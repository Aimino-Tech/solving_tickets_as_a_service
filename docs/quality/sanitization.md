# Agent Output Sanitization - Configuration & Allowlist

STAS sanitizes all agent-generated output before it reaches external surfaces
(PR descriptions, issue comments, Slack notifications). The sanitization system
strips internal system details - API keys, internal URLs, system prompts,
absolute paths, environment variables, and private IPs - without breaking
legitimate content.

## How It Works

```
Agent output (PR body, comments, diff, summary)
    |
    v
  SanitizationConfig  --->  pattern registry (6 categories, ~38 rules)
    |
    +--> Allowlist filter  --->  suppress known-safe patterns
    |
    +--> Regex scan  ---------->  replace matching content with [REDACTED_*]
    |
    v
  SanitizerResult  ---------->  sanitized_text + replacement log
```

## Pattern Categories

| Category | Rules | Risk | What It Catches |
|----------|-------|------|-----------------|
| `api_keys` | 9 | HIGH | OpenAI `sk-...`, GitHub tokens, AWS keys, Slack tokens, JWTs, private keys |
| `internal_urls` | 6 | HIGH | `.internal`/`.local` hostnames, localhost, RFC 1918 URLs, `stas-*` services |
| `system_prompts` | 5 | MEDIUM | "You are an AI assistant" templates, system directives, tool access descriptions |
| `file_paths` | 9 | MEDIUM | `/etc/`, `/home/`, `/root/`, `/var/`, `/tmp/`, `/usr/`, `/opt/`, `.env`, `~/.ssh/` |
| `env_vars` | 5 | LOW | `process.env.X`, `os.environ`, shell `$VARS`, `${VARS}`, `export` statements |
| `internal_ips` | 4 | MEDIUM | RFC 1918 private IPs (10.x, 172.16-31.x, 192.168.x) + loopback |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_SANITIZER_ENABLED` | `true` | Enable/disable all sanitization |
| `STAS_SANITIZER_ALLOWLIST` | `""` | Comma-separated rule/category names to allowlist |

### Allowlist

The allowlist suppresses specific rules or entire categories. Items are matched
by prefix - allowlisting `"localhost"` also suppresses `"localhost_url"`.

Examples:

```bash
# Suppress localhost URL redaction
export STAS_SANITIZER_ALLOWLIST="localhost"

# Suppress all file path redaction
export STAS_SANITIZER_ALLOWLIST="file_paths"

# Suppress multiple specific rules
export STAS_SANITIZER_ALLOWLIST="loopback,abs_tmp"
```

### Disabling Sanitization Completely

```bash
export STAS_SANITIZER_ENABLED=false
```

## Architecture

```
workers/gates/
+-- __init__.py               # Public API re-exports
+-- sanitizer.py              # Sanitizer engine (applies patterns)
+-- sanitization_config.py    # <- This file - pattern registry + allowlist
+-- pattern_db.py             # Malicious code patterns (separate gate)
+-- injection_guard.py        # Prompt injection detection
+-- injection_middleware.py   # Celery middleware for injection checks
+-- malicious_code_gate.py    # Pre-PR malicious code scanner
+-- oss_integration.py        # OSS ML guard integration
```

## Usage

```python
from workers.gates.sanitization_config import (
    build_sanitizer_config,
    get_active_rules,
    get_config_summary,
    is_allowlisted,
    load_allowlist,
)

config = build_sanitizer_config()

active = get_active_rules(config)
for rule in active:
    print(f"{rule.category}/{rule.name} - {rule.description}")

if is_allowlisted("localhost", config.allowlist):
    print("localhost URLs will NOT be redacted")

summary = get_config_summary()
print(f"{summary['active_rules']} / {summary['total_rules']} rules active")
```

## Severity Levels

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Private keys, credentials that cause immediate security exposure |
| **HIGH** | API keys, tokens, internal URLs, SSH paths |
| **MEDIUM** | System prompts, absolute paths, env var references |
| **LOW** | Shell variable references, generic quoted secrets, loopback IPs |

## Testing

```bash
cd workers
python -m pytest tests/test_sanitization_config.py -v
```

## Files

| File | Purpose |
|------|---------|
| `workers/gates/sanitization_config.py` | Pattern registry, allowlist, config builders |
| `workers/gates/sanitizer.py` | Sanitization engine (applies patterns to text) |
| `workers/tests/test_sanitization_config.py` | Tests for config module |
| `workers/tests/test_sanitizer.py` | Tests for sanitizer engine |
| `docs/quality/sanitization.md` | This document |
