"""
Tests for EpistemicGuardrail and supporting modules.
"""
import json
import os
import sys

import pytest

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import litellm
from litellm.types.utils import ModelResponse

from guardrail.epistemic.types import Claim, Constraint, Decision, EpistemicResult, Severity, Violation
from guardrail.epistemic.claim_extractor import extract_claims
from guardrail.epistemic.argumentation import evaluate_constraint, compute_dfquad_strength
from guardrail.epistemic.policy_engine import evaluate_claims
from guardrail.epistemic.loader import get_constraints, load_constraints
from guardrail.epistemic.guardrail import EpistemicGuardrail


# ── Claim extractor tests ─────────────────────────────────────────────

def test_extract_empty():
    assert extract_claims("") == []
    assert extract_claims(None) == []
    assert extract_claims("   ") == []


def test_extract_single_sentence():
    claims = extract_claims("Python uses name mangling for pseudo-private members.")
    assert len(claims) == 1
    assert "name mangling" in claims[0].text


def test_extract_multiple_sentences():
    text = "Python has a GIL. It prevents true CPU parallelism. Threads are for I/O."
    claims = extract_claims(text)
    assert len(claims) >= 2
    assert all(isinstance(c, Claim) for c in claims)


def test_extract_short_sentences_skipped():
    text = "Hi. Python has a GIL. Ok."
    claims = extract_claims(text)
    assert len(claims) == 1
    assert "GIL" in claims[0].text


# ── Argumentation tests ───────────────────────────────────────────────

def test_evaluate_constraint_no_violation():
    constraint = Constraint(
        id="python-gil",
        description="CPython has a GIL",
        statement="CPython has a GIL that prevents true CPU parallelism",
        severity=Severity.WARN,
    )
    claim = Claim(text="CPython has a GIL that prevents true CPU parallelism")
    result = evaluate_constraint(claim, constraint)
    assert result is None


def test_evaluate_constraint_violation():
    constraint = Constraint(
        id="python-no-true-private",
        description="Python uses name mangling",
        statement="Python does not have true private members",
        severity=Severity.WARN,
    )
    claim = Claim(text="You can use __var to make truly private members in Python")
    result = evaluate_constraint(claim, constraint)
    assert result is not None
    assert result.constraint_id == "python-no-true-private"


def test_evaluate_constraint_irrelevant_text():
    constraint = Constraint(
        id="no-silver-bullet",
        description="No silver bullet",
        statement="No single programming language is optimal for every problem",
        severity=Severity.WARN,
    )
    claim = Claim(text="The weather is nice today")
    result = evaluate_constraint(claim, constraint)
    assert result is None


def test_dfquad_support_raises_confidence():
    constraint = Constraint(
        id="python-no-true-private",
        description="Test",
        statement="Python has no true private members",
        severity=Severity.WARN,
        supported_by=["python-gil"],
    )
    claim = Claim(text="__var makes truly private members")
    violation = Violation(
        constraint_id="python-gil",
        claim=Claim(text="test"),
        strength=0.8,
        severity=Severity.WARN,
    )
    strength = compute_dfquad_strength(claim, constraint, [violation])
    assert strength > 0.8, f"Support should raise confidence, got {strength}"


# ── Policy engine tests ──────────────────────────────────────────────

def test_policy_clean_pass():
    constraints = [
        Constraint(id="test", description="Test", statement="Python has a GIL", severity=Severity.WARN),
    ]
    claims = [Claim(text="The sky is blue")]
    result = evaluate_claims(claims, constraints)
    assert result.decision == Decision.ALLOW
    assert len(result.violations) == 0


def test_policy_violation_detected():
    constraints = [
        Constraint(id="python-gil", description="Test", statement="CPython has a GIL that prevents true CPU parallelism", severity=Severity.WARN),
    ]
    claims = [Claim(text="CPython threads give true CPU parallelism")]
    result = evaluate_claims(claims, constraints)
    assert len(result.violations) >= 1


