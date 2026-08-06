# SYNTARO — User Stories & Checklist (Todo List)

> **Full user journey**: from first seeing the **syntaro.io** website → sign up → log in → onboarding → core features → third-party platform integrations.
> The site is not public yet; the dashboard runs at **http://localhost:5173/login**.
> Each User Story ships with a **Checklist** of every user action + expected outcome (Acceptance criteria).

---

## PART 1 — FIRST-TOUCH JOURNEY

### US-1: User visits syntaro.io for the first time

> **As a** developer/engineering lead who wants to automate ticket resolution,
> **I want** to understand what SYNTARO is the moment I land on the homepage,
> **so that** I can decide whether to keep going.

- [ ] Open `https://syntaro.io` → see hero: tagline *"Label a Ticket. Get a Pull Request."* + CTA **"Install GitHub App →"** (→ `https://github.com/apps/syntarogithub1/installations/new`)
- [ ] See 3 trust stats: `162K+ OpenCode Stars`, `5 min Setup`, `∞ No Hidden Costs`
- [ ] Read **The Problem** section (old way 45+ min/ticket vs SYNTARO < 4 min)
- [ ] Read **How It Works** section (4 steps: Label issue → Investigate → Fix & Verify → PR Created)
- [ ] Browse **Testimonials** + **FAQ**
- [ ] (Optional) Click **"Read the Docs"** → docs page: Quick Start, GitHub App install guide (`github.com/apps/syntaro-app/installations/new`)
- [ ] (Optional) View **Pricing** → each plan's "Get Started" button points to GitHub App install
- [ ] (Optional) View **/integrations** → list of integrations (OpenCode, Claude, Cursor, Codex, Windsurf, GitHub/GitLab/Bitbucket, MCP Registry, Smithery, npm, skills.sh, GitHub Marketplace, RapidAPI)
- [ ] (Optional) View **/agents** → "SYNTARO for AI Agents"
- [ ] **Outcome**: User understands the core value + next action (install GitHub App or sign up)

---

### US-2: User registers an account

> **As a** new user interested in SYNTARO,
> **I want** to create an account with email + password,
> **so that** I can sign in to the dashboard.

> ⚠️ Not public yet — access directly at **http://localhost:5173/login**

- [x] Open `http://localhost:5173/login` → see 2 tabs: **Sign In** / **Register**
- [x] Switch to **Register** tab
- [x] Enter **Name** (optional)
- [x] Enter valid **Email**
- [x] Enter **Password** ≥ 8 characters
- [ ] (If invalid input) Form shows validation errors — no submit *(untested)*
- [x] Click **Register** → `POST /v1/auth/register` (rate-limited) → backend creates user via Supabase (plan = `solo`) — *verified; code actually uses `email_confirm:true` (auto-confirmed), NOT `email_confirm:false` as this doc states*
- [ ] Backend records `auth.register` to audit log + PostHog `user_signup` event *(code path exists; audit page shows 0 entries — unverified)*
- [x] Backend returns `201` with token → `syntaro_token` + `refreshToken` saved to `localStorage`
- [x] Auto-redirect to dashboard (route `/`) — **Acceptance**: registration lands user in dashboard — *verified: landed on `/`, user "QA New User", plan Solo*
  > ⚠️ **2026-08-05**: behavior changed — registration now redirects to **`/onboarding`** (not `/`). Automation `test_register_fresh_user_lands_on_dashboard` fails on this (expects `/`). With onboarding step 1 blocked by the installations 500, a fresh user lands on a stuck wizard (can still "Skip this step").

> Note: backend currently requires email confirmation (`email_confirmed_at`) before login/refresh. When public, a **confirm-email** step (link in inbox) is needed.

---

### US-3: User signs in

> **As a** user with an existing account,
> **I want** to sign in with email + password,
> **so that** I can access the dashboard and manage runs/PRs.

- [x] Open `http://localhost:5173/login` → **Sign In** tab
- [x] Enter registered email + password
- [x] Click **Sign In** → `POST /v1/auth/login` (rate-limited `loginLimiter`) → Supabase `signInWithPassword` — *verified: login OK*
- [x] Backend checks `email_confirmed_at` → success returns token
- [x] Token saved to `localStorage` → redirect to `/`
- [x] (If already authed and re-opening `/login`) → auto-redirect to `/` *(code-confirmed: `App.tsx` `/login` → `/` guard)*
- [ ] (Error) Wrong password / unconfirmed email → clear error message *(untested)*
- [x] **Acceptance**: successful sign-in → see **Layout** with nav: Dashboard, Runs, Repos, Billing, Audit, Settings

---

### US-4: Forgot password / Magic Link (optional)

> **As a** user who forgot their password,
> **I want** to receive a magic link,
> **so that** I can sign in without remembering my password.

