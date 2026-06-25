import hashlib
import re
from typing import Literal

FixType = Literal["fix", "feature", "chore", "docs", "refactor"]


def generate_branch_name(
    issue_id: str,
    issue_identifier: str,
    fix_type: FixType = "fix",
) -> str:
    prefix = "stas"
    identifier_slug = re.sub(r"[^a-z0-9-]", "-", issue_identifier.lower())[:40]
    short_sha = hashlib.sha256(issue_id.encode()).hexdigest()[:8]
    return f"{prefix}/{fix_type}/{identifier_slug}-{short_sha}"
