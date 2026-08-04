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
> ❌ **2026-08-04**: `/forgot-password` submit → **500 "Internal server error"** (`POST /api/v1/auth/forgot-password`). Broken.

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
> ❌ **2026-08-04**: Wizard renders ONLY the 4-step header — the step card is empty. **Root cause**: backend `src/onboarding/wizard.ts` emits `currentStep` in snake_case (`"github_install"`) but frontend `WizardContainer.tsx` matches kebab-case (`'github-install'`) → no step component matches → empty card. Also `config.enabled=false` and `githubAppUrl` = `https://github.com/apps/123456/installations/new` (placeholder). No auto-redirect to `/onboarding` after register either (App.tsx has no guard).

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
> ❌ **2026-08-04**: `/settings` page does NOT render — vite/babel transform error `Settings.tsx: Unexpected token, expected "," (821:19)`. tsc/biome/esbuild all parse the file fine; only babel fails → ErrorBoundary shows "Something went wrong". Also every dashboard page logs `GET /api/v1/admin/steering/health → 503`.

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
| US-4 | Magic link / forgot password | ❌ Broken — forgot-password 500 | 1 |
| US-5–9 | Onboarding (5 steps) | ❌ Broken — empty wizard (snake/kebab mismatch) | 2 |
| US-10–12 | Core features (label→PR, runs, repo/credit/billing/audit) | 🟡 Runs/Repos/Billing/Audit ✅; **Settings page broken** | 3 |
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
| US-29 | n8n / SAML / Enterprise / Proxy | 🟡 By plan | 4 |
| US-30 | Upgrade plan | ✅ Live | 5 |
| US-31 | Security/Privacy trust | ✅ Live | 6 |
