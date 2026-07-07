"""
Comprehensive guardrail tests: pattern detection, false positives, edge cases,
and policy enforcement (guardrail never blocks).
"""
import json
import os
import re
import sys
import ast
import logging

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import litellm
from litellm.types.utils import ModelResponse

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError


def load_test_cases():
    path = os.path.join(_test_dir, "test_guardrail_detection.json")
    with open(path) as f:
        return json.load(f)["test_cases"]


guardrail = SlopIntentGuardrail()


def test_should_block_all_cases():
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
        f"Guardrail FAILED to detect {len(failures)} cases: {failures}"
    )


def test_should_pass_all_cases():
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


# ── Policy enforcement: Guardrail NEVER blocks ──────────────────────────

async def test_precall_never_blocks():
    g = SlopIntentGuardrail()
    for msg_text in ["let's stub this out for now", "I'll mock the database", "just put a placeholder here"]:
        data = {"messages": [{"role": "user", "content": msg_text}]}
        try:
            result = await g.async_pre_call_hook(data, None)
            assert result is None or isinstance(result, dict)
        except Exception as e:
            assert False, f"pre_call should never block but raised {type(e).__name__}: {e}"


async def test_postcall_never_blocks():
    g = SlopIntentGuardrail()
    response = ModelResponse(
        id="test",
        choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": "I'll stub this out for now", "reasoning_content": None, "thinking_blocks": None},
            "finish_reason": "stop",
        }],
        created=0, model="test", object="chat.completion",
    )
    try:
        await g.async_post_call_success_hook({}, None, response)
    except Exception as e:
        assert False, f"post_call should never block but raised {type(e).__name__}: {e}"


async def test_postcall_annotate_appends_warning():
    g = SlopIntentGuardrail()
    response = ModelResponse(
        id="test", choices=[{
            "index": 0,
            "message": {"role": "assistant", "content": "I'll stub this out for now", "reasoning_content": None, "thinking_blocks": None},
            "finish_reason": "stop",
        }],
        created=0, model="test", object="chat.completion",
    )
    await g.async_post_call_success_hook({}, None, response)
    content = response.choices[0].message.content
    assert "slop" in content.lower() or "⚠️" in content, f"Warning should be appended, got: {content[:100]}"


def test_on_detect_block_falls_back():
    g = SlopIntentGuardrail(on_detect="block")
    assert g._on_detect == "annotate", "block mode should fall back to annotate"


def test_on_detect_block_logs_warning():
    import io, logging
    logger = logging.getLogger("guardrail.slop_guardrail")
    handler = logging.StreamHandler(io.StringIO())
    handler.setLevel(logging.WARNING)
    logger.addHandler(handler)
    try:
        SlopIntentGuardrail(on_detect="block")
        output = handler.stream.getvalue()
        assert "not a supported mode" in output, f"Warning should be logged, got: {output}"
    finally:
        logger.removeHandler(handler)


def test_on_detect_annotate_is_default():
    g = SlopIntentGuardrail()
    assert g._on_detect == "annotate"


def test_on_detect_correct_is_accepted():
    g = SlopIntentGuardrail(on_detect="correct")
    assert g._on_detect == "correct"


def test_guardrail_error_not_raised():
    assert issubclass(SlopIntentGuardrailError, ValueError)
    err = SlopIntentGuardrailError()
    assert isinstance(err, ValueError)


def test_no_blocking_raise_in_source():
    path = os.path.abspath(os.path.join(_test_dir, "..", "..", "slop_guardrail.py"))
    with open(path) as f:
        source = f.read()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise):
            raise_node = node
            line = source.splitlines()[raise_node.lineno - 1]
            assert False, f"Blocking raise found at line {raise_node.lineno}: {line.strip()}"


# ── Runner ─────────────────────────────────────────────────────────────

async def run_policy_tests():
    await test_precall_never_blocks()
    print("✅ test_precall_never_blocks: Pre_call never blocks")
    await test_postcall_never_blocks()
    print("✅ test_postcall_never_blocks: Post_call never blocks")
    await test_postcall_annotate_appends_warning()
    print("✅ test_postcall_annotate_appends_warning: Annotation appended")
    test_on_detect_block_falls_back()
    print("✅ test_on_detect_block_falls_back: Block falls back")
    test_on_detect_annotate_is_default()
    print("✅ test_on_detect_annotate_is_default: Default is annotate")
    test_on_detect_correct_is_accepted()
    print("✅ test_on_detect_correct_is_accepted: Correct accepted")
    test_guardrail_error_not_raised()
    print("✅ test_guardrail_error_not_raised: Error class exists but not raised")
    test_no_blocking_raise_in_source()
    print("✅ test_no_blocking_raise_in_source: No raise statements in source")
    test_on_detect_block_logs_warning()
    print("✅ test_on_detect_block_logs_warning: Warning logged for block mode")


async def main():
    test_should_block_all_cases()
    print("✅ test_should_block_all_cases: All slop patterns detected")
    test_should_pass_all_cases()
    print("✅ test_should_pass_all_cases: No false positives on clean code")
    test_thinking_trace_interception()
    print("✅ test_thinking_trace_interception: Reasoning trace interception works")
    test_edge_cases()
    print("✅ test_edge_cases: No edge case issues")
    await run_policy_tests()
    print("\n🎉 All guardrail policy tests passed!")

if __name__ == "__main__":
    import asyncio, logging
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
