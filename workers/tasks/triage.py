import json
import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


def get_openai_client():
    """Lazy-init OpenAI client to avoid module-level side effects."""
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY", "")
    return OpenAI(api_key=api_key)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.tasks.triage.triage_issue",
)
def triage_issue(self, issue_data: dict) -> dict:
    """Classify an issue using OpenAI (or return a default if no API key)."""
    logger.info("Triaging issue — title=%s", issue_data.get("title", "untitled"))
    try:
        model = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")
        prompt = (
            f"Classify this GitHub issue:\n"
            f"Title: {issue_data.get('title', '')}\n"
            f"Body: {issue_data.get('body', '')}\n\n"
            f"Respond with a JSON object: category (bug/feature/question), scope (small/medium/large), confidence (0-1)."
        )
        if get_openai_client().api_key:
            response = get_openai_client().chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            raw = response.choices[0].message.content or ""
            # Try to parse JSON response; fall back to default
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"category": "unknown", "scope": "medium", "confidence": 0}
            logger.info("Triage result — %s", parsed)
            return {"issue_data": issue_data, "triage_result": parsed, "type": parsed.get("category", "unknown"), "confidence": parsed.get("confidence", 0)}
        else:
            logger.warning("No OPENAI_API_KEY set — skipping LLM triage")
            default = {"category": "unknown", "scope": "medium", "confidence": 0}
            return {"issue_data": issue_data, "triage_result": default, "type": "unknown", "confidence": 0}
    except Exception as exc:
        logger.error("Triage failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
