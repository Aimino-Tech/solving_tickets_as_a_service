# STAS API — Solving Tickets As A Service

**Label a GitHub issue. Get a pull request.**

STAS is an AI-powered GitHub bot that automatically fixes bugs and implements features. Submit a GitHub issue URL, and STAS investigates your codebase, writes a fix, runs your entire test suite, and opens a PR — all without human intervention.

## How It Works

```
1. You submit a GitHub issue URL → 2. STAS investigates the codebase
   → 3. Root cause analysis → 4. Fix implementation
   → 5. New regression tests → 6. Full test suite execution
   → 7. A draft PR appears ✨
```

## Key Features

- **🤖 Fully Autonomous** — From issue to PR, no manual steps
- **🧪 Regression Tested** — Every fix includes new tests and runs your full suite
- **🔒 Sandboxed** — All execution in isolated E2B sandboxes
- **📊 Benchmarked** — 72%+ pass rate on SWE-bench
- **🔍 Audit Trail** — Every step logged and visible in the PR

## Who Is It For?

- **Open Source Maintainers** — Never triage another low-priority bug manually
- **Dev Teams** — Let STAS handle the backlog while you build features
- **CI/CD Pipelines** — Integrate automated fixing into your workflow
- **Indie Developers** — Fix bugs while you sleep

## Example

```bash
curl -X POST https://stas-rapidapi.p.rapidapi.com/api/fix \
  -H "Content-Type: application/json" \
  -H "X-RapidAPI-Key: your-key" \
  -H "X-RapidAPI-Proxy-Secret: your-secret" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "issueTitle": "Login endpoint returns 500 for special characters",
    "issueBody": "When email contains +, the login crashes with 500."
  }'
```

## Plans

| Plan | Price | Fixes/Day | Support |
|------|-------|-----------|---------|
| Free | $0 | 10 | Community |
| Pro | $49/mo | 100 | Email |
| Enterprise | $199/mo | 1000 | Slack + Email + SLA |

## Links

- **Source Code**: https://github.com/tamnguyen08/solving_tickets_as_a_service
- **Documentation**: https://github.com/tamnguyen08/solving_tickets_as_a_service#readme
- **Website**: https://syntaro.io
