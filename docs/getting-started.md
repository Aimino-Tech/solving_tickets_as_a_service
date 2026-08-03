# Getting Started with SYNTARO

> **Goal**: Go from zero to your first fix PR in ≤15 minutes.

## Install Paths

Choose the path that fits your setup:

| Method | Setup Time | Best For |
|--------|-----------|----------|
| **GitHub Action** (recommended) | 30 seconds | Any public repo |
| **GitHub App** | 5 minutes | Full-featured, self-hosted |
| **Docker** | 5 minutes | Self-hosted with Docker |

---

## Option 1: GitHub Action (30 seconds)

Add this workflow file to your repo:

```yaml
# .github/workflows/syntaro-fix.yml
name: SYNTARO Fix
on:
  issues:
    types: [labeled]
jobs:
  fix:
    if: github.event.label.name == 'syntaro:fix'
    runs-on: ubuntu-latest
    steps:
      - uses: aimino/syntaro-fix-action@v1
        with:
          opencode-endpoint: ${{ secrets.OPENCODE_ENDPOINT }}
```

Then label any issue with `syntaro:fix`. SYNTARO will investigate, fix, and open a PR.

---

## Option 2: GitHub App + Self-Hosted (5 minutes)

```bash
# 1. Clone SYNTARO
git clone https://github.com/Aimino-Tech/solving_tickets_as_a_service
cd solving_tickets_as_a_service

# 2. Install dependencies
npm install

# 3. Start OpenCode (agent backend)
opencode serve --port 4096

# 4. Configure
cp .env.example .env
# Fill in: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET

# 5. Start
npm run dev

# 6. Verify
curl http://localhost:3000/health
```

---

## Option 3: Docker (5 minutes)

```bash
# Clone and run
git clone https://github.com/Aimino-Tech/solving_tickets_as_a_service
cd solving_tickets_as_a_service
cp .env.example .env
# Fill in env vars
docker compose up -d
```

---

## Verify It Works

1. Go to any issue in your repo
2. Add the label `syntaro:fix`
3. Within 60 seconds, SYNTARO will post a "working on it" comment
4. Within 5-10 minutes, a draft PR will appear
5. Review the PR and merge if satisfied

**Troubleshooting**: If nothing happens, check [Troubleshooting](troubleshooting.md).

## What Happens When You Label an Issue

1. SYNTARO detects the label via webhook
2. Agent classifies the issue (bug, feature, question, etc.)
3. Agent clones your repo into a sandbox
4. Agent investigates root cause
5. Agent implements a fix
6. Agent writes a regression test
7. Agent runs your test suite
8. Agent pushes a branch and creates a draft PR
9. Quality gates run and results are appended to the PR body
10. You review and merge
