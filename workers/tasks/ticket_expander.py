"""
Ticket Auto-Expansion — AI expands vague tickets into structured format.

Scans incoming issues, scores their clarity/completeness, and if below
threshold, uses an LLM to produce a structured expansion (context, input,
output, implementation, acceptance criteria).  The expanded format is
posted as a comment — the original issue description is never modified.
"""

import json
import logging
import os
import re

from celery import shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LLM client (reuse pattern from workers.tasks.triage)
# ---------------------------------------------------------------------------

_llm_client = None


def _get_llm_client():
    """Lazy-init OpenAI client so no crash if OPENAI_API_KEY is unset at import time."""
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        _llm_client = False  # sentinel
        return None
    try:
        from openai import OpenAI

        _llm_client = OpenAI(api_key=key)
        return _llm_client
    except Exception as exc:
        logger.warning("Failed to init OpenAI client: %s", exc)
        _llm_client = False
        return None


# ---------------------------------------------------------------------------
# Quality scoring (keyword-based, no LLM needed)
# ---------------------------------------------------------------------------

# Thresholds — matching the AC expectations
HIGH_QUALITY_THRESHOLD = 0.7  # score above this -> skip expansion
LOW_QUALITY_THRESHOLD = 0.3   # score below this -> always expand
CONFIDENCE_POST_THRESHOLD = 0.3  # LLM confidence must exceed this to post comment


def _score_length(description: str) -> tuple[float, dict]:
    """Score based on description length and structure."""
    details: dict = {}
    score = 0.0
    factors = 0.0

    desc_len = len(description.strip())
    details["length_chars"] = desc_len

    if desc_len >= 300:
        score += 1.0
    elif desc_len >= 150:
        score += 0.6
    elif desc_len >= 50:
        score += 0.3
    else:
        score += 0.0
    factors += 1.0

    # Check for structured sections (markdown headings, **bold** section headers)
    has_sections = bool(
        re.search(
            r"(?:^|\n)#{1,6}\s+\w+|"
            r"(?:^|\n)\*\*(?:Context|Problem|Goal|Description|Summary|Details|"
            r"Background|Steps|Expected|Actual|Acceptance|Definition)\*\*",
            description,
            re.IGNORECASE | re.MULTILINE,
        )
    )
    details["has_sections"] = 1 if has_sections else 0
    if has_sections:
        score += 1.0
    factors += 1.0

    # Check for acceptance criteria indicators
    has_ac_indicators = bool(
        re.search(
            r"(?:^|\n)\s*[-*]\s+\[.?\]|"
            r"(?:^|\n)\s*\d+[.)]\s+|"
            r"\b(?:acceptance\s+criterion|given|when|then|scenario)\b",
            description,
            re.IGNORECASE | re.MULTILINE,
        )
    )
    details["has_ac_indicators"] = 1 if has_ac_indicators else 0
    if has_ac_indicators:
        score += 1.0
    factors += 1.0

    # Specificity - code blocks, links, numbers
    code_blocks = description.count("```")
    has_urls = bool(re.search(r"https?://\S+", description))
    has_numbers = bool(re.search(r"\d+", description))
    details["code_blocks"] = code_blocks
    details["has_urls"] = 1 if has_urls else 0

    specificity_score = 0.0
    if code_blocks > 0:
        specificity_score += 0.5
    if has_urls:
        specificity_score += 0.5
    if has_numbers:
        specificity_score += 0.5
    details["specificity_score"] = specificity_score
    score += min(specificity_score, 1.0)
    factors += 1.0

    normalized = max(score / max(factors, 1.0), 0.0)
    return min(normalized, 1.0), details


