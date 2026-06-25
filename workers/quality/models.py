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


class TestMapping(BaseModel):
    """Mapping between a production function and its expected test."""
    production_function: str
    production_file: str
    test_function: str = ""
    test_file: str = ""
    has_test: bool = False


class AntiLiarFinding(BaseModel):
    """A finding from one of the anti-liar enforcement layers."""
    file: str
    line: int = 0
    layer: str = ""  # which layer produced this finding
    message: str = ""
    severity: str = "warning"  # critical, blocking, warning
    snippet: str = ""


class AntiLiarResult(BaseModel):
    """Overall result from the anti-liar enforcement pipeline."""
    passed: bool = False
    layer1_passed: bool = False
    layer2_passed: bool = False
    layer3_passed: bool = False
    findings: list[AntiLiarFinding] = Field(default_factory=list)
    test_mappings: list[TestMapping] = Field(default_factory=list)
    coverage_threshold: int = 80
