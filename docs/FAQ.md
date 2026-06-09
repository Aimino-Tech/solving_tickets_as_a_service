# Frequently Asked Questions

---

## General

### What is STAS?

STAS (Solving Tickets As A Service) is an open-source GitHub bot that automatically fixes labeled issues. When you label an issue with `stas:fix`, STAS investigates your codebase, writes a fix, runs your tests, and opens a pull request — all without human intervention.

It's backed by [OpenCode](https://opencode.ai) — the 162K-star open-source coding agent.

### How is STAS different from Plip?

| Feature | STAS | Plip.io |
|---|---|---|
| Open source | Yes (MIT) | No |
| Self-hostable | Yes | No (SaaS only) |
| Your model choice | Yes (any OpenCode-compatible model) | No (Claude only) |
| Price | Free (self-host) or $49/mo (cloud) | $99-$199/mo |
| Sandbox isolation | E2B + Docker (configurable) | Proprietary |
| Issue tracker support | GitHub, GitLab, Bitbucket, Linear, Jira | GitHub only |
| Multi-platform webhooks | Yes | No |

### How is STAS different from KintsugiBot?

STAS was inspired by KintsugiBot but extends it significantly:

| Aspect | STAS | KintsugiBot |
|---|---|---|
| Agent backend | OpenCode Serve (162K★ agent) | Direct LLM SDK calls |
| Queue system | BullMQ + RabbitMQ dual-backend | Basic in-memory |
| Sandbox | E2B + Docker (pluggable) | Docker |
| Verification gate | Before/after baseline comparison | Basic test run |
| Retry strategy | 4-stage with exact delays + DLQ | Limited |
| Multi-platform | GitHub, GitLab, Bitbucket, Linear, Jira | GitHub only |
| Monitoring | Sentry, Prometheus, Pino structured logging | Basic |
| Rate limiting | Per-account + per-repo token bucket | None |
| Audit trail | Structured + optional DB persistence | None |
| Prompt injection protection | Built-in sanitization | None |
| Fallback models | Model chain with automatic retry | Single model |
| Dead-letter queue | Yes | No |

### How is STAS different from Open SWE?

Open SWE is a LangChain-based agent that operates on SWE-bench tasks. STAS is a production-grade bot that:

- Listens for GitHub webhooks (no manual task submission)
- Runs in an isolated sandbox with network restrictions
- Has a full queue system with retries and DLQ
- Auto-detects project runtime (10+ languages)
- Writes regression tests and validates them
- Creates actual PRs with formatted descriptions
- Supports multi-platform webhooks

### Does STAS work with private repos?

**Yes.** STAS uses GitHub App installation tokens that are scoped to specific repositories. When you install the GitHub App on a private repository, STAS can clone, investigate, and push changes to it.

The sandbox is ephemeral — the repo clone is destroyed after each run. Your code is never stored by STAS.

### What models can I use?

STAS uses two models:

1. **Triage model** (cheap): Classifies the issue before the fix agent runs. Default: `gpt-4o-mini`. Configurable via `OPENAI_CHEAP_MODEL`.
2. **Fix agent model** (primary): The main agent that investigates and fixes the issue. Default: `anthropic/claude-sonnet-4-20250514`. Configurable via `OPENCODE_MODEL`.

The fix agent supports any model that OpenCode serves supports, including:
- Anthropic Claude (Opus, Sonnet, Haiku)
- OpenAI GPT-4o, GPT-4o-mini
- DeepSeek Coder
- Google Gemini
- Any OpenAI-compatible API

Fallback models (`FALLBACK_MODELS`) are tried automatically if the primary model fails.

---

## Setup & Configuration

### Do I need a GitHub App?

**Yes.** STAS operates as a GitHub App. You need to:

1. Create a GitHub App at `https://github.com/settings/apps/new`
2. Set webhook permissions (Issues: read+write, Pull Requests: write, Contents: write)
3. Subscribe to Issues and Issue comments events
4. Generate a private key
5. Configure the app ID, private key, and webhook secret in STAS

The `.env.example` file has step-by-step instructions. See [SELF_HOSTING.md](./SELF_HOSTING.md) for a detailed walkthrough.

### Do I need Redis?

