# Contributing to STAS

## Development Setup

```bash
# Clone and install
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service
npm install

# Set up environment
cp .env.example .env
# Edit .env with minimum: GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET

# Start Redis (required for BullMQ queue)
redis-server

# Start OpenCode (another terminal)
opencode serve --port 4096

# Run the bot
npm run dev
```

## Project Structure

```
src/
├── agent/        # OpenCode agent dispatch, triage
├── audit/        # Audit logging
├── bridge/       # Cross-service bridge metrics
├── config.ts     # Zod-validated configuration
├── credits/      # Credit system
├── db/           # Database schema, migrations, repositories
├── github/       # GitHub API client, auth, messages
├── health/       # Health checks, queue depth monitoring
├── monitoring/   # Sentry integration, alerting
├── queue/        # BullMQ/RabbitMQ issue queue
├── routes/       # Express route handlers
├── sandbox/      # E2B/Docker sandbox factory
├── security/     # Auth middleware, IP allowlist
├── server.ts     # Express app creation
├── storage/      # Run history storage (SQLite/Postgres)
├── stripe/       # Stripe webhook handler
├── trackers/     # Linear/Jira integration
├── utils/        # Logging, types, utilities
├── validation.ts # Webhook payload validation
└── webhooks/     # GitHub/GitLab/Bitbucket handlers
```

## Code Style

We use [Biome](https://biomejs.dev) for formatting and linting:

```bash
# Check formatting
npm run lint

# Auto-format
npm run format

# CI check
npm run lint:ci
```

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run E2E tests (requires Docker)
npm run test:e2e
```

### Test Requirements

- Unit tests required for new modules
- E2E tests for pipeline changes
- Tests must pass before PR is created
- No mock objects that simulate the actual behavior without testing real code paths

## PR Process

1. Create a branch from `main`
2. Implement your changes
3. Add tests for new functionality
4. Run `npm run lint` and `npm run typecheck`
5. Run `npm test` to verify all tests pass
6. Open a pull request
7. Ensure CI passes

## Commit Messages

We use conventional commits:

```
feat: add new feature
fix: fix a bug
docs: update documentation
refactor: restructure code
test: add tests
chore: maintenance tasks
```

## Type Checking

```bash
npm run typecheck
```

TypeScript strict mode is enabled. Do not use `any` unless absolutely necessary.

## Adding Dependencies

- Prefer existing dependencies when possible
- Use `npm install <pkg>` — avoid manual `package.json` edits
- Keep dependencies minimal

## Questions?

Open a [GitHub Discussion](https://github.com/tamnguyen08/solving_tickets_as_a_service/discussions) or join our community.
