# SYNTARO — QA Test Plan (short)

> Scope, environment, and exit criteria for pre-launch QA of **website** (static marketing site) + **webapp** (dashboard).
> Companion doc: [`docs/user-stories-todo.md`](user-stories-todo.md) (checklist per user story). QA evidence pattern: `manual-qa/` screenshots.
> **Standing rule: every website/webapp test run includes Lighthouse per page** (≥ 90 performance best-effort per repo standard, screenshots at 375/768/1280).

## Environment

| Component | URL / Command | Notes |
|---|---|---|
| Dashboard FE (Vite) | `http://localhost:5173` — `cd dashboard && npm run dev` | proxies `/api/*` → `:3002` |
| API (Express) | `http://localhost:3002` — `npm run dev:api` (`.env` `PORT=3002`) | health: `degraded` w/ RabbitMQ error (OK for auth/dashboard) |
| Automation baseline | `cd tests/automation && python3 -m pytest -v` | 50 tests, Playwright headless |
| Website (static) | `website/` — serve locally or `https://syntaro.io` | 14 HTML pages |
| Lighthouse | `npx lighthouse <url> --chrome-path=/usr/bin/google-chrome --output=json` | v13.4.1 installed |

## Scope

| # | Surface | Pages / Stories | Coverage |
|---|---|---|---|
| 1 | Website | index, docs, pricing, integrations, agents, benchmark, blog, faq, privacy, status, support, terms, trust, 404 | US-1, US-31 |
| 2 | Dashboard — Auth | /login, /forgot-password, /auth/reset-password | US-2, US-3, US-4 |
| 3 | Dashboard — Onboarding | /onboarding (5 steps) | US-5–US-9 |
| 4 | Dashboard — Core | / (home), /runs, /runs/:id, /liveview, /repos, /usage-limits, /members, /billing, /audit, /referral, /settings | US-10–US-12 |
| 5 | Dashboard — Public trust | /security, /privacy, /status, /dpa, /benchmarks, /pricing, /vs/:competitor, /enterprise | US-30, US-31 |
| 6 | Integrations | GitHub, GitLab/Bitbucket, Jira, Linear, Slack, Telegram, WhatsApp, MCP, OpenCode, Claude, Cursor, Codex, Windsurf, Smithery, Marketplace, RapidAPI, n8n/SAML/Enterprise/Proxy | US-13–US-29 |

## Test method per item

1. **Action** — what the tester does (page + user action from checklist).
2. **Result** — PASS/FAIL + expected vs actual.
3. **Screenshot** — saved as `manual-qa/<NN>-<page>.png` (pattern: `manual-qa/01-login.png`).
4. **Console errors** — browser console captured; note any.
5. **Lighthouse** — per page, record performance/accessibility/best-practices/SEO scores (≥ 90 target).
6. **Note** — environment quirks, root cause if FAIL.

## Known P0 bugs (verify first — already reported 2026-08-04)

| # | Bug | Evidence | Status |
|---|---|---|---|
| P0-1 | US-4 `/forgot-password` submit → **500 Internal server error** | `POST /api/v1/auth/forgot-password` | Re-verify this run |
| P0-2 | US-5–9 Onboarding wizard renders only header — **empty step card** | snake_case `github_install` vs kebab-case `github-install` mismatch | Re-verify this run |
| P0-3 | US-12 `/settings` does **not render** — vite/babel transform error `Settings.tsx (821:19)` → ErrorBoundary | + every dashboard page logs `GET /api/v1/admin/steering/health → 503` | Re-verify this run |

## Exit criteria

- [ ] Automation baseline run: results recorded (pass count, known failures)
- [ ] All 3 P0 bugs manually re-verified, evidence (screenshot + console) captured
- [ ] Untested `[ ]` checklist items in `docs/user-stories-todo.md` exercised where environment permits; checklist updated (`[x]` pass / `❌` fail + root cause)
- [ ] Lighthouse run per page (website + dashboard) with scores recorded
- [ ] Bugs filed as GitHub issues: title `[QA] <US-x> <description>`, severity + evidence attached
