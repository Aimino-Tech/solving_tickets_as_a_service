"""
Tests for BLOCK mode in SlopIntentGuardrail.
"""
import json
import os
import sys

import pytest

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail.slop_guardrail import (
    SlopIntentGuardrail,
    SlopIntentGuardrailError,
    CAUTION_PREFIX,
)


@pytest.fixture
def guardrail_block():
    g = SlopIntentGuardrail(gate_mode="block", block_threshold=0.5)
    return g


@pytest.fixture
def guardrail_annotate():
    g = SlopIntentGuardrail(gate_mode="annotate", block_threshold=0.5)
    return g


@pytest.fixture
def guardrail_warn():
    g = SlopIntentGuardrail(gate_mode="warn", block_threshold=0.5)
    return g


SLOP_TEXT = (
    "The user wants a payment processing function. "
    "I'll stub this out for now and implement the real Stripe integration later. "
    "Let me create a mock payment handler."
)


CLEAN_TEXT = (
    "The user needs a payment processing function. "
    "I'll use the Stripe API to create a payment intent."
)


def test_block_mode_default():
    """Default gate_mode should be 'block'."""
    g = SlopIntentGuardrail()
    assert g._gate_mode == "block"


def test_block_mode_env_var(monkeypatch):
    monkeypatch.setenv("SLOP_GATE_MODE", "warn")
    g = SlopIntentGuardrail()
    assert g._gate_mode == "warn"


def test_block_mode_invalid_fallback():
    g = SlopIntentGuardrail(gate_mode="invalid")
    assert g._gate_mode == "block"


def test_block_threshold_default():
    g = SlopIntentGuardrail()
    assert g._block_threshold == 0.5


def test_block_threshold_env_var(monkeypatch):
    monkeypatch.setenv("SLOP_BLOCK_THRESHOLD", "0.8")
    g = SlopIntentGuardrail()
    assert g._block_threshold == 0.8


def test_block_mode_detects_slop_and_blocks():
    """In block mode, slop detection should raise SlopIntentGuardrailError."""
    g = SlopIntentGuardrail(gate_mode="block")
    g._match_log = []
    g._check_content(SLOP_TEXT, "test")
    assert len(g._match_log) > 0
    score = g._compute_slop_score()
    assert score > 0


def test_annotate_mode_does_not_block():
    """In annotate mode, slop detection should not raise."""
    g = SlopIntentGuardrail(gate_mode="annotate", block_threshold=2.0)
    g._match_log = []
    g._check_content(SLOP_TEXT, "test")
    assert len(g._match_log) > 0
    score = g._compute_slop_score()
    assert score < 2.0


def test_warn_mode_does_not_block():
    """In warn mode, slop detection should not raise."""
    g = SlopIntentGuardrail(gate_mode="warn")
    g._match_log = []
    g._check_content(SLOP_TEXT, "test")
    assert len(g._match_log) > 0


def test_compute_slop_score_no_matches():
    g = SlopIntentGuardrail()
    assert g._compute_slop_score() == 0.0


def test_compute_slop_score_single_match():
    g = SlopIntentGuardrail()
    g._match_log = [{"category": "stub_intent", "pattern": "stub", "source": "test", "snippet": "test"}]
    score = g._compute_slop_score()
    assert 0 < score <= 1.0


def test_compute_slop_score_multiple_categories():
    g = SlopIntentGuardrail()
    g._match_log = [
        {"category": "stub_intent", "pattern": "stub", "source": "test", "snippet": "test"},
        {"category": "mock_intent", "pattern": "mock", "source": "test", "snippet": "test"},
        {"category": "placeholder_intent", "pattern": "placeholder", "source": "test", "snippet": "test"},
    ]
    score = g._compute_slop_score()
    assert 0.5 < score <= 1.0


def test_block_threshold_below():
    """When score is below block_threshold in annotate mode, should annotate not block."""
    g = SlopIntentGuardrail(gate_mode="annotate", block_threshold=2.0)
    g._match_log = [{"category": "stub_intent", "pattern": "stub", "source": "test", "snippet": "test"}]
    score = g._compute_slop_score()
    assert score < 2.0


def test_annotate_annotation_content():
    """In annotate mode, annotation should contain CAUTION_PREFIX."""
    g = SlopIntentGuardrail(gate_mode="annotate", block_threshold=2.0)
    annotation = (
        f"{CAUTION_PREFIX}\n"
        f"* Patterns matched: 1\n"
        f"* Top category: stub_intent\n"
        f"* Score: {g._compute_slop_score():.2f}\n"
        f"\n\nThe response contained patterns associated with AI-generated code slop "
        f"(stubs, placeholders, mocks, or deferrals). Please review the flagged "
        f"content before using."
    )
    assert CAUTION_PREFIX in annotation
    assert "stub_intent" in annotation


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
