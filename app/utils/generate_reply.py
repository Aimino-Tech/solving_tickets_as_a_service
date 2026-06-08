from __future__ import annotations
import json
import sys
from typing import Any

import httpx

from app.common.config import settings
from app.common.models import DraftRequest, DraftResponse
from app.common.ai_drafting import _fallback_draft


BRAND_VOICE = """
We build fast, production-grade MCP servers:
- fast-html-mcp: High-performance HTML-to-MCP converter
- office-oxide-mcp: Office document MCP integration
- OpenClaw: Autonomous agent framework for developers

Tone: Technical, helpful, not salesy. Add value first. Show, don't tell.
When appropriate, ask questions to understand their use case.
"""

DECISION_CONTEXT_PROMPT = """You are an open-source MCP tool creator replying to a post.
{BRAND_VOICE}

Analyze the post and determine the best engagement strategy.
Respond with a JSON object: {{"tone": "technical|casual|enthusiastic", "content": "<your reply>", "strategy": "add_value|question|share_experience|offer_help|correct_misconception"}}
"""


class EngagementDraft:
    def __init__(self, content: str, tone: str, strategy: str):
        self.content = content
        self.tone = tone
        self.strategy = strategy

    def to_dict(self) -> dict[str, Any]:
        return {"content": self.content, "tone": self.tone, "strategy": self.strategy}


def generate_reply(post_content: str, platform: str = "reddit",
                   post_author: str = None, post_title: str = None,
                   sentiment: str = None, relevance: int = None) -> EngagementDraft:
    topic = post_title or post_content[:100]
    context_parts = [f"Platform: {platform}"]
    if post_author:
        context_parts.append(f"Author: {post_author}")
    if post_title:
        context_parts.append(f"Title: {post_title}")
    if sentiment:
        context_parts.append(f"Sentiment: {sentiment}")
    context_parts.append(f"Post: {post_content[:1000]}")

    context = "\n".join(context_parts)

    prompt = DECISION_CONTEXT_PROMPT.replace("{BRAND_VOICE}", BRAND_VOICE)

    if not settings.opencode_api_key:
        fallback = _fallback_draft(platform, topic)
        return EngagementDraft(content=fallback, tone="neutral", strategy="add_value")

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
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": context},
                ],
                "temperature": 0.7,
                "max_tokens": 600,
                "response_format": {"type": "json_object"},
            },
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()["choices"][0]["message"]["content"]

        if "```json" in result:
            result = result.split("```json")[1].split("```")[0].strip()
        elif "```" in result:
            result = result.split("```")[1].split("```")[0].strip()

        parsed = json.loads(result)
        return EngagementDraft(
            content=parsed.get("content", fallback),
            tone=parsed.get("tone", "technical"),
            strategy=parsed.get("strategy", "add_value"),
        )
    except Exception as e:
        print(f"LLM reply generation failed: {e}", file=sys.stderr)
        fallback = _fallback_draft(platform, topic)
        return EngagementDraft(content=fallback, tone="neutral", strategy="add_value")


def batch_generate(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results = []
    for post in posts:
        draft = generate_reply(
            post_content=post.get("content", ""),
            platform=post.get("platform", "reddit"),
            post_author=post.get("author_name"),
            post_title=post.get("title"),
            sentiment=post.get("sentiment"),
            relevance=post.get("relevance"),
        )
        results.append({
            "post_id": post.get("id"),
            **draft.to_dict(),
        })
    return results


def generate_digest(engagements: list[dict[str, Any]]) -> str:
    total = len(engagements)
    by_platform = {}
    for e in engagements:
        p = e.get("platform", "unknown")
        by_platform[p] = by_platform.get(p, 0) + 1
    platform_summary = ", ".join(f"{p}: {c}" for p, c in by_platform.items())

    if not settings.opencode_api_key:
        return f"Engagement Digest: {total} engagements across {platform_summary}"

    try:
        resp = httpx.post(
            f"{settings.opencode_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.opencode_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "opencode-go/minimax-m2.5",
                "messages": [
                    {"role": "system", "content": "Generate a brief, informative Telegram digest of recent marketing engagement activity. 2-3 sentences max."},
                    {"role": "user", "content": f"Summarize: {total} total engagements across {platform_summary}. Top items: {json.dumps(engagements[:3])}"},
                ],
                "temperature": 0.5,
                "max_tokens": 300,
            },
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"Digest generation failed: {e}", file=sys.stderr)
        return f"Engagement Digest: {total} engagements across {platform_summary}"


def generate_post(topic: str, platform: str = "linkedin",
                  engagement_type: str = "post") -> EngagementDraft:
    req = DraftRequest(platform=platform, topic=topic, engagement_type=engagement_type)
    prompt = DECISION_CONTEXT_PROMPT.replace("{BRAND_VOICE}", BRAND_VOICE)

    if not settings.opencode_api_key:
        content = _fallback_draft(platform, topic)
        return EngagementDraft(content=content, tone="neutral", strategy="add_value")

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
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Write a {engagement_type} for {platform} about: {topic}"},
                ],
                "temperature": 0.7,
                "max_tokens": 500,
            },
            timeout=30,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        return EngagementDraft(content=content, tone="technical", strategy="add_value")
    except Exception:
        content = _fallback_draft(platform, topic)
        return EngagementDraft(content=content, tone="neutral", strategy="add_value")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate engagement replies and content")
    sub = parser.add_subparsers(dest="command", required=True)

    p_reply = sub.add_parser("reply", help="Generate a reply to a post")
    p_reply.add_argument("--post", required=True)
    p_reply.add_argument("--platform", default="reddit")
    p_reply.add_argument("--author")
    p_reply.add_argument("--title")
    p_reply.add_argument("--sentiment")
    p_reply.add_argument("--relevance", type=int)

    p_batch = sub.add_parser("batch", help="Batch generate replies")
    p_batch.add_argument("--input", type=str)

    p_digest = sub.add_parser("digest", help="Generate engagement digest")
    p_digest.add_argument("--input", type=str)

    p_post = sub.add_parser("post", help="Generate a new post")
    p_post.add_argument("--topic", required=True)
    p_post.add_argument("--platform", default="linkedin")
    p_post.add_argument("--type", default="post")

    args = parser.parse_args()

    if args.command == "reply":
        draft = generate_reply(args.post, args.platform, args.author, args.title,
                               args.sentiment, args.relevance)
        print(json.dumps(draft.to_dict(), indent=2))
    elif args.command == "batch":
        with open(args.input) as f:
            posts = json.load(f)
        results = batch_generate(posts)
        print(json.dumps(results, indent=2))
    elif args.command == "digest":
        with open(args.input) as f:
            engagements = json.load(f)
        digest = generate_digest(engagements)
        print(json.dumps({"digest": digest}, indent=2))
    elif args.command == "post":
        draft = generate_post(args.topic, args.platform, args.type)
        print(json.dumps(draft.to_dict(), indent=2))
