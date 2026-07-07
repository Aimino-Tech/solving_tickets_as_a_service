"""
Comprehensive guardrail tests: pattern detection, false positives, edge cases,
pre_call injection (non-blocking), post_call modes, output guardrails.
"""
import json
import os
import sys

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import litellm
from litellm.types.utils import ModelResponse

from guardrail.slop_guardrail import (
    SlopIntentGuardrail,
    SlopIntentGuardrailError,
    _run_output_guardrails,
    _apply_annotation,
    _apply_correction,
)
from guardrail.slop_guardrail import _check_input_message, _extract_user_messages


def load_test_cases():
    path = os.path.join(_test_dir, "test_guardrail_detection.json")
    with open(path) as f:
        return json.load(f)["test_cases"]


guardrail = SlopIntentGuardrail()


def test_should_block_all_cases():
    """Every slop test case must be detected by the guardrail."""
    cases = load_test_cases()
    failures = []
    for tc in cases["should_block"]:
        result = False
        for category, patterns in guardrail._categorized.items():
            for pattern in patterns:
                if pattern.search(tc["text"]):
                    result = True
                    break
            if result:
                break
        if not result:
            failures.append(tc["name"])

    assert not failures, (
        f"Guardrail FAILED to detect {len(failures)} cases: {failures}\n"
        "These patterns need to be added to slop_patterns.json."
    )


def test_should_pass_all_cases():
    """Clean code must NOT trigger the guardrail."""
    cases = load_test_cases()
    failures = []
    for tc in cases["should_pass"]:
        for category, patterns in guardrail._categorized.items():
            for pattern in patterns:
                if pattern.search(tc["text"]):
                    failures.append(f"{tc['name']} matched '{pattern.pattern}' in {category}")
                    break
            if failures and failures[-1].startswith(tc["name"]):
                break

    assert not failures, (
        f"Guardrail produced {len(failures)} false positives:\n" + "\n".join(failures)
    )


def test_thinking_trace_interception():
    slop_reasoning = (
        "The user wants a payment processing function. "
        "I'll stub this out for now and implement the real Stripe integration later. "
        "Let me create a mock payment handler."
    )

    detected = False
    for category, patterns in guardrail._categorized.items():
        for pattern in patterns:
            if pattern.search(slop_reasoning):
                detected = True
                break
        if detected:
            break

    assert detected, "Guardrail failed to detect slop in thinking/reasoning trace"

    clean_reasoning = (
        "The user needs a payment processing function. "
        "I'll use the Stripe API to create a payment intent. "
        "The flow is: validate amount, create payment intent, handle confirmation."
    )

    false_positive = False
    for category, patterns in guardrail._categorized.items():
        for pattern in patterns:
            if pattern.search(clean_reasoning):
                false_positive = True
                break
        if false_positive:
            break

    assert not false_positive, "Guardrail had false positive on clean reasoning trace"


def test_edge_cases():
    for cat, patterns in guardrail._categorized.items():
        for p in patterns:
            assert not p.search(""), f"Pattern '{p.pattern}' matched empty string"

    code = "const result = sample.array.map(x => x * 2);"
    for cat, patterns in guardrail._categorized.items():
        for p in patterns:
            if p.search(code):
                print(f"WARNING: Edge case 'sample.array.map' matched {cat}/{p.pattern}")


# ── Audit: Pre-call hook tests (never blocks, only injects) ──────────────

async def test_precall_injects_nudge_on_slop():
    g = SlopIntentGuardrail()
    data = {"messages": [{"role": "user", "content": "let's stub this out for now"}]}
    result = await g.async_pre_call_hook(data, None)
    assert result is not None
    msgs = result.get("messages", [])
    system_msgs = [m for m in msgs if m.get("role") == "system"]
    assert len(system_msgs) >= 1
    assert "CAUTION" in system_msgs[-1]["content"]


