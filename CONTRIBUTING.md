# Contributing to SYNTARO

> **Thank you for considering contributing to SYNTARO!**

SYNTARO is an open-source project (MIT licensed) that turns labeled GitHub issues into pull requests. We welcome contributions of all kinds — bug fixes, features, documentation, tests, and more.

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
- [Release Process](#release-process)
- [Worker E2E Tests (Celery Pipeline)](#worker-e2e-tests-celery-pipeline)

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
# → {"status":"ok","label":"syntaro:fix","uptime":42}
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

### Evaluation Pipeline

See `evaluation/README.md` for the full eval pipeline documentation.

Quick start:
```bash
# Run smoke eval (3 critical tests)
make eval-smoke

# Full eval via Docker Compose (starts LangFuse + Postgres)
make eval-up
make eval-full
make eval-down
```

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

### CI Gates (Leave It Cleaner)

Every PR automatically runs three enforcement gates via `.github/scripts/ci-gates.sh`:

| Gate | Check | What It Blocks |
|---|---|---|
| **Gate 1 — LSP Diagnostics** | `tsc --noEmit` on all changed files | Any TypeScript/type error, pre-existing or new |
| **Gate 2 — Test Regression** | Compare test results on base vs PR head | Previously-passing tests that now fail |
| **Gate 3 — Lint Diff** | `biome check --changed --since=<base>` | New lint warnings introduced by the PR |

**These gates are mandatory.** There is no skip mechanism. If a gate fails:
1. Fix the root cause in the changed files
2. Push a new commit — the gates re-run automatically
3. Do not add `// biome-ignore` or `@ts-expect-error` to bypass checks

Run the gates locally before pushing:
```bash
bash .github/scripts/ci-gates.sh 1   # Diagnostics
bash .github/scripts/ci-gates.sh 2   # Regression
bash .github/scripts/ci-gates.sh 3   # Lint diff
bash .github/scripts/ci-gates.sh all # All three
```

### Anti-Mock Enforcement (5-Layer Defense)

Research shows AI-generated tests often mock core infrastructure instead of testing against real execution, producing false confidence. SYNTARO runs 5 enforcement layers on every PR to prevent this:

| Layer | Tool | What It Blocks | Why |
|---|---|---|---|---|
| **Layer 1 — Architecture** | tsarch | Static imports of `sandbox/executor` and `qualityGates` in tests (test files for those modules are exempted) | Prevents test files from directly importing core infrastructure for mocking |
| **Layer 2+3 — ESLint** | `no-restricted-imports` + custom `no-mock-core-infra` + `@vitest/eslint-plugin` | Static imports via `no-restricted-imports`; `vi.mock`/`jest.mock` calls targeting file paths containing `sandbox/executor`, `qualityGates`, `actionDispatcher`; assertion-quality issues (`expect(true).toBe(true)`, standalone expects, conditional expects) | Catches mock patterns at the import level AND at the assertion level |
| **Layer 4 — Mutation Testing** | Stryker | Code with < 60% mutation score (blocking — no `continue-on-error`) | Tests that mock everything won't catch mutations in real code |
| **Layer 5 — Branch Coverage** | c8 (vitest coverage) | Branch coverage < 80%, lines < 90%, functions < 85%, statements < 90% | Prevents line-coverage gaming — branch coverage forces testing both truthy and falsy paths |

These layers run as the `anti-mock-enforcement` job in `.github/workflows/quality.yml`. All five must pass before merging. The Stryker step is **blocking** (`break` threshold at 60%) — it does NOT use `continue-on-error`.

**For contributors**: Write tests against real execution paths, not mocks. If you need to test sandbox behavior, use the real executor test suite. If you need to test quality gates, run them against real code. If you need to test the action dispatcher, use the action dispatcher test suite. Do NOT mock these modules in other test files.

**Quick reference — run enforcement layers locally:**
```bash
npm run test:architecture    # Layer 1: tsarch
npm run lint:eslint          # Layer 2+3: ESLint rules
npm run test:mutation        # Layer 4: Stryker (mutation testing)
npm run test:coverage        # Layer 5: branch/line coverage
```

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

---

## Worker E2E Tests (Celery Pipeline)

The Celery worker pipeline E2E test validates the full worker task flow:
`triage → agent → sandbox → verification → PR creation → notifications`

### Prerequisites

- **Docker** and **docker-compose** (for Redis and RabbitMQ)
- **Python 3.10+** with `python3` and `pip3` on PATH
- The test auto-creates a Python virtualenv and installs dependencies from `workers/requirements.txt`

### Running Worker E2E Tests

```bash
# Full pipeline: starts Docker, runs test, cleans up
npm run test:worker

# Watch mode (re-run on changes — assumes Docker already running)
npm run test:worker:watch
```

### What the Test Does

1. **Infrastructure setup**:
   - Starts Redis (Celery result backend) and RabbitMQ (Celery broker) via `docker-compose.e2e.yml`
   - Starts mock HTTP servers for OpenCode serve and GitHub API
   - Creates a Python virtualenv with Celery and task dependencies
   - Spawns a `celery worker` subprocess consuming from all pipeline queues

2. **Pipeline execution**:
   - A Python helper script dispatches a test issue through each stage sequentially:
     - `triage_issue` — classifies the issue (gracefully degrades when no API key)
     - `dispatch_opencode` — calls the mock OpenCode server (avoids real API costs)
      - `boot_sandbox` — creates a real E2B sandbox (falls back to placeholder when no E2B key)
      - `run_verification` — runs test_command in sandbox via E2B or locally via subprocess, returns real pass/fail output
      - `create_pull_request` — opens a draft PR via GitHub API and returns its URL
      - `send_notification` — delivers messages to configured Slack/Discord/email channels
   - Each stage emits a JSON result line with stage name, task ID, and status

3. **Assertions**:
   - All 6 stages complete with `SUCCESS` status
   - Each stage's result contains expected fields
   - Data flows correctly between stages (e.g., issue number preserved)
   - Pipeline executes stages in the correct order

### Mock External Dependencies

The test uses mock HTTP servers instead of real services:

| Service | Mock Port | Purpose |
|---|---|---|
| **OpenCode serve** | 9409 | Responds to `POST /run` with mock agent results |
| **GitHub API** | 9410 | Handles PR creation, comments, refs |
| **OpenCode Go LLM** | — | Gracefully skipped (empty `OPENCODE_API_KEY`) |
| **E2B Sandbox** | — | Creates real sandbox when key set; returns placeholder when empty |

### CI Gates (Leave It Cleaner)

Every PR also runs three CI Gates that enforce code quality on every changed file:

- **Gate 1 (LSP Diagnostics)**: `tsc --noEmit` on all files, zero tolerance for any errors
- **Gate 2 (Test Regression)**: Runs tests on base branch, then PR head, blocks on regressions
- **Gate 3 (Lint Diff)**: `biome check --changed` on PR files, blocks new warnings

Run locally: `bash .github/scripts/ci-gates.sh all`

### CI Integration

Worker E2E tests run as a separate job (`worker-e2e`) in the CI workflow:
- Runs in parallel with other E2E tests
- Uses `actions/setup-python@v5` to provision Python 3.12
- Starts Redis + RabbitMQ via Docker Compose
- Has a 15-minute timeout (pipeline can take 3+ minutes)
- Docker services are torn down in an `if: always()` step

### Debugging

If the worker pipeline test fails:

1. **Check Docker logs**:
   ```bash
   docker logs syntaro-e2e-redis
   docker logs syntaro-e2e-rabbitmq
   ```

2. **Check Python virtualenv**: The test creates `.venv-worker-pipeline` in `tests/e2e/`.
   You can activate it manually:
   ```bash
   source tests/e2e/.venv-worker-pipeline/bin/activate
   celery -A workers.celery_app worker --loglevel=DEBUG --concurrency=1
   ```

3. **Run the helper script directly** (with Docker and venv active):
   ```bash
   python3 tests/e2e/worker_pipeline_helper.py \
     --broker amqp://guest:guest@localhost:5672// \
     --backend redis://localhost:16379/0
   ```

4. **Common failure modes**:
   - Docker not running or containers unhealthy
   - Port conflicts (Redis on 16379, RabbitMQ on 5672/15672)
   - Python version mismatch (3.10+ required)
   - pip install failures (network, version conflicts)
   - Worker crashes on startup (check Celery log in test output)

---

## Release Process

SYNTARO follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and uses an automated release pipeline triggered by Git tags.

### Versioning Strategy

See [VERSIONING.md](./VERSIONING.md) for the full versioning strategy document.

Key points:
- **MAJOR** — Breaking changes (API, database, platform support)
- **MINOR** — New features, new integrations
- **PATCH** — Bug fixes, security patches, documentation
- Pre-release suffixes: `-alpha.N`, `-beta.N`, `-rc.N`

### Pre-Release Checklist

Before every release, run through the [PRE_RELEASE_CHECKLIST.md](./PRE_RELEASE_CHECKLIST.md). This covers:

- Changelog verification
- CI pipeline status
- Docker build validation
- Security scans
- Documentation checks

### Dry Run

Always perform a dry run before tagging a release:

```bash
npm run release:dry-run -- --version v0.11.0
```

This validates:
1. Git working tree is clean
2. CHANGELOG.md has an entry for the target version
3. package.json version
4. Docker image builds successfully

### Creating a Release

#### 1. Prepare the Release

```bash
# Ensure you're on main with latest changes
git checkout main
git pull origin main

# Review changes since last release
git log --oneline v<last-version>..HEAD

# Update CHANGELOG.md:
#   - Move [Unreleased] entries to a new dated section
#   - Ensure categories are correct (Added, Changed, Fixed, Removed, Security)
#   - Verify ticket references

# Update package.json version if needed:
#   node -e "const p=require('./package.json'); p.version='0.11.0'; require('fs').writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"

# Commit the release preparation
git add CHANGELOG.md package.json
git commit -m "chore: prepare release v0.11.0"
```

#### 2. Tag and Push

```bash
# Tag the release
git tag -a v0.11.0 -m "v0.11.0 — Production runbooks, migration testing, rate limit audit"

# Push the tag — this triggers the automated release workflow
git push origin v0.11.0
```

#### 3. What Happens Automatically

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which:

1. **Validates** — Verifies tag format, CHANGELOG entry exists
2. **Builds & pushes Docker image** — Multi-platform build to GHCR with semver tags
3. **Scans for vulnerabilities** — Trivy scan (HIGH/CRITICAL fails the build)
4. **Generates SBOM** — CycloneDX software bill of materials
5. **Creates GitHub Release** — Includes release notes from CHANGELOG, SBOM artifact
6. **Notifies Slack** — Optional notification via webhook

#### 4. Verify

```bash
# Check the release on GitHub
gh release view v0.11.0

# Pull and verify the Docker image
docker pull ghcr.io/aimino-tech/solving_tickets_as_a_service:v0.11.0
```

### Release Candidates

For pre-release testing:

```bash
git tag -a v0.11.0-rc.1 -m "v0.11.0-rc.1 — Release candidate 1"
git push origin v0.11.0-rc.1
```

Release candidates:
- Are marked as `prerelease` on GitHub
- Are NOT tagged as `latest` on GHCR
- Follow the same validation and build pipeline

### Hotfix Releases

For urgent fixes to a previous release:

1. Create a branch from the release tag:
   ```bash
   git checkout -b hotfix/v0.11.1 v0.11.0
   ```
2. Apply the fix
3. Tag and push:
   ```bash
   git tag -a v0.11.1 -m "v0.11.1 — Security patch"
   git push origin v0.11.1
   ```
4. Merge the hotfix back to `main`

### Automation Details

The release workflow is defined in `.github/workflows/release.yml`. It is separate from the CI workflow (`.github/workflows/ci.yml`) and is only triggered by version tags. The CD workflow (`.github/workflows/cd.yml`) handles continuous deployment from the `main` branch.

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR to `main` | Lint, typecheck, test, build, security scan |
| `cd.yml` | Push to `main` | Build & push Docker image (branch + SHA tags) |
| `release.yml` | Push `v*` tag | Release pipeline, GitHub Release, semver tags |
