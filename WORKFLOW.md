---
hooks:
  before_run:
  - source .venv/bin/activate 2>/dev/null || source venv/bin/activate 2>/dev/null
    || true
agent:
  backend: opencode
  default_effort: 3
  max_turns: 90
opencode:
  agent: claude
  model: deepseek-v4-flash
  approval_policy: auto_approve_terminal
  turn_timeout_ms: 300000
  plugins:
  - ralph-loop
  - review-work
  - refactor
  - handoff
---
# Hermes Agent — Development Workflow

## Quick Reference

```bash
# Setup
uv venv venv --python 3.11 && source venv/bin/activate
uv pip install -e ".[all,dev]"

# Optional: browser tools
npm install

# Test
scripts/run_tests.sh                              # CI-parity wrapper
pytest tests/ -v                                   # direct (venv active)
pytest tests/path/to/test.py::test_name -xvs       # single test

# Lint
ruff check .                                       # blocking enforcement
ty check .                                         # type diff (advisory)

# Config
cp cli-config.yaml.example ~/.hermes/config.yaml
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Git | With `--recurse-submodules` support, `git-lfs` |
| Python 3.11+ | uv will install it if missing |
| uv | Fast Python package manager ([install](https://docs.astral.sh/uv/)) |
| Node.js 20+ | Optional — browser tools, WhatsApp bridge |

---

## Development Setup

```bash
git clone --recurse-submodules https://github.com/NousResearch/hermes-agent.git
cd hermes-agent

# Create venv with Python 3.11
uv venv venv --python 3.11
source venv/bin/activate

# Install with all extras
uv pip install -e ".[all,dev]"

# Optional: browser tools
npm install

# Configure
mkdir -p ~/.hermes/{cron,sessions,logs,memories,skills}
cp cli-config.yaml.example ~/.hermes/config.yaml
touch ~/.hermes/.env
echo "OPENROUTER_API_KEY=***" >> ~/.hermes/.env

# Symlink for global access
mkdir -p ~/.local/bin
ln -sf "$(pwd)/venv/bin/hermes" ~/.local/bin/hermes

