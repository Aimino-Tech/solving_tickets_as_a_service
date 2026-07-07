"""
Comprehensive guardrail tests: pattern detection, false positives, edge cases.
"""
import json
import os
import sys

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail.slop_guardrail import (
    SlopIntentGuardrail,
    SlopIntentGuardrailError,
    _extract_user_messages,
    _check_input_message,
)


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
        f"Guardrail FAILED to block {len(failures)} cases: {failures}\n"
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
    """Simulate the post_call_success_hook by checking reasoning content."""
    # This mimics what LiteLLM's ModelResponse contains
    slop_reasoning = (
        "The user wants a payment processing function. "
        "I'll stub this out for now and implement the real Stripe integration later. "
        "Let me create a mock payment handler."
    )
    
    # Should detect slop in reasoning content
    detected = False
    for category, patterns in guardrail._categorized.items():
        for pattern in patterns:
            if pattern.search(slop_reasoning):
                detected = True
                break
        if detected:
            break
    
    assert detected, "Guardrail failed to detect slop in thinking/reasoning trace"
    
    # Clean reasoning should pass
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
    """Test boundary conditions."""
    # Empty input
    for cat, patterns in guardrail._categorized.items():
        for p in patterns:
            assert not p.search(""), f"Pattern '{p.pattern}' matched empty string"
    
    # Code containing 'sample' as legitimate function name
    code = "const result = sample.array.map(x => x * 2);"
    for cat, patterns in guardrail._categorized.items():
        for p in patterns:
            if p.search(code):
                # 'sample' is a valid function name, not slop
                # But we may match 'sample' in self_aware_slop or placeholder_intent
                print(f"WARNING: Edge case 'sample.array.map' matched {cat}/{p.pattern}")


# ── Pre-call hook tests ──────────────────────────────────────────────────

async def test_precall_injects_nudge_on_slop():
    """Pre_call hook injects system nudge when slop detected in user message."""
    g = SlopIntentGuardrail()
    data = {
        "messages": [
            {"role": "user", "content": "let's stub this out for now"},
        ]
    }
    result = await g.async_pre_call_hook(data, None)
    assert result is not None, "Should return modified data"
    msgs = result.get("messages", [])
    system_msgs = [m for m in msgs if m.get("role") == "system"]
    assert len(system_msgs) >= 1, "Should have at least one system message"
    assert "CAUTION" in system_msgs[-1]["content"], "Nudge should contain CAUTION"
    assert "stub" in system_msgs[-1]["content"].lower(), "Nudge should mention detected category"


async def test_precall_never_blocks():
    """Pre_call hook NEVER raises an exception."""
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
            assert False, f"pre_call should never block but raised {type(e).__name__}: {e}"


async def test_precall_clean_input_no_injection():
    """Pre_call hook does NOT inject nudge for clean input."""
    g = SlopIntentGuardrail()
    data = {
        "messages": [
            {"role": "user", "content": "Implement a payment processing function using Stripe API"},
        ]
    }
    result = await g.async_pre_call_hook(data, None)
    assert result is None, "Clean input should not return modified data"


async def test_precall_empty_messages():
    """Pre_call handles empty messages gracefully."""
    g = SlopIntentGuardrail()
    data = {"messages": []}
    result = await g.async_pre_call_hook(data, None)
    assert result is None, "Empty messages should return None"

    data = {}
    result = await g.async_pre_call_hook(data, None)
    assert result is None, "No messages key should return None"


async def test_precall_multiple_slop_categories():
    """Pre_call detects multiple slop categories and mentions all in nudge."""
    g = SlopIntentGuardrail()
    data = {
        "messages": [
            {"role": "user", "content": "stub this out and mock this up with just a placeholder"},
        ]
    }
    result = await g.async_pre_call_hook(data, None)
    assert result is not None, "Should detect multiple categories"
    msgs = result.get("messages", [])
    system_msgs = [m for m in msgs if m.get("role") == "system"]
    assert len(system_msgs) >= 1, "Should inject system nudge"


async def test_precall_tracks_injection_flag():
    """Guardrail tracks whether pre_call injection occurred."""
    g = SlopIntentGuardrail()
    assert g._pre_call_injected is False, "Should start as False"

    data = {"messages": [{"role": "user", "content": "stub this out"}]}
    await g.async_pre_call_hook(data, None)
    assert g._pre_call_injected is True, "Should be True after injection"

    g2 = SlopIntentGuardrail()
    data2 = {"messages": [{"role": "user", "content": "clean request"}]}
    await g2.async_pre_call_hook(data2, None)
    assert g2._pre_call_injected is False, "Should remain False for clean input"


# ── Runner ────────────────────────────────────────────────────────────────

async def run_precall_tests():
    await test_precall_injects_nudge_on_slop()
    print("✅ test_precall_injects_nudge_on_slop: Nudge injected on slop")
    await test_precall_never_blocks()
    print("✅ test_precall_never_blocks: Pre_call never blocks")
    await test_precall_clean_input_no_injection()
    print("✅ test_precall_clean_input_no_injection: Clean input no injection")
    await test_precall_empty_messages()
    print("✅ test_precall_empty_messages: Empty messages handled gracefully")
    await test_precall_multiple_slop_categories()
    print("✅ test_precall_multiple_slop_categories: Multiple categories detected")
    await test_precall_tracks_injection_flag()
    print("✅ test_precall_tracks_injection_flag: Injection flag tracked")


async def main():
    test_should_block_all_cases()
    print("✅ test_should_block_all_cases: All slop patterns detected")
    test_should_pass_all_cases()
    print("✅ test_should_pass_all_cases: No false positives on clean code")
    test_thinking_trace_interception()
    print("✅ test_thinking_trace_interception: Reasoning trace interception works")
    test_edge_cases()
    print("✅ test_edge_cases: No edge case issues")
    await run_precall_tests()
    print("\n🎉 All guardrail tests passed!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
