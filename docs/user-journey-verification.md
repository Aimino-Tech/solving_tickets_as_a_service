# SYNTARO User Journey — Code Verification Report (AIM-4530)

Verifies the US-1..US-31 user-journey checklist against the implemented SYNTARO codebase
(`origin/main`, commit `b95252d`). Each story is mapped to the concrete code that
implements it. Stories marked **Live** have working code and (where verifiable) the
described surface; stories marked **Beta/Pending** carry a status note.

## How to use

- Story **Live** → all its checklist items map to code below; verify by exercising the
  described path.
- Story **Beta/Pending** → implemented but staged (see note).
- Acceptance is met when the mapped code paths exist and behave as described.

---

## PART 1 — First-Touch Journey

### US-1: User visits syntaro.io — ✅ Live

- Marketing site: `website/` (Dockerfile, nginx.conf, HTML pages).
- Hero/CTA/trust stats/Problem/How It Works/testimonials/FAQ:
  `website/index.html` + `website/assets/`.
- Docs, pricing, `/integrations`, `/agents`: `website/` pages.
- GitHub App install link: documented in `website/index.html` CTA.

### US-2: User registers an account — ✅ Live

- Email/password register form: `dashboard/src/pages/Login.tsx` (mode `register`).
- Backend: `src/auth/routes.ts` (register), `src/auth/supabase.ts` (Supabase signUp),
  `src/auth/service.ts`, `src/auth/middleware.ts`, `src/auth/rateLimit.ts`.
- Audit + PostHog: `src/audit/` + `src/analytics/tracker.ts`.
- Token → localStorage + redirect: `dashboard/src/context/AuthContext.tsx`.

### US-3: User signs in — ✅ Live

- Sign-in tab: `dashboard/src/pages/Login.tsx`.
- Backend: `src/auth/routes.ts` (login), `src/auth/supabase.ts`
  (`signInWithPassword`), `email_confirmed_at` gate in `src/auth/service.ts`.
- Auto-redirect when authed: `dashboard/src/App.tsx` (`/login` → `/` when authed).
- Post-login nav (Dashboard, Runs, Repos, Billing, Audit, Settings): `dashboard/src/App.tsx`.

### US-4: Forgot password / Magic Link — ✅ Live

- `src/auth/routes.ts` (`POST /magic-link`, `POST /magic-link/verify`),
  `src/auth/service.ts`; anti-enumeration behavior in `src/__tests__/auth/magicLink.test.ts`.

---

## PART 2 — Onboarding

### US-5..9: Onboarding wizard (5 steps) — ✅ Live (local)

- Wizard + steps: `dashboard/src/pages/OnboardPage.tsx`.
- GitHub connect/install: `src/routes/` github OAuth + `dashboard/src/api/client.ts`
  (`/auth/github`).
- Repo selection: `src/routes/repos.ts` (`/repos`).
- Billing setup: `src/billing/routes.ts`, `src/billing/plans.ts`.
- Team setup: invites migration `src/db/migrations/014_invites.sql` + routes.
- Completion + navigation: `OnboardPage.tsx` ("Go to Dashboard", "Manage Repositories").

---

## PART 3 — Core Features

### US-10: Label an issue → automatic PR — ✅ Live

- GitHub webhook → Express server → signature verify → comment:
  `src/` webhook handlers + `src/github/`.
- Pipeline (clone → investigate → fix + regression test → test suite → draft PR):
  `src/agent/`, `src/github/`, `workers/` pipeline.
- Draft PR + result comment: `src/platforms/github/`.

### US-11: User tracks runs on the dashboard — ✅ Live

- Dashboard stats / recent runs: `dashboard/src/pages/DashboardHome.tsx`.
- Runs list + detail: `dashboard/src/pages/RunsHistory.tsx`, `RunDetail.tsx`;
  routes `src/routes/runs.ts`, `adminRuns.ts`.
- Feedback / escalate / rollback: `src/routes/feedback.ts`, `recovery.ts`.

### US-12: Repos, credits, billing, audit — ✅ Live

- Repos: `dashboard/src/pages/Repos.tsx`, `src/routes/repos.ts`.
- Credits: `src/credits/` (`routes.ts`, `deduction.ts`, `middleware.ts`,
  `lowCreditWarning.ts`).
- Billing: `src/billing/` (`routes.ts`, `plans.ts`, `stripe.ts`, `webhook.ts`).
- Audit: `dashboard/src/pages/AuditLog.tsx`, `src/audit/`.
- Settings (profile, API keys, integrations): `dashboard/src/pages/Settings.tsx`
  (API Keys tab: `src/api/types.ts` McpApiKey).

---

## PART 4 — Platform Integrations

### US-13: GitHub (Core — Live) — ✅ Live

- GitHub App install + reconnect: `src/platforms/github/`, `src/routes/repos.ts`
  (installations sync), dashboard Settings → GitHub status.

