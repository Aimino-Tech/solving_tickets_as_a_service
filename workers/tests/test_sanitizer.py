"""Tests for agent output sanitizer."""

import time
import pytest
from workers.gates.sanitizer import (
    Sanitizer, SanitizerConfig, SanitizerResult,
    get_sanitizer, sanitize_agent_output,
)


@pytest.fixture
def sanitizer() -> Sanitizer:
    return Sanitizer()


@pytest.fixture
def clean_text() -> str:
    return "The login button is not working on Chrome. Please fix the CSS."


class TestSanitizeApiKeys:
    def test_openai_sk_key_redacted(self, sanitizer):
        text = "My API key is sk-abc123def456ghi789jkl01234567890 and it's secret."
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert "sk-abc123def456ghi789jkl01234567890" not in result.sanitized_text
        assert result.replaced_count >= 1
        assert "openai_sk" in result.patterns_matched

    def test_openai_proj_key_redacted(self, sanitizer):
        text = "OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl01234567890"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert result.replaced_count >= 1
        assert "openai_proj" in result.patterns_matched

    def test_clean_text_not_affected(self, sanitizer, clean_text):
        result = sanitizer.sanitize(clean_text)
        assert result.sanitized_text == clean_text
        assert result.replaced_count == 0
        assert result.patterns_matched == []

    def test_multiple_api_keys_all_redacted(self, sanitizer):
        text = "Key1: sk-abc123def456ghi789jkl01234567890 and Key2: ghp_abc123def456ghi789jkl01234567890abcdefghijklm"
        result = sanitizer.sanitize(text)
        assert result.replaced_count >= 2

    def test_pk_key_redacted(self, sanitizer):
        text = "Anthropic key: pk-abc123def456ghi789jkl01234567890"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert "pk_key" in result.patterns_matched

    def test_aws_key_redacted(self, sanitizer):
        text = "AWS key: AKIAIOSFODNN7EXAMPLE"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert "aws_key" in result.patterns_matched

    def test_jwt_token_redacted(self, sanitizer):
        text = "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert "jwt_token" in result.patterns_matched


class TestSanitizeInternalUrls:
    def test_internal_hostname_redacted(self, sanitizer):
        text = "Check the dashboard at https://monitoring.internal:9090/prometheus"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_URL]" in result.sanitized_text
        assert "internal_host" in result.patterns_matched

    def test_localhost_url_redacted(self, sanitizer):
        text = "OpenCode is running at http://localhost:4096"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_URL]" in result.sanitized_text
        assert "localhost" in result.patterns_matched

    def test_github_com_url_not_redacted(self, sanitizer):
        text = "See the PR at https://github.com/owner/repo/pull/123"
        result = sanitizer.sanitize(text)
        assert "github.com" in result.sanitized_text
        assert result.replaced_count == 0


class TestSanitizeSystemPrompts:
    def test_you_are_ai_redacted(self, sanitizer):
        text = "You are a helpful assistant that can read files and execute commands."
        result = sanitizer.sanitize(text)
        assert "[REDACTED_SYSTEM_PROMPT]" in result.sanitized_text
        assert "you_are_ai" in result.patterns_matched

    def test_normal_descriptions_not_flagged(self, sanitizer):
        text = "The fix adds a new validation endpoint."
        result = sanitizer.sanitize(text)
        assert result.replaced_count == 0


class TestSanitizeFilePaths:
    def test_etc_path_redacted(self, sanitizer):
        text = "Check the config in /etc/nginx/nginx.conf"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_PATH]" in result.sanitized_text
        assert "abs_etc" in result.patterns_matched

    def test_env_file_redacted(self, sanitizer):
        text = "Load credentials from .env.production"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_PATH]" in result.sanitized_text
        assert "env_file" in result.patterns_matched

    def test_relative_paths_not_redacted(self, sanitizer):
        text = "The fix is in src/components/Button.tsx"
        result = sanitizer.sanitize(text)
        assert result.replaced_count == 0


class TestSanitizeEnvVars:
    def test_process_env_redacted(self, sanitizer):
        text = "The key is process.env.DATABASE_URL"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_ENV_VAR]" in result.sanitized_text
        assert "process_env" in result.patterns_matched

    def test_os_getenv_redacted(self, sanitizer):
        text = "db_url = os.environ.get('DATABASE_URL')"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_ENV_VAR]" in result.sanitized_text
        assert "os_environ" in result.patterns_matched


class TestSanitizeInternalIps:
    def test_rfc1918_10_redacted(self, sanitizer):
        text = "Server at 10.0.0.5"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_INTERNAL_IP]" in result.sanitized_text
        assert "rfc1918_10" in result.patterns_matched

    def test_public_ip_not_redacted(self, sanitizer):
        text = "Server at 8.8.8.8"
        result = sanitizer.sanitize(text)
        assert result.replaced_count == 0


class TestAllowlist:
    def test_allowlist_suppresses_pattern(self):
        config = SanitizerConfig(allowlist="localhost")
        s = Sanitizer(config=config)
        text = "Key sk-abc123def456ghi789jkl01234567890 at http://localhost:3000"
        result = s.sanitize(text)
        assert "localhost" in result.sanitized_text
        assert "[REDACTED_API_KEY]" in result.sanitized_text


