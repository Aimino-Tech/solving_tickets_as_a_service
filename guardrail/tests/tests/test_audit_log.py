"""
Tests for guardrail audit_log module.
"""
import os
import sys
import tempfile

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, "..", "..", ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail import audit_log


def setup_function():
    audit_log.close()


def test_init_creates_table():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        audit_log.log_event("test-guardrail", "block", db_path=db_path)
        events = audit_log.query_events(db_path=db_path)
        assert len(events) == 1
        assert events[0]["guardrail"] == "test-guardrail"
        assert events[0]["decision"] == "block"
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_log_event_returns_id():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        event_id = audit_log.log_event("g1", "warn", db_path=db_path)
        assert event_id > 0
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_log_event_with_all_fields():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        audit_log.log_event(
            guardrail="slop-detector",
            decision="block",
            model="deepseek-reasoner",
            source="choice[0].reasoning_content",
            pattern="stub pattern",
            snippet="...example text...",
            metadata={"score": 0.95, "category": "stub"},
            db_path=db_path,
        )
        events = audit_log.query_events(db_path=db_path)
        assert len(events) == 1
        assert events[0]["model"] == "deepseek-reasoner"
        assert events[0]["pattern"] == "stub pattern"
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_query_filter_by_guardrail():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        audit_log.log_event("g1", "block", db_path=db_path)
        audit_log.log_event("g2", "warn", db_path=db_path)
        g1_events = audit_log.query_events(guardrail="g1", db_path=db_path)
        assert len(g1_events) == 1
        assert g1_events[0]["guardrail"] == "g1"
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_query_filter_by_decision():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        audit_log.log_event("g1", "block", db_path=db_path)
        audit_log.log_event("g2", "warn", db_path=db_path)
        blocked = audit_log.query_events(decision="block", db_path=db_path)
        assert len(blocked) == 1
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_count_events():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        audit_log.log_event("g1", "block", db_path=db_path)
        audit_log.log_event("g1", "warn", db_path=db_path)
        assert audit_log.count_events(db_path=db_path) == 2
        assert audit_log.count_events(guardrail="g1", db_path=db_path) == 2
        assert audit_log.count_events(decision="block", db_path=db_path) == 1
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_query_pagination():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    audit_log.close()
    try:
        audit_log.init_db(db_path)
        for i in range(10):
            audit_log.log_event("g1", "block", db_path=db_path)
        page1 = audit_log.query_events(limit=3, offset=0, db_path=db_path)
        assert len(page1) == 3
        page2 = audit_log.query_events(limit=3, offset=3, db_path=db_path)
        assert len(page2) == 3
        assert page1[0]["id"] != page2[0]["id"]
    finally:
        audit_log.close()
        os.unlink(db_path)


def test_env_var_overrides_path():
    import os as _os
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        env_path = f.name
    audit_log.close()
    try:
        _os.environ["GUARDRAIL_AUDIT_DB_PATH"] = env_path
        audit_log.init_db()
        audit_log.log_event("g1", "block")
        events = audit_log.query_events()
        assert len(events) >= 1
        del _os.environ["GUARDRAIL_AUDIT_DB_PATH"]
    finally:
        audit_log.close()
        _os.unlink(env_path)