- [ ] Click magic-link option → `POST /v1/auth/magic-link` (anti-enumeration — does not reveal whether email exists) *(no magic-link UI on login page — "Forgot password?" only; untested)*
- [ ] Receive link via email → open → `POST /v1/auth/magic-link/verify` → signed in *(untested)*
- [ ] **Acceptance**: successful sign-in via magic link *(untested)*
> ✅ **2026-08-05**: **FIXED & VERIFIED** — `/forgot-password` submit → `200` `{"ok":true,"message":"If an account exists for this email, a password reset link has been sent."}` (anti-enumeration). 0 console errors. Evidence: `manual-qa/08-forgot-password.png`.

---

## PART 2 — ONBOARDING (after first sign-in)

> If onboarding is incomplete, `/onboarding` opens the **WizardContainer** with 5 steps:
> `github-install → repo-selection → billing-setup → team-setup → complete`

### US-5: Onboarding step 1 — Connect GitHub & install the App

> **As a** new user,
> **I want** to connect GitHub and install the SYNTARO App,
> **so that** I can receive issue events.

- [ ] Click **"Sign in with GitHub"** → OAuth popup (`POST /v1/github/login` → window `github-oauth-callback` → sessionStorage) *(wizard broken — no content renders)*
- [ ] Click **"Install SYNTARO App"** → `https://github.com/apps/syntaro-bot/installations/new` → select repo → Install *(wizard broken)*
- [ ] Complete → `onboarding.completeStep('github-install')` *(wizard broken)*
- [ ] **Acceptance**: step marked done, wizard advances *(wizard broken)*
> 🟡 **2026-08-05**: Wizard step 1 **now renders** (snake/kebab mismatch fixed — "Connect Your GitHub Account" + Sign in with GitHub + Install SYNTARO App buttons visible). "Skip this step" → "Onboarding Skipped" → Go to Dashboard **works**. Also after register, user **auto-redirects to `/onboarding`** (guard now exists).
> ✅ **2026-08-05 (re-verify)**: `GET /api/v1/github/installations` **500 FIXED** — live-tested → **200** `{installations: [...]}` (DB table `github_installations` now exists after `015_github_oauth` applied; earlier 500 was the catch-block DB fallback also throwing on a missing table). "Continue" now returns the list; if no app installed yet, the wizard shows the hint *"Install the SYNTARO GitHub App first, then click Continue again"* — correct UX, advances once an installation exists. Evidence: live curl on `:3001` (fresh user).

### US-6: Onboarding step 2 — Select repository

- [ ] Repo list loads from `repos.list()`
- [ ] Select target **owner/repo** → `completeStep('repo-selection')`

### US-7: Onboarding step 3 — Billing setup

- [ ] `billing.listPlans()` shows plans
- [ ] Pick a plan or **"Skip billing — use free tier"** → `completeStep('billing-setup')`

### US-8: Onboarding step 4 — Team setup

- [ ] Invite team members (email/invite) → `completeStep('team-setup')`

### US-9: Onboarding step 5 — Complete

- [ ] **"You're all set!"** screen shows 3 actions: 1. Label an issue `syntaro:fix`, 2. Watch the magic happen, 3. Review and merge
- [ ] **Go to Dashboard** button → `/`
- [ ] **Manage Repositories** button → `/repos`

---

## PART 3 — CORE FEATURES (post-onboarding)

### US-10: User labels an issue → gets an automatic Pull Request

> **As a** developer,
> **I want** to label an issue `syntaro:fix` on GitHub,
> **so that** I receive an AI-generated PR to review.

- [ ] Open connected GitHub repo → create/receive an issue
- [ ] Apply label **`syntaro:fix`** (or trigger comment)
- [ ] GitHub webhook → Express server → verify signature → post *"working on it"* comment
- [ ] Pipeline: shallow clone repo → investigate root cause → write fix + regression test → run test suite
- [ ] Commit & push branch → GitHub API opens **draft PR**
- [ ] Post result comment on the issue
- [ ] **Acceptance**: draft PR appears with fix description + tests

### US-11: User tracks runs on the dashboard

- [x] Open **Dashboard** (`/`) → see stats / recent runs — *verified: plan Solo, 0 runs, nav OK*
- [x] Open **Runs** (`/runs`) → run list (filters + "No runs found." for new user)
- [ ] (If available) **Live View** (`/liveview`) to watch agent progress in real time *(untested — no run to watch)*
- [ ] Send **feedback** on a result (`/v1/run-feedback`), escalate/rollback if needed *(untested — no run)*

### US-12: User manages repos, credits, billing, audit

