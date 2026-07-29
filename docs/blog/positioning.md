---
title: "The most important skill for AI coding tools isn't writing code — it's knowing what to write"
description: "Why STAS founder built an AI that plans before coding. The bottleneck isn't code generation — it's understanding the problem. Async workflow: label an issue, get a PR, stay in flow."
status: draft
date: 2026-07-28
canonical: https://stas.aimino.io/blog/positioning
keywords:
  - AI coding tools
  - automated bug fixing
  - developer productivity
  - context switching
  - AI planning
  - STAS founder story
  - async development workflow
featured_image: /images/blog/positioning.png
featured_image_description: "Developer on a laptop, seamless flow state with code on screen and a STAS PR notification arriving in the background — no context switch"
cross_post:
  devto:
    canonical: https://stas.aimino.io/blog/positioning
  medium:
    canonical: https://stas.aimino.io/blog/positioning
---

# The most important skill for AI coding tools isn't writing code — it's knowing what to write

*July 28, 2026 · 7 min read*

---

## The context-switch tax

I was debugging a race condition in a distributed rate limiter. The stack trace pointed to a `Promise.all` call where one promise rejected and the error was swallowed. Classic. I knew the fix. It was three lines.

But before I could write those three lines, I needed to:

1. Re-read the full rate limiter module to remind myself of the control flow.
2. Trace through the test suite to understand what edge cases were already covered.
3. Check the Git history to see if someone had tried to fix this before — and why their approach failed.
4. Consider whether the fix would affect other parts of the system that depend on rate limiter guarantees.

By the time I'd done all that, the context-switch tax had already been paid. I was no longer thinking about the rate limiter. I was thinking about the PR I'd been reviewing before this bug report came in, the Slack message I'd half-read, and the config file I'd been editing for an unrelated project. It took another 10 minutes to re-establish flow.

This is the developer experience that STAS was built to eliminate.

## The founding insight: understanding is the bottleneck

When I started building STAS, the assumption everyone made was that code generation would be the hard part. "How do you get the AI to write good code?" was the question I heard most often. The implicit belief was that if you could just make the AI produce correct code, everything else would follow.

But my experience — and the data that's emerged since — points to a different conclusion. **The hard part isn't generating code. The hard part is understanding what code to generate.**

Consider what happens when a real developer fixes a bug:

1. **Understand the report**: What is the user experiencing? What did they expect to happen? Can we reproduce it?
2. **Navigate the codebase**: Which files are relevant? What's the control flow? Where does the bug manifest?
3. **Form a hypothesis**: What's causing the bug? What's the minimal fix? What could go wrong?
4. **Implement and verify**: Write the fix, run tests, check for regressions, clean up.

Steps 1-3 are about **understanding**. Step 4 is about **generation**. And for most bugs, steps 1-3 take 80% of the time — even for experienced developers who know the codebase.

AI coding tools that skip steps 1-3 are generating code without understanding. They're typing without knowing what to type. The results are predictably unreliable — not because the model can't write code, but because it doesn't know what to write.

## Why we built STAS differently

STAS was designed from the ground up around the understanding-first philosophy. The entire pipeline is organized around a simple idea: **before any code is generated, the issue and codebase must be thoroughly understood**.

This manifests in three concrete design decisions:

### 1. The triage phase is not optional

Every issue that enters STAS is first classified by a cheap, fast model (`gpt-4o-mini`, ~$0.10 per classification). It determines: Is this a bug? A feature request? A question? How complex is it? Which files are likely relevant?

This does two things. First, it catches the ~60% of labeled issues that don't need code changes at all — feature requests, questions, "known unknowns." Those get a polite response instead of a wasted agent run. Second, it produces a structured brief that the agent can use to bootstrap its investigation. The agent doesn't start from zero; it starts from "the triage model thinks this is a medium-complexity bug in the auth module, specifically around token refresh logic."

### 2. Code intelligence precedes code generation

Before STAS's agent writes a single line of code, it builds a complete understanding of the relevant code:

- A **symbol index** of all function declarations, class definitions, type exports, and import relationships.
- A **dependency graph** showing which files depend on which.
- A **type map** that tracks cross-file type references.
- **Baseline test results** that establish what "passing" looks like before any changes.

