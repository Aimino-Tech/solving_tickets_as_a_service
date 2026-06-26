import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
# Load guardrail module
from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError
import re, json, asyncio

class TestHarness:
    """Test harness for SlopIntentGuardrail without needing LiteLLM runtime."""

    def __init__(self):
        self.guardrail = SlopIntentGuardrail()

    def check_text(self, text: str) -> dict | None:
        """Simulate the guardrail's thinking-trace check."""
        guardrail = self.guardrail
        for category, patterns in guardrail._categorized.items():
            for pattern in patterns:
                match = pattern.search(text)
                if match:
                    return {
                        "category": category,
                        "pattern": match.group(0),
                        "matched": text[max(0, match.start()-40):match.end()+40]
                    }
        return None
