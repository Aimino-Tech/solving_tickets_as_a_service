"""Tests for the ticket auto-expansion module."""

from unittest.mock import patch, MagicMock
from workers.celery_app import app


def test_tasks_registered():
    import workers.tasks.ticket_expander  # noqa: F401
    assert "workers.tasks.ticket_expander.expand_ticket" in app.tasks


def test_expand_ticket_skip_high_quality():
    from workers.tasks.ticket_expander import expand_ticket

    with patch("workers.tasks.ticket_expander._score_quality") as mock_score:
        mock_score.return_value = 0.85
        result = expand_ticket.run(
            issue_id="test-001",
            title="Good ticket",
            description="Well described issue with clear acceptance criteria.",
            repo_url="https://github.com/test/repo",
        )
        assert result["expanded"] is False
        assert result["skip_reason"] == "already good enough"


def test_expand_ticket_low_confidence_skips_posting():
    from workers.tasks.ticket_expander import expand_ticket

    with patch("workers.tasks.ticket_expander._score_quality") as mock_score:
        mock_score.return_value = 0.3
        with patch("workers.tasks.ticket_expander._call_llm") as mock_llm:
            mock_llm.return_value = {
                "context": "Some context",
                "input": "Some input",
                "output": "Some output",
                "implementation": "Some implementation",
                "acceptance_criteria": ["AC1", "AC2"],
            }
            result = expand_ticket.run(
                issue_id="test-002",
                title="Vague ticket",
                description="Fix things",
                repo_url="https://github.com/test/repo",
            )
            assert result["expanded"] is True
            assert result["confidence"] > 0


def test_score_quality_high():
    from workers.tasks.ticket_expander import _score_quality

    score = _score_quality(
        "This is a well-described problem with clear context and acceptance criteria.",
        "- AC1: login works\n- AC2: validation passes",
    )
    assert score > 0.5


def test_score_quality_low():
    from workers.tasks.ticket_expander import _score_quality

    score = _score_quality("fix", "")
    assert score < 0.4


def test_parse_llm_response():
    from workers.tasks.ticket_expander import _parse_llm_response

    response = """
{
    "context": "The login endpoint fails",
    "input": "Email and password",
    "output": "JWT token",
    "implementation": "Add validation",
    "acceptance_criteria": ["AC1: Return 200", "AC2: Return 401"]
}
"""
    result = _parse_llm_response(response)
    assert result["context"] == "The login endpoint fails"
    assert len(result["acceptance_criteria"]) == 2


def test_parse_llm_response_fallback():
    from workers.tasks.ticket_expander import _parse_llm_response

    result = _parse_llm_response("invalid json")
    assert result["context"] == ""
    assert result["acceptance_criteria"] == []


def test_expand_ticket_handles_empty_issue():
    from workers.tasks.ticket_expander import expand_ticket

    with patch("workers.tasks.ticket_expander._score_quality") as mock_score:
        mock_score.return_value = 0.0
        result = expand_ticket.run(
            issue_id="test-empty",
            title="",
            description="",
            repo_url="https://github.com/test/repo",
        )
        assert result["expanded"] is False
        assert "confidence" in result
        assert result["confidence"] == 0.0