# Verify
hermes doctor
hermes chat -q "Hello"
```

---

## Testing

### CI-parity (recommended — hermetic, parallel)

```bash
scripts/run_tests.sh
# - Unsets credential env vars
# - Sets TZ=UTC, LANG=C.UTF-8
# - Runs with `-n auto` xdist workers
# - Per-file subprocess isolation prevents state leakage
```

### Direct (venv must be active)

```bash
pytest tests/ -v
pytest tests/path/to/test.py -v              # single file
pytest tests/path/to/test.py::test_name -xvs # single test, no capture
```

### Test structure

- Tests live under `tests/` mirroring the source tree
- Each `test_*.py` file runs in its own subprocess (via `tests/_isolate_plugin.py`)
- Integration tests (requiring API keys) are marked `@pytest.mark.integration`
- Default run skips integration tests: `-m 'not integration'`
- Per-test timeout: 30s hard cap (`--timeout=30 --timeout-method=signal`)
- Platform-specific tests use `@pytest.mark.skipif(sys.platform == "win32", ...)`

---

## Linting

### Ruff (Python)

Configured in `pyproject.toml` under `[tool.ruff]`:

- **Preview mode** enabled (required for `PLW1514`)
- **Active rule**: `PLW1514` (unspecified-encoding) — catches bare `open()`/`read_text()` calls
- All other rules intentionally disabled while typecheck wrangling is in progress
- Test/skills/plugin paths excluded from PLW1514

Run:
```bash
ruff check .                    # blocking — exit code propagates
ruff check --output-format json --exit-zero .  # advisory (all diagnostics, exits 0)
```

CI runs two jobs (see `.github/workflows/lint.yml`):
1. **Advisory diff** — ruff + ty diagnostics vs target branch, posted as PR comment
2. **Blocking enforcement** — `ruff check .`, gates merge

### Ty (Python type diff)

```bash
ty check .                      # type error diff (advisory only)
```

Configured in `pyproject.toml: [tool.ty.*]`.

### Windows footgun check

```bash
python scripts/check-windows-footguns.py --all
```

Static analysis for Windows-unsafe patterns: `os.kill(pid, 0)`, `os.setsid`, `os.killpg`, bare `open()` without encoding, shebang scripts via subprocess. Runs in CI as a blocking job.

---

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

### Types

| Type | Use for |
|------|---------|
| `fix` | Bug fixes |
| `feat` | New features |
| `docs` | Documentation |
| `test` | Tests |
| `refactor` | Code restructuring (no behavior change) |
| `chore` | Build, CI, dependency updates |

### Scopes

`cli`, `gateway`, `tools`, `skills`, `agent`, `install`, `whatsapp`, `security`, `plugins`, `cron`, `kanban`, `tui`, `website`, etc.

### Examples

```
fix(cli): prevent crash in save_config_value when model is a string
feat(gateway): add WhatsApp multi-user session isolation
fix(security): prevent shell injection in sudo password piping
test(tools): add unit tests for file_operations
chore(deps): bump openai from 2.24.0 to 2.25.0
```

---

## Pull Request Process

### Branch naming

```
fix/description            # Bug fixes
feat/description           # New features
docs/description           # Documentation
test/description           # Tests
refactor/description       # Code restructuring
```

### Before submitting

1. **Run tests** — `scripts/run_tests.sh` (CI-parity)
2. **Test manually** — `hermes` + exercise your code path
3. **Check cross-platform** — I/O, process mgmt, terminal handling on macOS/Linux/WSL2
4. **Windows footguns** — `python scripts/check-windows-footguns.py --all` on your diff
5. **Keep focused** — one logical change per PR

### PR description template

Include:
- **What** changed and **why**
- **How to test** (reproduction steps for bugs, usage examples for features)
- **Platforms** tested on
- Reference related issues

Full template at `.github/PULL_REQUEST_TEMPLATE.md`.

### Checklist

Before requesting review:
- [ ] Commits follow Conventional Commits
- [ ] No unrelated changes in the PR
- [ ] `scripts/run_tests.sh` passes
- [ ] Windows footguns checked (if code touches I/O, processes, or shell)
- [ ] Updated docs/AGENTS.md if architecture changed
- [ ] Updated `cli-config.yaml.example` if config keys changed
- [ ] Dependency pins follow supply-chain policy (upper bounds, SHAs)

---

## Dependency Pinning Policy

After the litellm supply-chain compromise (March 2026) and Mini Shai-Hulud worm (May 2026):

| Source | Required |
|--------|----------|
| PyPI package | `>=floor,<next_major` |
| Git URL | Full commit SHA |
| GitHub Actions | Full commit SHA + version comment |
| CI-only pip | `==exact` |

**Post-1.0**: `<2` ceiling — e.g. `openai>=2.24.0,<3`
**Pre-1.0**: `<0.(current_minor + 2)` — e.g. `asyncpg>=0.29,<0.32`

PRs adding unbounded `>=X.Y.Z` will be rejected. See `pyproject.toml` for the full rationale.

---

## CI/CD Pipeline

Located in `.github/workflows/` (14 workflows):

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `tests.yml` | push/PR main | Full test suite (6 parallel slices) |
| `lint.yml` | push/PR main | Ruff + ty diff + blocking enforcement |
| `nix.yml` | push/PR main | Nix flake build |
| `nix-lockfile-fix.yml` | push main | Auto-fix flake.lock drift |
| `docker-publish.yml` | release | Build & push Docker image |
| `upload_to_pypi.yml` | release | Publish to PyPI |
| `deploy-site.yml` | push main | Deploy documentation site |
| `supply-chain-audit.yml` | push/PR main | Flag dep manifest changes |
| `osv-scanner.yml` | push/PR main | Vulnerability scanner |
| `history-check.yml` | push main | Verify git history integrity |
| `contributor-check.yml` | PR | Contributor license agreement |
| `skills-index.yml` | push main | Rebuild skills index |
| `uv-lockfile-check.yml` | push main | Verify uv.lock consistency |
| `docs-site-checks.yml` | push/PR | Documentation build validation |

All action SHAs are pinned with a version comment (`# v6`). This prevents tag-mutation attacks.

---

## Backend Configuration

### `config.yaml` (~/.hermes/config.yaml)

Key sections:

```yaml
model:                          # Model selection
  provider: openrouter
  model: openrouter/auto

agent:                          # Agent behavior
  max_iterations: 90
  tools: cli

display:                        # CLI appearance
  skin: default                 # or mono, slate, ares, custom
  tool_progress: true

terminal:                       # Terminal backend
  backend: local                # local, docker, ssh, modal

delegation:                     # Subagent spawning
  max_concurrent_children: 3
  orchestrator_enabled: true

memory:                         # Memory backend
  provider: honcho              # or mem0, supermemory, byterover, etc.

gateway:                        # Messaging gateway
  enabled: false                # enable for Telegram, Discord, Slack, etc.

cron:                           # Scheduled jobs
  enabled: false
```

