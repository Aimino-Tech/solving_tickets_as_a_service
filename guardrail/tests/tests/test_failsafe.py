"""
Tests for guardrail fail-safe behavior: ERROR logging, Prometheus counters, STRICT mode.
"""
import json
import os
import sys
import logging

import pytest

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError
from guardrail.metrics import record_counter, render_metrics, STRICT_MODE


def test_metrics_counter_increments():
    record_counter("guardrail_failures_total", 1, module="test_module")
    rendered = render_metrics()
    assert "guardrail_failures_total" in rendered
    assert "module=test_module" in rendered


def test_metrics_render_format():
    record_counter("guardrail_failures_total", 1, module="test_format")
    rendered = render_metrics()
    assert "# HELP guardrail_failures_total" in rendered
    assert "# TYPE guardrail_failures_total counter" in rendered


def test_metrics_multiple_labels():
    record_counter("guardrail_failures_total", 1, module="hook_a_unique")
    record_counter("guardrail_failures_total", 1, module="hook_b_unique")
    rendered = render_metrics()
    assert "module=hook_a_unique" in rendered
    assert "module=hook_b_unique" in rendered


def test_strict_mode_env_var(monkeypatch):
    monkeypatch.setenv("GUARDRAIL_STRICT_MODE", "true")
    import importlib
    import guardrail.metrics
    importlib.reload(guardrail.metrics)
    assert guardrail.metrics.STRICT_MODE is True


def test_strict_mode_default():
    assert STRICT_MODE is False


def test_post_call_logs_error_on_failure(caplog):
    caplog.set_level(logging.ERROR)
    g = SlopIntentGuardrail()
    import asyncio
    import litellm

    resp = litellm.ModelResponse(
        id="test", choices=[], created=0, model="test", object="chat.completion",
    )
    object.__setattr__(resp, "choices", None)

    asyncio.run(g.async_post_call_success_hook({}, None, resp))
    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert any("GUARDRAIL FAILURE" in r.message for r in error_records)


@pytest.mark.asyncio
async def test_streaming_logs_error_on_failure(caplog):
    caplog.set_level(logging.ERROR)
    g = SlopIntentGuardrail()

    async def bad_stream():
        raise RuntimeError("stream failure")
        yield None

    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, bad_stream(), {}):
        results.append(chunk)
    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
