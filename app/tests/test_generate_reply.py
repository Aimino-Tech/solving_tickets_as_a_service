import pytest
from generate_reply import (
    EngagementDraft, generate_reply, generate_digest, generate_post,
    batch_generate, BRAND_VOICE,
)
from app.common.ai_drafting import _fallback_draft


def test_engagement_draft_to_dict():
    d = EngagementDraft("test content", "technical", "add_value")
    result = d.to_dict()
    assert result["content"] == "test content"
    assert result["tone"] == "technical"
    assert result["strategy"] == "add_value"


def test_generate_reply_no_api_key(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    draft = generate_reply("What are MCP tools?", "reddit", "test_user", "MCP Question")
    assert draft.content is not None
    assert len(draft.content) > 10
    assert draft.tone is not None
    assert draft.strategy is not None


def test_generate_reply_different_platforms(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    for platform in ["reddit", "linkedin", "discord", "x"]:
        draft = generate_reply("MCP open source tools", platform, "user1")
        assert draft.content is not None
        assert draft.tone is not None


def test_generate_reply_with_context(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    draft = generate_reply(
        "I built an MCP server", "reddit", "dev_user", "My MCP project",
        sentiment="positive", relevance=90,
    )
    assert draft.content is not None


def test_generate_digest_no_api_key(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    engagements = [
        {"platform": "reddit", "status": "sent"},
        {"platform": "telegram", "status": "pending"},
    ]
    digest = generate_digest(engagements)
    assert "Digest" in digest
    assert "reddit" in digest
    assert "telegram" in digest


def test_generate_digest_empty(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    digest = generate_digest([])
    assert "Digest" in digest


def test_generate_post_no_api_key(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    draft = generate_post("MCP Tools for Developers", "linkedin", "post")
    assert draft.content is not None
    assert len(draft.content) > 10


def test_batch_generate(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    posts = [
        {"id": "1", "content": "MCP is great", "platform": "reddit", "author_name": "u1"},
        {"id": "2", "content": "Open source rocks", "platform": "linkedin", "author_name": "u2"},
    ]
    results = batch_generate(posts)
    assert len(results) == 2
    assert results[0]["post_id"] == "1"
    assert results[1]["post_id"] == "2"
    assert "content" in results[0]
    assert "tone" in results[0]
    assert "strategy" in results[0]


def test_brand_voice_contains_mcp():
    assert "fast-html-mcp" in BRAND_VOICE
    assert "office-oxide-mcp" in BRAND_VOICE
    assert "OpenClaw" in BRAND_VOICE
    assert "Technical" in BRAND_VOICE
