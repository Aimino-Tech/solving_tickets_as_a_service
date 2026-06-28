"""
promptfoo Python provider for LLM Governance Guardrail testing.
Tests SlopIntentGuardrail pattern detection without network calls.
"""
import json
import os
import sys
from typing import Any

# Ensure guardrail module is importable from promptfoo subprocess
_provider_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_provider_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail.slop_guardrail import SlopIntentGuardrail

guardrail = SlopIntentGuardrail()


def call_api(prompt: str, options: dict[str, Any], context: dict[str, Any]) -> dict:
    """Check if prompt text would be blocked by the guardrail."""
    results: dict[str, Any] = {"blocked": False, "matches": []}
    for category, patterns in guardrail._categorized.items():
        for pattern in patterns:
            match = pattern.search(prompt)
            if match:
                results["matches"].append({
                    "category": category,
                    "pattern": match.group(0),
                })
                results["blocked"] = True
                break
        if results["blocked"]:
            break
    return {"output": json.dumps(results)}
