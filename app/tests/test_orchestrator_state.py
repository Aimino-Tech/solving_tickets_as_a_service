import pytest
from orchestrator_state import OrchestratorRepository, get_repository


@pytest.fixture(autouse=True)
def reset_repo(monkeypatch):
    repo = OrchestratorRepository(":memory:")
    monkeypatch.setattr("orchestrator_state.get_repository", lambda db_path=None: repo)
    yield
    repo.close()


@pytest.fixture
def repo():
    r = OrchestratorRepository(":memory:")
    yield r
    r.close()


def test_schema_creation(repo):
    tables = repo.conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t[0] for t in tables]
    assert "orchestrator_state" in table_names
    assert "engagement_history" in table_names
    assert "leads" in table_names


def test_set_and_get_state(repo):
    repo.set_state("test_key", {"value": 42, "nested": {"a": 1}})
    val = repo.get_state("test_key")
    assert val["value"] == 42
    assert val["nested"]["a"] == 1


def test_state_overwrite(repo):
    repo.set_state("key1", "v1")
    repo.set_state("key1", "v2")
    assert repo.get_state("key1") == "v2"


def test_get_nonexistent_state(repo):
    assert repo.get_state("nonexistent") is None


def test_log_engagement(repo):
    eid = repo.log_engagement("reddit", "reply", "https://reddit.com/r/test", "test content", 85)
    assert eid is not None
    rows = repo.conn.execute("SELECT * FROM engagement_history WHERE id = ?", [eid]).fetchall()
    assert len(rows) == 1
    assert rows[0][1] == "reddit"
    assert rows[0][2] == "reply"


def test_update_engagement(repo):
    eid = repo.log_engagement("telegram", "send_message", status="pending")
    repo.update_engagement(eid, status="sent", approved_by="operator")
    rows = repo.conn.execute("SELECT status, approved_by FROM engagement_history WHERE id = ?", [eid]).fetchall()
    assert rows[0][0] == "sent"
    assert rows[0][1] == "operator"


def test_get_pending_engagements(repo):
    repo.log_engagement("reddit", "reply", score=80, status="pending")
    repo.log_engagement("telegram", "send", score=90, status="sent")
    repo.log_engagement("linkedin", "post", score=70, status="pending")
    pending = repo.get_pending_engagements()
    assert len(pending) == 2
    assert all(p["status"] == "pending" for p in pending)


def test_pending_engagements_ordered_by_score(repo):
    repo.log_engagement("a", "type", score=50, status="pending")
    repo.log_engagement("b", "type", score=90, status="pending")
    pending = repo.get_pending_engagements()
    assert pending[0]["score"] >= pending[1]["score"]


def test_add_lead(repo):
    lid = repo.add_lead("reddit", "https://reddit.com/r/test", "user1", "@user1",
                        "Check out MCP tools!", 80, "positive", 75, "today")
    assert lid is not None
    rows = repo.conn.execute("SELECT * FROM leads WHERE id = ?", [lid]).fetchall()
    assert len(rows) == 1
    assert rows[0][1] == "reddit"
    assert rows[0][6] == 80


def test_get_new_leads(repo):
    repo.add_lead("reddit", relevance_score=80, opportunity_score=75)
    repo.add_lead("telegram", relevance_score=90, opportunity_score=85)
    leads = repo.get_new_leads()
    assert len(leads) == 2
    assert all(l["status"] == "new" for l in leads)


def test_update_lead(repo):
    lid = repo.add_lead("reddit", relevance_score=50)
    repo.update_lead(lid, status="engaged", relevance_score=85, opportunity_score=90)
    rows = repo.conn.execute("SELECT status, relevance_score, opportunity_score FROM leads WHERE id = ?", [lid]).fetchall()
    assert rows[0][0] == "engaged"
    assert rows[0][1] == 85
    assert rows[0][2] == 90


def test_empty_summary(repo):
    summary = repo.summary(days=7)
    assert "engagement_counts" in summary
    assert "lead_counts" in summary


def test_summary_with_data(repo):
    repo.log_engagement("reddit", "reply", score=80, status="sent")
    repo.log_engagement("reddit", "reply", score=70, status="pending")
    repo.add_lead("reddit", relevance_score=80)
    summary = repo.summary(days=7)
    assert len(summary["engagement_counts"]) == 2
    assert len(summary["lead_counts"]) == 1