class TestSanitizerConfig:
    def test_default_enabled(self):
        config = SanitizerConfig()
        assert config.enabled is True

    def test_enabled_via_env(self, monkeypatch):
        monkeypatch.setenv("STAS_SANITIZER_ENABLED", "false")
        config = SanitizerConfig()
        assert config.enabled is False


class TestSanitizerResult:
    def test_to_dict(self):
        result = SanitizerResult("clean text", 2, ["openai_sk"], {"api_keys": 1}, 1.234)
        d = result.to_dict()
        assert d["replaced_count"] == 2
        assert d["scan_duration_ms"] == 1.2

    def test_repr(self):
        result = SanitizerResult("x", 1, ["test"], {"test_cat": 1}, 5.0)
        assert "SanitizerResult" in repr(result)


class TestSanitizerDisabled:
    def test_disabled_returns_original(self):
        config = SanitizerConfig()
        config.enabled = False
        s = Sanitizer(config=config)
        text = "My key is sk-abc123def456ghi789jkl01234567890"
        result = s.sanitize(text)
        assert result.sanitized_text == text
        assert result.replaced_count == 0


class TestSanitizeDiff:
    def test_sanitize_diff_works(self, sanitizer):
        diff = 'const API_KEY = "sk-abc123def456ghi789jkl01234567890";'
        result = sanitizer.sanitize_diff(diff)
        assert "[REDACTED_API_KEY]" in result.sanitized_text


class TestSanitizeAgentOutputCeleryTask:
    def test_sanitizes_summary_field(self):
        fix_result = {
            "summary": "Fixed using key sk-abc123def456ghi789jkl01234567890",
            "branch": "fix/login-bug",
        }
        result = sanitize_agent_output(fix_result)
        assert "[REDACTED_API_KEY]" in result["summary"]
        assert "_sanitized" in result
        assert "summary" in result["_sanitized"]["fields_sanitized"]

    def test_sanitizes_nested_comments(self):
        fix_result = {
            "comments": {
                "status_update": "Running on http://stas-worker-1.internal:9090",
                "review_comment": "Looks good to me",
            },
        }
        result = sanitize_agent_output(fix_result)
        assert "[REDACTED_URL]" in result["comments"]["status_update"]
        assert result["comments"]["review_comment"] == "Looks good to me"

    def test_sanitizes_comment_list(self):
        fix_result = {
            "comment_bodies": [
                "Starting fix with key sk-abc123def456ghi789jkl01234567890",
                "Fix completed",
            ],
        }
        result = sanitize_agent_output(fix_result)
        assert "[REDACTED_API_KEY]" in result["comment_bodies"][0]
        assert result["comment_bodies"][1] == "Fix completed"

    def test_clean_output_no_sanitization(self):
        fix_result = {"summary": "Fixed login validation bug", "diff": "+console.log('hello');"}
        result = sanitize_agent_output(fix_result)
        assert result["_sanitized"]["total_replacements"] == 0

    def test_preserves_non_text_fields(self):
        fix_result = {"summary": "Fixed", "score": 0.95, "passed": True}
        result = sanitize_agent_output(fix_result)
        assert result["score"] == 0.95
        assert result["passed"] is True


class TestMultiCategorySanitization:
    def test_api_key_and_url_both_sanitized(self, sanitizer):
        text = "Connect to http://10.0.0.5:5432 using sk-abc123def456ghi789jkl01234567890"
        result = sanitizer.sanitize(text)
        assert "[REDACTED_API_KEY]" in result.sanitized_text
        assert "[REDACTED_URL]" in result.sanitized_text or "[REDACTED_INTERNAL_IP]" in result.sanitized_text
        assert "api_keys" in result.categories_matched


class TestPerformance:
    def test_sanitize_under_100ms(self, sanitizer):
        text = "This is a benign description. " * 200
        text += "Key: sk-abc123def456ghi789jkl01234567890. " * 10
        start = time.perf_counter()
        for _ in range(10):
            sanitizer.sanitize(text)
        elapsed = (time.perf_counter() - start) * 1000
        assert elapsed / 10 < 100

    def test_large_text_under_100ms(self, sanitizer):
        text = "No secrets here. " * 5000
        start = time.perf_counter()
        for _ in range(5):
            sanitizer.sanitize(text)
        elapsed = (time.perf_counter() - start) * 1000
        assert elapsed / 5 < 100


class TestFalsePositiveRate:
    BENIGN_TEXTS = [
        "The login page throws a 500 error when the email contains special characters.",
        "Feature request: Add pagination to the search results endpoint.",
        "The logout button does not work on Safari.",
        "Fixed the bug in the user authentication flow.",
        "Refactored the database connection pool to use PgBouncer.",
    ]

    def test_false_positive_rate_below_one_percent(self, sanitizer):
        fps = sum(1 for t in self.BENIGN_TEXTS if sanitizer.sanitize(t).replaced_count > 0)
        assert fps / len(self.BENIGN_TEXTS) < 0.01


class TestGetSanitizer:
    def test_get_sanitizer_returns_instance(self):
        assert isinstance(get_sanitizer(), Sanitizer)

    def test_get_sanitizer_is_singleton(self):
        assert get_sanitizer() is get_sanitizer()