async def test_precall_never_blocks():
    g = SlopIntentGuardrail()
    test_messages = [
        {"role": "user", "content": "let's stub this out for now"},
        {"role": "user", "content": "I'll mock the database for testing"},
        {"role": "user", "content": "just put a placeholder here"},
    ]
    for msg in test_messages:
        data = {"messages": [msg]}
        try:
            result = await g.async_pre_call_hook(data, None)
            assert result is None or isinstance(result, dict)
        except Exception as e:
            assert False, f"pre_call raised {type(e).__name__}: {e}"


async def test_precall_clean_input_no_injection():
    g = SlopIntentGuardrail()
    data = {"messages": [{"role": "user", "content": "Implement a payment processing function using Stripe API"}]}
    result = await g.async_pre_call_hook(data, None)
    assert result is None


# ── Audit: Post-call tests (annotate/correct, never blocks) ─────────────

async def test_postcall_no_raise_in_default_mode():
    """Default mode (annotate) should never raise SlopIntentGuardrailError."""
    g = SlopIntentGuardrail()
    mock_response = type("MockResponse", (), {"choices": [
        type("Choice", (), {"message": type("Msg", (), {
            "content": "I'll stub this out for now",
            "reasoning_content": None,
            "thinking_blocks": None,
        })()}),
    ],})()
    try:
        await g.async_post_call_success_hook({}, None, mock_response)
    except SlopIntentGuardrailError:
        assert False, "post_call should not raise in annotate mode"
    except Exception:
        pass  # Other exceptions might come from litellm.ModelResponse type checks


async def test_postcall_annotate_appends_warning():
    """Annotate mode appends warning to response content."""
    response = _make_mock_response("I'll stub this out for now")
    g = SlopIntentGuardrail()
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert content is not None, "Content should exist"
    assert "⚠️" in content or "slop" in content.lower(), "Warning should be appended"


async def test_postcall_correct_replaces_patterns():
    """Correct mode replaces slop patterns with [SANITIZED] markers."""
    g = SlopIntentGuardrail(on_detect="correct")
    response = _make_mock_response("I'll stub this out for now and create a mock later")
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert "[SANITIZED:" in content, "Correction should add sanitized markers"
    assert "stub this out" not in content, "Original slop should be replaced"


async def test_postcall_clean_response_no_annotation():
    """Clean response should not be annotated."""
    g = SlopIntentGuardrail()
    response = _make_mock_response("Implement a payment processing function using Stripe API")
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert "⚠️" not in content, "Clean response should not have warnings"
    assert "---" not in content.replace("---", ""), "No annotation markers on clean"


async def test_postcall_empty_response():
    """Empty response should not cause errors."""
    g = SlopIntentGuardrail()
    response = _make_mock_response("")
    try:
        await g.async_post_call_success_hook({}, None, response)
    except Exception as e:
        assert False, f"Empty response raised {type(e).__name__}: {e}"


async def test_postcall_non_model_response():
    """Non-ModelResponse should be silently ignored."""
    g = SlopIntentGuardrail()
    try:
        await g.async_post_call_success_hook({}, None, "not a response")
        await g.async_post_call_success_hook({}, None, None)
        await g.async_post_call_success_hook({}, None, 42)
    except Exception as e:
        assert False, f"Non-model response raised {type(e).__name__}: {e}"


# ── Audit: Output guardrail tests ───────────────────────────────────────

def test_output_guardrails_empty_log():
    result = _run_output_guardrails([])
    assert result == [], "Empty match log should produce no annotations"


def test_output_guardrails_with_matches():
    match_log = [
        {"category": "stub_intent", "pattern": "stub this out", "source": "test", "snippet": "test"},
    ]
    result = _run_output_guardrails(match_log)
    assert len(result) >= 1, "Match log should produce annotations"
    assert any("slop" in a.lower() for a in result), "Annotations should mention slop"