def test_policy_multiple_violations():
    constraints = [
        Constraint(id="c1", description="Test1", statement="Python has no true private members", severity=Severity.WARN),
        Constraint(id="c2", description="Test2", statement="CPython has a GIL", severity=Severity.WARN),
    ]
    claims = [
        Claim(text="Python has true private members"),
        Claim(text="CPython threads give true CPU parallelism"),
    ]
    result = evaluate_claims(claims, constraints)
    assert len(result.violations) >= 1


# ── Guardrail tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_guardrail_no_config():
    g = EpistemicGuardrail()
    response = ModelResponse(
        id="test", choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": "Python has a GIL for CPU parallelism", "reasoning_content": None, "thinking_blocks": None},
            "finish_reason": "stop",
        }],
        created=0, model="test", object="chat.completion",
    )
    try:
        await g.async_post_call_success_hook({}, None, response)
    except Exception as e:
        assert False, f"Guardrail raised {type(e).__name__}: {e}"


@pytest.mark.asyncio
async def test_guardrail_allows_clean_response():
    g = EpistemicGuardrail()
    response = ModelResponse(
        id="test", choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": "The weather is nice today", "reasoning_content": None, "thinking_blocks": None},
            "finish_reason": "stop",
        }],
        created=0, model="test", object="chat.completion",
    )
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert "Epistemic" not in content, "Clean response should not be annotated"


@pytest.mark.asyncio
async def test_guardrail_precall_noop():
    g = EpistemicGuardrail()
    result = await g.async_pre_call_hook({"messages": []}, None)
    assert result is None


@pytest.mark.asyncio
async def test_guardrail_empty_response():
    g = EpistemicGuardrail()
    response = ModelResponse(
        id="test", choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": "", "reasoning_content": None, "thinking_blocks": None},
            "finish_reason": "stop",
        }],
        created=0, model="test", object="chat.completion",
    )
    try:
        await g.async_post_call_success_hook({}, None, response)
    except Exception as e:
        assert False, f"Empty response raised {type(e).__name__}: {e}"


# ── Runner ──────────────────────────────────────────────────────────

async def run_guardrail_tests():
    await test_guardrail_no_config()
    print("✅ test_guardrail_no_config: No config passes through")
    await test_guardrail_allows_clean_response()
    print("✅ test_guardrail_allows_clean_response: Clean not annotated")
    await test_guardrail_precall_noop()
    print("✅ test_guardrail_precall_noop: Pre_call is no-op")
    await test_guardrail_empty_response()
    print("✅ test_guardrail_empty_response: Empty handled")


def main():
    test_extract_empty()
    print("✅ test_extract_empty: Empty input handled")
    test_extract_single_sentence()
    print("✅ test_extract_single_sentence: Single sentence extracted")
    test_extract_multiple_sentences()
    print("✅ test_extract_multiple_sentences: Multiple sentences extracted")
    test_extract_short_sentences_skipped()
    print("✅ test_extract_short_sentences_skipped: Short skipped")
    test_evaluate_constraint_no_violation()
    print("✅ test_evaluate_constraint_no_violation: No false positive")
    test_evaluate_constraint_violation()
    print("✅ test_evaluate_constraint_violation: Violation detected")
    test_evaluate_constraint_irrelevant_text()
    print("✅ test_evaluate_constraint_irrelevant_text: Irrelevant passes")
    test_dfquad_support_raises_confidence()
    print("✅ test_dfquad_support_raises_confidence: Support raises confidence")
    test_policy_clean_pass()
    print("✅ test_policy_clean_pass: Clean pass")
    test_policy_violation_detected()
    print("✅ test_policy_violation_detected: Violation detected")
    test_policy_multiple_violations()
    print("✅ test_policy_multiple_violations: Multiple violations")

    import asyncio
    asyncio.run(run_guardrail_tests())

    print("\n🎉 All epistemic guardrail tests passed!")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    main()
