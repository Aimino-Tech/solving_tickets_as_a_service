from workers.quality.models import (
    AntiMockupFinding,
    AntiMockupResult,
    AntiLiarFinding,
    AntiLiarResult,
    QualityScore,
    SelfAuditChecklistItem,
    SelfAuditResult,
    TestMapping,
)
from workers.quality.analyzer import quality_analyze, get_e2e_spec_template
from workers.quality.anti_mockup_scan import anti_mockup_scan
from workers.quality.prompt_template import inject_anti_stub_prompt

__all__ = [
    "QualityScore",
    "AntiMockupFinding",
    "AntiMockupResult",
    "AntiLiarFinding",
    "AntiLiarResult",
    "SelfAuditChecklistItem",
    "SelfAuditResult",
    "TestMapping",
    "quality_analyze",
    "get_e2e_spec_template",
    "anti_mockup_scan",
    "inject_anti_stub_prompt",
]


from workers.quality import analyzer as _analyzer  # noqa: F401 — Celery autodiscovery
from workers.quality import anti_mockup_scan as _mockup_scan  # noqa: F401 — Celery autodiscovery
from workers.tasks import anti_liar as _anti_liar  # noqa: F401 — Celery autodiscovery