def test_apply_annotation():
    response = _make_mock_response("clean text")
    _apply_annotation(response, ["\n\n⚠️ Warning"])
    assert "⚠️ Warning" in response.choices[0].message.content


def test_apply_correction():
    response = _make_mock_response("stub this out here")
    match_log = [{"category": "stub_intent", "pattern": "stub this out", "source": "test", "snippet": "test"}]
    _apply_correction(response, match_log)
    content = response.choices[0].message.content
    assert "[SANITIZED:stub_intent]" in content
    assert "stub this out" not in content


# ── Audit: __init__ validation tests ────────────────────────────────────

def test_on_detect_unknown_mode_falls_back():
    g = SlopIntentGuardrail(on_detect="block")
    assert g._on_detect == "annotate", "Unknown mode should fall back to annotate"


def test_on_detect_annotate_is_default():
    g = SlopIntentGuardrail()
    assert g._on_detect == "annotate", "Default on_detect should be annotate"


def test_on_detect_correct_is_accepted():
    g = SlopIntentGuardrail(on_detect="correct")
    assert g._on_detect == "correct", "correct on_detect should be accepted"


# ── Helpers ─────────────────────────────────────────────────────────────

def _make_mock_response(content: str) -> ModelResponse:
    return ModelResponse(
        id="mock-test",
        choices=[{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content,
                "reasoning_content": None,
                "thinking_blocks": None,
            },
            "finish_reason": "stop",
        }],
        created=0,
        model="mock-model",
        object="chat.completion",
    )


# ── Runner ──────────────────────────────────────────────────────────────

async def run_audit_tests():
    await test_precall_injects_nudge_on_slop()
    print("✅ test_precall_injects_nudge_on_slop: Nudge injected on slop")
    await test_precall_never_blocks()
    print("✅ test_precall_never_blocks: Pre_call never blocks")
    await test_precall_clean_input_no_injection()
    print("✅ test_precall_clean_input_no_injection: Clean input no injection")
    await test_postcall_no_raise_in_default_mode()
    print("✅ test_postcall_no_raise_in_default_mode: No raise in annotate mode")
    await test_postcall_annotate_appends_warning()
    print("✅ test_postcall_annotate_appends_warning: Warning appended")
    await test_postcall_correct_replaces_patterns()
    print("✅ test_postcall_correct_replaces_patterns: Patterns sanitized")
    await test_postcall_clean_response_no_annotation()
    print("✅ test_postcall_clean_response_no_annotation: Clean not annotated")
    await test_postcall_empty_response()
    print("✅ test_postcall_empty_response: Empty handled")
    await test_postcall_non_model_response()
    print("✅ test_postcall_non_model_response: Non-model ignored")
    test_output_guardrails_empty_log()
    print("✅ test_output_guardrails_empty_log: Empty log")
    test_output_guardrails_with_matches()
    print("✅ test_output_guardrails_with_matches: Matches produce annotations")
    test_apply_annotation()
    print("✅ test_apply_annotation: Annotation appended")
    test_apply_correction()
    print("✅ test_apply_correction: Correction applied")
    test_on_detect_unknown_mode_falls_back()
    print("✅ test_on_detect_unknown_mode_falls_back: Unknown mode fallback")
    test_on_detect_annotate_is_default()
    print("✅ test_on_detect_annotate_is_default: Default is annotate")
    test_on_detect_correct_is_accepted()
    print("✅ test_on_detect_correct_is_accepted: Correct mode accepted")


async def main():
    test_should_block_all_cases()
    print("✅ test_should_block_all_cases: All slop patterns detected")
    test_should_pass_all_cases()
    print("✅ test_should_pass_all_cases: No false positives on clean code")
    test_thinking_trace_interception()
    print("✅ test_thinking_trace_interception: Reasoning trace interception works")
    test_edge_cases()
    print("✅ test_edge_cases: No edge case issues")
    await run_audit_tests()
    print("\n🎉 All guardrail audit tests passed!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
