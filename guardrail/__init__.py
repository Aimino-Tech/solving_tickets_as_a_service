"""
Slop-intent guardrail system for LiteLLM proxy.

Detects AI-generated code slop in LLM responses and thinking traces:
stubs, placeholders, mocks, deferrals, self-aware demo patterns.

Usage:
    from guardrail.slop_guardrail import SlopIntentGuardrail, cli

Components:
    - SlopIntentGuardrail: LiteLLM CustomGuardrail subclass
    - cli(): CLI entrypoint for offline text scanning
    - proxy_config.yaml: LiteLLM proxy configuration with guardrails
    - slop_patterns.json: Canonical pattern definitions
"""

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError, cli

__all__ = [
    "SlopIntentGuardrail",
    "SlopIntentGuardrailError",
    "cli",
]
