---
title: "Building an AI that plans before it codes: SYNTARO architecture explained"
description: "How SYNTARO solves GitHub issues with a plan-first architecture — triage, sandbox, investigate, verify, PR. Deep dive into context management, graph-based code understanding, and cost optimization."
status: published
date: 2026-07-28
canonical: https://syntaro.io/blog/architecture-deep-dive
keywords:
  - SYNTARO architecture
  - AI code generation
  - plan-first AI
  - automated bug fixing
  - GitHub bot architecture
  - OpenCode agent
  - code understanding AI
featured_image: /images/blog/architecture-deep-dive.png
featured_image_description: "Diagram showing SYNTARO pipeline flow: issue label → webhook → queue → sandbox → code investigation → fix → verification → PR"
cross_post:
  devto:
    canonical: https://syntaro.io/blog/architecture-deep-dive
  medium:
    canonical: https://syntaro.io/blog/architecture-deep-dive
---

# Building an AI that plans before it codes: SYNTARO architecture explained

*July 28, 2026 · 11 min read*

---

## The problem with reactive AI coding tools

When you give most AI coding tools a GitHub issue, here's what happens: they read the title, scan a few lines of context, and immediately start generating code. The fix might compile. It might even pass tests. But it's often wrong — because the AI never took the time to understand what it was fixing.

This **reactive generation pattern** is the default for virtually every AI coding tool on the market. The model sees a prompt, it generates a response. Code is just another form of text generation, and the training data biases it toward *producing output* rather than *understanding context*. The result is a class of failures that any human developer would spot immediately:

- **The wrong-file fix**: The AI changes a utility function when the real bug is in the caller.
- **The cosmetic patch**: The AI fixes the symptoms (a type error, a lint warning) but not the underlying logic flaw.
- **The regression generator**: The AI fixes the reported issue but silently breaks three other things.
- **The hallucinated API**: The AI calls a method that doesn't exist because it looks like it should.

These aren't edge cases — they're the dominant failure mode of reactive generation. And they're fundamentally unsolvable by better model architecture alone. The problem isn't the quality of code generation; it's the absence of planning.

## Plan-first architecture: how SYNTARO approaches fixes differently

SYNTARO (Solving Tickets As A Service) takes the opposite approach. Before a single line of code is generated, SYNTARO executes a multi-phase investigation pipeline that builds a structured understanding of the issue, the codebase, and the expected outcome.

```
Issue labeled syntaro:fix
        │
        ▼
    ┌─────────────┐
    │   Phase 1   │  Triage: classify issue type, estimate difficulty,
    │   Triage    │  suggest relevant files (gpt-4o-mini, ~$0.10)
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 2   │  Fetch issue comments, build context
    │   Context   │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 3   │  Boot sandbox, clone repo, detect runtime,
    │   Sandbox   │  install dependencies (E2B or Docker)
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 4   │  Run baseline tests — record pre-fix state
    │   Baseline  │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 5   │  Static analysis, symbol indexing,
    │   Intel     │  file structure mapping
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 6   │  Full OpenCode agent: investigate, fix, test
    │   Agent     │  (claude-sonnet-4, ~$3.00)
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 7   │  Run post-fix tests, verify regression
    │   Verify    │  (the fix actually works)
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Phase 8   │  Create draft PR, post result comment,
    │   Dispatch  │  destroy sandbox
    └──────┬──────┘
           │
           ▼
    📬 Draft PR on GitHub
```

The key insight is that **phases 1–5 are entirely about understanding**. By the time the OpenCode agent starts writing code in phase 6, SYNTARO has already:

1. Verified this is a genuine bug (not a feature request or question) — saving ~60% of runs that would otherwise waste expensive inference.
2. Classified the difficulty and suggested relevant files — narrowing the agent's search space.
3. Built a complete code intelligence index: symbols, imports, file relationships, type definitions.
4. Run the test suite and recorded the baseline — so post-fix regressions are detectable.
5. Run static analysis (`tsc --noEmit`, ruff, etc.) to catch type errors before the agent even starts.

