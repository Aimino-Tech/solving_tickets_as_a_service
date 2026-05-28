# STAS Roadmap

## Phase 1 — Core Loop (✅ Done)

The basic pipeline: GitHub webhook → OpenCode agent → PR.

- [x] Webhook receiver (Express, `issues.labeled` events)
- [x] Webhook signature verification (HMAC-SHA256)
- [x] OpenCode serve dispatch (`POST /api/run` on `:4096`)
- [x] GitHub API client (Octokit JWT auth, comments, draft PR creation)
- [x] Config validation (Zod schema with safeParse)
- [x] Dockerfile for containerized deployment
- [x] WORKFLOW.md (AI orchestrator state machine)
- [x] AGENTS.md (AI-readable project context)

## Phase 2 — Production Hardening (🔜 Current)

Make the bot safe and reliable for real repos.

### 2.1 Two-phase triage
- Cheap model (Haiku) classifies issue: actionable? bug? needs more info?
- Only dispatch expensive model if actionable
- Reduces cost by ~60% (filter out noise issues, feature requests, questions)

### 2.2 Sandbox isolation
- Docker sandbox for each fix attempt
- Clone repo, run agent, verify, destroy
- Network locked to GitHub + LLM provider only
- Ephemeral — no code persists after run
- E2B integration for production (cloud sandboxes)

### 2.3 Verification gate
- Run existing test suite before and after fix
- New regression test must fail on original code, pass on fix
- If no test suite exists, skip verification but flag as "unverified"
- Quality bar: don't open PR unless tests pass (configurable)

### 2.4 Error handling & retry
- Exponential backoff on API failures
- Graceful timeout handling (default 10 min per fix)
- Retry with different model if first attempt fails
- Store run history (SQLite for local, Postgres for hosted)

### 2.5 Rate limiting & concurrency
- Max N concurrent fixes (configurable, default 3)
- Per-repo rate limiting
- Queue system for high-volume repos
- BullMQ with Redis for production

### 2.6 Monitoring & logging
- Structured logging (pino)
- Health check endpoint (`GET /health`)
- Run telemetry (duration, model used, files changed, outcome)
- Error alerting

## Phase 3 — OSS Launch (🔜 Next)

Make the project self-serve and launch-ready.

### 3.1 GitHub App setup guide
- Step-by-step screenshots
- Video walkthrough
- GitHub App creation script (CLI wizard)
- `stas-config init` interactive setup

### 3.2 One-command deploy
- `npx stas init` — clones, installs, configures, runs
- Railway template (deploy button)
- Fly.io config
- Kubernetes manifests

### 3.3 CI/CD setup
- GitHub Actions workflow for testing
- Docker build + publish
- E2E test with a test repo

### 3.4 Documentation
- Architecture deep-dive
- Security model explainer
- FAQ: "How is this different from Plip?"
- Self-hosting guide
- Customization guide (change label, model, etc.)

### 3.5 Launch
- Hacker News post
- Reddit r/programming, r/github, r/MachineLearning
- Dev.to walkthrough
- Twitter/X thread
- OpenCode ecosystem announcement

## Phase 4 — Hosted Service (🔜 Future)

Monetize with our AGI.

### 4.1 Cloud deployment
- Our AGI model behind API
- Multi-region deployment
- Auto-scaling sandbox pool
- Database (Postgres) for accounts, teams, runs

### 4.2 Dashboard
- Login with GitHub OAuth
- Repo management (add/remove repos)
- Run history with diff viewer
- Analytics: fix rate, cost, avg time
- Audit log

### 4.3 Stripe billing
- $49/mo Solo plan
- $149/mo Team plan
- Usage-based overages
- Free trial (14 days, 5 fixes)

### 4.4 Enterprise
- SSO/SAML
- VPC deployment
- Custom model routing
- SLA guarantees
- Dedicated sandbox infra
- Compliance certifications

## Phase 5 — Expansion

### 5.1 GitLab & Bitbucket support
- Mirror the GitHub App pattern
- Webhook API, PR/MR creation

### 5.2 Linear & Jira integration
- Agent picks up tickets from issue trackers
- Slack notification integration

### 5.3 Self-healing for CI
- Detect failing CI → auto-fix → PR
- Monitor production errors → auto-triage

### 5.4 Multi-model routing
- Haiku for triage (fast, cheap)
- Sonnet for standard fixes
- Opus for complex tasks
- Our AGI for all of the above, better
