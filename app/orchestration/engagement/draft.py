"""AI-powered reply drafting with brand voice."""

import os
import json
import logging

import httpx

logger = logging.getLogger(__name__)

BRAND_VOICE = """You are the creator of open-source MCP (Model Context Protocol) servers.
Your tone: Technical, helpful, not salesy. Add value first.
Focus areas: fast-html-mcp, office-oxide-mcp, data pipelines, web scraping.
You reply to developer communities with genuine technical insight."""


class NoApiKeyError(RuntimeError):
    pass


def _call_llm(prompt, model="opencode-go/minimax-m2.7"):
    api_key = os.getenv("OPENCODE_API_KEY")
    base_url = os.getenv("OPENCODE_BASE_URL", "https://api.opencode.ai/v1")
    if not api_key:
        raise NoApiKeyError("OPENCODE_API_KEY is not set — configure it in .env")

    resp = httpx.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": BRAND_VOICE},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 300,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


def _fallback_draft(post_content):
    return (
        "Great point! We've been working on similar challenges with our open-source "
        "MCP servers. If you're interested, check out fast-html-mcp for "
        "HTML-to-MCP conversion or office-oxide-mcp for document processing. "
        "Always happy to discuss approaches!"
    )


def draft_reply(post_content, platform="unknown", context=None):
    prompt = f"""A developer on {platform} posted this:

{post_content[:1000]}

Draft a helpful, technical reply that adds genuine value. Do not pitch unless directly relevant. Be concise (2-4 sentences)."""
    try:
        return _call_llm(prompt)
    except NoApiKeyError:
        logger.warning("OPENCODE_API_KEY not set, using fallback draft")
        return _fallback_draft(post_content)


def score_relevance(post_content, platform="unknown"):
    prompt = f"""Rate this {platform} post for relevance to an MCP open-source tool creator.
Categories: relevant (wants MCP/OS tool solution), maybe (discusses related topics), irrelevant (not related).

Post: {post_content[:800]}

Respond with JSON only: {{"score": 0-100, "label": "relevant|maybe|irrelevant", "reason": "..."}}"""
    try:
        result = _call_llm(prompt, model="opencode-go/minimax-m2.5")
        return json.loads(result)
    except NoApiKeyError:
        logger.warning("OPENCODE_API_KEY not set, skipping relevance scoring")
        return {"score": 0, "label": "maybe", "reason": "API key not configured"}
    except Exception as e:
        logger.warning("LLM scoring failed: %s", e)
        return {"score": 0, "label": "maybe", "reason": str(e)}


def score_sentiment(post_content):
    prompt = f"""Analyze sentiment of this post about MCP/devtools:

{post_content[:500]}

Respond with JSON only: {{"sentiment": "positive|neutral|negative|curious", "confidence": 0-1}}"""
    try:
        result = _call_llm(prompt, model="opencode-go/minimax-m2.5")
        return json.loads(result)
    except NoApiKeyError:
        logger.warning("OPENCODE_API_KEY not set, skipping sentiment scoring")
        return {"sentiment": "neutral", "confidence": 0.5}
    except Exception as e:
        logger.warning("Sentiment scoring failed: %s", e)
        return {"sentiment": "neutral", "confidence": 0.5}