- [x] **Repos** (`/repos`): view connected repos, sync installations (`POST /v1/github/installations/sync`), disconnect — *verified: page renders, "Connect GitHub" buttons, empty state OK*
- [ ] **Credits**: view balance/transactions/usage, top up (`/v1/credits/*`) *(untested)*
- [x] **Billing**: view plan, upgrade — *verified: Current Plan, Stripe Portal button, LiteLLM budget, cost chart render*
- [x] **Audit** (`/audit`): view activity audit log — *verified: page renders ("0 total entries")*
- [ ] **Settings** (`/settings`): update profile, create API keys, manage integrations *(untested)*
> ✅ **2026-08-05**: **FIXED & VERIFIED** — `/settings` renders fully (Source Control incl. GitHub "Connected as xdnaimino", GitLab, Azure DevOps, Bitbucket, Integrations: Slack/Teams/Linear/Jira/Sentry, MCP API Keys "0 active", Data & Privacy: Export/Deletion/Data Residency EU/"never train on your code", Notifications). 0 console errors; all API calls 200. Evidence: `manual-qa/10-settings.png`. **Also no longer observed**: `GET /api/v1/admin/steering/health → 503` on dashboard pages (steering health calls gone).
>
> 🟡 **New (2026-08-05, QA sweep)** — **all re-verified 2026-08-05; 4 of 5 fixed**:
> - **Referral** (`/referral`): `GET /api/v1/referral/code` + `/rewards` — ✅ **FIXED** (live-tested → **200**; tables `referral_codes`/`referral_rewards`/`accounts` now exist; earlier 500 was missing-table drift).
> - **Billing** (`/billing`) & `/credits`: `GET /api/v1/credits/billing-settings` — ✅ **FIXED** (live-tested → **200**; settings are read from `accounts.*` columns, present).
> - **Members** (`/members`): `GET /api/teams/me` — ✅ **FIXED** (live-tested → **404** "not a member of any team" = intended behavior for teamless users; earlier 500 was missing `team_members` table).
> - **Status** (`/status`): FE called `/api/health/verbose` → backend only served `/health/verbose` at root. ✅ **FIXED 2026-08-05** — `src/server.ts` now also mounts `healthRouter` under `/api` (`app.use('/api', healthRouter)`) → live-tested **200**.
> - **LiveView** (`/liveview`): React hydration warning — `<tr>` nested in `<div>` (invalid HTML) → 2 console errors. *(unchanged)*

---

## PART 4 — PLATFORM INTEGRATIONS

### US-13: GitHub (Core — Live)

> **As a** developer,
> **I want** to install the SYNTARO GitHub App on my repos,
> **so that** I can trigger auto-fix with the `syntaro:fix` label.

- [ ] Visit the GitHub App page (`github.com/apps/syntarogithub1/installations/new` or `syntaro-app`/`syntaro-bot` depending on environment)
- [ ] Select account + repos → **Install** → grant webhook access
- [ ] In dashboard **Settings → GitHub** see status *Connected via GitHub App*
- [ ] (Reconnect) Click reconnect → `githubApi.getOAuthUrl` → OAuth redirect
- [ ] **Acceptance**: webhook receives issue/label events → pipeline runs

### US-14: GitLab & Bitbucket (Beta)

> **As a** user on GitLab/Bitbucket,
> **I want** to connect GitLab/Bitbucket repos,
> **so that** I get fixes on my git platform.

- [ ] In dashboard select **GitLab** (Beta) or **Bitbucket** (Beta) platform
- [ ] Connect account (token/OAuth) → `registry.ts getClient('gitlab'|'bitbucket')`
- [ ] Select repo → receive webhook/PR
- [ ] **Acceptance**: platform client creates fixes/PRs (currently Beta)

### US-15: Jira (Tracker + Write-back)

> **As a** PM/dev using Jira,
> **I want** SYNTARO to track Jira tickets and write results back,
> **so that** I can see fix progress directly in Jira.

- [ ] Configure Jira connection in dashboard (tracker surface)
- [ ] SYNTARO receives Jira webhooks (`JiraTracker` — issue/status/changelog)
- [ ] Jira ticket → corresponding GitHub issue (bridge)
- [ ] On fix result → **write-back** comment/link on the Jira ticket (`writeBack.ts`)
- [ ] **Acceptance**: Jira ticket shows PR/test result link

### US-16: Linear (Live — OAuth)

> **As a** user on Linear,
> **I want** to connect Linear to SYNTARO,
> **so that** I can bridge Linear tickets to GitHub issues and get results back.

- [ ] **Settings → Linear**: click connect → `POST /v1/linear/url` → `https://linear.app/oauth/authorize?client_id=...`
- [ ] Approve OAuth → `GET /v1/linear/callback` → `POST /v1/linear/token`
- [ ] `GET /v1/linear/status` → see `connected: true`, linearUserId, linearLogin
- [ ] `linearTicketToIssueData` → bridge Linear ticket → GitHub issue (`linearBridge.ts`)
- [ ] Fix result → write-back + create link in Linear (`nonCodeResult.ts`)
- [ ] (Disconnect) `DELETE /v1/linear/disconnect`
- [ ] **Acceptance**: Linear ticket is tracked and updated with results