def score_ticket_quality(
    title: str,
    description: str,
) -> dict:
    """
    Score a ticket's quality on a 0-1 scale using keyword/text heuristics.

    Returns a dict with:
      - ``score`` (float, 0-1) - overall quality
      - ``details`` (dict) - per-factor breakdown
      - ``should_expand`` (bool) - whether expansion is recommended
      - ``reason`` (str) - human-readable explanation
    """
    combined = f"{title} {description}".strip()
    if not combined:
        return {
            "score": 0.0,
            "details": {"reason": "empty_title_and_description"},
            "should_expand": True,
            "reason": "Ticket has no title or description",
        }

    clarity_score, clarity_details = _score_length(description)

    # Title quality
    title_len = len(title.strip())
    title_score = 0.0
    if title_len >= 20:
        title_score = 1.0
    elif title_len >= 10:
        title_score = 0.5
    else:
        title_score = 0.0

    # Keyword-based context check
    combined_lower = combined.lower()
    context_keywords = [
        "context", "background", "problem", "goal", "purpose",
        "description", "summary", "details",
    ]
    context_score = sum(1 for kw in context_keywords if kw in combined_lower)
    context_score = min(context_score / 3.0, 1.0)  # normalize to 0-1

    # Overall score: weighted combination
    total = (
        0.35 * clarity_score
        + 0.25 * title_score
        + 0.25 * context_score
        + 0.15 * min(clarity_details.get("specificity_score", 0) / 1.5, 1.0)
    )

    total = round(min(max(total, 0.0), 1.0), 4)

    should_expand = total < HIGH_QUALITY_THRESHOLD

    reasons = []
    if total >= HIGH_QUALITY_THRESHOLD:
        reasons.append("Ticket is well-structured; no expansion needed")
    else:
        if clarity_score < 0.5:
            reasons.append("Description lacks sufficient detail or structure")
        if title_score < 0.5:
            reasons.append("Title is too short or vague")
        if context_score < 0.3:
            reasons.append("No context/background section found")
        if not reasons:
            reasons.append(
                f"Overall quality score {total} below threshold "
                f"{HIGH_QUALITY_THRESHOLD}"
            )

    return {
        "score": total,
        "details": {
            "clarity": clarity_details,
            "title_score": title_score,
            "context_score": context_score,
            "clarity_score": clarity_score,
        },
        "should_expand": should_expand,
        "reason": "; ".join(reasons),
    }


# ---------------------------------------------------------------------------
# LLM-based expansion
# ---------------------------------------------------------------------------

EXPANSION_SYSTEM_PROMPT = """You are a ticket clarification assistant for a software engineering AI agent.
Your job is to expand vague GitHub issues into a structured, actionable format.

Given a ticket title and description, produce a JSON object with exactly these 5 fields:

1. "context" - Background information, the problem space, affected components, and why this matters.
2. "input" - What inputs, preconditions, or starting state the agent can expect.
3. "output" - What the expected outcome or deliverable looks like.
4. "implementation" - A suggested approach, implementation notes, files likely involved, and relevant code paths.
5. "acceptance_criteria" - A numbered list of concrete, testable acceptance criteria that a PR must satisfy.

Also include a field:
6. "confidence" - A float 0.0-1.0 indicating how confident you are that your expansion is accurate based on the available information.

Rules:
- Be concise but complete. Each field should be 2-5 sentences unless more detail is essential.
- Do NOT invent information that contradicts the ticket. If something is ambiguous, note the ambiguity.
- The "acceptance_criteria" field must be a list of strings (each one a criterion).
- Return ONLY valid JSON, no markdown fences, no explanation."""


def _build_expansion_prompt(title: str, description: str) -> str:
    """Build the user message for the LLM expansion call."""
    return (
        f"Expand the following GitHub issue into structured format:\n\n"
        f"Title: {title}\n\n"
        f"Description:\n{description}\n\n"
        f"Respond with a JSON object containing the 5 fields (context, input, output, "
        f"implementation, acceptance_criteria) plus a confidence score."
    )


