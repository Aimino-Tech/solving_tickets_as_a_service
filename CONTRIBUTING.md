# Contributing to STAS

> **Thank you for considering contributing to STAS!**

STAS is an open-source project (MIT licensed) that turns labeled GitHub issues into pull requests. We welcome contributions of all kinds — bug fixes, features, documentation, tests, and more.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Test Requirements](#test-requirements)
- [Pull Request Process](#pull-request-process)
- [Commit Conventions](#commit-conventions)
- [Adding New Features](#adding-new-features)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

---

## Development Setup

### Prerequisites

- **Node.js** >= 20
- **npm** >= 10
- **Docker** (for sandbox)
- **Redis** (for queue)
- **OpenCode CLI** (`npm install -g @opencode/cli`)

### Step 1: Clone and One-Command Setup

The fastest way to get started:

```bash
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service
npm run setup
```

This single command checks prerequisites, installs dependencies, creates a `.env` file with development defaults, and optionally starts Docker services.

### Step 2: Manual Configuration (if needed)

If you need to customize the environment after running `setup`:

```bash
cp .env.example .env
# At minimum, set up a GitHub App and fill in:
#   GITHUB_APP_ID
#   GITHUB_APP_PRIVATE_KEY (or GITHUB_APP_PRIVATE_KEY_PATH)
#   GITHUB_WEBHOOK_SECRET
```

For development, you can use a **smee.io** proxy to forward GitHub webhooks to your local machine:

```bash
# Start smee proxy
npm run smee

# In another terminal, start the bot
npm run dev
```

### Step 3: Start Dependencies

```bash
# Start Redis (required)
docker compose up -d

# Start OpenCode (required for fix agent)
opencode serve --port 4096
```

### Step 4: Run the Bot

```bash
# Development mode with hot-reload
npm run dev

# Or run API server only
npm run dev:api

# Or run worker only
npm run dev:worker
```

### Step 5: Verify

```bash
curl http://localhost:3000/health
# → {"status":"ok","label":"stas:fix","uptime":42}
```

---

## Project Structure

```
solving_tickets_as_a_service/
├── src/                      # TypeScript source
│   ├── index.ts              # Entry point (Sentry init first)
│   ├── server.ts             # Express server setup
│   ├── config.ts             # Zod-validated config
│   ├── validation.ts         # Payload validation
│   ├── webhooks/             # Webhook handlers
│   │   ├── github.ts         # GitHub webhook events
│   │   ├── gitlab.ts         # GitLab webhook events
│   │   ├── bitbucket.ts      # Bitbucket webhook events
│   │   ├── base.ts           # Abstract webhook base
│   │   ├── retryWorker.ts    # Webhook retry logic
│   │   ├── eventLogger.ts    # Event recording
│   │   └── healthMonitor.ts  # Webhook health tracking
│   ├── queue/                # Job queue
│   │   ├── issueQueue.ts     # BullMQ queue + worker
│   │   ├── producers.ts      # RabbitMQ producers
│   │   └── rabbitmq.ts       # RabbitMQ connection
│   ├── agent/                # Agent pipeline
│   │   ├── issueAgent.ts     # Main pipeline (8 phases)
│   │   ├── tools.ts          # Agent tool definitions
│   │   └── types.ts          # Agent result types
│   ├── sandbox/              # Sandbox isolation
│   │   ├── index.ts          # Factory (E2B > Docker)
│   │   ├── executor.ts       # E2B sandbox implementation
│   │   ├── docker.ts         # Docker sandbox implementation
│   │   └── types.ts          # Shared sandbox interface
│   ├── github/               # GitHub integration
│   │   ├── auth.ts           # App authentication
│   │   ├── actionDispatcher.ts # PR creation logic
│   │   └── messages.ts       # Comment/PR templates
│   ├── security/             # Security module
│   │   ├── index.ts          # Exports
│   │   ├── adminAuth.ts      # Admin API authentication
│   │   ├── audit.ts          # Audit logging
│   │   ├── ipAllowlist.ts    # IP restriction
│   │   └── sandboxSecurity.ts # Sandbox security config
│   ├── services/             # Services
│   │   └── featureFlags.ts   # Feature flag service
│   ├── db/                   # Database (PostgreSQL)
│   ├── storage/              # Run history persistence
│   ├── metering/             # Usage metering
│   ├── ratelimit/            # Rate limiting
│   ├── monitoring/           # Sentry, logging
│   ├── notifications/        # Slack notifications
│   ├── trackers/             # Linear, Jira integration
│   ├── stripe/               # Stripe webhooks
│   ├── bridge/               # Cross-service bridge
│   └── utils/                # Utilities (logger, types)
├── docs/                     # Documentation
│   ├── ARCHITECTURE.md       # Architecture deep-dive
│   ├── SECURITY.md           # Security model
│   ├── FAQ.md                # Frequently asked questions
│   ├── SELF_HOSTING.md       # Self-hosting guide
│   └── CUSTOMIZATION.md      # Customization guide
├── workers/                  # Python Celery workers
├── plugin/                   # OpenCode plugin
├── k8s/                      # Kubernetes manifests
├── scripts/                  # Utility scripts
└── tests/                    # Tests (Vitest)
```

---

## Coding Standards

### Language and Tools

- **TypeScript** — All source code is TypeScript (strict mode)
- **Biome** — Code formatting and linting
- **Vitest** — Testing framework

### Code Style (Biome)

```bash
# Check for issues
npm run lint

# Auto-format
npm run format

# CI check
npm run lint:ci
```

Configuration is in `biome.json` at the project root. Key rules:
- Single quotes
- Semicolons
- 120 character line width
- Trailing commas where valid
- TypeScript strict mode

### TypeScript Guidelines

- Use explicit return types on all public functions
- Prefer `interface` over `type` for object shapes
- Use `const` assertions for constants
- Use `import type` for type-only imports
- Avoid `any` — use `unknown` and type guards instead
- Document public APIs with JSDoc

### File Naming

- Source files: `kebab-case.ts` (e.g., `issue-agent.ts` → `issueAgent.ts`)
- Test files: `*.test.ts` or `*.spec.ts`
- Type files: `types.ts` within each module

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Variables | camelCase | `installationId` |
| Functions | camelCase | `enqueueIssue()` |
| Classes | PascalCase | `ActionDispatcher` |
| Interfaces | PascalCase | `SandboxExecutor` |
| Types | PascalCase | `TriageResult` |
| Constants | UPPER_SNAKE_CASE | `QUEUE_NAME` |
| Files | kebab-case | `issue-queue.ts` |

---

## Test Requirements

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# E2E tests (require Docker)
npm run test:e2e
```

### Test Types

| Type | Location | Requirements |
|---|---|---|
| **Unit tests** | `src/__tests__/` | None |
| **Integration tests** | `src/__tests__/` | Redis (via Docker) |
| **E2E tests** | `src/__tests__/` | Docker, GitHub App |

### Test Guidelines

1. **Write tests for new code** — Pull requests should include tests for new functionality
2. **Regression tests** — Bug fixes should include a test that fails without the fix
3. **Test both paths** — Happy path and error path
4. **Use descriptive names** — `describe('enqueueIssue', () => { it('should deduplicate identical issues', ...) })`
5. **Avoid mocks when possible** — Prefer integration tests with real Redis/Docker
6. **Clean up** — Tests should clean up any resources they create

---

## Pull Request Process

### 1. Before You Code

- Check open issues to see if someone is already working on it
- For significant changes, open an issue first to discuss the approach
- Fork the repo and create a branch from `main`

### 2. While You Code

- Follow the [coding standards](#coding-standards)
- Write tests for your changes
- Keep changes focused — one feature/fix per PR
- Update documentation if needed

### 3. Before Submitting

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes (tsc --noEmit)
- [ ] `npm test` passes
- [ ] New tests cover the changes
- [ ] Documentation is updated
- [ ] Commit messages follow conventions

### 4. Submitting

1. Push your branch
2. Open a pull request against `main`
3. Fill in the PR template (description, motivation, testing)
4. Request review from maintainers

### 5. After Submission

- Respond to reviewer feedback
- Make requested changes
- Keep the branch up to date with `main`
- Once approved, a maintainer will merge

---

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | When to Use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, etc.) |
| `refactor` | Code refactoring |
| `test` | Adding or updating tests |
| `chore` | Build, CI, dependencies |
| `perf` | Performance improvements |
| `security` | Security fixes |

### Examples

```
feat(webhooks): add GitLab webhook support
fix(queue): handle Redis connection timeout gracefully
docs: add self-hosting guide
refactor(agent): extract verification into separate module
test(sandbox): add E2B sandbox integration tests
security: add prompt injection sanitization
```

### Scope Examples

- `webhooks`, `queue`, `agent`, `sandbox`, `github`, `security`, `config`, `docs`, `deploy`, `db`

---

## Adding New Features

### Adding a New Webhook Platform

1. Create a new file in `src/webhooks/` (e.g., `gitea.ts`)
2. Implement the `PlatformWebhook` interface from `src/webhooks/base.ts`
3. Implement the `PlatformClient` interface
4. Add the webhook route in `src/server.ts`
5. Add configuration variables in `src/config.ts`
6. Add environment variables to `.env.example`
7. Write tests
8. Update documentation

### Adding a New Sandbox Provider

1. Create a new file in `src/sandbox/` (e.g., `firecracker.ts`)
2. Implement the `SandboxExecutor` interface from `src/sandbox/types.ts`
3. Add the provider to the factory in `src/sandbox/index.ts`
4. Add configuration in `src/config.ts`
5. Add path traversal protection (see existing implementations)
6. Write tests
7. Update documentation

### Adding a New Agent Tool

1. Edit `src/agent/tools.ts`
2. Add the tool to the `buildTools()` return array
3. Follow the existing tool shape: `{ name, description, inputSchema, handler }`
4. Test the tool in the basic fix fallback path

---

## Documentation

Good documentation is critical for an open-source project. Please:

- Update existing docs when you change behavior
- Add JSDoc comments to public functions and interfaces
- Use Mermaid diagrams for architectural docs
- Keep the `.env.example` in sync with `src/config.ts`
- Follow the existing doc style

### Documentation Files

| File | Content |
|---|---|
| `README.md` | Project overview, quick start |
| `docs/ARCHITECTURE.md` | Deep architecture dive |
| `docs/SECURITY.md` | Security model |
| `docs/FAQ.md` | Frequently asked questions |
| `docs/SELF_HOSTING.md` | Self-hosting guide |
| `docs/CUSTOMIZATION.md` | Customization guide |
| `CONTRIBUTING.md` | This file |
| `CODE_OF_CONDUCT.md` | Code of conduct |

---

## Getting Help

- **GitHub Issues**: For bugs, feature requests, and questions
- **Discussions**: For open-ended discussions
- **Pull Requests**: For code contributions

If you're stuck or have questions, don't hesitate to open an issue. We're here to help!

---

## Recognition

Contributors will be recognized in:
- The project README (for significant contributions)
- Release notes
- GitHub's automatic contributor graph

Thank you for contributing!