### US-17: Slack (Channel — Live)

> **As a** developer who works in Slack,
> **I want** to receive fix progress and control SYNTARO from Slack,
> **so that** I never have to leave Slack.

- [ ] **Settings → Slack API Key**: enter **Bot Token** (`SLACK_BOT_TOKEN`, prefix `xoxb-`) and **App Token** (`SLACK_APP_TOKEN`, prefix `xapp-`)
- [ ] Click **Verify connection** → status OK
- [ ] Mention the bot in a channel → `registerSlackMentionHandler` → parse issue refs (`parseIssueRefs`)
- [ ] Receive **SlackProgressSender** — run progress updates in the Slack channel
- [ ] Create ticket from Slack (`ticketConfirm`, `ticketWork`) → trigger fix
- [ ] **Acceptance**: mention → SYNTARO replies + sends real-time progress

### US-18: Telegram (Channel — Live)

- [ ] Configure bot token in dashboard (channel surface)
- [ ] `TelegramProgressSender` sends fix progress to a Telegram chat/group
- [ ] **Acceptance**: receive progress messages on Telegram while a run executes

### US-19: WhatsApp (Channel — Live)

- [ ] Configure WhatsApp (Twilio/provider) in dashboard
- [ ] `WhatsAppProgressSender` sends fix progress via WhatsApp
- [ ] **Acceptance**: receive progress messages via WhatsApp

### US-20: MCP (Model Context Protocol — Live)

> **As an** AI agent (Claude, Cursor, Codex, OpenCode…),
> **I want** to call SYNTARO through MCP tools/resources,
> **so that** I can dispatch an issue fix from within my session.

- [ ] Install MCP server: `npm install -g @aimino/syntaro-mcp` (npm) or use stdio/SSE/Streamable HTTP
- [ ] (Discovery) `GET /discovery/mcp.json` or `GET /.well-known/mcp-server-card.json` (MCP Registry listing)
- [ ] Available tools: `syntaro_label_issue`, `syntaro_run_fix`, `syntaro_check_status`, `syntaro_get_pr`, `list_issues`, `search_codebase`
- [ ] Resources: `syntaro://runs/{run_id}`, `syntaro://issues/{issue_id}`, `syntaro://status`, `syntaro://queue`
- [ ] Agent JSON-RPC (agentServer at `/mcp/jsonrpc`): `tools/list` → `tools/call syntaro_fix_issue {repoOwner, repoName, issueNumber}` → `syntaro_check_status {runId}` → `syntaro_list_runs` → `syntaro_get_run`
- [ ] Create **MCP API Key** in **Settings** (prefix `sk-syntaro_`, shown once, SHA-256 stored server-side, revocable)
- [ ] **Acceptance**: agent calls a tool → run dispatched via RabbitMQ → returns status (queued → investigating → fixing → completed/failed)

### US-21: OpenCode (AI Coding Agent — Live)

- [ ] Run `npx skills add Aimino-Tech/solving_tickets_as_a_service`
- [ ] OpenCode agent uses `syntaro` skill → tools to submit issues / check status / fetch results
- [ ] **Acceptance**: OpenCode can call SYNTARO from within a session

### US-22: Claude Desktop (Live — MCP config)

- [ ] Add MCP server config to `claude_desktop_config.json`
- [ ] Open Claude Desktop → SYNTARO tools appear → call `syntaro_run_fix`/`syntaro_check_status`
- [ ] **Acceptance**: Claude Desktop can use SYNTARO tools

### US-23: Cursor (Live — .cursor/mcp.json)

- [ ] Add `mcp` to `.cursor/mcp.json` in the project
- [ ] Use SYNTARO tools in the Cursor agent
- [ ] **Acceptance**: Cursor can call SYNTARO MCP

### US-24: Codex CLI (Live)

- [ ] Run `npx -y @aimino/syntaro-mcp` (stdio) or configure within Codex
- [ ] Call tools from Codex CLI
- [ ] **Acceptance**: Codex can use SYNTARO tools

### US-25: Windsurf (Beta — SSE)

- [ ] Configure SSE endpoint: `curl http://localhost:4095/sse`
- [ ] Connect Windsurf → SYNTARO tools
- [ ] **Acceptance**: Windsurf can use SYNTARO (Beta)

### US-26: Smithery.ai & MCP Registry (Live)

- [ ] Find `@aimino/syntaro-mcp` on **Smithery.ai** → Install
- [ ] Find it on **MCP Registry** → see the server card
- [ ] **Acceptance**: install from marketplace succeeds

### US-27: GitHub Marketplace (Pending — Action `syntaro-eval`)

- [ ] Visit GitHub Marketplace → search SYNTARO (currently Pending)
- [ ] Use the `syntaro-eval` action in a workflow
- [ ] **Acceptance**: once public, the action runs in GitHub Actions

