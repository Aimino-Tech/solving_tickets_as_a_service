# E2E Tests — Epistemic Guardrail

## Quick Start

Run all epistemic E2E tests:

```bash
cd /path/to/repo
PYTHONPATH=".:guardrail" python3 tests/e2e/test_epistemic_e2e.py
```

Run all epistemic unit tests:

```bash
PYTHONPATH=".:guardrail" python3 guardrail/tests/tests/test_epistemic_guardrail.py
```

Run all slash guardrail tests:

```bash
PYTHONPATH=".:guardrail" python3 guardrail/tests/tests/test_guardrail.py
```

## Requirements

- Python 3.10+
- `litellm` (for `CustomGuardrail` base class and `ModelResponse`)
- `pyyaml` (for constraint loading)

Install:

```bash
pip install litellm pyyaml
```

## Test Structure

### E2E Tests (`tests/e2e/test_epistemic_e2e.py`)

| Group | Test | What it checks |
|-------|------|----------------|
| Pipeline | `test_e2e_full_pipeline_block` | Violating claim → WARN/BLOCK |
| Pipeline | `test_e2e_full_pipeline_allow` | Clean text → ALLOW |
| Pipeline | `test_e2e_full_pipeline_warn` | Borderline → WARN |
| Pipeline | `test_e2e_multiple_violations` | 2+ violations detected |
| Pipeline | `test_e2e_support_relation_raises_confidence` | Support increases strength |
| Pipeline | `test_e2e_attack_relation_lowers_confidence` | Attack decreases strength |
| Pipeline | `test_e2e_no_false_positive` | Safe text → no violations |
| Proxy | `test_e2e_proxy_violation_returned` | Violation annotated via guardrail |
| Proxy | `test_e2e_proxy_clean_request` | Clean passes through unmodified |
| Proxy | `test_e2e_proxy_both_guardrails` | Guardrail runs without error |
| Constraints | `test_e2e_constraint_loading` | YAML config loads correctly |
| Constraints | `test_e2e_rigor_language_constraints` | Language-specific constraints work |

### Helpers

```python
make_llm_response(text: str) -> ModelResponse
run_epistemic_pipeline(text, constraints) -> (claims, violations, decision)
assert_violation(violations, constraint_id, severity=None)
```

## Writing Constraints

Constraints are defined in YAML:

```yaml
constraints:
  - id: unique-constraint-id
    description: Human-readable description
    statement: The epistemically correct factual statement
    severity: warn|block|allow
    supported_by: [other-constraint-id]  # raises confidence
    attacked_by: [other-constraint-id]    # lowers confidence
```

Place your constraint file at `guardrail/epistemic/constraints.yaml` or set `EPISTEMIC_CONFIG_PATH` env var.

## Interpreting Output

The guardrail annotates responses with violation information:

```
--- 
*Epistemic guardrail detected potential issues:
* Violations: 2
* Decision: warn
*
The response contains statements that conflict with known constraints.
```

Violations are also logged at WARNING level with constraint IDs and strength scores.
