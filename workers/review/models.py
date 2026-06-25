from enum import Enum
from pydantic import BaseModel


class ReviewVerdict(str, Enum):
    approve = "approve"
    changes_requested = "changes_requested"


class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class FindingCategory(str, Enum):
    bug = "bug"
    security = "security"
    performance = "performance"
    test = "test"
    style = "style"


class Finding(BaseModel):
    category: FindingCategory
    severity: Severity
    file: str = ""
    line: int = 0
    description: str


class ReviewResult(BaseModel):
    verdict: ReviewVerdict
    severity: Severity
    findings: list[Finding] = []
    score: float = 0.0


class MergeResult(BaseModel):
    status: str
    merge_sha: str = ""
    pr_url: str = ""
    error: str = ""


class MergeStrategy(str, Enum):
    squash = "squash"
    merge = "merge"
    rebase = "rebase"
