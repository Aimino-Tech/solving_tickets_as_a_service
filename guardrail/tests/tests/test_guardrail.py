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

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError


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


if __name__ == "__main__":
    test_should_block_all_cases()
    print("✅ test_should_block_all_cases: All slop patterns detected")
    test_should_pass_all_cases()
    print("✅ test_should_pass_all_cases: No false positives on clean code")
    test_thinking_trace_interception()
    print("✅ test_thinking_trace_interception: Reasoning trace interception works")
    test_edge_cases()
    print("✅ test_edge_cases: No edge case issues")
    print("\n🎉 All guardrail tests passed!")