def _call_llm_expand(title: str, description: str) -> dict | None:
    """Call the LLM to expand a ticket. Returns parsed JSON or None on failure."""
    client = _get_llm_client()
    if not client:
        logger.warning("No LLM client available - cannot expand ticket")
        return None

    model = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EXPANSION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _build_expansion_prompt(title, description),
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.error("LLM expansion call failed: %s", exc)
        return None

    result_text = response.choices[0].message.content or ""
    if not result_text:
        logger.warning("LLM returned empty response")
        return None

    try:
        result = json.loads(result_text)
    except json.JSONDecodeError:
        logger.warning("LLM response was not valid JSON: %.200s", result_text)
        return None

    # Validate required fields
    required = [
        "context", "input", "output",
        "implementation", "acceptance_criteria", "confidence",
    ]
    missing = [f for f in required if f not in result]
    if missing:
        logger.warning(
            "LLM response missing fields: %s - raw: %.200s", missing, result_text
        )
        return None

    # Normalize confidence
    try:
        result["confidence"] = float(result["confidence"])
    except (ValueError, TypeError):
        result["confidence"] = 0.0

    # Ensure acceptance_criteria is a list
    if not isinstance(result["acceptance_criteria"], list):
        if isinstance(result["acceptance_criteria"], str):
            result["acceptance_criteria"] = [result["acceptance_criteria"]]
        else:
            result["acceptance_criteria"] = [str(result["acceptance_criteria"])]

    result["confidence"] = max(0.0, min(1.0, result["confidence"]))
    return result


# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------


def _format_expanded_comment(
    title: str,
    quality: dict,
    expansion: dict | None,
) -> str:
    """Format the expansion result as a GitHub issue comment."""
    lines = [
        "## STAS Ticket Auto-Expansion",
        "",
        f"**Original title:** {title}",
        f"**Quality score:** {quality['score']:.2f}/1.0",
        "",
    ]

    if not expansion:
        lines.append("_Expansion skipped or failed - see score above._")
        return "\n".join(lines)

    confidence = expansion.get("confidence", 0.0)
    lines.append(f"**LLM confidence:** {confidence:.2f}/1.0")
    lines.append("")

    lines.append("### Context")
    lines.append(expansion.get("context", ""))
    lines.append("")

    lines.append("### Input / Preconditions")
    lines.append(expansion.get("input", ""))
    lines.append("")

    lines.append("### Expected Output")
    lines.append(expansion.get("output", ""))
    lines.append("")

    lines.append("### Suggested Implementation")
    lines.append(expansion.get("implementation", ""))
    lines.append("")

    lines.append("### Acceptance Criteria")
    for i, ac in enumerate(expansion.get("acceptance_criteria", []), 1):
        lines.append(f"{i}. {ac}")
    lines.append("")

    lines.append("---")
    lines.append(
        "_This expansion was auto-generated. The original issue description "
        "has not been modified. If the expansion is inaccurate, please update "
        "the issue description manually._"
    )

    return "\n".join(lines)


