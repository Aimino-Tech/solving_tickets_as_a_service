"""
Slop-intent guardrail system for LiteLLM proxy.

Detects AI-generated code slop in LLM responses and thinking traces:
stubs, placeholders, mocks, deferrals, self-aware demo patterns.

Submodules:
    - slop_guardrail: LiteLLM CustomGuardrail for slop detection
    - audit_log: Persistent SQLite-backed audit logging
    - memory_service: Persistent SQLite-backed memory storage
    - dashboard: Lightweight query interface for audit/memory data

Usage:
    from guardrail.slop_guardrail import SlopIntentGuardrail, cli
    from guardrail import audit_log, memory_service, dashboard

Components:
    - SlopIntentGuardrail: LiteLLM CustomGuardrail subclass
    - EpistemicGuardrail: Constraint-based factual accuracy checker
    - cli(): CLI entrypoint for offline text scanning
    - proxy_config.yaml: LiteLLM proxy configuration with guardrails
    - slop_patterns.json: Canonical pattern definitions

Subpackages:
    - epistemic/: DF-QuAD argumentation-based epistemic constraint evaluation
"""

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError, cli

__all__ = [
    "SlopIntentGuardrail",
    "SlopIntentGuardrailError",
    "cli",
]
