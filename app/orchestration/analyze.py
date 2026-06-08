from __future__ import annotations
import json
import sys
from typing import Any

import httpx

from app.common.config import settings
from app.common.models import EngagementRecord
from orchestrator_state import get_repository


SYSTEM_PROMPT = """You are an MCP (Model Context Protocol) open-source tool engagement analyzer.
Your job is to analyze social media posts and scored mentions for relevance to MCP/open-source tool promotion.
Score each item on these four dimensions:
1. Relevance (0-100): How directly related to MCP, developer tools, or open-source?
2. Sentiment (positive/neutral/negative): Overall tone toward MCP/devtools
3. Opportunity (0-100): Lead quality - would engaging here be productive?
4. Urgency (immediate/today/batch): How quickly should we respond?

Respond with a JSON array of objects, each with: id, relevance, sentiment, opportunity, urgency.
"""


class AnalysisResult:
    def __init__(self, item_id: str, relevance: int, sentiment: str,
                 opportunity: int, urgency: str):
        self.item_id = item_id
        self.relevance = relevance
        self.sentiment = sentiment
        self.opportunity = opportunity
        self.urgency = urgency

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.item_id,
            "relevance": self.relevance,
            "sentiment": self.sentiment,
            "opportunity": self.opportunity,
            "urgency": self.urgency,
        }


def _build_input_text(items: list[dict[str, Any]]) -> str:
    lines = []
    for item in items:
        lines.append(
            f"[ID:{item.get('id', '?')}] Platform:{item.get('platform', '?')} "
            f"Content:{item.get('content_snippet', item.get('content_preview', ''))[:300]}"
        )
    return "\n".join(lines)


def analyze_items(items: list[dict[str, Any]]) -> list[AnalysisResult]:
    if not items:
        return []

    input_text = _build_input_text(items)

    try:
        resp = httpx.post(
            f"{settings.opencode_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.opencode_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "opencode-go/minimax-m2.7",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Analyze these items:\n\n{input_text}\n\nReturn JSON array."},
                ],
                "temperature": 0.3,
                "max_tokens": 2000,
                "response_format": {"type": "json_object"},
            },
            timeout=30,
        )
        resp.raise_for_status()
        result_data = resp.json()["choices"][0]["message"]["content"]

        if "```json" in result_data:
            result_data = result_data.split("```json")[1].split("```")[0].strip()
        elif "```" in result_data:
            result_data = result_data.split("```")[1].split("```")[0].strip()

        parsed = json.loads(result_data)
        scores = parsed.get("scores", parsed) if isinstance(parsed, dict) else parsed
        if isinstance(scores, dict):
            scores = [scores]
    except Exception as e:
        print(f"LLM analysis failed, using fallback: {e}", file=sys.stderr)
        scores = _fallback_analysis(items)

    results = []
    for i, item in enumerate(items):
        item_id = item.get("id", str(i))
        if i < len(scores) and isinstance(scores[i], dict):
            s = scores[i]
            results.append(AnalysisResult(
                item_id=item_id,
                relevance=s.get("relevance", s.get("score", 50)),
                sentiment=s.get("sentiment", "neutral"),
                opportunity=s.get("opportunity", s.get("opportunity_score", 50)),
                urgency=s.get("urgency", "batch"),
            ))
        else:
            results.append(AnalysisResult(
                item_id=item_id, relevance=50,
                sentiment="neutral", opportunity=50, urgency="batch",
            ))
    return results


def _fallback_analysis(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scores = []
    for item in items:
        content = (item.get("content_snippet", "") or item.get("content_preview", "") or "").lower()
        relevance = 50
        if any(kw in content for kw in ("mcp", "model context protocol", "openclaw", "fast-html-mcp")):
            relevance = 80
        elif any(kw in content for kw in ("opensource", "open source", "devtools", "llm", "ai tool")):
            relevance = 60
        sentiment = "neutral"
        if any(kw in content for kw in ("amazing", "great", "love", "awesome", "helpful")):
            sentiment = "positive"
        elif any(kw in content for kw in ("terrible", "awful", "hate", "useless", "broken")):
            sentiment = "negative"
        opportunity = min(relevance + 10, 100)
        urgency = "batch"
        if relevance >= 80 and sentiment != "negative":
            urgency = "today"
        if relevance >= 90 and sentiment == "positive":
            urgency = "immediate"
        scores.append({
            "relevance": relevance,
            "sentiment": sentiment,
            "opportunity": opportunity,
            "urgency": urgency,
        })
    return scores


def _extract_scores(result: AnalysisResult) -> tuple:
    return (result.relevance, result.opportunity)


def prioritize_results(results: list[AnalysisResult]) -> list[AnalysisResult]:
    urgency_order = {"immediate": 0, "today": 1, "batch": 2}
    return sorted(results, key=lambda r: (urgency_order.get(r.urgency, 3), -r.relevance, -r.opportunity))


def score_and_persist(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results = analyze_items(items)
    repo = get_repository()

    for r in results:
        lid = repo.add_lead(
            platform=items[0].get("platform", "unknown"),
            source_url=items[0].get("source_url"),
            author_name=items[0].get("author_name"),
            relevance_score=r.relevance,
            sentiment=r.sentiment,
            opportunity_score=r.opportunity,
            urgency=r.urgency,
        )
        r.lead_id = lid

    prioritized = prioritize_results(results)
    output = []
    for r in prioritized:
        d = r.to_dict()
        if hasattr(r, "lead_id"):
            d["lead_id"] = r.lead_id
        output.append(d)
    return output


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Analyze and score engagement items")
    parser.add_argument("--input", type=str, help="JSON file with items to analyze")
    parser.add_argument("--inline", type=str, help="JSON string of items")
    parser.add_argument("--persist", action="store_true", help="Persist results as leads")
    parser.add_argument("--prioritize", action="store_true", help="Return prioritized results")

    args = parser.parse_args()

    if args.input:
        with open(args.input) as f:
            items = json.load(f)
    elif args.inline:
        items = json.loads(args.inline)
    else:
        items = json.loads(sys.stdin.read())

    if args.persist:
        output = score_and_persist(items)
    else:
        results = analyze_items(items)
        if args.prioritize:
            results = prioritize_results(results)
        output = [r.to_dict() for r in results]

    print(json.dumps(output, indent=2))
