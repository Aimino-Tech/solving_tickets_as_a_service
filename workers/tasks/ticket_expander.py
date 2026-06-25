import json
import logging
import os

from celery import shared_task

from workers.linear_client import LinearClient

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


EXPANSION_PROMPT_TEMPLATE = """You are a ticket refinement expert. Given a raw issue description, extract or infer the following structured fields. Return ONLY valid JSON — no markdown, no code fences.

Issue Description:
{description}

---

Respond with a JSON object containing exactly these keys:
- "context": string — What problem does this solve? What is the background and motivation?
- "input": string — What does the feature receive? What are the inputs, triggers, or preconditions?
- "output": string — What does it produce? What are the outputs, side effects, or deliverables?
- "implementation": string — Suggested implementation approach. How should it be built?
- "acceptance_criteria": list of strings — Testable, specific acceptance criteria (at least 3, at most 8).
- "confidence": float — How confident are you that this expansion is accurate? 0.0 to 1.0. Be conservative — if the description is too vague, assign low confidence."""


@shared_task(
    bind=True,
    max_retries=1,
    name="workers.tasks.ticket_expander.expand_ticket",
)
def expand_ticket(
    self,
    issue_id: str,
    description: str,
    acceptance_criteria: str = "",
) -> dict:
    """Expand a vague ticket into structured format using an LLM.

    Scores ticket quality first. If score > 0.7, skips expansion (already
    good enough). Otherwise constructs a prompt, calls the LLM, parses the
    structured response, and posts an expansion comment on the issue.

    Safety guarantees:
    - Never deletes original description — always appends as a comment.
    - If confidence < 0.3, discards expansion silently.
    - If 0.3 <= confidence < 0.7, posts with a review flag.
    - If confidence >= 0.7, posts confidently.
    """
    logger.info(
        "Expanding ticket issue_id=%s desc_len=%d ac_len=%d",
        issue_id,
        len(description),
        len(acceptance_criteria),
    )

    try:
        # 1. Score ticket quality by reusing the quality analyzer
        from workers.quality.analyzer import quality_analyze as quality_task

        quality_result = quality_task(issue_id, description, acceptance_criteria)
        score = float(quality_result.get("score", 0.0))

        logger.info("Issue=%s quality_score=%.4f", issue_id, score)

        # 2. If score > 0.7, skip expansion (already good enough)
        if score > 0.7:
            logger.info(
                "Issue=%s score=%.4f > 0.7 — skipping expansion, already good enough",
                issue_id,
                score,
            )
            return {
                "expanded": False,
                "structured": {
                    "context": "",
                    "input": "",
                    "output": "",
                    "implementation": "",
                    "acceptance_criteria": [],
                },
                "confidence": score,
            }

        # 3. Call LLM
        client = _get_llm_client()
        if not client:
            logger.warning(
                "No LLM client available for ticket expansion issue=%s",
                issue_id,
            )
            return {
                "expanded": False,
                "structured": {
                    "context": "",
                    "input": "",
                    "output": "",
                    "implementation": "",
                    "acceptance_criteria": [],
                },
                "confidence": 0.0,
            }

        model = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")
        prompt = EXPANSION_PROMPT_TEMPLATE.format(description=description)

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        result_text = response.choices[0].message.content or ""

        # 4. Parse structured response
        try:
            parsed = json.loads(result_text)
        except json.JSONDecodeError:
            logger.error(
                "Failed to parse LLM response as JSON for issue=%s — response=%s",
                issue_id,
                result_text[:500],
            )
            return {
                "expanded": False,
                "structured": {
                    "context": "",
                    "input": "",
                    "output": "",
                    "implementation": "",
                    "acceptance_criteria": [],
                },
                "confidence": 0.0,
            }

        structured = {
            "context": str(parsed.get("context", "")),
            "input": str(parsed.get("input", "")),
            "output": str(parsed.get("output", "")),
            "implementation": str(parsed.get("implementation", "")),
            "acceptance_criteria": list(parsed.get("acceptance_criteria", [])),
        }
        confidence = float(parsed.get("confidence", 0.0))

        logger.info(
            "LLM expansion complete for issue=%s confidence=%.4f",
            issue_id,
            confidence,
        )

        # 5. Safety: confidence-based handling
        if confidence < 0.3:
            logger.info(
                "Issue=%s confidence=%.4f < 0.3 — discarding expansion (nonsense)",
                issue_id,
                confidence,
            )
            return {
                "expanded": True,
                "structured": structured,
                "confidence": confidence,
            }

        # Build comment body (never delete original — always append)
        ac_lines = "\n".join(f"- {ac}" for ac in structured["acceptance_criteria"])

        if confidence < 0.7:
            comment_body = (
                f"## AI Auto-Expansion (confidence: {confidence:.2f} — needs review)\n\n"
                f"### Context\n{structured['context']}\n\n"
                f"### Input\n{structured['input']}\n\n"
                f"### Output\n{structured['output']}\n\n"
                f"### Suggested Implementation\n{structured['implementation']}\n\n"
                f"### Acceptance Criteria\n{ac_lines}\n\n"
                f"---\n"
                f"*This expansion has confidence between 0.3 and 0.7 "
                f"and should be reviewed before use.*"
            )
        else:
            comment_body = (
                f"## AI Auto-Expansion (confidence: {confidence:.2f})\n\n"
                f"### Context\n{structured['context']}\n\n"
                f"### Input\n{structured['input']}\n\n"
                f"### Output\n{structured['output']}\n\n"
                f"### Suggested Implementation\n{structured['implementation']}\n\n"
                f"### Acceptance Criteria\n{ac_lines}"
            )

        # 6. Post as issue comment
        try:
            linear = LinearClient()
            linear.post_comment(issue_id, comment_body)
            logger.info(
                "Posted expansion comment for issue=%s confidence=%.4f",
                issue_id,
                confidence,
            )
        except Exception as exc:
            logger.warning(
                "Failed to post expansion comment for issue=%s — %s",
                issue_id,
                exc,
            )

        return {
            "expanded": True,
            "structured": structured,
            "confidence": confidence,
        }

    except Exception as exc:
        logger.error(
            "Ticket expansion failed for issue=%s — %s",
            issue_id,
            exc,
            exc_info=True,
        )
        raise self.retry(exc=exc)
