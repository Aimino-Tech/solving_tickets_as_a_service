import logging
import os

from celery import shared_task

from openai import OpenAI

logger = logging.getLogger(__name__)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.tasks.triage.triage_issue",
    autoretry_for=(Exception,),
)
def triage_issue(self, issue_data: dict) -> dict:
    logger.info("Triaging issue — title=%s", issue_data.get("title", "untitled"))
    try:
        model = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")
        prompt = (
            f"Classify this GitHub issue:\n"
            f"Title: {issue_data.get('title', '')}\n"
            f"Body: {issue_data.get('body', '')}\n\n"
            f"Respond with a JSON object: category (bug/feature/question), scope (small/medium/large), confidence (0-1)."
        )
        if client.api_key:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            result = response.choices[0].message.content
            logger.info("Triage result — %s", result)
            return {"issue_data": issue_data, "triage_result": result}
        else:
            logger.warning("No OPENAI_API_KEY set — skipping LLM triage")
            return {
                "issue_data": issue_data,
                "triage_result": {"category": "unknown", "scope": "medium", "confidence": 0},
            }
    except Exception as exc:
        logger.error("Triage failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
