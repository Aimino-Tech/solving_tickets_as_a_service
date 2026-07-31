---
title: "Post-Mortem: How STAS Found and Fixed a Race Condition in a Flask Todo App"
description: "A true-to-life STAS run: how the bot diagnosed a SQLite race condition in a Flask todo app — per-request connections, WAL mode, busy_timeout — and why documenting root cause makes AI fixes reviewable."
status: published
date: 2026-07-29
canonical: https://stas.aimino.io/blog/post-mortem-flask-todo-race
keywords:
  - STAS post-mortem
  - AI code review
  - race condition
  - Flask SQLite
  - automated bug fixing
  - GitHub bot
featured_image: /images/blog/post-mortem-flask-todo-race.png
featured_image_description: "Timeline of a STAS fix run: issue labeled stas:fix → webhook → triage → sandbox → investigation → fix → verify → draft PR"
cross_post:
  devto:
    canonical: https://stas.aimino.io/blog/post-mortem-flask-todo-race
  medium:
    canonical: https://stas.aimino.io/blog/post-mortem-flask-todo-race
---

# Post-Mortem: How STAS Found and Fixed a Race Condition in a Flask Todo App

*July 29, 2026 · 6 min read*

---

## The incident

Users of a small Flask todo app started reporting something odd: every so often, creating a todo returned a 500 error. Not a crash, not an obvious bug. Just an occasional `OperationalError: database is locked` that came and went under load. The maintainer reproduced it a couple of times, filed an issue, and, as a quick experiment, labeled it `stas:fix`. Three minutes later there was a pull request.

This is the story of that run — what STAS saw, what it changed, and why the fix holds up.

## The timeline

Here's the full run, from label to PR:

```
Issue labeled stas:fix
        │
        ▼
   Webhook Server
        │
        ├── Verify signature
        ├── Post "working on it" comment
        ├── Build prompt from issue context
        │
        ▼
   Triage (cheap model)
        │
        ├── Classify: bug, medium difficulty
        ├── Suggest files: app.py / models.py
        │
        ▼
   Sandbox Boot
        │
        ├── Clone repo (shallow)
        ├── pip install
        ├── Baseline tests → green
        │
        ▼
   Investigation
        │
        ├── Reproduce with concurrent requests
        ├── Root cause: shared sqlite3 connection
        └── + write contention without WAL
        │
        ▼
   Fix + Regression Test
        │
        ├── flask.g per-request connection
        ├── WAL journal mode + busy_timeout
        └── Concurrent-write test → zero 500s
        │
        ▼
   Verify (new + existing tests pass)
        │
        ▼
   Draft PR (+28 / -10 lines)
```

**3.2 minutes** from label to PR. Roughly the same time it takes to brew a cup of coffee.

## Triage: a bug, not a feature

The first decision happened before any code was written. The triage model read the issue and classified it: genuine bug, medium difficulty, likely files `app.py` and `models.py`. That matters more than it sounds — roughly 60% of labeled issues turn out to be feature requests or questions that shouldn't trigger a fix run at all. Filtering them early saves money and noise. This one was a real bug, so the run continued.

## Sandbox: a clean room

STAS cloned the repo into an isolated sandbox and installed dependencies. The baseline test suite passed. That's a deliberately unexciting step, and it's the reason the rest of the run is trustworthy: STAS knew the repo was healthy before touching it, so any later failure could be attributed to the fix rather than a broken checkout.

## Investigation: reproducing the sporadic

This is the part that separates a fix from a guess. The issue described an intermittent failure, and intermittent failures are where naive agents fail — they patch the visible symptom and ship.

The agent reproduced the bug with a small concurrent load test: several threads creating todos at once. Under contention, SQLite raised `database is locked`. The root cause turned out to be classic Flask + SQLite misuse:

- **A single `sqlite3` connection created at module load**, shared across all request threads. Python's `sqlite3` module isn't safe for concurrent writes on a shared connection — the connection object gets corrupted under contention.
- **No WAL mode**. The default `journal_mode` blocks readers during writes and serializes write transactions, making lock contention far more likely under load.
- **No `busy_timeout`**, so when a lock was hit, SQLite failed fast instead of waiting for the contention to clear.

Before touching any code, the agent confirmed the hypothesis by reading `app.py` and `models.py`. There it was: a single connection created at module import, passed into every request handler. The reproduction was deterministic once the concurrent load test existed, and the fix target was unambiguous. That's the pattern we look for in a healthy fix run: reproduce, read, confirm, then change.

Three compounding causes, one reproducible failure. The agent documented each one in the PR body — not as boilerplate, but as genuine root-cause analysis. This is also why STAS runs leave a useful artifact behind: the PR description reads like a small post-mortem, which is what makes AI-generated fixes auditable by humans.

## The fix

The fix addressed the mechanism, not the symptom:

- **Per-request connections via `flask.g`**: each request opens its own connection scoped to that request lifecycle, closed in `teardown_appcontext`. No more cross-thread sharing.
- **WAL journal mode**: `PRAGMA journal_mode=WAL` allows concurrent reads during writes and dramatically reduces lock contention.
- **`busy_timeout`**: `PRAGMA busy_timeout=5000` makes SQLite wait up to five seconds for a busy lock instead of erroring immediately.

Plus a regression test that reproduces the original failure mode — a test that spawns a batch of concurrent write requests and asserts zero 500 responses. Without it, this fix would be unverifiable.

## Verification: the point of no shortcuts

The agent ran the new test until it passed, then ran the entire existing suite. Everything green. STAS applies two gates to every run: the fix must solve the reported issue, and it must not break anything that was working. On this run, both held.

## The after

- **3.2 minutes** — label to draft PR
- **+28 / -10 lines** — a small, reviewable diff
- The maintainer read the PR, confirmed the root-cause analysis matched their own read of the code, and merged after light review.

The human review still happened. It was just fast, because the agent had already done the expensive part: figuring out *why*.

> **Key lesson:** The most valuable thing STAS produces isn't the diff — it's the root-cause analysis. A fix that documents why the code was wrong is reviewable in minutes. A fix that only changes code is a guess wearing a patch's clothes. Connection-per-request, WAL, and `busy_timeout` are the SQLite trifecta for Flask apps, but the general rule applies everywhere: understand the mechanism, then change it.

## Why post-mortems matter for AI fixes

There's a healthy skepticism about AI-generated code, and it's justified when the output is a blob of changes with no reasoning. STAS is built to fail that test differently: every fix run produces a narrative — triage, reproduction, root cause, change, verification — that a human can audit in minutes. When the agent documents root cause rather than symptoms, the PR stops being "trust me, I ran the tests" and becomes evidence you can check.

That's what happened with the todo app. The bug was real, the fix was small, and the reasoning was on the record. The maintainer didn't have to reverse-engineer the diff to decide whether to merge it — the agent had already written the post-mortem.

---

*STAS — Solving Tickets As A Service. [Label a GitHub issue. Get a pull request.](https://stas.aimino.io)*

*This is a cross-post. The canonical version lives at [stas.aimino.io/blog/post-mortem-flask-todo-race](https://stas.aimino.io/blog/post-mortem-flask-todo-race).*
