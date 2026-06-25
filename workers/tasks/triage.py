import json
import logging
import os
import re

from celery import shared_task

logger = logging.getLogger(__name__)

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


def classify_via_keywords(issue_data: dict) -> dict:
    """Keyword-based fallback classification when no LLM is available."""
    title = (issue_data.get("title") or "").lower()
    body = (issue_data.get("body") or "").lower()
    combined = f"{title} {body}"

    # Bug indicators
    bug_score = 0
    bug_kw = [
        "bug", "error", "crash", "broken", "fail", "fix", "wrong", "incorrect",
        "not working", "unexpected", "exception", "doesn't work", "issue",
        "bug report",
    ]
    for kw in bug_kw:
        if kw in combined:
            bug_score += 1

    # Feature indicators
    feature_score = 0
    feature_kw = [
        "feature", "request", "would like", "suggest", "please add", "want",
        "proposal", "idea", "enhancement", "new:",
    ]
    for kw in feature_kw:
        if kw in combined:
            feature_score += 1

    # Question indicators
    question_score = 0
    question_kw = ["?", "how to", "how do", "question"]
    for kw in question_kw:
        if kw in combined:
            question_score += 1

    scores = {"bug": bug_score, "feature": feature_score, "question": question_score}
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        best = "unknown"

    # Difficulty estimation
    body_len = len(issue_data.get("body") or "")
    code_blocks = body.count("```")
    if body_len > 2000 or code_blocks > 3:
        scope = "large"
    elif body_len > 500 or code_blocks > 1:
        scope = "medium"
    else:
        scope = "small"

    return {"category": best, "scope": scope, "confidence": round(scores[best] / max(sum(scores.values()), 1), 2)}


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.tasks.triage.triage_issue",
)
def triage_issue(self, issue_data: dict) -> dict:
    logger.info("Triaging issue — title=%s", issue_data.get("title", "untitled"))
    try:
        client = _get_llm_client()
        if client:
            model = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")
            prompt = (
                f"Classify this GitHub issue:\n"
                f"Title: {issue_data.get('title', '')}\n"
                f"Body: {issue_data.get('body', '')}\n\n"
                f"Respond with a JSON object: category (bug/feature/question), "
                f"scope (small/medium/large), confidence (0-1)."
            )
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            result_text = response.choices[0].message.content or ""
            try:
                result = json.loads(result_text)
            except json.JSONDecodeError:
                result = classify_via_keywords(issue_data)
            logger.info("LLM triage result — %s", result)
            return {"issue_data": issue_data, "triage_result": result}
        else:
            logger.warning("No LLM available — using keyword-based triage")
            result = classify_via_keywords(issue_data)
            return {"issue_data": issue_data, "triage_result": result}
    except Exception as exc:
        logger.error("Triage failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
