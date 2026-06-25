"""
Research integration --- augment plan creation with codebase and web research.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from workers.plan.research_engine import search_codebase, search_web

logger = logging.getLogger(__name__)


def generate_search_queries(issue_body: str, max_queries: int = 5) -> list[str]:
    if not issue_body or not issue_body.strip():
        return []

    candidates: set[str] = set()

    for match in re.finditer(
        r"(?:src|lib|app|workers|tests|scripts)/[\w./-]+\.\w+", issue_body
    ):
        candidates.add(match.group())

    for match in re.finditer(r"\b[a-z_]\w*(?:\.[a-z_]\w*)+\b", issue_body):
        candidates.add(match.group())

    for match in re.finditer(r"\b[A-Z]\w*(?:Error|Exception|Warning)\b", issue_body):
        candidates.add(match.group())

    for match in re.finditer(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", issue_body):
        candidates.add(match.group())

    for match in re.finditer(
        r"\b(?:Redis|PostgreSQL|Docker|Kubernetes|GraphQL|gRPC|REST|HTTP|OpenAPI|"
        r"Celery|RabbitMQ|OpenTelemetry|Sentry|Prometheus|Grafana)\b",
        issue_body,
        re.IGNORECASE,
    ):
        candidates.add(match.group())

    for match in re.finditer(r'"([^"]{4,})"', issue_body):
        candidates.add(match.group(1))
    for match in re.finditer(r"'([^']{4,})'", issue_body):
        candidates.add(match.group(1))

    ordered = sorted(candidates, key=_query_score, reverse=True)
    return ordered[:max_queries]


def augment_plan(
    issue_id: str,
    steps: list[dict[str, Any]],
    issue_body: str | None = None,
    repo_path: str | None = None,
    ctx: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    augmented: list[dict[str, Any]] = []

    for idx, step in enumerate(steps):
        task_desc = step.get("task", "")
        if not task_desc:
            augmented.append({
                **step, "research": {"codebase_results": [], "web_results": []}
            })
            continue

        queries = generate_search_queries(task_desc, max_queries=3)
        if issue_body:
            body_queries = generate_search_queries(issue_body, max_queries=2)
            queries.extend(q for q in body_queries if q not in queries)

        codebase_results: list[dict[str, Any]] = []
        web_results: list[dict[str, Any]] = []

        for query in queries:
            logger.debug(
                "Step %d/%d --- searching codebase for %r", idx + 1, len(steps), query
            )
            codebase_results.extend(
                search_codebase(query, repo_path=repo_path, max_results=5)
            )
            logger.debug(
                "Step %d/%d --- searching web for %r", idx + 1, len(steps), query
            )
            web_results.extend(search_web(query, max_results=3))

        augmented.append({
            **step,
            "research": {
                "codebase_results": codebase_results,
                "web_results": web_results,
            },
        })

    return augmented


def build_research_context(
    steps: list[dict[str, Any]],
    max_chars: int = 2000,
) -> str:
    parts: list[str] = []

    for idx, step in enumerate(steps):
        task = step.get("task", f"Step {idx + 1}")
        research = step.get("research")
        if not research:
            continue

        cb = research.get("codebase_results", [])
        web = research.get("web_results", [])

        if not cb and not web:
            continue

        parts.append(f"### Research for: {task}")
        if cb:
            parts.append(f"\n**Codebase hits ({len(cb)}):**")
            parts.append("```")
            for r in cb[:5]:
                loc = f"{r['file']}:{r['line']}"
                snippet = r.get("content", "")
                parts.append(f"  {loc}  {snippet[:120]}")
            parts.append("```")
        if web:
            parts.append(f"\n**Web results ({len(web)}):**")
            for r in web[:3]:
                parts.append(f"- [{r['title']}]({r['url']})")
                parts.append(f"  {r['snippet'][:200]}")
        parts.append("")

    output = "\n".join(parts)
    if len(output) > max_chars:
        output = output[:max_chars] + "\n... (truncated)"
    return output


def _query_score(query: str) -> float:
    words = query.split()
    length_penalty = min(len(query) / 100.0, 1.0)
    return (1.0 - length_penalty) * (1.0 + len(words) / 10.0)