### US-28: RapidAPI (Live — payable REST API)

- [ ] Subscribe to the API on RapidAPI
- [ ] Call `POST /api/fix` → get `jobId`
- [ ] `GET /api/fix/{jobId}` → result
- [ ] `GET /api/eval/results`, `GET /api/health`
- [ ] **Acceptance**: fix results returned via paid REST API

### US-29: n8n, SAML, Enterprise, Proxy

- [ ] **n8n**: connect SYNTARO node (`n8n.ts`) — automated workflows call fix/check
- [ ] **SAML SSO** (`saml.ts`): admin configures SSO for enterprise
- [ ] **Enterprise** (`/enterprise`, `enterprise.ts`): purchase enterprise plan → SSO, VPC, SLA
- [ ] **Proxy** (`proxy.ts`): use the SYNTARO proxy server
- [ ] **Acceptance**: integration works per role/plan

---

## PART 5 — CONVERSION & PLANS

### US-30: User upgrades their plan

> **As a** user who exhausted the free tier,
> **I want** to upgrade my plan,
> **so that** I get more fixes/month + full analytics dashboard.

- [ ] Open **Billing** → `billing.listPlans()` → pick a plan (Solo/Pro/Team)
- [ ] Pay → plan updates (map `pro`→`solo` in accounts if needed)
- [ ] Compare plans on **Pricing** (`/pricing`): Free/Pro/Team/Enterprise
- [ ] See **Benchmarks** (`/benchmarks`), compare **vs/{competitor}** (`/vs/:competitor`)
- [ ] **Acceptance**: upgraded plan reflected on the dashboard

---

## PART 6 — SECURITY & TRUST

### US-31: User reads security & privacy policies

- [ ] View `/security`, `/privacy`, `/dpa`, `/status` (public pages)
- [ ] See the **"We Never Train on Your Code"** badge on the login page
- [ ] **Acceptance**: user trusts the product before signing up

---

## SUMMARY — Master Checklist (Roadmap)

| # | User Story | Status | Part |
|---|-----------|--------|------|
| US-1 | Visit syntaro.io first time | ✅ Live (`website/`) | 1 |
| US-2 | Register account | ✅ Verified (browser 2026-08-04) | 1 |
| US-3 | Sign in | ✅ Verified (browser 2026-08-04) | 1 |
| US-4 | Magic link / forgot password | ✅ Fixed & verified 2026-08-05 (was 500; now 200 anti-enumeration) | 1 |
| US-5–9 | Onboarding (5 steps) | 🟡 Wizard renders + skip works; Continue works (installations **200** since `015_github_oauth` applied); steps 2–5 still need a real GitHub App install to test | 2 |
| US-10–12 | Core features (label→PR, runs, repo/credit/billing/audit) | 🟡 Settings fixed ✅; Referral/Billing-settings/Members/Status **all fixed 2026-08-05** (live-verified); LiveView hydration warning open | 3 |
| US-13 | GitHub | ✅ Live | 4 |
| US-14 | GitLab / Bitbucket | 🟡 Beta | 4 |
| US-15 | Jira (tracker + write-back) | 🟡 Tracker surface | 4 |
| US-16 | Linear | ✅ Live (OAuth) | 4 |
| US-17 | Slack | ✅ Live | 4 |
| US-18 | Telegram | ✅ Live | 4 |
| US-19 | WhatsApp | ✅ Live | 4 |
| US-20 | MCP (tools/resources/JSON-RPC) | ✅ Live | 4 |
| US-21 | OpenCode | ✅ Live | 4 |
| US-22 | Claude Desktop | ✅ Live | 4 |
| US-23 | Cursor | ✅ Live | 4 |
| US-24 | Codex CLI | ✅ Live | 4 |
| US-25 | Windsurf | 🟡 Beta (SSE) | 4 |
| US-26 | Smithery / MCP Registry | ✅ Live | 4 |
| US-27 | GitHub Marketplace (syntaro-eval) | ⏳ Pending | 4 |
| US-28 | RapidAPI | ✅ Live | 4 |
| US-29 | n8n / SAML / Enterprise / Proxy | 🟡 By plan — Enterprise routes **mounted 2026-08-05** (named `enterpriseRouter` export; was `Router.use() got a Module`) | 4 |
| US-30 | Upgrade plan | ✅ Live | 5 |
| US-31 | Security/Privacy trust | ✅ Live | 6 |

---

## QA RUN LOG (2026-08-05)

**Baseline** — automation suite (`tests/automation`, python3 pytest): **36 passed, 3 failed, 2 skipped, 4 xfailed, 5 xpassed** in 135s.
- FAIL `test_be_health_reachable` — **test-config issue**: `OSY_URL` defaults to `:4096` (OpenCode serve, returns HTML) — not an app bug.
- FAIL `test_sign_in_form_submission_shows_error` — **stale test data**: `test@example.com/password123` is a pre-existing (seeded) account → login legitimately succeeds. App correctly 401s garbage creds (probed).
- FAIL `test_register_fresh_user_lands_on_dashboard` — **behavior change**: register now redirects to `/onboarding` (test expects `/`). See US-2 note.
- XPASS (previously-expected failures now passing): analytics chart/export/page, register 201, login 200 — **analytics feature works now**.

