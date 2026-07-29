"""
Slop-intent guardrail system for LiteLLM proxy.

Detects AI-generated code slop in LLM responses and thinking traces:
stubs, placeholders, mocks, deferrals, self-aware demo patterns.

Submodules:
    - slop_guardrail: LiteLLM CustomGuardrail for slop detection
    - audit_log: Persistent SQLite/PostgreSQL-backed audit logging
    - memory_service: Persistent SQLite-backed memory storage
    - dashboard: Lightweight query interface for audit/memory data

Usage:
    from guardrail.slop_guardrail import SlopIntentGuardrail, cli
    from guardrail import audit_log, memory_service, dashboard
"""

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError, cli, CAUTION_PREFIX
from guardrail.log_setup import configure_guardrail_logging

configure_guardrail_logging()

__all__ = [
    "SlopIntentGuardrail",
    "SlopIntentGuardrailError",
    "cli",
    "CAUTION_PREFIX",
]
