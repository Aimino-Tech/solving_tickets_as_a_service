# Changelog

All notable changes to STAS (Solving Tickets As A Service) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- CHANGELOG.md with Keep a Changelog format and retroactive entries from AIM-1185 onward
- VERSIONING.md documenting the project's versioning strategy
- PRE_RELEASE_CHECKLIST.md for structured release qualification
- Automated release workflow (`.github/workflows/release.yml`) triggered by `v*` tags
- `npm run release:dry-run` script for local release verification
- Release process documentation in CONTRIBUTING.md

---

## [0.11.0] - 2026-06-08

### Added
- Production deployment runbook and alert configurations (AIM-1280)
- Database migration integrity check and rollback verification in CI (AIM-1281)
- Restore scripts, backup verification, and DR drill documentation (AIM-1278)
- Dashboard deployment configuration — API proxy and static server (AIM-1276)
- One-command developer environment setup (`npm run setup`) (AIM-1277)
- Load testing and performance baseline with k6 scenarios and runner (AIM-1273)
- Supply chain security: CycloneDX SBOM generation, dependency scanning, lockfile integrity checks (AIM-1270)
- Content Security Policy and security headers middleware (AIM-1271)

### Changed
- Rate limiting applied to all API endpoints with centralized config and auth-aware tiers (AIM-1282)
- Coverage thresholds aligned between vitest config and CI (AIM-1289)
- Unit test coverage expanded to 10 previously untested modules including billing, audit, and bridge (AIM-1267)
- Production monitoring enriched with queue depth, error rate, and Sentry alerting (AIM-1272)

### Fixed
- TypeScript compilation errors — ~50 type errors resolved across the codebase (AIM-1263)
- All `as any` type assertions eliminated — 107+ occurrences replaced with proper types (AIM-1265)
- npm peer dependency conflicts resolved (AIM-1266)
- Boolean env var coercion: `"false"` / `"0"` now correctly evaluated as `false` (AIM-1264)
- Stripe API version reference fixed in billing modules — pointed to non-existent version (AIM-1285)
- Duplicate middleware registration removed from Express server (AIM-1286)
- Slack-bolt test fixed to handle async error type correctly (AIM-1267)

### Security
- Docker security hardening: non-root user, HEALTHCHECK, CI/CD Grype scanning, Docker Bench Security (AIM-1279)
- Supply chain security: dependency scanning, lockfile integrity, SBOM generation, pip-audit (AIM-1270)
- Content Security Policy headers configured for all Express responses (AIM-1271)
- Production Docker Compose hardened with certbot, backup volumes, and security best practices (AIM-1287)

---

## [0.10.0] - 2026-06-05

### Added
- OpenAPI documentation and developer portal with Swagger UI (AIM-1241)
- Multi-tenant Postgres schema, repositories, and dashboard API routes (AIM-1214)
- Hosted service dashboard with Vite/React/TypeScript (AIM-1212)
- Persistent run history storage with SQLite/Postgres backends (AIM-1203)
- Data retention policies, automated backup scripts, and disaster recovery playbook (AIM-1240)
- Usage metering with cost calculation and unit tests (AIM-1246)
- E2E test infrastructure and full-flow test harness (AIM-1220, AIM-1221)
- CI/CD pipeline optimization with parallel jobs and caching (AIM-1222)
- Performance benchmark suite for the agent pipeline (AIM-1223)
- Queuing infrastructure: BullMQ queue worker, RabbitMQ producers and connection (AIM-1230)
- Dead letter queue, retry logic, and worker monitoring (AIM-1233)
- Webhook reliability: delivery guarantees, event replay, and event log (AIM-1236)
- Audit logging system and admin API authentication (AIM-1239)
- Docker sandbox for local development with auto-select factory (AIM-1204)
- Per-repo rate limiting and concurrency management (AIM-1207)
- Prometheus metrics wired for rate limiting and concurrency (AIM-1253)
- RabbitMQ monitoring user, dev vhost, and TLS configuration
- Comprehensive OSS documentation and setup guides (AIM-1210)
- Monitoring and observability improvements with enhanced health endpoints (AIM-1211)
- Sentry error monitoring integration (AIM-1235)

### Changed
- Complete codebase rewrite using KintsugiBot's battle-tested patterns (AIM-1185)
- Agent pipeline enhanced with DLQ replay endpoint and Celery autoretry
- Middleware stack reorganized for better separation of concerns

### Fixed
- PR review issues: removed duplicate audit references, unused imports, async inconsistencies
- E2E test configuration and environment variable handling
- Merge conflicts between feature branches and main (Phase 2 MVP consolidation)

### Security
- Security hardening: Helmet, CORS, IP allowlist, sandbox security sandboxing (AIM-1237)
- Production Docker Compose stack with proper secret management (AIM-1238)
- Environment variable validation with Zod schemas