**Manual sweep** — 19 dashboard pages (Playwright, token auth): clean pages `/`, `/runs`, `/repos`, `/audit`, `/security`, `/privacy`, `/dpa`, `/benchmarks`, `/pricing`, `/vs`, `/enterprise`. Findings: see US-5-9 / US-12 notes. `/admin` → 403 expected (non-admin).

**Known-P0 re-verification**:
- P0-1 forgot-password 500 → ✅ FIXED
- P0-2 onboarding empty wizard → ✅ FIXED (renders; Continue → installations **200** — live-verified 2026-08-05; earlier 500 was missing `github_installations` table)
- P0-3 settings babel error → ✅ FIXED
- steering/health 503 spam → ✅ GONE

**2026-08-05 afternoon fixes (live-verified on `:3001`)**:
- `/api/health/verbose` 404 → ✅ FIXED (`src/server.ts` mounts `healthRouter` under `/api` too) → **200**
- Enterprise routes unmounted (`Router.use() requires a middleware function but got a Module`) → ✅ FIXED (`server.ts` now imports named `enterpriseRouter`) → `/api/v1/enterprise/plans` **401** (auth gate) instead of 404
- SLO latency spam `column "duration_ms" does not exist` (querying a column no migration ever created on `webhook_events`) → ✅ FIXED (`src/monitoring/slos.ts` computes p99 from `EXTRACT(EPOCH FROM (processed_at - created_at)) * 1000`); no DB-query retries at startup SLO check
- **Latent finding (not fixed, monitoring loop disabled in dev)**: `src/monitoring/capacityMetrics.ts` writes to a `slo_metrics` table that no migration creates — will fail once the monitoring loop is enabled. Needs a migration (e.g. `026_slo_metrics.sql`).

**Lighthouse** (standing rule — every website/webapp run): sweep results in `/tmp/opencode/lighthouse/scores.csv`; see report. Target ≥ 90 per page.

---

## PART 7 — REAL DATA & EVALUATION (2026-08-05, live-verified)

> Các US này được verify với **tài khoản thật** `xdn.aimino@gmail.com` (plan free), **data thật** từ webhook signed HMAC + MCP API calls + Supabase — **không mockup**.

### US-32: User sees REAL runs on /runs

> **As a** user with a connected account,
> **I want** `/runs` (và `/runs/:id`) hiển thị các fix run thật của mình,
> **so that** tôi theo dõi được tiến độ fix mà không cần tin vào mockup.

- [x] Webhook GitHub signed (X-Hub-Signature-256, GITHUB_WEBHOOK_SECRET) → `POST /webhook/github` → **202 accepted**
- [x] Handler `issues.labeled` match label `stas:fix` (cần `SYNTARO_LABEL` — xem fix F-1) → `storage.saveRun` ghi **pending** vào bảng `run_history` (Supabase)
- [x] Dispatch tới OpenSymphony `POST :4000/api/v1/dispatch` → accept `dispatch_<uuid>` → consumer cập nhật status `running`
- [x] `GET /api/v1/runs` đọc `run_history` JOIN accounts (github_installation_id) → **4 runs thật** hiển thị trên `/runs`
- [x] `GET /api/v1/runs/:id` → detail: repo, issue #, summary, status, created
- [x] MCP `submit_issue` cũng tạo run (test "MCP test 3: remove deprecated API call" — running)
- **Bằng chứng**: `usage-limits-real-1-of-10.png`, `runs-evidence-real-data.png`, raw Supabase rows, GitHub issue #30 thật.

### US-33: User nói "fix these tickets" → agent kiểm tra/tạo ticket

> **As a** user (qua MCP hoặc Slack),
> **I want** nhắn yêu cầu tự nhiên "fix these tickets, do this do that",
> **so that** agent trả lời ticket tồn tại hay chưa, và tự tạo ticket để fix.

- [x] **Eval 10×10 (10 conversations × 10 turns): 100/100 PASS (100%)** — scenario thật: `first-fix-lifecycle`, `multi-ticket-batch`, `do-this-do-that`, `check-then-fix`, `status-watcher`, `creator-then-fixer`, `everything-mixed`, `check-loops`, `polite-requests`, `full-lifecycle-regression`
- [x] Agent reply mẫu thật: *"[xdnaimino/syntaro-eval-sandbox] Ticket ... doesn't exist yet — I'll create it and fix it for you. Created #85. Fix submitted."*
- [x] Capability accuracy 100%: `ticket_checked` 64, `fix_submitted` 41, `ticket_created` 25, `status_checked` 24, `tickets_listed` 12
- [x] MCP surface: REST `/mcp/*` + JSON-RPC `/mcp/jsonrpc` + `syntaro_fix_issue`/`check_status`/`list_runs`/`get_run`
- [ ] Slack bot DM/channel test thật (bot `syntaro2` Socket Mode connected — cần user nhắn bot trong workspace Aimino)
- **Fix liên quan**: F-8 common-sense gate bỏ qua `issue_number` check cho nguồn conversational (freeform không có GitHub issue).

