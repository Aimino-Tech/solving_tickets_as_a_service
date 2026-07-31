# STAS Growth Initiative: Phase 2, Activation Funnel Optimization

> **Status**: Execution plan (strategy document)
> **Owner**: STAS Growth Initiative (AIM-4396)
> **Objective**: Optimize the activation funnel so newly installed repos reach their first merged fix quickly and reliably. Success is measured by two targets from the parent initiative: **time-to-first-fix under 60 seconds** and **merge rate above 40%**.

This document is the executable plan for Phase 2 of the growth initiative, mirroring the format of the Phase 4 content-engine roadmap (`docs/stas/growth-initiative-phase-4-content-engine.md`) and the Phase 6 roadmap (`docs/stas/growth-initiative-phase-6-one-million-users.md`). It defines the welcome experience for new installations, the merge-rate levers applied to every PR, the latency budget that keeps turnarounds fast, and the measurement cadence that decides whether the phase worked. It is deliberately concrete: every workstream names its files and the KPI that closes it.

**Reference points for this phase**

| Input | Where it lives | What it contributes |
|---|---|---|
| Parent initiative + Phase 2 checklist | Linear AIM-4396 (Phase 2 section), AIM-4408 | Success metrics, workstream checklist, target funnel |
| Welcome issue auto-creation | `src/webhooks/github.ts` (`createWelcomeIssue` :111-173, `installation.created` handler :209-313) | First-touch activation on install |
| PR quality gate | `src/github/prQualityGate.ts` (`handleCheckSuiteCompleted` :177-227) | CI pass gate before a PR is marked ready |
| Auto-review request | `src/github/prQualityGate.ts` (`requestReviewFromCollaborators` :65-112) | Merge-rate lever gated by `PR_AUTO_REQUEST_REVIEW` (default true) |
| Merge queue integration | `src/github/prQualityGate.ts` (`enableMergeQueue` :119-143) | Opt-in merge queue gated by `PR_MERGE_QUEUE_ENABLED` (default false) |
| Dispatch timeout | `src/config.ts` (`QUEUE_MSG_TTL_MS`, default `30_000`, :47) → `src/queue/rabbitmq.ts` (:144) | Latency budget for quick-turnaround issues |

---

## Purpose & Success Metrics

Phase 2 exists to make the path from *installation* to *first merged fix* as short and self-serve as possible. New users decide whether STAS works within their first few issues; a fast, visible first fix is the strongest activation signal available. The parent initiative sets two primary metrics; the supporting metrics below keep the funnel honest.

| Metric | Target | Source / basis |
|---|---|---|
| Time-to-first-fix | **< 60s** | AIM-4396 Phase 2 success metric; measured from webhook receipt to fix PR opened |
| Merge rate | **> 40%** | AIM-4396 Phase 2 success metric; share of fix PRs that reach a merged state |
| Welcome issue created | 100% of new installations | `installation.created` handler; measured per installation event |
| PRs with requested review | Rising | `requestReviewFromCollaborators`; measured per PR |
| Queue latency | < 30s for labeled issues | `QUEUE_MSG_TTL_MS` default 30,000ms; measured via queue metrics |

Targets are the parent initiative's Phase 2 success metrics. Baseline measurements come from the pipeline's run records; the reporting cadence in Measurement & Reporting decides whether the phase worked.

---

## The Activation Funnel

A four-stage funnel. Every new installation passes through the same stages; the difference is which workstream owns each stage.

| Stage | What happens | Owner | Output |
|---|---|---|---|
| 1. Welcome | On `installation.created`, STAS creates a welcome issue that explains how to trigger a fix | Webhook handler | Welcome issue labeled `stas:fix` on every repo of the installation |
| 2. Trigger | The user labels an issue (or a pre-seeded welcome issue) `stas:fix` | User / welcome issue | Issue queued on the `stas.issues.fix` queue |
| 3. Dispatch & fix | The fix pipeline picks the issue up, investigates, fixes, and opens a draft PR | Fix pipeline | Draft PR with regression test |
| 4. Review & merge | CI passes → STAS requests review from collaborators and (when enabled) joins the merge queue | Quality gate | Reviewed, merged PR |

**Latency budget**: labeled issues are dispatched with a message TTL of 30 seconds (`QUEUE_MSG_TTL_MS` default `30_000`, `src/config.ts:47`; applied to the fix queue at `src/queue/rabbitmq.ts:144`). Combined with the pre-warmed agent pool and streaming commit status, the target is time-to-first-fix under 60 seconds.

---

## The Four Workstreams (AIM-4408 checklist)

| # | Workstream | Status | Goal | File | KPI |
|---|---|---|---|---|---|
| 1 | Welcome issue auto-creation | **Done** | Create a welcome issue on `installation.created` so the first fix is one click away | `src/webhooks/github.ts` | Welcome issue on 100% of installs |
| 2 | PR quality gate | **Done** | Mark PRs ready only after CI passes | `src/github/prQualityGate.ts` | Zero ready PRs with failing checks |
| 3 | Auto-review request | **Done** | Request review from repo collaborators automatically | `src/github/prQualityGate.ts` | Review requested on qualifying PRs |
| 4 | Merge queue integration | **Done** | Join GitHub Merge Queue when enabled | `src/github/prQualityGate.ts` | Auto-merge on opt-in repos |

