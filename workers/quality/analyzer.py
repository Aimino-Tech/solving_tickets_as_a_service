import logging
import re

from celery import shared_task

from workers.quality.models import QualityScore

logger = logging.getLogger(__name__)


def _score_clarity(description: str) -> tuple[float, dict[str, int]]:
    details: dict[str, int] = {}
    score = 0.0
    factors = 0

    desc_len = len(description.strip())
    details["length_chars"] = desc_len
    if desc_len >= 200:
        score += 1.0
    elif desc_len >= 100:
        score += 0.6
    elif desc_len >= 50:
        score += 0.3
    factors += 1

    has_sections = bool(
        re.search(
            r"(?:^|\n)#{1,6}\s+\w+|(?:^|\n)\*\*(?:Context|Problem|Goal|Description|Summary|Details)\*\*",
            description,
            re.IGNORECASE | re.MULTILINE,
        )
    )
    details["has_sections"] = 1 if has_sections else 0
    if has_sections:
        score += 1.0
    factors += 1

    has_what = bool(re.search(r"\b(?:what|should|need|must|wants?)\b", description, re.IGNORECASE))
    has_why = bool(re.search(r"\b(?:because|reason|why|so that|in order to)\b", description, re.IGNORECASE))
    details["has_what"] = 1 if has_what else 0
    details["has_why"] = 1 if has_why else 0
    if has_what:
        score += 0.5
    if has_why:
        score += 0.5
    factors += 2

    normalized = max(score / max(factors, 1), 0.0)
    return min(normalized, 1.0), details


def _score_completeness(acceptance_criteria: str) -> tuple[float, dict[str, int]]:
    details: dict[str, int] = {}
    score = 0.0
    factors = 0

    lines = [ln.strip() for ln in acceptance_criteria.strip().split("\n") if ln.strip()]
    bullet_lines = [ln for ln in lines if ln.startswith("-") or ln.startswith("*") or re.match(r"^\d+[.)]", ln)]
    details["ac_count"] = len(bullet_lines) if bullet_lines else len(lines)

    count = details["ac_count"]
    if count >= 5:
        score += 1.0
    elif count >= 3:
        score += 0.7
    elif count >= 1:
        score += 0.3
    factors += 1

    specificity_score = 0.0
    spec_factors = 0
    for line in bullet_lines or lines:
        has_numbers = bool(re.search(r"\d+", line))
        has_verbs = bool(re.search(r"\b(?:should|must|will|shall|verify|check|ensure|validate|return|respond)\b", line, re.IGNORECASE))
        if has_numbers:
            specificity_score += 0.5
            spec_factors += 1
        if has_verbs:
            specificity_score += 0.5
            spec_factors += 1
    if spec_factors > 0:
        score += min(specificity_score / max(spec_factors, 1), 1.0)
        details["specificity"] = round(min(specificity_score / max(spec_factors, 1), 1.0) * 100)
    else:
        details["specificity"] = 0
    factors += 1

    normalized = max(score / max(factors, 1), 0.0)
    return min(normalized, 1.0), details


def _score_ac_quality(acceptance_criteria: str) -> tuple[float, dict[str, int]]:
    details: dict[str, int] = {}
    score = 0.0
    factors = 0

    lines = [ln.strip() for ln in acceptance_criteria.strip().split("\n") if ln.strip()]
    bullet_lines = [ln for ln in lines if ln.startswith("-") or ln.startswith("*") or re.match(r"^\d+[.)]", ln)]
    ac_lines = bullet_lines or lines

    gwt_count = 0
    actionable_count = 0
    for line in ac_lines:
        if re.search(r"\b(?:Given|When|Then|Scenario)\b", line):
            gwt_count += 1
        if re.search(r"\b(?:should|must|will|shall|verify|check|ensure|validate|return|respond)\b", line, re.IGNORECASE):
            actionable_count += 1

    details["gwt_format"] = gwt_count
    details["actionable"] = actionable_count
    total_ac = len(ac_lines)

    if total_ac > 0:
        gwt_ratio = gwt_count / total_ac
        actionable_ratio = actionable_count / total_ac
        score += min(gwt_ratio * 2, 1.0)
        score += min(actionable_ratio, 1.0)
        factors += 2
    else:
        score += 0.0
        factors += 1

    normalized = max(score / max(factors, 1), 0.0)
    return min(normalized, 1.0), details


E2E_SPEC_TEMPLATE = """

## E2E Spec Template (Auto-generated)

### Preconditions
- [ ] Describe the initial system state

### Test Steps
1. Step one: describe the action
2. Step two: describe the expected intermediate state
3. Step three: describe the final verification

### Expected Results
- [ ] Result one: what the system should produce
- [ ] Result two: what should NOT happen
- [ ] Error handling: how the system behaves on failure

### Verification Criteria
- [ ] All acceptance criteria are independently verifiable
- [ ] Edge cases are documented
- [ ] Performance/latency expectations are defined
"""


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.quality.analyzer.quality_analyze",
    autoretry_for=(Exception,),
)
def quality_analyze(
    self,
    issue_id: str,
    description: str,
    acceptance_criteria: str,
    auto_heal: bool = True,
) -> dict:
    logger.info("Quality analyzing issue=%s desc_len=%d ac_len=%d", issue_id, len(description), len(acceptance_criteria))
    try:
        clarity_score, clarity_details = _score_clarity(description)
        completeness_score, completeness_details = _score_completeness(acceptance_criteria)
        ac_quality_score, ac_quality_details = _score_ac_quality(acceptance_criteria)

        total = 0.3 * clarity_score + 0.4 * completeness_score + 0.3 * ac_quality_score
        total = round(min(max(total, 0.0), 1.0), 4)

        needs_review = False
        auto_healed = False
        details = {
            "clarity": clarity_details,
            "completeness": completeness_details,
            "ac_quality": ac_quality_details,
        }

        if total < 0.6 and auto_heal:
            auto_healed = True
            needs_review = True
            details["auto_heal_note"] = "Score below 0.6 threshold. E2E spec template appended."
            logger.info("Issue=%s score=%.4f — auto-heal triggered, needs review", issue_id, total)

        score = QualityScore(
            score=total,
            clarity_score=round(clarity_score, 4),
            completeness_score=round(completeness_score, 4),
            ac_quality_score=round(ac_quality_score, 4),
            auto_healed=auto_healed,
            needs_review=needs_review,
            details=details,
        )

        return score.model_dump()
    except Exception as exc:
        logger.error("Quality analysis failed for issue=%s — %s", issue_id, exc, exc_info=True)
        raise self.retry(exc=exc)


def get_e2e_spec_template() -> str:
    return E2E_SPEC_TEMPLATE