### US-34: Evaluation System 4 trụ cột

> **As a** maintainer,
> **I want** hệ thống đánh giá có Criteria + Data & Evidence + Metrics/Rubrics + Feedback Loop,
> **so that** đo được chất lượng agent và cải tiến liên tục.

- [x] **Criteria**: `eval/conversations/types.ts` — TurnExpectation per action (fix/check/create/status/list) + replyIncludes/Excludes
- [x] **Data & Evidence**: report JSON (`eval/results/conversations/<tag>.json` — user turn, reply, actions, verdict, errors) + tickets thật trên GitHub + run_history + MCP states
- [x] **Metrics/Rubrics**: `npm run eval:scorecard` (`eval/scorecard.ts`) — pass rate tổng, per-scenario, capability accuracy, trend + regression detection. Kết quả: 26 reports, latest 100%, 1 run 96% (evmsg2tr34)
- [x] **Feedback Loop**: fail → bugfix (xem F-1..F-10) → re-run → scorecard trend so sánh
- [x] Doc: `docs/evaluation-system.md`

### US-35: Usage limits phản ánh consumption THẬT (free plan)

> **As a** free-plan user,
> **I want** `/usage-limits` hiển thị đúng số fix đã dùng trong free limit,
> **so that** tôi biết khi nào hết quota (10 fixes).

- [x] `usage_records` (Supabase ledger) ghi **1 credit mỗi fix dispatch** (`src/dispatch/osDispatch.ts` → `recordFixUsage`, action `fix_dispatch`) — mọi path (webhook/MCP/queue)
- [x] `GET /api/v1/usage-limits` đọc `usage_records` (trước đọc bảng `runs` legacy rỗng — fix F-9)
- [x] `getAccountId` ưu tiên account có `github_installation_id` thật (dương) — tránh nhầm 2 rows cùng email (fix F-10)
- [x] **Kết quả thật**: `/usage-limits` hiển thị **1 / 10 (10%)** cho Continuous/Weekly/Monthly sau 1 dispatch thật

### US-36: Source Code integration buttons trên run detail

> **As a** user xem chi tiết một run,
> **I want** nút dẫn tới PR/issue trên GitHub/Bitbucket (nơi integration source code),
> **so that** tôi mở được fix thật trong repository — không phải card "share".

- [x] Thay card "Share this run" (Copy link + Share on X) bằng card **"Source Code"** (`dashboard/src/components/RunDetailContent.tsx`)
- [x] **View Issue** → `https://github.com/{owner}/{repo}/issues/{n}` (khi issueNumber > 0) — mở tab GitHub thật
- [x] **View Pull Request** → `run.prUrl` (khi có — sẽ trỏ tới PR GitHub/Bitbucket bất kỳ platform)
- [x] Fallback: "No PR yet — run {status}" khi chưa có cả hai

### US-37: Project status overview trên /runs (kanban + warnings → tickets + evaluation)

> **As a** user muốn biết SYNTARO đang hoạt động thế nào trên project/repo của mình,
> **I want** một overview compact trên trang `/runs`: plan tier + usage limits, pipeline kanban (Pending / Done-Verified / Failed) tự cập nhật, warning/alert click được, và hệ thống đánh giá sức khỏe project,
> **so that** tôi nhìn vào là biết hệ thống đang chạy, biết cái gì hỏng, và tạo ticket fix từ chính warning đó — theo đúng gói của tôi (Team auto, Free/Solo có review usage limits).