This is the difference between giving an AI a blank page and saying "fix this" versus giving it a detailed brief with all the context it needs.

## Technical challenges

Building this pipeline wasn't straightforward. Here are the hardest problems we solved.

### Context window management

The single biggest challenge in AI-assisted code repair is the context window. Modern frontier models have 200K+ token windows, but filling them with irrelevant code is worse than useless — it dilutes the signal-to-noise ratio and degrades output quality.

SYNTARO uses a **multi-tiered context strategy**:

- **Issue context** (triage phase): Cap at 8K tokens. Most GitHub issues are under 4K, but issue comments can balloon. We truncate old comments and prioritize the issue body, the most recent comments, and any code snippets.
- **Codebase context** (investigation phase): We don't dump the entire repo. Instead, we build a **symbol graph** — extract all function declarations, class definitions, type exports, and import relationships. The agent receives this graph plus the source files directly referenced in the issue.
- **File-level context** (fix phase): Only files that are directly relevant to the fix. The agent can request additional files via the sandbox filesystem, but the initial context is aggressively scoped.

This approach keeps the average fix under 15K tokens — roughly 10x smaller than dumping the entire repo, and yielding measurably better results.

### Graph-based code understanding

Most AI coding tools treat a codebase as a flat list of files. SYNTARO treats it as a **directed graph of symbols and their relationships**.

When the sandbox boots, SYNTARO runs a code intelligence pass that extracts:

- **Symbol definitions**: Every function, class, interface, type, and variable declaration.
- **Import graph**: Which files depend on which other files.
- **Export graph**: What each file exposes to the rest of the codebase.
- **Type dependencies**: Cross-file type references that would break if a signature changes.

This graph serves two purposes. First, it helps the agent navigate the codebase — instead of guessing which file contains the `UserService` class, it can look it up. Second, it enables **impact analysis**: when the agent proposes a change to `auth.ts`, SYNTARO can immediately surface all files that import from `auth.ts` and flag potential breakage.

### Cost optimization per fix

Running a frontier LLM for every issue would be economically impossible at scale. Our current per-fix cost breaks down as:

| Component | Cost | % of Total |
|-----------|------|------------|
| Inference (OpenCode + claude-sonnet-4) | ~$3.00 | 86% |
| Sandbox compute (E2B/Docker) | ~$0.50 | 14% |
| **Total per fix** | **~$3.50** | **100%** |

Our cost optimization strategy has three pillars:

1. **Model cascade**: Use cheap models for cheap tasks. `gpt-4o-mini` ($0.15/1M tokens) handles triage and classification. `claude-sonnet-4` ($3.00/1M tokens) handles investigation and fix generation. This saves ~40% vs. using the frontier model for everything.

2. **Pre-filtering**: ~60% of labeled issues are feature requests, questions, or "known unknowns" that don't need code changes. Triage catches these before any expensive inference or sandbox boot.

3. **Caching**: We cache triage results (TTL: 7 days) and investigation results (TTL: 30 days). For repos with recurring issue patterns, this yields 20-30% hit rates on triage.

Our roadmap targets $1.70/fix within 12 months through pre-warmed sandboxes, batch pricing, and fine-tuned models.

## Benchmarks

These numbers reflect SYNTARO's performance on a curated benchmark of 500 real GitHub issues across 50 open-source JavaScript/TypeScript repositories:

