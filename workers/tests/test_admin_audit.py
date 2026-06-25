"""Tests for the admin actions audit trail module."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from workers.audit.admin_trail import (
    clear_log, count_admin_actions, export_admin_actions_csv,
    export_admin_actions_json, log_admin_action, query_admin_actions,
)


@pytest.fixture
def log_path() -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        yield os.path.join(tmpdir, "admin-audit.jsonl")


class TestLogAdminAction:
    def test_appends_entry(self, log_path):
        entry = log_admin_action("admin", "pause", "p1", log_path=log_path)
        assert entry["actor"] == "admin" and entry["action"] == "pause"
        assert len(entry["id"]) == 32 and "timestamp" in entry

    def test_writes_to_file(self, log_path):
        log_admin_action("admin", "pause", "p1", log_path=log_path)
        with open(log_path) as f:
            assert json.loads(f.readline())["actor"] == "admin"

    def test_append_only(self, log_path):
        log_admin_action("a", "pause", "p1", log_path=log_path)
        log_admin_action("b", "resume", "p2", log_path=log_path)
        with open(log_path) as f:
            assert len(f.readlines()) == 2

    def test_with_details(self, log_path):
        log_admin_action("admin", "config.change", "c:r", {"old":"100","new":"200"}, log_path=log_path)
        with open(log_path) as f:
            assert json.loads(f.readline())["details"]["old"] == "100"

    def test_returns_entry_on_write_failure(self):
        e = log_admin_action("admin","test","r", log_path="/nope/x/y/z.jsonl")
        assert e["actor"] == "admin"


class TestQueryAdminActions:
    def test_newest_first(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        log_admin_action("a","resume","p1",log_path=log_path)
        assert query_admin_actions(log_path=log_path)[0]["action"] == "resume"

    def test_empty(self, log_path):
        assert query_admin_actions(log_path=log_path) == []

    def test_nonexistent_file(self):
        assert query_admin_actions(log_path="/tmp/_nonexist.jsonl") == []

    def test_filter_actor(self, log_path):
        log_admin_action("alice","pause","p1",log_path=log_path)
        log_admin_action("bob","pause","p2",log_path=log_path)
        assert len(query_admin_actions(actor="alice",log_path=log_path)) == 1

    def test_filter_action_prefix(self, log_path):
        log_admin_action("a","pause.project","p1",log_path=log_path)
        log_admin_action("a","resume","p2",log_path=log_path)
        assert len(query_admin_actions(action="pause",log_path=log_path)) == 1

    def test_filter_resource_prefix(self, log_path):
        log_admin_action("a","config.change","config:x",log_path=log_path)
        log_admin_action("a","pause","project:y",log_path=log_path)
        assert len(query_admin_actions(resource="config:",log_path=log_path)) == 1

    def test_filter_date(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        assert query_admin_actions(start_date="2100-01-01T00:00:00",log_path=log_path) == []

    def test_pagination(self, log_path):
        for i in range(5):
            log_admin_action("a",f"a{i}",f"r{i}",log_path=log_path)
        assert len(query_admin_actions(limit=2,offset=0,log_path=log_path)) == 2

    def test_skips_malformed(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        with open(log_path,"a") as f: f.write("not-json\n")
        log_admin_action("a","resume","p1",log_path=log_path)
        assert len(query_admin_actions(log_path=log_path)) == 2


class TestCountAdminActions:
    def test_counts(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        log_admin_action("a","resume","p1",log_path=log_path)
        assert count_admin_actions(log_path=log_path) == 2
        assert count_admin_actions(action="pause",log_path=log_path) == 1


class TestExport:
    def test_json(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        out = log_path + ".json"
        assert export_admin_actions_json(out,log_path=log_path) == 1

    def test_csv(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        out = log_path + ".csv"
        assert export_admin_actions_csv(out,log_path=log_path) == 1
        with open(out) as f: assert "pause" in f.read()

    def test_csv_header_on_empty(self, log_path):
        out = log_path + ".csv"
        assert export_admin_actions_csv(out,log_path=log_path) == 0
        with open(out) as f: assert "id,timestamp" in f.read()


class TestClearLog:
    def test_clears(self, log_path):
        log_admin_action("a","pause","p1",log_path=log_path)
        assert os.path.isfile(log_path)
        clear_log(log_path)
        assert not os.path.isfile(log_path)

    def test_nonexistent_ok(self):
        clear_log("/tmp/_nonexistent.jsonl")


class TestIntegration:
    def test_full_workflow(self, log_path):
        log_admin_action("ops","pause","project:a",{"reason":"maint"},log_path=log_path)
        log_admin_action("ops","resume","project:a",log_path=log_path)
        log_admin_action("admin","config.change","config:x",{"k":"v"},log_path=log_path)
        assert count_admin_actions(log_path=log_path) == 3
        assert count_admin_actions(actor="ops",log_path=log_path) == 2
        assert count_admin_actions(action="pause",log_path=log_path) == 1
        assert export_admin_actions_json(log_path+".json",log_path=log_path) == 3
        clear_log(log_path)
        assert query_admin_actions(log_path=log_path) == []