- [x] **Plan strip**: badge tier (Free/Solo/Team/Enterprise), usage `used/limit` + progress bar, cảnh báo vàng khi ≥ 80%, "Unlimited" cho Team/Enterprise/self-hosted (`dashboard/src/components/ProjectOverview.tsx`)
- [x] **Metric cards** (5): Bugs detected, Issues created, Pending, Done/Verified, Health score (severity badge theo verdict)
- [x] **Metric card click → mở detail aside (list mode)**: KHÔNG popup — nhất quán với kanban; aside hiển thị danh sách nhóm (distinct issues / failed runs / pending / done), click item → aside chuyển sang run detail full; footer "Click to view details"
- [x] **Kanban compact** 3 cột (Pending / Done-Verified / Failed) — **chiều cao ~1/2, scroll nội bộ column** (UX: không kéo dài trang), count badge mỗi cột
- [x] **Auto-move**: poll 20s → run tự chuyển cột khi trạng thái đổi
- [x] **Click card kanban → mở run detail aside** (`onSelectRun` → RunsHistory.openDetail); mobile (<768px) điều hướng sang `/runs/{id}`
- [x] **Gỡ run history table + filters + pagination**: redundant với kanban + aside (status/issue/date đều trên card; cost/duration/feedback trong aside detail). `/runs` giờ là overview-first; history full >100 runs có thể quay lại sau dưới dạng view riêng
- [x] **Warning click được**: click warning row → mở detail (error message, PR link, "View run")
- [x] **Create ticket — theo gói**:
  - Team → **auto-create** khi phát hiện failed run MỚI (dedup theo runId, 1 lần/run/session, không gate usage)
  - Free/Solo → nút **"Create ticket"** thủ công → modal **usage review** (used/limit + remaining); khi hết limit → **blocked** + CTA Upgrade `/billing`
- [x] **Usage warning**: hiện trong warnings list khi `used/limit ≥ 80%` (kèm detail số liệu)
- [x] **Evaluation panel (4 trụ cột)**: rubric table — Criteria (ngưỡng) + Value + Evidence (số liệu thật) + Verdict per item; weighted score 0–100; **feedback loop** (delta improved/regressed vs snapshot trước, lưu localStorage); suggested actions (create tickets / review failed / check usage)
- [x] **Backend**: `POST /api/v1/tickets` — JWT (`requireAuth`), resolve account + plan tier **server-side** (không tin client), gate usage (402 `usage_limit_reached` khi free/solo hết limit), enqueue RabbitMQ `issuesFix` (mirror `mcp.ts`), trả `{ runId, status }` (`src/routes/tickets.ts`, mount `src/server.ts`)
- [x] **i18n đầy đủ**: 55 keys `overview.*` ở en/de/fr/es
- [x] **Tests**: 11 test mới cho `evaluateProject`/`computeFeedbackLoop`; component tests `ProjectOverview.test.tsx` (kanban grouping, warning detail, tier gating, usage block, team auto-submit); mock mở rộng trong `RunsHistory.test.tsx`

---

## FIX LOG (2026-08-05 — real-data pipeline, all live-verified)

| # | Fix | File |
|---|---|---|
| F-1 | `RABBITMQ_URL` sai port 5673 → 5672 + creds `symphony` + tạo vhost `/syntaro` | `.env`, rabbit container |
| F-2 | `STAS_LABEL` là dead var — config đọc `SYNTARO_LABEL`; thêm `SYNTARO_LABEL=stas:fix` | `.env` |
| F-3 | `/api/v1/runs` đọc bảng `runs` legacy (rỗng) → chuyển sang `run_history` JOIN accounts | `src/routes/runsApi.ts` |
| F-4 | Pending run thiếu title → saveRun thêm `summary: jobData.issueTitle` | `src/webhooks/github.ts` |
| F-5 | `/api/repos` 401/[] → resolveToken async + DB OAuth lookup; `/installations` 403 → fallback user repos | `src/routes/repos.ts`, `src/routes/github.ts` |
| F-6 | RunsHistory crash `formatDuration` → `formatDurationShort` | `dashboard/src/pages/RunsHistory.tsx` |
| F-7 | `audit_logs` thiếu cột `ip_address` (code ghi nhưng table thiếu) | Supabase ALTER TABLE |
| F-8 | common-sense gate chặn freeform conversational fix (issueNumber=0) → bỏ qua check issue_number | `src/guardrails/commonSenseGate.ts` |
| F-9 | MCP `submit_issue` installationId=0 → resolve từ user → accounts.github_installation_id | `src/routes/mcp.ts` |
| F-10 | `updateRunStatus` sau dispatch (running/failed) + usage credit ghi tại choke point dispatch | `src/server.ts`, `src/dispatch/osDispatch.ts` |
| F-11 | usage-limits đọc `usage_records` thay `runs`; `getAccountId` ưu tiên install thật | `src/usage-limits/routes.ts` |
| F-12 | Run detail: "Share this run" → "Source Code" (View Issue/PR) | `dashboard/src/components/RunDetailContent.tsx` |

## CÒN LẠI (chưa xong)

- [ ] **Real fix tạo PR**: OpenSymphony worker chưa chạy fix thật (dispatch "completed" 3s, không PR). Cần OS config: GITHUB_TOKEN/OPENCODE_URL + worker.
- [ ] **Slack thật**: bot connected (Socket Mode, workspace Aimino) — chưa test DM/mention thật (cần user nhắn bot).
- [ ] **Credit balance**: `credit_balances` chưa được ghi (chỉ `usage_records`) — khi có billing sẽ nạp.
- [ ] Jira OAuth rebuild (Full OAuth) — TẠM HOÃN.