---

## [0.9.0] - 2026-06-05

### Added
- Stripe billing integration with subscriptions, plans, trials, and webhooks (AIM-1213)
- Pricing tier tests, admin authentication, and wiring (AIM-1227)
- Feature flag service for gradual feature rollout (AIM-1242)
- OpenCode plugin for workflow automation

### Changed
- Wiring of audit logging into action dispatcher, queue, and rate limit middleware
- GitHub action dispatcher enhanced for multi-platform webhook support

---

## [0.8.0] - 2026-05-28

### Added
- Initial project scaffolding and repository setup (AIM-1185)
- WORKFLOW.md with OpenCode orchestration rules
- AGENTS.md, STRATEGY.md, ROADMAP.md — foundational project documentation
- OpenCode plugin for AI agent workflow management
- Basic testing infrastructure (394 tests initial baseline)
- CI/CD pipelines with Docker multi-stage builds
- Express server with health endpoint and basic middleware
- GitHub App authentication and webhook handling
- Agent pipeline for issue triage, fix, and PR creation
- E2B and Docker sandbox implementations
- Monitoring with Pino logging and basic health checks
- Queue infrastructure with BullMQ

### Security
- Base security middleware (Helmet, CORS)
- Input validation with Zod schemas
- Secure Docker build with multi-stage and non-root user

---

## [0.7.0] - Earlier

### Added
- GitLab and Bitbucket webhook platform support
- Slack notifications integration
- Linear and Jira tracker integrations
- Celery worker pipeline (Python) for async task processing
- Cloud deployment configurations (Railway, Fly.io)
- Kubernetes manifests for container orchestration
- nginx reverse proxy configuration
- Redis caching layer

---

## [0.6.0] - Earlier

### Added
- Sandbox isolation providers (E2B, Docker)
- Agent tool definitions for code modification
- GitHub action dispatcher for automated PR creation
- Basic rate limiting and concurrency controls
- Database schema with Drizzle ORM

---

## [0.5.0] - Earlier

### Added
- Initial TypeScript project structure
- Core issue resolution pipeline
- Webhook event processing
- Configuration validation with Zod
- Logging infrastructure with Pino

---

## [0.4.0] - Earlier

### Added
- Multi-platform webhook support (GitHub, GitLab, Bitbucket)
- Queue management with BullMQ and RabbitMQ
- Basic monitoring and health checks
- Testing framework with Vitest

---

## [0.3.0] - Earlier

### Added
- Express server with RESTful API endpoints
- GitHub App integration and authentication
- Webhook secret verification
- Basic PR creation workflow

---

## [0.2.0] - Earlier

### Added
- Initial project scaffolding
- TypeScript strict mode configuration
- Biome code formatting and linting setup
- Docker development environment

---

## [0.1.0] - Earlier

### Added
- Initial commit — STAS bot proof of concept
- Basic issue label detection
- GitHub API client setup
- Project README and license

---

## Release Tags

| Version | Tag | Date | Highlights |
|---------|-----|------|------------|
| 0.11.0 | `v0.11.0` | 2026-06-08 | Runbooks, migration testing, rate limit audit, Docker hardening, CPS, SBOM |
| 0.10.0 | `v0.10.0` | 2026-06-05 | Phase 2 MVP: Stripe, dashboard, E2E, OpenAPI, audit logging, DR, DLQ |
| 0.9.0 | `v0.9.0` | 2026-06-05 | Stripe billing, pricing tiers, feature flags |
| 0.8.0 | `v0.8.0` | 2026-05-28 | Initial OSS release: full agent pipeline, CI/CD, testing, Docker |
| 0.7.0 | `v0.7.0` | Earlier | Multi-platform, Celery workers, K8s, Slack, Linear |
| 0.6.0 | `v0.6.0` | Earlier | Sandbox isolation, tool definitions, DB schema |
| 0.5.0 | `v0.5.0` | Earlier | TypeScript project, core pipeline, webhooks, Zod config |
| 0.4.0 | `v0.4.0` | Earlier | Multi-platform webhooks, BullMQ, RabbitMQ, Vitest |
| 0.3.0 | `v0.3.0` | Earlier | Express server, GitHub App, webhook verification |
| 0.2.0 | `v0.2.0` | Earlier | TypeScript strict mode, Biome, Docker dev env |
| 0.1.0 | `v0.1.0` | Earlier | Proof of concept — issue label detection, GitHub API |

---

## How to Release

See [VERSIONING.md](./VERSIONING.md) for versioning strategy and [CONTRIBUTING.md](./CONTRIBUTING.md) for the full release process.

For the automated release workflow, push a `v*` tag (e.g., `v0.11.0`) to trigger `.github/workflows/release.yml`.