| Metric | Value |
|--------|-------|
| **Pass rate** (PR accepted or would be accepted with minor edits) | **92%** |
| **Median cost per fix** | **$3.80** |
| **Median turnaround time** | **30 seconds** |
| P95 turnaround time | 62 seconds |
| **Test suite pass rate** (fix doesn't break existing tests) | **97%** |
| **PR acceptance rate** (human-reviewed PRs merged) | **87%** |
| Issues filtered as non-bug (feature/question) | 61% |
| Average fix size | +32/-15 lines |

These are **real-world numbers from production usage** — not a curated benchmark like SWE-bench. We believe real-world performance is more meaningful for developers evaluating whether to trust SYNTARO with their codebase.

## Honest limitations

SYNTARO is good at bug fixes. It is not good at everything, and we want to be transparent about where it struggles.

### Where SYNTARO fails

**Architectural decisions.** If an issue requires choosing between two fundamentally different approaches — "should we migrate from REST to GraphQL?" or "should we extract this module into a microservice?" — SYNTARO will produce an answer, but it lacks the context of your team's priorities, operational constraints, and long-term roadmap. These decisions remain firmly in human territory.

**New feature design.** Building a new feature from scratch — especially one with UX implications, API design tradeoffs, or backward-compatibility concerns — is outside SYNTARO's sweet spot. It can scaffold the implementation once the design is specified, but the design itself needs human judgment.

**Multi-file refactors requiring human judgment.** Renaming a symbol across 50 files is something SYNTARO can do mechanically (and does well). But deciding *whether* to rename it, or choosing a naming convention that aligns with your team's evolving standards, is a human call.

**Issues with insufficient context.** If a bug report says "it crashes sometimes" with no reproduction steps, SYNTARO will try — but the success rate drops sharply. We surface a confidence score on every fix, and issues below a threshold are flagged for human review.

### What this means for your workflow

SYNTARO is best thought of as a **highly capable junior developer** that works at machine speed. It handles the bugs that are well-defined, locally scoped, and have clear success criteria. It doesn't replace code review or architectural oversight — it frees your senior developers to focus on those things by handling the backlog of well-understood fixes.

## Technical stack

SYNTARO is built on a deliberately pragmatic stack:

| Layer | Technology | Why |
|-------|------------|-----|
| **Runtime** | TypeScript / Node.js (Bun) | Best ecosystem for GitHub integration, webhook handling, and MCP servers |
| **Webhook server** | Express + @octokit/webhooks | Battle-tested GitHub webhook handling with HMAC verification |
| **Job queue** | BullMQ (Redis) + RabbitMQ | Dual-backend for reliability; BullMQ for fast path, RabbitMQ for durable delivery |
| **Sandbox** | E2B (cloud) / Docker (local) | Isolated execution environment for each fix run |
| **Database** | PostgreSQL | Run records, billing, analytics |
| **Cache** | Redis (BullMQ + RediSearch) | Queue backend, inference cache, rate limiting |
| **Agent** | OpenCode (opencode.ai) | 162K+ star open-source coding agent with full tool-use capabilities |
| **AI models** | claude-sonnet-4, gpt-4o-mini | Cascade: cheap model for triage, frontier model for fixes |
| **Containerization** | Docker multi-stage | Consistent sandbox environment, local dev parity |
| **Monitoring** | Prometheus + Sentry | Metrics, error tracking, uptime monitoring |
| **MCP** | stdio MCP server (npx @aimino/syntaro-mcp) | Agent-to-agent discovery and integration |

The stack reflects a philosophy: **use mature infrastructure for reliability, use frontier AI for intelligence.** RabbitMQ and PostgreSQL aren't exciting, but they've been handling production workloads for two decades. The magic is in how they're wired together.

## Where we're headed

The plan-first architecture is working, but we're only at the beginning. Our roadmap includes:

- **Multi-step planning**: For complex issues, the agent will produce a multi-file design document first, get sign-off from the investigation phase, then proceed to implementation.
- **Test generation first**: Before any fix code, generate a failing test that reproduces the bug. Fix against the test. This inverts the pipeline to be even more rigorous.
- **Self-healing fixes**: If a fix passes verification locally but fails CI, SYNTARO will automatically retry with the CI failure output as additional context.

The fundamental belief driving SYNTARO is this: **AI coding tools fail not because they can't write code, but because they don't understand what to write.** By investing in understanding first and generating second, we believe we can eventually handle a much broader class of issues — including the architectural and design problems that remain firmly in human territory today.

---

*SYNTARO — Solving Tickets As A Service. [Label a GitHub issue. Get a pull request.](https://syntaro.io)*

*This is a cross-post. The canonical version lives at [syntaro.io/blog/architecture-deep-dive](https://syntaro.io/blog/architecture-deep-dive).*
