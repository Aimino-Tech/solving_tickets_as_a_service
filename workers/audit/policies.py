"""Policy engine for the compliance audit trail.

Each policy rule inspects an ``AuditEvent`` and produces a
:class:`PolicyVerdict` indicating whether the event satisfies
the rule's constraints.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Callable

from workers.audit.models import AuditEvent, PolicyVerdict

logger = logging.getLogger(__name__)


class PolicyRule(ABC):
    """Base class for a single compliance policy rule."""

    def __init__(self, name: str, severity: str = "info") -> None:
        self.name = name
        self.severity = severity

    @abstractmethod
    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        """Evaluate *event* against this rule and return a verdict."""
        ...


# ---------------------------------------------------------------------------
# Built-in rules
# ---------------------------------------------------------------------------


class PayloadPresenceRule(PolicyRule):
    """Ensure the event payload is non-empty (where required)."""

    def __init__(
        self,
        name: str = "payload_presence",
        severity: str = "warning",
        *,
        require_for_types: frozenset[str] | None = None,
    ) -> None:
        super().__init__(name=name, severity=severity)
        self._require_for = require_for_types or frozenset()

    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        if self._require_for and event.event_type not in self._require_for:
            return PolicyVerdict(
                rule_name=self.name,
                passed=True,
                reason=f"Event type {event.event_type!r} not in required set",
                severity=self.severity,
            )
        if not event.payload:
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=f"Event {event.id} has empty payload for type={event.event_type}",
                severity=self.severity,
            )
        return PolicyVerdict(
            rule_name=self.name,
            passed=True,
            reason="Payload present",
            severity=self.severity,
        )


class HashIntegrityRule(PolicyRule):
    """Verify that the event's ``payload_hash`` matches the canonical
    re-computation of its payload."""

    def __init__(
        self,
        name: str = "hash_integrity",
        severity: str = "critical",
    ) -> None:
        super().__init__(name=name, severity=severity)

    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        from workers.audit.trail import compute_payload_hash

        expected = compute_payload_hash(event.payload)
        if event.payload_hash != expected:
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=(
                    f"Payload hash mismatch — event={event.id} "
                    f"stored={event.payload_hash} expected={expected}"
                ),
                severity=self.severity,
            )
        return PolicyVerdict(
            rule_name=self.name,
            passed=True,
            reason="Payload hash matches",
            severity=self.severity,
        )


class PrevHashChainRule(PolicyRule):
    """Verify that the event's ``prev_hash`` matches the chain hash
    of the immediately preceding event in the same tenant scope.

    Requires access to the audit store to look up the predecessor.
    """

    def __init__(
        self,
        name: str = "prev_hash_chain",
        severity: str = "critical",
    ) -> None:
        super().__init__(name=name, severity=severity)

    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        # The chain-hash check is performed on the *store* side during
        # verify_chain_integrity.  This rule validates the local field.
        # For a genesis event prev_hash should be empty; for others
        # it should be non-empty and hex (64 chars).
        if event.prev_hash == "" and event.event_type != "audit.genesis":
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=(
                    f"Event {event.id} (type={event.event_type}) has empty "
                    f"prev_hash but is not a genesis event"
                ),
                severity=self.severity,
            )
        if event.prev_hash and len(event.prev_hash) != 64:
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=(
                    f"Event {event.id} has invalid prev_hash length: "
                    f"got {len(event.prev_hash)}, expected 64"
                ),
                severity=self.severity,
            )
        return PolicyVerdict(
            rule_name=self.name,
            passed=True,
            reason="prev_hash is valid",
            severity=self.severity,
        )


class EventTypeAllowlistRule(PolicyRule):
    """Ensure the event type belongs to a known allowlist."""

    def __init__(
        self,
        name: str = "event_type_allowlist",
        severity: str = "warning",
        *,
        allowed_types: frozenset[str] | None = None,
    ) -> None:
        super().__init__(name=name, severity=severity)
        self._allowed = allowed_types or frozenset({
            "audit.genesis",
            "pipeline.start",
            "pipeline.complete",
            "pipeline.fail",
            "pipeline.retry",
            "task.start",
            "task.success",
            "task.failure",
            "task.retry",
            "verification.start",
            "verification.pass",
            "verification.fail",
            "sandbox.create",
            "sandbox.destroy",
            "pr.create",
            "pr.merge",
            "policy.violation",
            "drift.detected",
            "export.run",
        })

    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        if event.event_type not in self._allowed:
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=(
                    f"Unknown event type {event.event_type!r} "
                    f"— not in allowlist"
                ),
                severity=self.severity,
            )
        return PolicyVerdict(
            rule_name=self.name,
            passed=True,
            reason=f"Event type {event.event_type!r} is allowed",
            severity=self.severity,
        )


class MaxPayloadSizeRule(PolicyRule):
    """Reject events whose serialised payload exceeds a threshold."""

    def __init__(
        self,
        name: str = "max_payload_size",
        severity: str = "warning",
        *,
        max_bytes: int = 65_536,
    ) -> None:
        super().__init__(name=name, severity=severity)
        self._max_bytes = max_bytes

    def evaluate(self, event: AuditEvent) -> PolicyVerdict:
        import json

        raw = json.dumps(event.payload, sort_keys=True, separators=(",", ":"))
        size = len(raw.encode("utf-8"))
        if size > self._max_bytes:
            return PolicyVerdict(
                rule_name=self.name,
                passed=False,
                reason=(
                    f"Payload size {size}B exceeds limit {self._max_bytes}B"
                ),
                severity=self.severity,
            )
        return PolicyVerdict(
            rule_name=self.name,
            passed=True,
            reason=f"Payload size {size}B within limit",
            severity=self.severity,
        )


# ---------------------------------------------------------------------------
# Rule factory  (maps string names to rule classes)
# ---------------------------------------------------------------------------

_BUILTIN_RULES: dict[str, type[PolicyRule]] = {
    "payload_presence": PayloadPresenceRule,
    "hash_integrity": HashIntegrityRule,
    "prev_hash_chain": PrevHashChainRule,
    "event_type_allowlist": EventTypeAllowlistRule,
    "max_payload_size": MaxPayloadSizeRule,
}


# ---------------------------------------------------------------------------
# Policy Engine
# ---------------------------------------------------------------------------


class PolicyEngine:
    """Evaluates a set of policy rules against audit events.

    Usage::

        engine = PolicyEngine.with_defaults()
        verdicts = engine.evaluate(event)
    """

    def __init__(self, rules: list[PolicyRule] | None = None) -> None:
        self._rules: list[PolicyRule] = rules or []

    @classmethod
    def with_defaults(cls) -> PolicyEngine:
        """Create an engine with all built-in rules at default severity."""
        return cls([
            PayloadPresenceRule(),
            HashIntegrityRule(),
            PrevHashChainRule(),
            EventTypeAllowlistRule(),
            MaxPayloadSizeRule(),
        ])

    def add_rule(self, rule: PolicyRule) -> None:
        """Register an additional rule."""
        self._rules.append(rule)

    def add_custom_rule(
        self,
        name: str,
        evaluate_fn: Callable[[AuditEvent], PolicyVerdict],
        severity: str = "info",
    ) -> None:
        """Register a rule from a callable.

        Example::

            def my_rule(event: AuditEvent) -> PolicyVerdict:
                ...

            engine.add_custom_rule("my_rule", my_rule)
        """

        class _CustomRule(PolicyRule):
            def evaluate(self, event: AuditEvent) -> PolicyVerdict:
                return evaluate_fn(event)

        self._rules.append(_CustomRule(name=name, severity=severity))

    def evaluate(self, event: AuditEvent) -> list[PolicyVerdict]:
        """Run all registered rules against *event*.

        Returns a list of :class:`PolicyVerdict` — one per rule.
        """
        verdicts: list[PolicyVerdict] = []
        for rule in self._rules:
            try:
                verdict = rule.evaluate(event)
            except Exception as exc:
                logger.exception("Policy rule %s raised an exception", rule.name)
                verdict = PolicyVerdict(
                    rule_name=rule.name,
                    passed=False,
                    reason=f"Rule raised exception: {exc}",
                    severity="critical",
                )
            verdicts.append(verdict)
        return verdicts

    def evaluate_all(self, events: list[AuditEvent]) -> list[list[PolicyVerdict]]:
        """Run all rules against every event in *events*."""
        return [self.evaluate(ev) for ev in events]

    @property
    def rules(self) -> list[PolicyRule]:
        return list(self._rules)
