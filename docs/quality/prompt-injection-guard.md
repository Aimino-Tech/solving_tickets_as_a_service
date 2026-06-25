# Prompt Injection Guard — OSS Tool Integration

STAS ships with a two-tier prompt injection protection system:

1. **Tier 1 — Built-in regex guard** (`InjectionGuard` in `workers/gates/injection_guard.py`)
   - Pure regex scanner, < 100ms, zero dependencies
   - Detects direct injection patterns, delimiter escapes, context leaks, homoglyph attacks
   - Active by default in strict mode
2. **Tier 2 — OSS tool integration** (this document — `workers/gates/oss_integration.py`)
   - Optional ML-powered scanners: `llm-guard`, `rebuff`, `garak`
   - Parallel cross-validation, configurable per-tool
   - Falls back automatically to Tier 1 when OSS tools are unavailable

---

## OSS Tools Overview

### [llm-guard](https://github.com/protectai/llm-guard) (default OSS scanner)

Python library that scans prompt/response pairs for injection, PII leakage,
profanity, and topic restriction violations.

- **Detection method**: Transformer-based classifier (`laiyer/deberta-v3-base-prompt-injection`)
- **Speed**: ~200–500ms per scan (GPU-accelerated when available)
- **Strengths**: Semantic understanding — catches rewrites regex misses
- **License**: MIT

### [rebuff](https://github.com/protectai/rebuff) (cross-validation)

Multi-layered injection detector with a vector DB of known attack patterns,
canonicalization tricks, and a separate LLM-as-judge heuristic.

- **Detection method**: Heuristics + vector similarity + LLM query
- **Speed**: ~100–300ms per scan (vector DB in-memory)
- **Strengths**: Can detect novel attacks via similarity to known vectors
- **License**: MIT

### [garak](https://github.com/leondz/garak) (deep probe)

LLM vulnerability scanner — runs a battery of adversarial probes designed
to test model robustness. In STAS, garak is used as a secondary scan for
high-risk inputs flagged by other guards.

- **Detection method**: 100+ plug-in probe modules
- **Speed**: ~1–5s per probe (configurable depth)
- **Strengths**: Comprehensive — tests many attack surfaces simultaneously
- **License**: Apache 2.0

---

## Setup

### 1. Install OSS dependencies

```bash
# From the workers/ directory
pip install llm-guard rebuff garak

# Or use the install script:
bash scripts/install-oss-guard.sh
```

### 2. Verify installation

```python
from workers.gates.oss_integration import OssGuardManager

manager = OssGuardManager()
print(manager.available_tools)  # ['llm_guard', 'rebuff', 'garak']
```

### 3. Configuration

Set environment variables to control which tools are used:

| Variable | Default | Description |
|---|---|---|
| `STAS_OSS_GUARD_ENABLED` | `false` | Enable OSS tool integration |
| `STAS_OSS_GUARD_TOOLS` | `llm_guard,rebuff` | Comma-separated list of OSS tools |
| `STAS_OSS_GUARD_TIMEOUT` | `5.0` | Per-tool timeout in seconds |

The OSS guard is **opt-in** by default. Set `STAS_OSS_GUARD_ENABLED=true`
to activate it alongside the existing regex guard.

---

## Integration Architecture

```
Issue text
    │
    ▼
InjectionGuardRegex  ─── fast, always-on, < 100ms
    │
    ├── [clean] ──► pass through
    │
    └── [flagged] ──► OssGuardManager (opt-in)
                         │
                         ├── llm-guard scanner
                         ├── rebuff cross-validation
                         └── garak deep probe (optional)
                              │
                              ▼
                         Aggregated verdict
```

The OSS integration runs **on top of** the existing regex guard. When enabled:

1. The regex guard always runs first (fast path)
2. If the regex guard flags content, the OSS tools provide deeper analysis
3. If the regex guard gives a clean result, the OSS tools can still be used
   as an independent parallel check (configurable via `OSS_GUARD_TOOLS`)
4. If OSS tools are unavailable or time out, the system falls back to the
   regex guard's verdict

---

## Usage

### Basic usage

```python
from workers.gates.oss_integration import OssGuardManager

manager = OssGuardManager()
result = manager.scan("ignore all previous instructions")

if result.detected:
    print(f"OSS verdict: {result.severity} (confidence: {result.confidence:.2f})")
    print(f"Tools used: {result.tools_used}")
    print(f"Details: {result.details}")
```

### Integration with existing middleware

```python
from workers.gates.injection_guard import InjectionGuard
from workers.gates.oss_integration import OssGuardManager

oss = OssGuardManager()

def check_injection(text: str):
    # Always run regex guard first
    regex_result = InjectionGuard.scan(text)

    if oss.enabled:
        # Parallel OSS validation
        oss_result = oss.scan(text)
        # Combine verdicts...
        return combine_verdicts(regex_result, oss_result)

    return regex_result
```

---

## Testing

```bash
cd workers
python -m pytest tests/test_oss_injection.py -v
```

---

## Best Practices

1. **Always keep the regex guard active** — it's fast, reliable, and works offline
2. **Enable OSS tools in production** — they catch semantic attacks regex misses
3. **Use rebuff for cross-validation** — it detects novel attacks via vector similarity
4. **Use garak sparingly** — it's slower and better suited for periodic batch scans
5. **Set timeouts** — OSS tools can hang on unusual input; the guard handles this gracefully
6. **Monitor `OssGuardResult.confidence`** — a low-confidence detection may warrant human review