**Yes** (for production). STAS uses Redis for:
- BullMQ job queue (or RabbitMQ as alternative)
- Per-repo concurrency locks
- Rate limiting (token bucket)
- Optional: result caching

For local development, Docker Compose starts a Redis instance automatically.

### Do I need OpenCode?

**Yes.** STAS delegates the fix agent loop to OpenCode Serve. You need to run:
```bash
opencode serve --port 4096
```

STAS sends issue context to OpenCode and receives the fix result. OpenCode handles:
- Code investigation and tracing
- Fix implementation
- Test writing
- Code formatting
- Git commit

### Can I run STAS without Docker?

For the sandbox, you have two options:
1. **E2B cloud sandbox** (recommended for production): No Docker needed. Get a free API key at https://e2b.dev.
2. **Docker local sandbox** (development): Requires Docker.

Without either, STAS cannot run fix attempts because the code execution needs isolation. The triage phase (classification) works without a sandbox, but the full fix pipeline requires one.

---

## Pricing & Economics

### How much does it cost to run STAS?

**Self-hosted (OSS)**: You pay for:
- **LLM API costs**: ~$2-6 per fix attempt depending on the model
- **Infrastructure**: ~$10-50/mo for a VPS (Redis + OpenCode + bot)
- **Sandbox**: Free (Docker) or ~$0.50/fix (E2B cloud)

Example monthly cost for 100 fixes with Claude Sonnet + Docker sandbox: **~$250-400**.

**Cloud (coming soon)**: $49/mo flat for 100 fixes, including our AGI model.

### How does STAS compare cost-wise?

See [STRATEGY.md](../STRATEGY.md) for detailed economics:

| Agent | Cost/fix | Pass rate |
|---|---|---|
| Claude Opus 4.5 (direct) | $2.64 | 45.7% |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% |
| STAS (our AGI, projected) | ~$3.00 | 90%+ |

### Can I use my own API key?

**Yes.** As a self-hosted OSS user, you bring your own API key for:
- Triage LLM / fallback fix: `OPENCODE_API_KEY` (OpenCode Go direct LLM endpoint)
- Fix agent: Configured in OpenCode's environment (OpenCode uses the model's native API key)

The cloud version routes through our AGI, which you don't need to configure.

---

## Technical

### How does STAS handle issue triage?

STAS uses a **two-phase triage** approach:

1. **Classification** (cheap model): The issue is classified as `bug`, `feature`, `question`, or `unknown`. Features and questions are skipped, saving ~60% in agent costs.
2. **Difficulty estimation**: Bug issues are rated `easy`, `medium`, or `hard` to set agent expectations.

The triage uses `gpt-4o-mini` by default (configurable) and costs ~$0.001 per call.

### What happens if the agent fails?

STAS has a multi-layered failure handling:

1. **Model chain**: If the primary model fails, fallback models are tried automatically.
2. **Basic fix fallback**: If OpenCode is unavailable, a simpler fix attempt is made using the triage model directly.
3. **Retry queue**: Failed jobs are retried with exponential backoff (30s, 2m, 5m, 15m).
4. **Dead-letter queue**: After 4 retries, the job moves to a DLQ for manual review.

### Does STAS run the existing test suite?

**Yes.** STAS runs the test suite **before** any changes (baseline) and **after** the fix (verification):

1. Baseline: Records which tests pass/fail before changes
2. Regression test validation: New tests must fail on original code and pass on fix
3. Post-fix comparison: Detects if previously-passing tests now fail
4. If regression is detected, PR creation is blocked

### What languages does STAS support?

STAS auto-detects the project runtime and supports 10+ languages:

| Language | Detection | Test Command |
|---|---|---|
| Node.js / JavaScript / TypeScript | `package.json` | `npm test`, `turbo run test`, `nx run-many` |
| Python | `requirements.txt`, `setup.py`, `pyproject.toml` | `pytest`, `unittest` |
| Go | `go.mod` | `go test ./...` |
| Rust | `Cargo.toml` | `cargo test` |
| Ruby | `Gemfile` | `bundle exec rspec` |
| Java | `pom.xml`, `build.gradle` | `mvn test`, `gradlew test` |
| PHP | `composer.json` | `phpunit` |
| Swift | `Package.swift` | `swift test` |
| Dart/Flutter | `pubspec.yaml` | `flutter test`, `dart test` |
| Elixir | `mix.exs` | `mix test` |
| C++ | `CMakeLists.txt` | `ctest` |
| .NET/C# | `*.csproj`, `*.sln` | `dotnet test` |

