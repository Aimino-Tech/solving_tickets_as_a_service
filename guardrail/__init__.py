"""
Slop-intent guardrail system for LiteLLM proxy.

POLICY: This guardrail NEVER blocks. It only:
- Injects system message nudges (pre_call)
- Annotates responses with warnings (post_call, annotate mode)
- Replaces slop content with corrective text (post_call, correct mode)
"""

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError, cli

__all__ = [
    "SlopIntentGuardrail",
    "SlopIntentGuardrailError",
    "cli",
]
