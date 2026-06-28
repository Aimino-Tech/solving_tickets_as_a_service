"""Tests for progressive pipeline-status comment builder."""
from __future__ import annotations
from typing import Any
import pytest
from workers.notifications.progressive import STAGE_ORDER, _build_collapsible_section, _progress_bar, build_progressive_comment
from workers.notifications.status_comments import STAGE_LABELS

class TestProgressBar:
    def test_zero(self): assert _progress_bar(0.0) == "\u2591"*20
    def test_fifty(self): bar = _progress_bar(0.5); assert bar.count("\u2588") == 10
    def test_hundred(self): assert _progress_bar(1.0) == "\u2588"*20

class TestBuildCollapsibleSection:
    def test_closed(self): r = _build_collapsible_section("S",[]); assert "<details>" in r
    def test_open(self): r = _build_collapsible_section("S",["b"],open=True); assert "<details open>" in r

class TestBuildProgressiveComment:
    def test_completed(self): b = build_progressive_comment("X",{"triage":{"stage":"triage","status":"completed","message":"P"}}); assert "done:" in b
    def test_started(self): b = build_progressive_comment("X",{"agent":{"stage":"agent","status":"started","message":"R","progress":0.6}}); assert "running:" in b; assert "60%" in b
    def test_failed(self): b = build_progressive_comment("X",{"triage":{"stage":"triage","status":"failed","message":"F","detail":"E!"}}); assert "failed:" in b; assert "E!" in b
    def test_mixed_order(self): b = build_progressive_comment("X",{"research":{"stage":"research","status":"started","message":"R"},"triage":{"stage":"triage","status":"completed","message":"P"}}); assert b.index("Triage") < b.index("Agent")
    def test_pending(self): b = build_progressive_comment("X",{"triage":{"stage":"triage","status":"completed","message":"P"}}); assert "pending:" in b
    def test_detail(self): b = build_progressive_comment("X",{"triage":{"stage":"triage","status":"completed","message":"D","detail":"Analysis"}}); assert "Analysis" in b

class TestStageOrder:
    def test_all_in_order(self):
        for s in STAGE_LABELS: assert s in STAGE_ORDER
    def test_no_dupes(self): assert len(STAGE_ORDER) == len(set(STAGE_ORDER))
