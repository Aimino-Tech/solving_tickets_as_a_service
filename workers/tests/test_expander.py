"""Tests for the workers/triage/expander module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from workers.triage.expander import (
    _build_prompt,
    _keyword_fallback,
    _parse_llm_response,
    _validate_parsed,
    expand_issue,
)
from workers.triage.expander_config import (
    EXPANSION_PROMPT_TEMPLATE,
    EXPANDER_MODEL,
    EXPANDER_TEMPERATURE,
    ExpansionResult,
    get_config,
)


class TestExpansionResult:
    """Tests for the ExpansionResult dataclass."""

    def test_to_dict_roundtrip(self):
        """to_dict() then from_dict() produces the same object."""
        original = ExpansionResult(
            summary="Fix login bug",
            context="Login fails with special chars",
            acceptance_criteria=["AC1", "AC2"],
            implementation_plan=["Step 1", "Step 2"],
            test_spec=["Test 1"],
            confidence=0.85,
            estimated_effort="small",
        )
        d = original.to_dict()
        restored = ExpansionResult.from_dict(d)
        assert restored.summary == original.summary
        assert restored.context == original.context
        assert restored.acceptance_criteria == original.acceptance_criteria
        assert restored.implementation_plan == original.implementation_plan
        assert restored.test_spec == original.test_spec
        assert restored.confidence == original.confidence
        assert restored.estimated_effort == original.estimated_effort

    def test_fallback_returns_zero_confidence(self):
        """fallback() returns empty fields with 0.0 confidence."""
        fb = ExpansionResult.fallback()
        assert fb.summary == ""
        assert fb.context == ""
        assert fb.acceptance_criteria == []
        assert fb.implementation_plan == []
        assert fb.test_spec == []
        assert fb.confidence == 0.0
        assert fb.estimated_effort == "medium"

    def test_from_dict_missing_keys(self):
        """from_dict() fills defaults for missing keys."""
        result = ExpansionResult.from_dict({})
        assert result.summary == ""
        assert result.context == ""
        assert result.acceptance_criteria == []
        assert result.confidence == 0.0
        assert result.estimated_effort == "medium"

    def test_validate_empty_returns_issues(self):
        """validate() returns issues for empty result."""
        result = ExpansionResult.fallback()
        issues = result.validate()
        assert len(issues) >= 4  # multiple issues
        assert any("summary" in i for i in issues)
        assert any("acceptance_criteria" in i for i in issues)

    def test_validate_full_passes(self):
        """validate() returns empty list for complete result."""
        result = ExpansionResult(
            summary="Fix login bug",
            context="Users cannot login with special chars",
            acceptance_criteria=["AC1", "AC2", "AC3"],
            implementation_plan=["Step 1", "Step 2"],
            test_spec=["Test 1"],
            confidence=0.85,
            estimated_effort="small",
        )
        assert result.validate() == []

    def test_validate_few_acs_warns(self):
        """validate() warns when fewer than 3 acceptance criteria."""
        result = ExpansionResult(
            summary="Fix",
            context="Context",
            acceptance_criteria=["Only AC"],
            implementation_plan=["Step 1"],
            test_spec=["Test 1"],
            confidence=0.5,
            estimated_effort="small",
        )
        issues = result.validate()
        assert any("acceptance_criteria has only 1" in i for i in issues)

    def test_is_actionable_true(self):
        """is_actionable is True for well-formed result with confidence >= 0.3."""
        result = ExpansionResult(
            summary="Fix",
            context="Context",
            acceptance_criteria=["AC1"],
            implementation_plan=["Step 1"],
            test_spec=["Test 1"],
            confidence=0.5,
        )
        assert result.is_actionable

    def test_is_actionable_false_empty_summary(self):
        """is_actionable is False when summary is empty."""
        result = ExpansionResult(confidence=0.5)
        assert not result.is_actionable

    def test_is_actionable_false_low_confidence(self):
        """is_actionable is False when confidence < 0.3."""
        result = ExpansionResult(summary="Fix", confidence=0.1)
        assert not result.is_actionable

    def test_is_actionable_false_no_acs(self):
        """is_actionable is False when acceptance_criteria is empty."""
        result = ExpansionResult(summary="Fix", confidence=0.5)
        assert not result.is_actionable


class TestBuildPrompt:
    """Tests for _build_prompt."""

    def test_basic_prompt(self):
        """Prompt includes title and body."""
        prompt = _build_prompt("Fix bug", "Broken thing", "")
        assert "Fix bug" in prompt
        assert "Broken thing" in prompt

    def test_with_extra_context(self):
        """Extra context is included in prompt."""
        prompt = _build_prompt("Fix", "Body", extra_context="Logs: error")
        assert "Logs: error" in prompt

    def test_template_placeholders(self):
        """Prompt template contains the description placeholder."""
        prompt = _build_prompt("Test", "Description", "")
        assert "Description" in prompt


class TestParseLlmResponse:
    """Tests for _parse_llm_response."""

    def test_plain_json(self):
        """Plain JSON without fences is parsed."""
        raw = '{"summary": "Fix"}'
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["summary"] == "Fix"

    def test_with_code_fences(self):
        """JSON inside triple backticks is extracted."""
        raw = "```json\n{\"summary\": \"Fix\"}\n```"
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["summary"] == "Fix"

    def test_with_json_label(self):
        """JSON prefixed with 'json' label is handled."""
        raw = 'json\n{"summary": "Fix"}'
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["summary"] == "Fix"

    def test_with_generic_fences(self):
        """Triple backticks without language label are handled."""
        raw = "```\n{\"summary\": \"Fix\"}\n```"
        result = _parse_llm_response(raw)
        assert result is not None
        assert result["summary"] == "Fix"

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

    def test_noop_fences_no_json_inside(self):
        """Fences with no JSON inside return None."""
        raw = "```\njust some text\n```"
        result = _parse_llm_response(raw)
        assert result is None


class TestValidateParsed:
    """Tests for _validate_parsed."""

    def test_basic_validation(self):
        """Valid input is returned as-is with correct types."""
        raw = {
            "summary": "Fix bug",
            "context": "Some context",
            "acceptance_criteria": ["AC1", "AC2"],
            "implementation_plan": ["Step 1"],
            "test_spec": ["Test 1"],
            "confidence": 0.8,
            "estimated_effort": "small",
        }
        result = _validate_parsed(raw)
        assert result["summary"] == "Fix bug"
        assert result["estimated_effort"] == "small"
        assert result["confidence"] == 0.8

    def test_confidence_clamped_above(self):
        """Confidence > 1.0 is clamped to 1.0."""
        result = _validate_parsed({"confidence": 2.5})
        assert result["confidence"] == 1.0

    def test_confidence_clamped_below(self):
        """Confidence < 0.0 is clamped to 0.0."""
        result = _validate_parsed({"confidence": -1.0})
        assert result["confidence"] == 0.0

    def test_invalid_effort_defaults_to_medium(self):
        """Invalid estimated_effort value defaults to 'medium'."""
        result = _validate_parsed({"estimated_effort": "extreme"})
        assert result["estimated_effort"] == "medium"

    def test_missing_fields_default(self):
        """Missing fields get empty defaults."""
        result = _validate_parsed({})
        assert result["summary"] == ""
        assert result["acceptance_criteria"] == []
        assert result["implementation_plan"] == []
        assert result["test_spec"] == []
        assert result["confidence"] == 0.0
        assert result["estimated_effort"] == "medium"


class TestKeywordFallback:
    """Tests for _keyword_fallback."""

    def test_error_keywords_produce_small_effort(self):
        """Error-related keywords produce 'small' effort and error ACs."""
        result = _keyword_fallback(title="Fix crash in parser", body="")
        assert result.estimated_effort == "small"
        assert len(result.acceptance_criteria) >= 2
        assert len(result.implementation_plan) >= 2
        assert result.confidence == 0.2

    def test_feature_keywords_produce_medium_effort(self):
        """Feature-related keywords produce 'medium' effort."""
        result = _keyword_fallback(title="Add new dashboard widget", body="")
        assert result.estimated_effort == "medium"
        assert len(result.acceptance_criteria) >= 2

    def test_unknown_keywords_still_produce_result(self):
        """No matching keywords still produces a sensible fallback."""
        result = _keyword_fallback(title="Random thing", body="")
        assert result.confidence == 0.2
        assert len(result.acceptance_criteria) >= 1
        assert result.estimated_effort == "medium"

    def test_empty_title_uses_fallback_summary(self):
        """Empty title gets a default summary."""
        result = _keyword_fallback(title="", body="")
        assert result.summary != ""


class TestExpandIssue:
    """Tests for the main expand_issue function."""

    def test_empty_input_returns_fallback(self):
        """Empty title and body returns fallback with 0.0 confidence."""
        result = expand_issue(title="", body="")
        assert result.confidence == 0.0
        assert result.summary == ""

    def test_no_llm_client_returns_keyword_fallback(self):
        """When no API key is set, keyword fallback is used (auto_heal=True)."""
        with patch.dict("os.environ", {}, clear=True):
            result = expand_issue(title="Fix something", body="It is broken")
            assert result.confidence == 0.2
            assert len(result.acceptance_criteria) >= 1

    def test_no_llm_client_auto_heal_false_returns_empty(self):
        """When auto_heal=False and no LLM, returns empty fallback."""
        with patch.dict("os.environ", {}, clear=True):
            result = expand_issue(title="Fix", body="Broken", auto_heal=False)
            assert result.confidence == 0.0
            assert result.summary == ""

    def test_llm_call_and_parse_success(self):
        """Successful LLM response is parsed and returned as ExpansionResult."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "summary": "Fix login validation",
                        "context": "The login endpoint fails with special chars",
                        "acceptance_criteria": [
                            "Given a user with + in email, When POST /login, Then return 200",
                            "All existing tests pass",
                        ],
                        "implementation_plan": [
                            "Add input sanitization",
                            "Add regression test",
                        ],
                        "test_spec": [
                            "Test special chars in email",
                        ],
                        "confidence": 0.85,
                        "estimated_effort": "small",
                    })
                )
            )
        ]

        with (
            patch("workers.triage.expander._get_llm_client") as mock_client_factory,
        ):
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = expand_issue(
                title="Login breaks on special chars",
                body="The login endpoint returns 500 when email has + sign.",
            )

        assert result.summary == "Fix login validation"
        assert result.context == "The login endpoint fails with special chars"
        assert len(result.acceptance_criteria) == 2
        assert len(result.implementation_plan) == 2
        assert len(result.test_spec) == 1
        assert result.confidence == 0.85
        assert result.estimated_effort == "small"

    def test_llm_malformed_json_returns_fallback(self):
        """When LLM returns invalid JSON, keyword fallback is used."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="this is not json"))
        ]

        with patch("workers.triage.expander._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            result = expand_issue(title="Fix", body="Broken")

        assert result.confidence == 0.2  # keyword fallback

    def test_llm_exception_returns_fallback(self):
        """When LLM call raises an exception, keyword fallback is used."""
        with patch("workers.triage.expander._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.side_effect = Exception("API down")
            mock_client_factory.return_value = mock_client

            result = expand_issue(title="Fix", body="Broken")

        assert result.confidence == 0.2  # keyword fallback

    def test_llm_call_uses_correct_model_params(self):
        """The LLM is called with the configured model and temperature."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "summary": "Fix",
                        "context": "",
                        "acceptance_criteria": ["AC1"],
                        "implementation_plan": ["Step 1"],
                        "test_spec": ["Test 1"],
                        "confidence": 0.9,
                        "estimated_effort": "small",
                    })
                )
            )
        ]

        with patch("workers.triage.expander._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_client_factory.return_value = mock_client

            expand_issue(title="Fix", body="Broken")

            mock_client.chat.completions.create.assert_called_once()
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            assert call_kwargs["model"] == EXPANDER_MODEL
            assert call_kwargs["temperature"] == EXPANDER_TEMPERATURE

    def test_extra_context_included_in_prompt(self):
        """Extra context is passed to the LLM prompt."""
        with patch("workers.triage.expander._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content="{}"))]
            )
            mock_client_factory.return_value = mock_client

            expand_issue(
                title="Fix",
                body="Broken",
                extra_context="Relevant log output here",
            )

            call_args = mock_client.chat.completions.create.call_args[1]
            prompt = call_args["messages"][0]["content"]
            assert "Relevant log output here" in prompt


class TestConfig:
    """Tests for expander_config."""

    def test_get_config_returns_dict(self):
        """get_config() returns a dict with expected keys."""
        cfg = get_config()
        assert "model" in cfg
        assert "temperature" in cfg
        assert "thresholds" in cfg
        assert cfg["model"] == EXPANDER_MODEL

    def test_template_not_empty(self):
        """EXPANSION_PROMPT_TEMPLATE is a non-empty string."""
        assert isinstance(EXPANSION_PROMPT_TEMPLATE, str)
        assert len(EXPANSION_PROMPT_TEMPLATE) > 50
        assert "{description}" in EXPANSION_PROMPT_TEMPLATE

    def test_module_imports(self):
        """Module imports without errors."""
        from workers.triage import expand_issue as ei, ExpansionResult as Er  # noqa: F401

        assert callable(ei)
        assert Er is ExpansionResult


class TestEdgeCases:
    """Edge cases for the expander."""

    def test_code_fences_in_llm_response(self):
        """LLM response with code fences is properly parsed."""
        response_text = (
            "```json\n"
            "{\n"
            '  "summary": "Fix validation",\n'
            '  "acceptance_criteria": ["AC1"],\n'
            '  "implementation_plan": ["Step 1"],\n'
            '  "test_spec": ["Test 1"],\n'
            '  "confidence": 0.75,\n'
            '  "estimated_effort": "medium"\n'
            "}\n"
            "```"
        )
        with patch("workers.triage.expander._get_llm_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=response_text))]
            )
            mock_client_factory.return_value = mock_client

            result = expand_issue(title="Fix", body="Issue")

        assert result.summary == "Fix validation"
        assert result.confidence == 0.75
