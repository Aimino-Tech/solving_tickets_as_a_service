from typing import Any

from pydantic import BaseModel, Field


class QualityScore(BaseModel):
    score: float = Field(ge=0.0, le=1.0, description="Overall quality score 0-1")
    clarity_score: float = Field(ge=0.0, le=1.0)
    completeness_score: float = Field(ge=0.0, le=1.0)
    ac_quality_score: float = Field(ge=0.0, le=1.0)
    auto_healed: bool = False
    needs_review: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class AntiMockupFinding(BaseModel):
    file: str
    line: int
    pattern: str
    severity: str = "warning"  # critical, blocking, warning
    snippet: str = ""


class AntiMockupResult(BaseModel):
    passed: bool
    findings: list[AntiMockupFinding] = Field(default_factory=list)


class SelfAuditChecklistItem(BaseModel):
    ac: str
    met: bool = False
    evidence: str = ""


class SelfAuditResult(BaseModel):
    checklist: list[SelfAuditChecklistItem] = Field(default_factory=list)
    missing_items: list[str] = Field(default_factory=list)
    anti_mockup_findings: list[AntiMockupFinding] = Field(default_factory=list)
    passed: bool = False
