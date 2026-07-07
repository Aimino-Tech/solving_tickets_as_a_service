"""
Epistemic types for the governance guardrail system.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional


class Severity(enum.Enum):
    BLOCK = "block"
    WARN = "warn"
    ALLOW = "allow"


class Decision(enum.Enum):
    BLOCK = "block"
    WARN = "warn"
    ALLOW = "allow"


@dataclass
class Claim:
    text: str
    confidence: float = 1.0


@dataclass
class Constraint:
    id: str
    description: str
    statement: str  # The epistemically correct statement
    severity: Severity = Severity.WARN
    supported_by: list[str] = field(default_factory=list)
    attacked_by: list[str] = field(default_factory=list)


@dataclass
class Violation:
    constraint_id: str
    claim: Claim
    strength: float = 1.0
    severity: Severity = Severity.WARN
    explanation: str = ""


@dataclass
class EpistemicResult:
    claims: list[Claim] = field(default_factory=list)
    violations: list[Violation] = field(default_factory=list)
    decision: Decision = Decision.ALLOW
    confidence: float = 1.0