**Workstream 1: welcome issue auto-creation (done).** `createWelcomeIssue` (`src/webhooks/github.ts:111-173`) runs on the `installation.created` webhook event (`github.ts:209-313`, per-repo loop at :301-309). It ensures the trigger label exists (`config.stas.label`, color `0366d6`, description "Trigger a STAS AI fix for this issue"), then opens an issue titled "Welcome to STAS — let's fix your first issue" whose body walks through what happens next, the `stas:fix` label, and a demo issue, finishing with a "Powered by STAS" footer. The function is best-effort: failures are logged and surfaced but never fail the installation event.

**Workstream 2: PR quality gate (done).** `handleCheckSuiteCompleted` (`src/github/prQualityGate.ts:177-227`) reacts to `check_suite.completed` (wired at `src/webhooks/github.ts:1018-1042`) and only advances a PR to "ready" once CI has passed. This keeps the review queue clean: no PR is presented as ready for review with failing checks.

**Workstream 3: auto-review request (done).** `requestReviewFromCollaborators` (`src/github/prQualityGate.ts:65-112`), gated by `PR_AUTO_REQUEST_REVIEW` (default true), lists repo collaborators with push permission, excludes the PR author, picks `config.github.reviewersCount` reviewers, and requests review via `octokit.pulls.requestReviewers`, posting a comment (`🔄 **STAS** requested review from: @a, @b`). Deduplication prevents re-requesting on already-reviewed PRs.

**Workstream 4: merge queue integration (done).** `enableMergeQueue` (`src/github/prQualityGate.ts:119-143`), gated by `PR_MERGE_QUEUE_ENABLED` (default false, opt-in), uses `enablePullRequestAutoMerge` via GraphQL with `mergeMethod: MERGE` when a PR is merged or closed, so opted-in repos can batch-merge through GitHub Merge Queue.

**Dispatch timeout (done).** `QUEUE_MSG_TTL_MS` defaults to `30_000` (`src/config.ts:47`), cutting the previous 120-second dispatch timeout to 30 seconds for quick-turnaround issues. The value flows to `config.queue.msgTtlMs` (`src/config.ts:419`) and is applied to the `stas.issues.fix` queue (`src/queue/rabbitmq.ts:144`); other queues keep a 10-minute TTL.

---

## Latency Reduction

Beyond the dispatch timeout, the latency budget rests on two levers planned for this phase:

- **Pre-warmed agent pool**: keep agents warm so the pipeline does not pay cold-start on every issue. Not yet implemented; tracked as follow-up.
- **Commit status streaming**: surface pipeline progress as commit statuses so users see activity immediately. Not yet implemented; tracked as follow-up.

These two items are the remaining latency work from the design plan; the dispatch-timeout reduction already lands the first half of the <60s target.

---

## Measurement & Reporting

A weekly review against queue metrics and the pipeline's run records:

- **Time-to-first-fix**: webhook receipt to fix PR opened, tracked per run; the <60s target is measured on a rolling 7-day average.
- **Merge rate**: share of fix PRs that reach merged state; tracked per repo and overall.
- **Welcome issue coverage**: percentage of `installation.created` events that produced a welcome issue.
- **Queue latency**: time spent queued on `stas.issues.fix`; the 30s TTL is the hard bound.

The weekly report feeds the funnel: installations without a welcome issue get investigated at the webhook layer, and repos with low merge rates get reviewed for quality-gate misfires.

---

## Deliverable File Map

| AIM-4408 checklist item | Status | Files |
|---|---|---|
| Welcome issue auto-creation | Done | `src/webhooks/github.ts` (`createWelcomeIssue` :111-173, `installation.created` handler :209-313) |
| Reduce dispatch timeout 120s → 30s | Done | `src/config.ts` (`QUEUE_MSG_TTL_MS` :47), `src/queue/rabbitmq.ts` (:144) |
| PR quality gate | Done | `src/github/prQualityGate.ts` (`handleCheckSuiteCompleted` :177-227), wired in `src/webhooks/github.ts` :1018-1042 |
| Auto-request review | Done | `src/github/prQualityGate.ts` (`requestReviewFromCollaborators` :65-112), `PR_AUTO_REQUEST_REVIEW` |
| Merge queue integration | Done | `src/github/prQualityGate.ts` (`enableMergeQueue` :119-143), `PR_MERGE_QUEUE_ENABLED` |
| Design doc | Done | This document |

---

## Related Documents

- Parent initiative: **AIM-4396**, Phase 2: Activation Funnel Optimization
- This ticket: **AIM-4408**, Implement Phase 2: Activation Funnel Optimization
- Phase roadmap: `docs/stas/growth-initiative-phase-6-one-million-users.md` (Phase 2 of that roadmap consumes this funnel)
- Content roadmap: `docs/stas/growth-initiative-phase-4-content-engine.md`
