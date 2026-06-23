# Contributing to STAS

Thank you for your interest in contributing to STAS (Solving Tickets As A Service)! This guide will help you get started.

## Getting Started

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for local development setup and deployment instructions.

### Quick Setup

```bash
# Clone the repo
git clone https://github.com/Aimino-Tech/solving_tickets_as_a_service
cd solving_tickets_as_a_service

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
```

## How to Contribute

1. **Find an issue** — Look for issues labeled `stas:fix`, `bug`, or `help wanted`
2. **Discuss** — Comment on the issue to let others know you're working on it
3. **Fork & branch** — Create a feature branch from `main`
4. **Implement** — Write your fix or feature, following our code style
5. **Test** — Run `npm test` and ensure all tests pass
6. **PR** — Open a pull request against `main`

## Code Style

- **TypeScript** — Strict mode, no `any`, ES2022+
- **Formatting** — [Biome](https://biomejs.dev) (space indent, double quotes, 100 char width)
- **Format**: `npm run format`
- **Lint**: `npm run lint`
- **Typecheck**: `npm run typecheck`

## Pull Request Process

1. Keep PRs focused — one fix or feature per PR
2. Include tests for new functionality
3. Update documentation if needed (README, docs/)
4. Ensure CI passes (lint, typecheck, tests)
5. Mark PR as **draft** initially, then mark ready when complete

## Issue Labels

| Label | Description |
|---|---|
| `stas:fix` | Auto-fixable by the STAS bot |
| `bug` | Something isn't working |
| `enhancement` | Feature request |
| `help wanted` | Looking for contributors |
| `good first issue` | Great for newcomers |

## Questions?

Open a [Discussion](https://github.com/Aimino-Tech/solving_tickets_as_a_service/discussions) or ask in the issue you're working on.
