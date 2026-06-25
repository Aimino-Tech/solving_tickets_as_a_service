import os
import subprocess
import sys

import pytest

from workers.sandbox.env_sanitizer import SanitizedEnvironment, ALWAYS_ALLOWED


def test_sensitive_vars_stripped():
    os.environ["OPENAI_API_KEY"] = "sk-fake"
    os.environ["AWS_SECRET_KEY"] = "aws-fake"
    env = SanitizedEnvironment.build()
    assert "OPENAI_API_KEY" not in env
    assert "AWS_SECRET_KEY" not in env


def test_allowlisted_var_present():
    os.environ["LINEAR_API_KEY"] = "lin-real"
    env = SanitizedEnvironment.build(allowlist={"LINEAR_API_KEY"})
    assert env.get("LINEAR_API_KEY") == "lin-real"


def test_always_allowed_present():
    os.environ["PATH"] = "/usr/bin:/bin"
    os.environ["HOME"] = "/home/test"
    os.environ["USER"] = "testuser"
    env = SanitizedEnvironment.build()
    assert "PATH" in env
    assert "HOME" in env
    assert "USER" in env


def test_agent_env_isolated():
    os.environ["STAS_SECRET"] = "should-not-leak"
    clean = SanitizedEnvironment.build()
    assert "STAS_SECRET" not in clean


def test_subprocess_gets_clean_env():
    os.environ["SECRET_TOKEN"] = "super-secret"
    os.environ["PATH"] = "/usr/bin"
    clean = SanitizedEnvironment.build()
    result = subprocess.run(
        [sys.executable, "-c", "import os; print('SECRET_TOKEN' in os.environ)"],
        env=clean,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert "False" in result.stdout


def test_build_subprocess_with_allowlist_file(tmp_path):
    allowlist_file = tmp_path / "allowlist.txt"
    allowlist_file.write_text("MY_CUSTOM_KEY\nANOTHER_KEY\n")
    os.environ["MY_CUSTOM_KEY"] = "custom-value"
    os.environ["ANOTHER_KEY"] = "another-value"
    os.environ["STRIPE_API_KEY"] = "sk-test"
    env = SanitizedEnvironment.build_for_subprocess(str(allowlist_file))
    assert env.get("MY_CUSTOM_KEY") == "custom-value"
    assert env.get("ANOTHER_KEY") == "another-value"
    assert "STRIPE_API_KEY" not in env


def test_blocklist_patterns_case_insensitive():
    os.environ["github_token"] = "ghp_fake"
    os.environ["Database_Url"] = "postgres://fake"
    env = SanitizedEnvironment.build()
    assert "github_token" not in env
    assert "Database_Url" not in env


def test_env_sanitizer_runs_under_5ms():
    import time
    os.environ["TEST_VAR_1"] = "value1"
    os.environ["TEST_VAR_2"] = "value2"
    start = time.perf_counter()
    for _ in range(100):
        SanitizedEnvironment.build()
    elapsed_ms = (time.perf_counter() - start) * 10
    assert elapsed_ms < 5.0


def test_all_20_sensitive_vars_stripped():
    sensitive_vars = [
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
        "AZURE_CLIENT_SECRET", "GCP_SERVICE_ACCOUNT_KEY",
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
        "DATABASE_URL", "REDIS_URL", "RABBITMQ_URL",
        "STRIPE_SECRET_KEY", "BROKER_URL",
        "API_KEY", "AUTH_TOKEN", "SECRET_KEY",
        "PASSWORD", "CREDENTIALS",
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
        "LINEAR_API_KEY",
    ]
    for v in sensitive_vars:
        os.environ[v] = f"test-{v}"
    env = SanitizedEnvironment.build(allowlist={"LINEAR_API_KEY"})
    for v in sensitive_vars:
        if v == "LINEAR_API_KEY":
            assert v in env, f"{v} should be in env (allowlisted)"
        else:
            assert v not in env, f"{v} should not be in env"


def test_allowlist_defaults_to_empty():
    env = SanitizedEnvironment.build()
    for key in env:
        assert key in ALWAYS_ALLOWED or not any(
            p.search(key) for p in __import__("workers.sandbox.env_sanitizer", fromlist=["BLOCKLIST_PATTERNS"]).BLOCKLIST_PATTERNS
        ), f"{key} should not be in env"
