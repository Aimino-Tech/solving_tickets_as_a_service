from app.common.models import DraftRequest, DraftResponse
from app.common.ai_drafting import draft_content, _fallback_draft, TONE_MAP


def test_tone_map():
    assert TONE_MAP["linkedin"] == "formal"
    assert TONE_MAP["discord"] == "casual"
    assert TONE_MAP["x"] == "concise"


def test_fallback_draft_linkedin():
    content = _fallback_draft("linkedin", "MCP Data Engineering")
    assert "MCP" in content
    assert "DataEngineering" in content
    assert content.startswith("I've been diving deep into")


def test_fallback_draft_discord():
    content = _fallback_draft("discord", "MCP Tools")
    assert "MCP" in content
    assert "🚀" in content


def test_fallback_draft_x():
    content = _fallback_draft("x", "Data Automation")
    assert "MCP" in content
    assert len(content) < 280


def test_draft_content_no_api_key(monkeypatch):
    monkeypatch.setattr("common.config.settings.opencode_api_key", "")
    request = DraftRequest(platform="linkedin", topic="MCP Data Engineering")
    response = draft_content(request)
    assert isinstance(response, DraftResponse)
    assert response.platform == "linkedin"
    assert response.tone == "formal"
    assert len(response.content) > 20


def test_draft_content_all_platforms(monkeypatch):
    monkeypatch.setattr("common.config.settings.opencode_api_key", "")
    for platform in ["linkedin", "discord", "x"]:
        request = DraftRequest(platform=platform, topic="MCP Tooling")
        response = draft_content(request)
        assert response.platform == platform
        assert response.tone == TONE_MAP[platform]
        assert len(response.content) > 10