def _post_github_comment(
    repo_url: str,
    issue_id: str,
    body: str,
) -> bool:
    """Post a comment on a GitHub issue.

    Parses the repo URL to extract owner/repo and uses the GitHubClient
    from ``workers.github.client``.  Falls back to logging the comment
    if posting fails.
    """
    # Parse owner/repo from repo_url
    # repo_url format: https://github.com/owner/repo
    # issue_id format: the issue number
    try:
        parts = repo_url.strip().rstrip("/").split("/")
        owner = parts[-2]
        repo = parts[-1]
        issue_number = issue_id
    except (IndexError, ValueError):
        logger.error(
            "Cannot parse repo_url=%s issue_id=%s - logging comment instead",
            repo_url,
            issue_id,
        )
        logger.info("Expansion comment (not posted):\n%s", body)
        return False

    try:
        from workers.github.client import GitHubClient

        gh = GitHubClient()
        gh._request(
            "POST",
            f"/repos/{owner}/{repo}/issues/{issue_number}/comments",
            json_body={"body": body},
        )
        logger.info(
            "Posted expansion comment on %s/%s#%s", owner, repo, issue_number
        )
        return True
    except Exception as exc:
        logger.error(
            "Failed to post comment on %s/%s#%s: %s",
            owner,
            repo,
            issue_number,
            exc,
        )
        # Fallback: log the comment
        logger.info("Expansion comment (not posted due to error):\n%s", body)
        return False


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.ticket_expander.expand_ticket",
    autoretry_for=(Exception,),
)
def expand_ticket(
    self,
    issue_id: str,
    title: str,
    description: str,
    repo_url: str,
    installation_id: int | None = None,
) -> dict:
    """
    Expand a vague ticket into structured format using LLM.

    Steps:
      1. Score ticket quality (keyword-based).
      2. If score > 0.7, skip expansion.
      3. If score < 0.7, construct expansion prompt and call LLM.
      4. Parse structured response.
      5. Post as issue comment if confidence > 0.3.

    Returns a dict with:
      - ``issue_id`` - the original issue identifier
      - ``quality_score`` - the pre-expansion quality score
      - ``expanded`` - whether expansion was attempted
      - ``posted`` - whether a comment was posted
      - ``confidence`` - LLM confidence (0 if not expanded)
      - ``reason`` - explanation of what happened
    """
    logger.info(
        "Expanding ticket - issue_id=%s title=%.60s desc_len=%d",
        issue_id,
        title,
        len(description),
    )

    # ── Step 1: Score ticket quality ──────────────────────────────
    quality = score_ticket_quality(title, description)
    score = quality["score"]

    # ── Step 2: > 0.7 -> skip (AC1) ────────────────────────────────
    if score > HIGH_QUALITY_THRESHOLD:
        logger.info(
            "Ticket %s score=%.4f - above %.1f threshold, skipping expansion",
            issue_id,
            score,
            HIGH_QUALITY_THRESHOLD,
        )
        return {
            "issue_id": issue_id,
            "quality_score": score,
            "expanded": False,
            "posted": False,
            "confidence": 0.0,
            "reason": quality["reason"],
        }

    # ── Step 3: Score < 0.3 -> attempt expansion (AC2) ────────────
    #     Score between 0.3-0.7 also triggers expansion
    expansion = _call_llm_expand(title, description)

    if expansion is None:
        logger.warning(
            "Ticket %s - expansion failed or LLM unavailable", issue_id
        )
        return {
            "issue_id": issue_id,
            "quality_score": score,
            "expanded": True,
            "posted": False,
            "confidence": 0.0,
            "reason": "LLM expansion call failed or returned invalid data",
        }

    confidence = expansion.get("confidence", 0.0)

    # ── Step 5: Post comment if confidence > threshold (AC4) ──────
    posted = False
    if confidence >= CONFIDENCE_POST_THRESHOLD:
        comment_body = _format_expanded_comment(title, quality, expansion)
        posted = _post_github_comment(repo_url, issue_id, comment_body)
    else:
        logger.info(
            "Ticket %s - LLM confidence %.2f below %.1f threshold, "
            "not posting",
            issue_id,
            confidence,
            CONFIDENCE_POST_THRESHOLD,
        )

    reason_parts = [quality["reason"]]
    if posted:
        reason_parts.append("Expanded ticket posted as comment")
    elif confidence < CONFIDENCE_POST_THRESHOLD:
        reason_parts.append(
            f"Expansion generated but confidence {confidence:.2f} "
            f"too low to post"
        )
    else:
        reason_parts.append(
            "Expansion generated but could not post comment"
        )

    result = {
        "issue_id": issue_id,
        "quality_score": score,
        "expanded": True,
        "posted": posted,
        "confidence": confidence,
        "reason": "; ".join(reason_parts),
    }

    logger.info(
        "Ticket %s expansion complete - score=%.4f confidence=%.2f "
        "posted=%s",
        issue_id,
        score,
        confidence,
        posted,
    )

    return result
