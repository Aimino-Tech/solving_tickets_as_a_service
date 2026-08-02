---
title: AIM-4495 — Story-Level Re-Derivation of STAS Megas 3180/3181/3179/3182
---

# AIM-4495: Story-Level Re-Derivation of STAS Megas 3180/3181/3179/3182

**Date**: 2026-08-02
**Baseline**: `aimino/main` @ `4effcab` (includes AIM-4477 MCP server + AIM-4481 green-build)
**Baseline gates**: `npm run build` exit 0 · `npm test` 2196 passed / 43 skipped, exit 0

## Purpose

The four STAS mega tickets (AIM-3180, AIM-3181, AIM-3179, AIM-3182) were marked
Verified with PR-link-only descriptions — no enumerated story lists — so the
2026-08-01 re-audit could not story-verify them. This document re-derives the
story list for each mega from the ticket titles, the linked PRs' changed files,
and the current `aimino/main` code, then verifies every story against the code
with file:line evidence.

## Method

1. Fetched each mega's full Linear content + linked PR metadata
   (STAS PRs #467/#470/#472/#473, OpenSymphony PRs #677/#679/#680/#681).
2. Derived the story list per mega from ticket titles + PR changed-file lists.
3. Verified each story against `aimino/main` @ `4effcab` using file reads and
   greps of the working tree (which equals `origin/main`).
4. Verdict per story: **IMPLEMENTED** / **PARTIAL** / **MISSING**, each with
   file:line evidence.

## Verdict Tables

### MEGA 5 — AIM-3180: STAS Pipeline & Quality (pipeline ops, quality gates, sandbox, compliance)

| Story | Verdict | Evidence |
|---|---|---|
| Pipeline ops (executor, state machine, sessions) | IMPLEMENTED | `src/pipeline/pipelineExecutor.ts` (`runPipelineGates` L330-331), `src/pipeline/stateMachine.ts` (`STAGE_ORDER` L26, `PHASE_STAGE_MAP` L41, `advanceStage` L53), `src/pipeline/pipelineWebhooks.ts`, `src/pipeline/sessionOrchestrator.ts` |
| Quality gates — 5 code gates (build/test/lint/security/sandbox) | IMPLEMENTED | `src/pipeline/quality-gates.ts`: `gateBuild` L79, `gateTest` L144, `gateLint` L205, `gateSecurity` L277 (secret regex L324-332, malicious patterns L354-364), `gateSandbox` L419; `runAllGates` L506, `runQuickGates` L571 |
| 6 deterministic quality gates (reality/compile/test-integrity/hallucination/dead-code/AI-tool) | IMPLEMENTED | `scripts/quality-gates.sh` L4-14 (gate list), `run_gate` L100; gate 1 reality L115-193, gate 2 compile L200, gate 3 test integrity L218, gate 4 hallucination L291, gate 5 dead code L385, gate 6 AI-tool L438+; runnable via `npm run quality-gates` |
| Sandbox isolation (docker orchestrator, resource limits, validation) | IMPLEMENTED | `src/sandbox/orchestrator.ts` (class L101, env setup L278-285, `validateSandboxIsolation` L387), `src/sandbox/docker.ts`, `gitGuard.ts`, `pool.ts` |
| Compliance checks (code review, dependency audit, license, security scan) | IMPLEMENTED | `src/pipeline/compliance.ts`: `checkCodeReview` L64, `checkDependencyAudit` L141, `checkLicenseCompliance` L229, `checkSecurityScan` L341, `runComplianceChecks` L451, `getComplianceSummary` L522 |
| Compliance wired into dispatch/pipeline flow | **MISSING** | `runComplianceChecks` called only from `src/routes/quality.ts:215` (API surface) — no call site in the webhook→dispatch or fix-PR pipeline path |
| Quality/compliance API + score card | IMPLEMENTED | `src/routes/quality.ts`: `POST /api/quality/gates/run` L61, `GET /api/quality/gates/status/:id` L156, `GET /api/quality/compliance` L182, score-card GET L240 / POST L319 / `:id` L352; router mounted `/api/quality` at `src/server.ts:1071` |

### MEGA 6 — AIM-3181: STAS Monitoring, API, Deployment (health dashboard, REST API, webhooks, CLI, Docker)

| Story | Verdict | Evidence |
|---|---|---|
| Monitoring metrics (SLOs, SLIs, capacity, anomalies, cost, circuit breaker) | IMPLEMENTED | `src/monitoring/`: `slos.ts` (`SLO_TARGETS` L62, `generateSLOReport` L211), `sloReporter.ts` (class L31), `alerting.ts` (`dispatchAlert` L102), `anomalyDetection.ts` (5 checkers L19-119), `capacityAlerts.ts` (`checkDiskUsage` L87, `checkCostSpike` L124), `costBreakdown.ts` (`recordFixCost` L150), `circuitBreaker.ts` (`checkCircuit` L147), `tenantHealth.ts` (`computeTenantHealth` L264) |
| Health dashboard + health routes | IMPLEMENTED | `src/routes/health.ts`: `/health` L66, `/health/verbose` L78, `/health/queue` L89, `/health/dependencies` L99, `/health/sla` L109; mounted `src/server.ts:740`; `GET /api/monitoring/status` at L745 |
| SLA metrics/reporting/escalation | IMPLEMENTED | `src/routes/sla.ts`: `/sla/metrics` L162, `/sla/status` L210, `/sla/report` L261, `/sla/escalate` L306, `/sla/tickets/:ticketId` L334; mounted `src/server.ts:815` |
| REST API v1 (runs, stats, audit, billing, config) | IMPLEMENTED | `src/server.ts` mounts: `/api/v1/me`+`/api/v1/config` L785, `/api/v1/stats` L792, `/api/v1/audit` L793, `/api/v1/billing` L796-798, `/api/v1/status` L1113, `/api/v1/runs` L1136 |
| Status endpoint | IMPLEMENTED | `src/routes/status.ts` `GET /api/v1/status` L22; mounted `src/server.ts:1113` |
| Webhooks (routing, retry, health, metrics) | IMPLEMENTED | `src/webhooks/`: `webhookRouter.ts` (`enqueue` L126), `eventLogger.ts` L129, `retryWorker.ts` L205, `healthMonitor.ts` L309, `metrics.ts` L117, plus `github.ts`/`gitlab.ts`/`bitbucket.ts`/`base.ts` |
| Distributed tracing (W3C trace context) | IMPLEMENTED | `src/monitoring/tracing.ts` (`getPipelineTracer` L12, `startPhaseSpan` L19, `PHASE_SPAN_NAMES` L8); merged via PR #706 (AIM-4243) |
| API keys | IMPLEMENTED | `src/routes/mcpKeys.ts`; router mounted `/api/v1/mcp-keys` `src/server.ts:788` |
| CLI (ops CLI) | **PARTIAL** | `packages/stas-cli/src/cli.ts` exposes only the `quickstart` command (L9-16); no monitoring/ops/admin commands |
| Docker deployment | IMPLEMENTED | `Dockerfile` + `Dockerfile.smithery` + 6 compose files (`docker-compose.yml`, `.dev`, `.e2e`, `.eval`, `.prod`, `.worker`) covering redis/rabbitmq/postgres/bot/worker/flower/n8n |
| GitHub Action (stas-fix) | IMPLEMENTED | `.github/actions/stas-fix/action.yml` (`name: 'STAS — Auto Fix Issues'`; inputs `opencode-url`, `opencode-model`, `github-token`) |
| Synthetic monitoring | IMPLEMENTED | `src/monitoring/syntheticMonitor.ts` (`runSyntheticCheck` L174, `isSyntheticMonitorHealthy` L326), `src/monitoring/syntheticCheck.ts` (`runSyntheticE2ECheck` L29) |

### MEGA 4 — AIM-3179: STAS Billing, Team, Onboarding (billing modules, Stripe, RBAC, onboarding wizard, audit logs)

| Story | Verdict | Evidence |
|---|---|---|
| Billing modules (plans, usage limits, quotas, trials, licenses) | IMPLEMENTED | `src/billing/`: `plans.ts` (`PLANS` L83, `getMonthlyFixLimit` L193), `usage.ts` (`hasExceededUsageLimit` L155, `checkUsageBeforeFix` L272), `trial.ts` (`startTrial` L137, `canUseTrial` L249), `license.ts` (`verifyLicenseKey` L28), `index.ts` (`initBilling` L66) |
| Stripe integration (checkout, portal, subscriptions, invoices) | IMPLEMENTED | `src/billing/stripe.ts`: `findOrCreateCustomer` L79, `createSubscriptionCheckoutSession` L127, `createBillingPortalSession` L230, `getSubscription` L253, `listInvoices` L263, `cancelSubscriptionAtPeriodEnd` L278, `updateSubscriptionPlan` L307 |
| Stripe webhook handler | IMPLEMENTED | `src/billing/webhook.ts` `createBillingWebhookHandler` L72 |
| Billing API | IMPLEMENTED | `src/billing/routes.ts` (406 lines); mounted `/api/v1/billing` `src/server.ts:798`; credits usage `src/server.ts:833` |
| Team management (create, invite, roles, remove) | IMPLEMENTED | `src/team/index.ts`: `createTeam` L86, `listTeams` L130, `getTeamDetails` L146, `inviteMember` L197, `changeMemberRole` L272, `removeMember` L342; routes `src/team/routes.ts` (POST `/` L66, POST `/:id/invite` L179, role L249, DELETE member L314) mounted `/api/teams` `src/server.ts:863` |
| RBAC (role-based access) | IMPLEMENTED | `src/team/index.ts` `hasRole` L403 + `TeamRole`; route `POST /:id/members/:userId/role` L249 |
| Onboarding wizard (4-step) | IMPLEMENTED | `src/onboarding/wizard.ts`: `startWizard` L237, `recordGitHubInstallation` L255, `recordRepoSelection` L287, `recordBillingSetup` L323, `recordTeamSetup` L359, `isOnboardingComplete` L433; mounted `/api/v1/onboarding` `src/server.ts:846` |
| Audit logs (events, query, export, retention) | IMPLEMENTED | `src/audit/service.ts` (`logWebhookReceived` L42, `logFixJobEvent` L71, `logPrCreated` L101, `logCreditTransaction` L128, `logTierChange` L159, `logAdminAction` L186, `logRateLimitHit` L210, `logTeamEvent` L244, `logOnboardingEvent` L266, `queryAuditLogs` L291, `enforceRetentionPolicy` L395); `middleware.ts` `auditMiddleware` L86; `export.ts` `streamAuditExportCsv` L231 |
| SSO | **MISSING** | No SSO/team-SSO module; only a conditional SAML route (`src/server.ts:1142`) exists |
| Demo repo / repo-connection onboarding | **PARTIAL** | Onboarding wizard has a `repo-selection` step (`recordRepoSelection` L287) but no demo-repo provisioning/seeding path found |

### MEGA 7 — AIM-3182: STAS Multi-Platform & Common Sense Gate (platform abstraction, guardrails, sanity checks)

| Story | Verdict | Evidence |
|---|---|---|
| Platform abstraction (github/gitlab/bitbucket connectors) | IMPLEMENTED | `src/webhooks/github.ts`, `gitlab.ts`, `bitbucket.ts`, `base.ts`, `webhookRouter.ts` (embeds `platform` source field); `docs/platforms/README.md` (GitHub Live, GitLab/Bitbucket Beta) |
| Platform validation (URL/repo/branch/webhook) | IMPLEMENTED | `src/guardrails/platformValidator.ts`: `validateRepoIdentifier` L16, `validateBranchName` L35, `validateWebhookUrl` L49 |
| Common sense gate (platform/URL/issue/repo/invariants) | IMPLEMENTED | `src/guardrails/commonSenseGate.ts`: `runCommonSenseGate` L167, `validatePlatformUrl` L76, `validateIssueReference` L110, `validateRepoName` L120; `DESTRUCTIVE_INSTRUCTION_PATTERNS` L57 enforced over issue body at L190-194 |
| Gate wired into dispatch (fail-closed) | IMPLEMENTED | `src/webhooks/webhookRouter.ts` `enqueue` L126-149 (rejects + logs, never enqueues); `src/webhooks/github.ts` L402-403, L659-660; `src/server.ts` L243-244, L1279-1280 (`guardIssueJobData`); fail-closed wiring documented in `docs/platforms/README.md` |
| Gate tests | IMPLEMENTED | `src/__tests__/guardrails/commonSenseGate.test.ts` (PR #473); full suite 2196 passing |
| Cost/benefit + sanity checks in gate | **PARTIAL** | Destructive-instruction invariants active on issue body; no explicit cost-benefit analysis module (OpenSymphony `cost_benefit.ex` analog absent) |

## Ranked Remaining Gaps

1. **(AIM-3180) Compliance checks not wired into the dispatch/pipeline flow** — `runComplianceChecks` is only exposed via `GET /api/quality/compliance` (`src/routes/quality.ts:215`); it never runs on the webhook→dispatch or fix-PR path. A compliance gate should gate PR creation / issue dispatch.
2. **(AIM-3181) CLI is minimal** — `packages/stas-cli/src/cli.ts` has only a `quickstart` command (L9-16); no monitoring, status, or ops commands promised by the mega.
3. **(AIM-3179) SSO missing** — only a conditional SAML route exists (`src/server.ts:1142`); no SSO/team-SSO implementation despite the mega's team scope.
4. **(AIM-3182) Cost/benefit gate analog not ported** — destructive-instruction invariants exist (`commonSenseGate.ts` L57-74), but no cost-benefit scoring/analysis module (OpenSymphony `cost_benefit.ex` equivalent).
5. **(AIM-3179) Demo-repo onboarding partial** — wizard has `repo-selection` step (`wizard.ts` L287) but no demo-repo provisioning.

## Baseline Verification

- `npm run build` → exit 0 (tsc clean, includes `packages/github-client` workspace build)
- `npm test` → 178 files passed, 2196 tests passed / 43 skipped, exit 0

## Cross-References

- AIM-3180 / AIM-3181 / AIM-3179 / AIM-3182 (megas verified herein)
- AIM-3200 (MEGA 8 production launch readiness — downstream consumer of these gates)
- STAS PRs #467, #470, #472, #473, #705, #706, #707, #745
- OpenSymphony PRs #677, #679, #680, #681 (Elixir reference implementations)