### How does STAS handle multiple concurrent fixes?

STAS uses a **per-repo concurrency lock** backed by Redis:
- Default: 3 concurrent fixes per repo
- Configurable via `STAS_MAX_CONCURRENT`
- Jobs that exceed the limit are retried after a delay
- Account-level limits based on billing tier

### Can STAS work with GitLab or Bitbucket?

**Yes.** STAS has built-in webhook handlers for:
- **GitLab**: Issues webhooks with token verification
- **Bitbucket**: Pull request webhooks with HMAC verification
- **Linear**: Issue webhooks with signature verification
- **Jira**: Issue webhooks with signature verification

Each platform normalizes the incoming webhook to STAS's internal `IssueJobData` format before enqueueing.

---

## Contributions

### Can I contribute?

**Absolutely.** STAS is open source (MIT licensed). See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Development setup guide
- Test requirements
- Pull request process
- Code style (Biome)
- Commit conventions

### What kind of contributions are welcome?

- Bug fixes and stability improvements
- Additional sandbox providers (e.g., Firecracker, gVisor)
- New platform webhook handlers (e.g., Gitea, Azure DevOps)
- Dashboard and UI components
- Documentation improvements
- Performance optimizations
- Security audits and improvements

### How do I report a security vulnerability?

Please open a GitHub issue with the `security` label or email the maintainers directly. Do not post security vulnerabilities in public issues.

---

## Operations

### How do I monitor STAS?

STAS provides:
- **Health endpoint**: `GET /health` — basic status, label, uptime
- **Database health**: `GET /health/db` — database connectivity check
- **Structured logging**: Pino with JSON output and request IDs
- **Sentry integration**: Error tracking and performance monitoring
- **Queue metrics**: Via BullMQ API (waiting, active, completed, failed counts)
- **Slack alerts**: Configurable alerts for queue depth and error rates

### Can I customize the trigger label?

**Yes.** Set `STAS_LABEL` to any label name:
```bash
STAS_LABEL=ai:fix
```

The default is `stas:fix`. See [CUSTOMIZATION.md](./CUSTOMIZATION.md) for more options.

### What happens to my code after a fix run?

**Nothing.** The sandbox (E2B or Docker) is destroyed after every run:
- The repository clone is deleted
- Temp directories are cleaned up
- No code is stored by STAS
- Only the PR branch on GitHub persists (if a fix was created)

### Does STAS have a dashboard?

The OSS version does not include a dashboard. The cloud version (coming soon) will have:
- Run history with diff viewer
- Analytics (fix rate, cost, average time)
- Audit log
- Configuration UI
- Account management

---

## Troubleshooting

### STAS isn't responding to my label

Check:
1. The label matches `STAS_LABEL` exactly (default: `stas:fix`)
2. The GitHub App webhook is pointing to your STAS instance
3. The webhook secret matches `GITHUB_WEBHOOK_SECRET`
4. Redis is running and accessible
5. OpenCode serve is running on the configured port
6. Server logs show the webhook arriving (`Received GitHub webhook`)

### The agent keeps timing out

Possible causes:
1. **Model too slow**: Try a faster model (e.g., `claude-sonnet` instead of `claude-opus`)
2. **Fix timeout too short**: Increase `FIX_TIMEOUT_MS` (default: 600,000ms = 10 min)
3. **Large repo**: The shallow clone (`--depth 1`) is fast, but dependency install may be slow
4. **Complex issue**: Some issues legitimately need more agent iterations

### Tests fail during verification

The verification gate is strict by design:
- If pre-existing tests regress, PR creation is blocked
- The regression test must fail on original code (proves it tests the bug)
- If the repo has no test suite, verification is skipped and marked "unverified"

You can configure the sandbox to skip verification by setting the `STAS_VERIFICATION_MODE` environment variable (see [CUSTOMIZATION.md](./CUSTOMIZATION.md)).