### `.env` (~/.hermes/.env — secrets only)

```
OPENROUTER_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
```

### Skins

Customize CLI appearance via `display.skin`:

| Skin | Description |
|------|-------------|
| `default` | Classic gold/kawaii (built-in) |
| `mono` | Clean grayscale (built-in) |
| `slate` | Cool blue developer theme (built-in) |
| `ares` | Crimson/bronze war-god theme (built-in) |
| Custom | Drop `~/.hermes/skins/<name>.yaml`, activate with `/skin <name>` |

---

## Architecture Overview

```
hermes-agent/
├── run_agent.py              # AIAgent — core conversation loop, tool dispatch
├── cli.py                    # HermesCLI — interactive CLI orchestrator
├── model_tools.py            # Tool orchestration, function dispatch
├── toolsets.py               # Tool grouping definitions
├── hermes_state.py           # SQLite session store (FTS5 search)
├── hermes_constants.py       # Profile-aware path resolution
│
├── agent/                    # Agent internals
│   ├── prompt_builder.py         # System prompt assembly
│   ├── context_compressor.py     # Auto-summarization
│   ├── auxiliary_client.py       # Side-LLM client resolution
│   ├── display.py                # Spinner, tool progress UI
│   └── memory_manager.py         # Memory orchestration
│
├── hermes_cli/               # CLI implementations
│   ├── config.py                 # Config mgmt, env var definitions
│   ├── skins/                    # Skin engine
│   └── commands.py               # Slash command registry
│
├── tools/                    # Tool implementations (self-registering)
│   ├── registry.py               # Central tool registry
│   ├── terminal_tool.py          # Terminal execution
│   ├── file_operations.py        # File read/write/search
│   ├── web_tools.py              # Web search + extract
│   ├── delegate_tool.py          # Subagent spawning
│   └── environments/             # Terminal backends
│
├── gateway/                  # Messaging gateway
│   ├── run.py                    # GatewayRunner
│   └── platforms/                # Telegram, Discord, Slack, etc.
│
├── plugins/                  # Plugin system
│   ├── memory/                   # Memory providers
│   ├── model-providers/          # Inference backends
│   └── kanban/                   # Multi-agent work queue
│
├── cron/                     # Scheduler
├── skills/                   # Bundled skills
├── optional-skills/          # Official optional skills
├── tests/                    # Test suite (~17k tests)
├── ui-tui/                   # React Ink TUI
└── website/                  # Docusaurus docs
```

---

## AI / Agent Workflow Instructions

### Operating Principles

1. **Read before writing.** Always read existing files before editing. Match the project's existing patterns.
2. **Decompose and delegate.** Use `delegate_task` for parallel subagent work. Do not implement complex work yourself — delegate to `deep` or `unspecified-high` agents.
3. **Never suppress type errors.** No `as any`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`.
4. **Fix minimally.** Bugfix = fix the bug, not refactor. No scope creep.
5. **Verify after every change.** Run `lsp_diagnostics` on changed files. Run tests before marking complete.
6. **Dependency discipline.** Every new `pyproject.toml` dep must have an upper bound. No bare `>=X.Y.Z`.
7. **Cross-platform aware.** Windows-unsafe patterns (`os.kill(pid, 0)`, `os.setsid`, bare `open()`) must be guarded or use `psutil` alternatives.

### Workflow Steps

1. **Explore** — fire 2-5 parallel `explore` agents to understand the codebase area
2. **Plan** — create todos before starting any multi-step work
3. **Implement** — delegate units of work in parallel via `delegate_task`; never work sequentially
4. **Verify** — run tests, check lints, run footgun checker
5. **Review** — use `review-work` skill for post-implementation QA

### Available Commands

| Command | Purpose |
|---------|---------|
| `/review-work` | Post-implementation review (5 parallel agents) |
| `/refactor` | Intelligent refactoring with LSP/AST-grep |
| `/ralph-loop` | Self-referential dev loop until completion |
| `/handoff` | Generate context summary for session handoff |
| `/remove-ai-slops` | Remove AI code smells from branch changes |
| `/init-deep` | Initialize hierarchical AGENTS.md knowledge base |

---

*See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution guide.*