This isn't just nice-to-have context. It's what enables the agent to make changes with confidence. When the agent modifies `authService.ts`, it knows that `UserController.ts` imports from it, and it can verify that the change doesn't break the type contract.

### 3. Verification is mandatory

STAS won't create a PR until it can prove the fix works. This means:

- The pre-fix test suite must pass (baseline).
- The post-fix test suite must pass (no regressions).
- A reproduction test must pass on the fix but fail on the original code (the fix actually addresses the issue).

This verification gate is what pushes STAS's pass rate to 92%. Without it, the pass rate would be significantly lower — because even with the best understanding, agents sometimes produce broken code. The verification step catches that before it reaches your repository.

## AI tools should be architects first, typists second

The broader lesson extends beyond STAS. The AI coding industry has been fixated on code generation quality — better models, longer context windows, more tokens per second. These improvements matter, but they're addressing the wrong bottleneck.

A model that writes code 10x faster is marginally useful if it's writing the wrong code. A model that spends 80% of its time understanding the problem and 20% generating code will produce better results than one that does the inverse — even if the inverse model generates code 5x faster.

This is why STAS's architecture invests so heavily in what we call the **"understand-verify" loop**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Understand-Verify Loop                     │
│                                                               │
│   Issue → Triage → Code Intel → Investigate → Plan → Fix →   │
│                                                               │
│   At each stage: have we understood correctly?                │
│   Verify before proceeding.                                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

The analogy is to architecture vs. typing. An architect designs the building, considers the constraints, verifies the structural integrity, and produces a blueprint. The typist types the blueprint. Both skills are necessary. But pouring all your effort into a better typist while ignoring the architect produces buildings that collapse.

## The async workflow: no IDE needed, no context switch

The most practical outcome of STAS's understanding-first approach is that it enables a genuinely **async workflow** — one that doesn't require the developer to context-switch at all.

Here's how it works:

1. **You**: An issue comes in. You read the title and description. If it looks like a straightforward bug, you add the `stas:fix` label. **Time spent: 15 seconds.** No context switch because you were already in the issue tracker.
2. **STAS**: Takes the issue, runs the full pipeline (triage → sandbox → investigation → fix → verification → PR). **Elapsed time: ~30 seconds.** You don't need to wait for this.
3. **You**: Later — when you're in a review headspace, not in the middle of something else — you see a draft PR from STAS in your notifications. You review it. **Time spent: 3-5 minutes.** One context switch, but it's a deliberate one.

This is radically different from the Copilot or Cursor workflow, where the tool activates inside your editor and responds to prompts as you type. Those tools are **synchronous** — they require your attention in the moment. STAS is **asynchronous** — it processes work independently and surfaces results when you're ready for them.

The implications are profound:

- **No context switching**: You don't drop what you're doing to fix a bug. The bug gets fixed in parallel.
- **No flow interruption**: Your deep work session stays intact.
- **Queue-based processing**: Fixes are queued, prioritized, and processed in order. You can triage 20 issues in 5 minutes and get 20 PRs back within the hour.
- **Review on your schedule**: PRs arrive asynchronously. Review them during your designated review time, not when the notification pops up.

## What's next

The understanding-first philosophy is still in its early stages. Our roadmap for the next 12 months focuses on deepening STAS's ability to understand — not just individual bugs, but entire codebases and the patterns of reasoning that development teams use:

- **Learning from review**: When you reject a STAS PR, we want to learn why and apply that to future fixes. Each review interaction trains a per-team model of coding standards and preferences.
- **Cross-repository understanding**: Many bugs span multiple repos (a frontend issue caused by a backend API change). STAS should understand those relationships.
- **Proactive bug detection**: Instead of waiting for an issue label, STAS should surface potential bugs based on code patterns it's learned to associate with real issues.

The thread connecting all of these is the same: **better understanding leads to better fixes.** Code generation is commodity. Understanding is the differentiator.

---

*STAS — Solving Tickets As A Service. [Label a GitHub issue. Get a pull request.](https://stas.aimino.io)*

*This is a cross-post. The canonical version lives at [stas.aimino.io/blog/positioning](https://stas.aimino.io/blog/positioning).*
