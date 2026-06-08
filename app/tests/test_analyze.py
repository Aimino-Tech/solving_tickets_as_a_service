import pytest
from analyze import (
    AnalysisResult, analyze_items, prioritize_results,
    _fallback_analysis, _build_input_text,
)
from backoff import BACKOFF_SECONDS


def test_analysis_result_to_dict():
    r = AnalysisResult("id1", 80, "positive", 75, "today")
    d = r.to_dict()
    assert d["id"] == "id1"
    assert d["relevance"] == 80
    assert d["sentiment"] == "positive"
    assert d["opportunity"] == 75
    assert d["urgency"] == "today"


def test_analyze_items_empty():
    results = analyze_items([])
    assert results == []


def test_analyze_items_fallback_mcp_keyword():
    items = [{"id": "1", "content_snippet": "I love using MCP tools for development!"}]
    results = analyze_items(items)
    assert len(results) == 1
    assert results[0].relevance >= 80


def test_analyze_items_fallback_opensource_keyword():
    items = [{"id": "2", "content_snippet": "Open source devtools are amazing"}]
    results = analyze_items(items)
    assert len(results) == 1
    assert results[0].relevance >= 60


def test_analyze_items_fallback_irrelevant():
    items = [{"id": "3", "content_snippet": "What's for lunch today?"}]
    results = analyze_items(items)
    assert len(results) == 1
    assert results[0].relevance == 50


def test_analyze_items_positive_sentiment():
    items = [{"id": "4", "content_snippet": "This MCP tool is amazing and helpful!"}]
    results = analyze_items(items)
    assert results[0].sentiment == "positive"
    assert results[0].urgency in ("immediate", "today")


def test_analyze_items_negative_sentiment():
    items = [{"id": "5", "content_snippet": "This terrible tool is completely useless"}]
    results = analyze_items(items)
    assert results[0].sentiment == "negative"


def test_prioritize_results_immediate_first():
    results = [
        AnalysisResult("batch", 50, "neutral", 50, "batch"),
        AnalysisResult("immediate", 90, "positive", 85, "immediate"),
        AnalysisResult("today", 70, "neutral", 60, "today"),
    ]
    prioritized = prioritize_results(results)
    assert prioritized[0].item_id == "immediate"
    assert prioritized[1].item_id == "today"
    assert prioritized[2].item_id == "batch"


def test_prioritize_results_same_urgency_higher_relevance_first():
    results = [
        AnalysisResult("low", 50, "neutral", 50, "today"),
        AnalysisResult("high", 90, "positive", 85, "today"),
    ]
    prioritized = prioritize_results(results)
    assert prioritized[0].item_id == "high"


def test_prioritize_results_same_relevance_higher_opportunity_first():
    results = [
        AnalysisResult("low_opp", 80, "positive", 60, "immediate"),
        AnalysisResult("high_opp", 80, "positive", 90, "immediate"),
    ]
    prioritized = prioritize_results(results)
    assert prioritized[0].item_id == "high_opp"


def test_build_input_text():
    items = [
        {"id": "1", "platform": "reddit", "content_snippet": "MCP tools are great"},
        {"id": "2", "platform": "telegram", "content_snippet": "Check out this opensource project"},
    ]
    text = _build_input_text(items)
    assert "ID:1" in text
    assert "Platform:reddit" in text
    assert "ID:2" in text
    assert "Platform:telegram" in text


def test_fallback_analysis_consistency():
    items = [
        {"id": "1", "content_snippet": "MCP tool"},
        {"id": "2", "content_snippet": "random chat"},
    ]
    first = _fallback_analysis(items)
    second = _fallback_analysis(items)
    assert first == second


def test_fallback_analysis_count():
    items = [{"id": str(i), "content_snippet": f"item {i}"} for i in range(5)]
    scores = _fallback_analysis(items)
    assert len(scores) == 5


def test_analysis_all_dimensions_present():
    items = [{"id": "1", "content_snippet": "MCP open-source"}]
    results = analyze_items(items)
    assert results[0].relevance is not None
    assert results[0].sentiment is not None
    assert results[0].opportunity is not None
    assert results[0].urgency is not None
