"""Tests for the workers/support/auto_answer module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from workers.support.auto_answer import (
    AUTO_ANSWER_MODEL,
    AUTO_ANSWER_PROMPT_TEMPLATE,
    AutoAnswerResult,
    _build_prompt,
    _parse_llm_response,
    _validate_parsed,
    auto_answer,
)


class TestAutoAnswerResult:
    """Tests for the AutoAnswerResult dataclass."""

    def test_to_dict_roundtrip(self):
        """to_dict() then from_dict() produces the same object."""
        original = AutoAnswerResult(
            answer="You can set up webhooks in Settings > Integrations.",
            confidence=0.85,
            needs_human_review=False,
            category="configuration",
        )
        d = original.to_dict()
        restored = AutoAnswerResult.from_dict(d)
        assert restored.answer == original.answer
        assert restored.confidence == original.confidence
        assert restored.needs_human_review == original.needs_human_review
        assert restored.category == original.category

    def test_fallback_returns_zero_confidence(self):
        """fallback() returns empty answer with 0.0 confidence."""
        fb = AutoAnswerResult.fallback()
        assert fb.answer == ""
        assert fb.confidence == 0.0
        assert fb.needs_human_review is True
        assert fb.category == "other"

    def test_from_dict_missing_keys(self):
        """from_dict() fills defaults for missing keys."""
        result = AutoAnswerResult.from_dict({})
        assert result.answer == ""
        assert result.confidence == 0.0
        assert result.needs_human_review is True
        assert result.category == "other"

    def test_validate_empty_returns_issues(self):
        """validate() returns issues for empty result."""
        result = AutoAnswerResult.fallback()
        issues = result.validate()
        assert len(issues) >= 1
        assert any("answer is empty" in i for i in issues)

    def test_validate_full_passes(self):
        """validate() returns empty list for complete result."""
        result = AutoAnswerResult(
            answer="You can set up webhooks in Settings > Integrations.",
            confidence=0.85,
            needs_human_review=False,
            category="configuration",
        )
        assert result.validate() == []

    def test_validate_low_confidence_warns(self):
        """validate() warns when confidence is below min threshold."""
        result = AutoAnswerResult(
            answer="Some answer",
            confidence=0.1,
            needs_human_review=True,
            category="other",
        )
        issues = result.validate()
        assert any("confidence" in i and "below min threshold" in i for i in issues)

    def test_validate_invalid_category(self):
        """validate() warns when category is not in allowed set."""
        result = AutoAnswerResult(
            answer="Some answer",
            confidence=0.5,
            needs_human_review=True,
            category="invalid_category",
        )
        issues = result.validate()
        assert any("category" in i for i in issues)

    def test_can_auto_post_true(self):
        """can_auto_post is True for high-confidence answers without review flag."""
        result = AutoAnswerResult(
            answer="Here is how to configure it.",
            confidence=0.85,
            needs_human_review=False,
            category="configuration",
        )
        assert result.can_auto_post

    def test_can_auto_post_false_empty_answer(self):
        """can_auto_post is False when answer is empty."""
        result = AutoAnswerResult(confidence=0.85, needs_human_review=False)
        assert not result.can_auto_post

    def test_can_auto_post_false_low_confidence(self):
        """can_auto_post is False when confidence is below threshold."""
        result = AutoAnswerResult(
            answer="Some answer",
            confidence=0.5,
            needs_human_review=False,
        )
        assert not result.can_auto_post

    def test_can_auto_post_false_needs_review(self):
        """can_auto_post is False when needs_human_review is True."""
        result = AutoAnswerResult(
            answer="Some answer",
            confidence=0.85,
            needs_human_review=True,
        )
        assert not result.can_auto_post


class TestBuildPrompt:
    """Tests for _build_prompt."""

    def test_basic_prompt(self):
        """Prompt includes question and context."""
        prompt = _build_prompt("How to setup webhooks?", "User is on pro tier")
        assert "How to setup webhooks?" in prompt
        assert "User is on pro tier" in prompt

    def test_template_placeholders(self):
        """Prompt template contains both placeholders."""
        assert "{question}" in AUTO_ANSWER_PROMPT_TEMPLATE
        assert "{context}" in AUTO_ANSWER_PROMPT_TEMPLATE


class TestParseLlmResponse:
    """Tests for _parse_llm_response."""

    def test_plain_json(self):
        """Plain JSON without fences is parsed."""
        raw = '{"answer": "Do X", "confidence": 0.8}'
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["answer"] == "Do X"
        assert result["confidence"] == 0.8

    def test_with_code_fences(self):
        """JSON inside triple backticks is extracted."""
        raw = "```json\n{\"answer\": \"Do X\", \"confidence\": 0.8}\n```"
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["answer"] == "Do X"

    def test_with_json_label(self):
        """JSON prefixed with 'json' label is handled."""
        raw = 'json\n{"answer": "Do X", "confidence": 0.8}'
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["answer"] == "Do X"

    def test_with_generic_fences(self):
        """Triple backticks without language label are handled."""
        raw = "```\n{\"answer\": \"Do X\", \"confidence\": 0.8}\n```"
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["answer"] == "Do X"

    def test_invalid_json_returns_none(self):
        """Malformed JSON returns None."""
        raw = "not json at all"
        result = _parse_llm_response(raw)
        assert result is None

    def test_empty_string_returns_none(self):
        """Empty input returns None."""
        assert _parse_llm_response("") is None

    def test_non_dict_json_returns_none(self):
        """Valid JSON that is not a dict returns None."""
        raw = "[1, 2, 3]"
        result = _parse_llm_response(raw)
        assert result is None


class TestValidateParsed:
    """Tests for _validate_parsed."""

    def test_basic_validation(self):
        """Valid input is returned as-is with correct types."""
        raw = {
            "answer": "Configure it like this.",
            "confidence": 0.85,
            "needs_human_review": False,
            "category": "configuration",
        }
        result = _validate_parsed(raw)
        assert result["answer"] == "Configure it like this."
        assert result["confidence"] == 0.85
        assert result["needs_human_review"] is False
        assert result["category"] == "configuration"

    def test_confidence_clamped_above(self):
        """Confidence > 1.0 is clamped to 1.0."""
        result = _validate_parsed({"confidence": 2.5})
        assert result["confidence"] == 1.0

    def test_confidence_clamped_below(self):
        """Confidence < 0.0 is clamped to 0.0."""
        result = _validate_parsed({"confidence": -1.0})
        assert result["confidence"] == 0.0

    def test_invalid_category_defaults_to_other(self):
        """Invalid category value defaults to 'other'."""
        result = _validate_parsed({"category": "unknown"})
        assert result["category"] == "other"

    def test_missing_fields_default(self):
        """Missing fields get empty defaults."""
        result = _validate_parsed({})
        assert result["answer"] == ""
        assert result["confidence"] == 0.0
        assert result["needs_human_review"] is True
        assert result["category"] == "other"


class TestAutoAnswer:
    """Tests for the main auto_answer function."""

    def test_empty_question_returns_fallback(self):
        """Empty question returns fallback with 0.0 confidence."""
        result = auto_answer(question="", context="")
        assert result.confidence == 0.0
        assert result.answer == ""

    def test_no_llm_client_returns_fallback(self):
        """When no API key is set, fallback is returned."""
        with patch.dict("os.environ", {}, clear=True):
            result = auto_answer(
                question="How do I set up webhooks?",
                context="User on pro tier",
            )
            assert result.confidence == 0.0
            assert result.answer == ""
            assert result.needs_human_review is True

    def test_llm_call_and_parse_success(self):
        """Successful LLM response is parsed and returned as AutoAnswerResult."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "answer": "You can set up webhooks in Settings > Integrations. "
                        "Go to your repo settings and add a webhook URL.",
                        "confidence": 0.85,
                        "needs_human_review": False,
                        "category": "configuration",
                    })
                )
            )
        ]

        with (
            patch("workers.support.auto_answer._get_llm_client") as mock_client_factory,
        ):
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="How do I set up webhooks?",
                context="User is on the pro tier.",
            )

        assert "Settings > Integrations" in result.answer
        assert result.confidence == 0.85
        assert result.needs_human_review is False
        assert result.category == "configuration"
        assert result.can_auto_post is True

    def test_llm_malformed_json_returns_fallback(self):
        """When LLM returns invalid JSON, fallback is returned."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="this is not json"))
        ]

        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="How do I set up webhooks?",
                context="Pro tier",
            )

        assert result.confidence == 0.0
        assert result.answer == ""

    def test_llm_exception_returns_fallback(self):
        """When LLM call raises an exception, fallback is returned."""
        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.side_effect = Exception("API down")
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="How do I set up webhooks?",
                context="Pro tier",
            )

        assert result.confidence == 0.0
        assert result.answer == ""

    def test_llm_call_uses_correct_model_params(self):
        """The LLM is called with the configured model and temperature."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "answer": "Do this.",
                        "confidence": 0.9,
                        "needs_human_review": False,
                        "category": "setup",
                    })
                )
            )
        ]

        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            auto_answer(
                question="How do I get started?",
                context="New user",
            )

            mock_client.chat.completions.create.assert_called_once()
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            assert call_kwargs["model"] == AUTO_ANSWER_MODEL
            assert call_kwargs["temperature"] == 0.0

    def test_low_confidence_result(self):
        """Low confidence result should not auto-post."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "answer": "I am not sure about this.",
                        "confidence": 0.25,
                        "needs_human_review": True,
                        "category": "other",
                    })
                )
            )
        ]

        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="Something complex and unclear",
                context="",
            )

        assert result.can_auto_post is False
        assert result.needs_human_review is True

    def test_context_included_in_prompt(self):
        """Context is passed to the LLM prompt."""
        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content="{}"))]
            )
            mock_client_factory.return_value = mock_client

            auto_answer(
                question="How to configure?",
                context="User is on enterprise tier with SSO enabled",
            )

            call_args = mock_client.chat.completions.create.call_args[1]
            prompt = call_args["messages"][0]["content"]
            assert "User is on enterprise tier with SSO enabled" in prompt


class TestEdgeCases:
    """Edge cases for the auto-answer module."""

    def test_code_fences_in_llm_response(self):
        """LLM response with code fences is properly parsed."""
        response_text = (
            "```json\n"
            "{\n"
            '  "answer": "Run `npm install` to get started.",\n'
            '  "confidence": 0.75,\n'
            '  "needs_human_review": false,\n'
            '  "category": "setup"\n'
            "}\n"
            "```"
        )
        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=response_text))]
            )
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="How do I install?",
                context="New user",
            )

        assert "npm install" in result.answer
        assert result.confidence == 0.75
        assert result.can_auto_post is True

    def test_billing_category_answer(self):
        """Billing questions are categorized correctly."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "answer": "Your plan is $49/month for 100 fixes.",
                        "confidence": 0.9,
                        "needs_human_review": False,
                        "category": "billing",
                    })
                )
            )
        ]

        with patch("workers.support.auto_answer._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = auto_answer(
                question="How much does Pro cost?",
                context="User asking about pricing",
            )

        assert result.category == "billing"
        assert result.can_auto_post is True


class TestModuleImports:
    """Tests that module-level exports work."""

    def test_module_imports(self):
        """Module imports without errors."""
        from workers.support import auto_answer as aa, AutoAnswerResult as AAR  # noqa: F401

        assert callable(aa)
        assert AAR is AutoAnswerResult

    def test_prompt_template_not_empty(self):
        """AUTO_ANSWER_PROMPT_TEMPLATE is a non-empty string with placeholders."""
        assert isinstance(AUTO_ANSWER_PROMPT_TEMPLATE, str)
        assert len(AUTO_ANSWER_PROMPT_TEMPLATE) > 50
        assert "{question}" in AUTO_ANSWER_PROMPT_TEMPLATE
        assert "{context}" in AUTO_ANSWER_PROMPT_TEMPLATE