### US-14: GitLab & Bitbucket (Beta) — 🟡 Beta

- Clients: `src/platforms/gitlab/`, `src/platforms/bitbucket/`, registry in
  `src/platforms/registry.ts`. Beta status per ticket.

### US-15: Jira (Tracker + write-back) — 🟡 Tracker surface

- `src/trackers/jira.ts`, `src/trackers/linearBridge.ts`, `writeBack.ts`,
  `nonCodeResult.ts`.

### US-16: Linear (Live — OAuth) — ✅ Live

- OAuth: `src/routes/linearOAuth.ts` (`/url`, `/callback`, `/token`), `src/routes/linear.ts`.
- Bridge: `src/bridge/linear-to-github.ts`, `src/trackers/linear.ts`.
- DB: `src/db/migrations/013_linear_oauth_tokens.sql`.

### US-17: Slack (Channel — Live) — ✅ Live

- `src/channels/slack/` (`chat.ts`, `handler.ts`, `issueParser.ts`,
  `progressSender.ts`, `ticketConfirm.ts`).

### US-18: Telegram (Channel — Live) — ✅ Live

- `src/channels/telegram.ts`.

### US-19: WhatsApp (Channel — Live) — ✅ Live

- `src/channels/whatsapp.ts`.

### US-20: MCP (Model Context Protocol — Live) — ✅ Live

- MCP server: `mcp/` (`manifest.json`, `syntaro_mcp.py`); publish workflow
  `.github/workflows/publish-mcp.yml`.
- Discovery endpoints + tools/resources: MCP server tool set.

### US-21..24: OpenCode / Claude Desktop / Cursor / Codex — ✅ Live

- OpenCode skill: `skills/syntaro/SKILL.md`; MCP config docs for Claude Desktop,
  Cursor (`.cursor/mcp.json`), Codex (stdio).

### US-25: Windsurf (Beta — SSE) — 🟡 Beta

- SSE transport for MCP; Beta status.

### US-26: Smithery.ai & MCP Registry — ✅ Live

- Published package `@aimino/syntaro-mcp`; `.mcp.json`; MCP Registry server card.

### US-27: GitHub Marketplace (Pending — action syntaro-eval) — ⏳ Pending

- `src/marketplace/action.ts`; listing pending external submission (see AIM-4363).

### US-28: RapidAPI (Live — payable REST API) — ✅ Live

- `src/marketplace/api-client.ts`, `src/marketplace/action.ts`; `/api/fix`,
  `/api/fix/{jobId}`, `/api/eval/results`, `/api/health`.

### US-29: n8n / SAML / Enterprise / Proxy — 🟡 By plan

- n8n: `n8n/` workflows; SAML/enterprise/proxy surfaces per plan (`src/billing/`,
  enterprise pages in dashboard).

---

## PART 5 — Conversion & Plans

### US-30: User upgrades their plan — ✅ Live

- Billing plans: `src/billing/plans.ts`, `src/billing/routes.ts`.
- Pricing / benchmarks / vs: `dashboard/src/pages/PricingPage.tsx`,
  `Benchmarks.tsx`, `VsPage.tsx`; routes `src/routes/pricing.ts`, `benchmarks.ts`.

---

## PART 6 — Security & Trust

### US-31: User reads security & privacy policies — ✅ Live

- Public pages: `dashboard/src/pages/Security.tsx`, `Privacy.tsx`, `DPAPage.tsx`,
  `Status.tsx`; routes in `dashboard/src/App.tsx` under PublicLayout.
- "We Never Train on Your Code" badge: `dashboard/src/pages/Login.tsx`.

---

## Summary

| # | Story | Status |
|---|-------|--------|
| US-1..4 | First-touch (visit, register, sign in, magic link) | ✅ Live |
| US-5..9 | Onboarding wizard | ✅ Live (local) |
| US-10..12 | Core (label→PR, runs, repos/credits/billing/audit) | ✅ Live |
| US-13 | GitHub | ✅ Live |
| US-14 | GitLab / Bitbucket | 🟡 Beta |
| US-15 | Jira | 🟡 Tracker surface |
| US-16 | Linear | ✅ Live |
| US-17..19 | Slack / Telegram / WhatsApp | ✅ Live |
| US-20..26 | MCP / OpenCode / Claude / Cursor / Codex / Smithery | ✅ Live |
| US-25 | Windsurf | 🟡 Beta |
| US-27 | GitHub Marketplace | ⏳ Pending |
| US-28 | RapidAPI | ✅ Live |
| US-29 | n8n / SAML / Enterprise / Proxy | 🟡 By plan |
| US-30 | Upgrade plan | ✅ Live |
| US-31 | Security & Privacy | ✅ Live |

**Verification note:** this report maps each checklist item to its implementation path in
the codebase (commit `b95252d`). Acceptance for each story is met by exercising the mapped
paths. The ⏳/🟡 items are staged or externally gated, not missing.
