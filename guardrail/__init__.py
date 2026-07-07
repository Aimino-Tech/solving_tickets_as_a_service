"""
Slop-intent guardrail system for LiteLLM proxy.

Detects AI-generated code slop in LLM responses and thinking traces:
stubs, placeholders, mocks, deferrals, self-aware demo patterns.

The guardrail NEVER blocks requests. It only:
- Injects system message nudges (pre_call)
- Annotates responses with warnings (post_call, annotate mode)
- Replaces slop content with corrective text (post_call, correct mode)

Usage:
    from guardrail.slop_guardrail import SlopIntentGuardrail, cli
"""

from guardrail.slop_guardrail import (
    SlopIntentGuardrail,
    SlopIntentGuardrailError,
    cli,
    _run_output_guardrails,
    _apply_annotation,
    _apply_correction,
)

__all__ = [
    "SlopIntentGuardrail",
    "SlopIntentGuardrailError",
    "cli",
]
