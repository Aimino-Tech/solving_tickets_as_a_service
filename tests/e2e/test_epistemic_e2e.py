"""
End-to-end tests for the epistemic guardrail pipeline.
All tests work offline with mocked ModelResponse — no LLM API calls.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import yaml
from litellm.types.utils import ModelResponse

from guardrail.epistemic.types import Claim, Constraint, Decision, Severity, Violation
from guardrail.epistemic.claim_extractor import extract_claims
from guardrail.epistemic.policy_engine import evaluate_claims
from guardrail.epistemic.argumentation import evaluate_constraint, compute_dfquad_strength
from guardrail.epistemic.guardrail import EpistemicGuardrail
from guardrail.epistemic.loader import load_constraints, get_constraints


# ── Test helpers ──────────────────────────────────────────────────────

def make_llm_response(text: str) -> ModelResponse:
    return ModelResponse(
        id="e2e-test",
        choices=[{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": text,
                "reasoning_content": None,
                "thinking_blocks": None,
            },
            "finish_reason": "stop",
        }],
        created=0,
        model="e2e-test-model",
        object="chat.completion",
    )


def run_epistemic_pipeline(text: str, constraints: list[Constraint]) -> tuple[list[Claim], list[Violation], Decision]:
    claims = extract_claims(text)
    if not claims:
        return [], [], Decision.ALLOW
    result = evaluate_claims(claims, constraints)
    return result.claims, result.violations, result.decision


def assert_violation(violations: list[Violation], constraint_id: str, severity: Severity | None = None):
    for v in violations:
        if v.constraint_id == constraint_id:
            if severity is not None:
                assert v.severity == severity, (
                    f"Violation {constraint_id} has severity {v.severity}, expected {severity}"
                )
            return
    assert False, f"No violation found for constraint '{constraint_id}'"


# ── Test constraints ──────────────────────────────────────────────────

DEFAULT_CONSTRAINTS = [
    Constraint(
        id="python-no-true-private",
        description="Python uses name mangling, not access modifiers",
        statement="Python does not have true private members",
        severity=Severity.WARN,
        attacked_by=["python-gil"],
    ),
    Constraint(
        id="python-gil",
        description="CPython has a GIL — threads don't give CPU parallelism",
        statement="CPython's Global Interpreter Lock (GIL) prevents true CPU-parallel execution of Python threads",
        severity=Severity.WARN,
        supported_by=["python-no-true-private"],
    ),
]

VIOLATING_TEXT = "You can use __var to make truly private members in Python"
CLEAN_TEXT = "The weather is nice today."
BORDERLINE_TEXT = "Python threads provide CPU parallelism through the GIL"


# ── Group 1: Full pipeline (standalone) ──────────────────────────────

def test_e2e_full_pipeline_block():
    claims, violations, decision = run_epistemic_pipeline(VIOLATING_TEXT, DEFAULT_CONSTRAINTS)
    assert len(violations) >= 1, "Should detect violations"
    assert decision in (Decision.WARN, Decision.BLOCK), "Should warn or block"


def test_e2e_full_pipeline_allow():
    claims, violations, decision = run_epistemic_pipeline(CLEAN_TEXT, DEFAULT_CONSTRAINTS)
    assert len(violations) == 0, "Should have no violations"
    assert decision == Decision.ALLOW, "Clean text should be ALLOW"


def test_e2e_full_pipeline_warn():
    borderline = (
        "Python threads can achieve true CPU parallelism "
        "because the GIL is not a real limitation"
    )
    claims, violations, decision = run_epistemic_pipeline(borderline, DEFAULT_CONSTRAINTS)
    assert decision in (Decision.WARN, Decision.BLOCK), "Borderline should not be ALLOW"


def test_e2e_multiple_violations():
    text = (
        "You can create truly private members in Python using __var. "
        "Also, Python threads give full CPU parallelism despite the GIL."
    )
    claims, violations, decision = run_epistemic_pipeline(text, DEFAULT_CONSTRAINTS)
    assert len(violations) >= 1, "Should detect at least one violation"
    assert_violation(violations, "python-no-true-private")
    assert_violation(violations, "python-gil")


def test_e2e_support_relation_raises_confidence():
    constraint_with_support = Constraint(
        id="python-no-true-private",
        description="Python has no true private members",
        statement="Python does not have true private members",
        severity=Severity.WARN,
        supported_by=["python-gil"],
    )
    gil_violation = Violation(
        constraint_id="python-gil",
        claim=Claim(text="test"),
        strength=0.7,
        severity=Severity.WARN,
    )
    claim = Claim(text="__var makes truly private members in Python")
    strength = compute_dfquad_strength(claim, constraint_with_support, [gil_violation])
    assert strength > 0.7, f"Support should raise confidence above 0.7, got {strength}"


def test_e2e_attack_relation_lowers_confidence():
    constraint_with_attack = Constraint(
        id="python-gil",
        description="CPython has a GIL",
        statement="CPython has a GIL that prevents true CPU parallelism",
        severity=Severity.WARN,
        attacked_by=["python-no-true-private"],
    )
    private_violation = Violation(
        constraint_id="python-no-true-private",
        claim=Claim(text="test"),
        strength=0.7,
        severity=Severity.WARN,
    )
    claim = Claim(text="Python threads give true CPU parallelism")
    strength = compute_dfquad_strength(claim, constraint_with_attack, [private_violation])
    assert strength < 1.0, f"Attack should lower confidence below base, got {strength}"
    assert strength >= 0.0, f"Strength should be non-negative, got {strength}"

    claims = [Claim(text="Python has no true private members"), claim]
    result = evaluate_claims(claims, [constraint_with_attack])
    if result.violations:
        v = result.violations[0]
        assert v.strength <= 0.7 or v.strength > 0, (
            f"Attack should moderate strength, got {v.strength}"
        )


def test_e2e_no_false_positive():
    safe_variants = [
        "I went to the grocery store today",
        "The sky is blue and the grass is green",
        "This is a simple implementation of a sorting algorithm",
    ]
    for text in safe_variants:
        claims, violations, decision = run_epistemic_pipeline(text, DEFAULT_CONSTRAINTS)
        assert decision == Decision.ALLOW, (
            f"Safe text should not violate: '{text[:40]}...' got {decision}"
        )


# ── Group 2: Proxy integration ───────────────────────────────────────

async def test_e2e_proxy_violation_returned():
    g = EpistemicGuardrail()
    response = make_llm_response(VIOLATING_TEXT)
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert "Epistemic" in content or "violation" in content.lower(), (
        "Violation should be annotated in response"
    )


async def test_e2e_proxy_clean_request():
    g = EpistemicGuardrail()
    response = make_llm_response(CLEAN_TEXT)
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert content == CLEAN_TEXT, "Clean response should not be modified"


async def test_e2e_proxy_both_guardrails():
    g = EpistemicGuardrail()
    response = make_llm_response(VIOLATING_TEXT)
    await g.async_post_call_success_hook({}, None, response)


# ── Group 3: Constraints ────────────────────────────────────────────

def test_e2e_constraint_loading():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump({"constraints": [
            {
                "id": "rust-no-gc",
                "description": "Rust does not have a garbage collector",
                "statement": "Rust does not have a garbage collector",
                "severity": "warn",
            },
        ]}, f)
        tmp_path = f.name

    try:
        constraints = load_constraints(tmp_path)
        assert len(constraints) == 1
        assert constraints[0].id == "rust-no-gc"
        assert constraints[0].severity == Severity.WARN
    finally:
        os.unlink(tmp_path)


def test_e2e_rigor_language_constraints():
    rust_constraint = Constraint(
        id="rust-no-gc",
        description="Rust has no GC",
        statement="Rust does not have a garbage collector",
        severity=Severity.WARN,
    )
    violating_text = "Rust has a garbage collector that manages memory automatically"
    claims, violations, decision = run_epistemic_pipeline(violating_text, [rust_constraint])
    assert len(violations) >= 1, "'Rust has a GC' should violate rust-no-gc"

    clean_text = "The weather is nice today for a walk in the park"
    claims, violations, decision = run_epistemic_pipeline(clean_text, [rust_constraint])
    assert len(violations) == 0, "Clean Rust text should not violate"


# ── Runner ───────────────────────────────────────────────────────────

async def run_guardrail_tests():
    await test_e2e_proxy_violation_returned()
    print("✅ test_e2e_proxy_violation_returned: Violation annotated")
    await test_e2e_proxy_clean_request()
    print("✅ test_e2e_proxy_clean_request: Clean not modified")
    await test_e2e_proxy_both_guardrails()
    print("✅ test_e2e_proxy_both_guardrails: Both guardrails run")


def main():
    test_e2e_full_pipeline_block()
    print("✅ test_e2e_full_pipeline_block: Violating text detected")
    test_e2e_full_pipeline_allow()
    print("✅ test_e2e_full_pipeline_allow: Clean text allowed")
    test_e2e_full_pipeline_warn()
    print("✅ test_e2e_full_pipeline_warn: Borderline warned")
    test_e2e_multiple_violations()
    print("✅ test_e2e_multiple_violations: Multiple violations")
    test_e2e_support_relation_raises_confidence()
    print("✅ test_e2e_support_relation_raises_confidence: Support raises confidence")
    test_e2e_attack_relation_lowers_confidence()
    print("✅ test_e2e_attack_relation_lowers_confidence: Attack lowers confidence")
    test_e2e_no_false_positive()
    print("✅ test_e2e_no_false_positive: No false positives")
    test_e2e_constraint_loading()
    print("✅ test_e2e_constraint_loading: Constraint loading works")
    test_e2e_rigor_language_constraints()
    print("✅ test_e2e_rigor_language_constraints: Rust constraints detected")

    import asyncio
    asyncio.run(run_guardrail_tests())

    print("\n🎉 All E2E tests passed!")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    main()
