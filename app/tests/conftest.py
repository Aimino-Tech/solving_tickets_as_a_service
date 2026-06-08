import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.common.db import EngagementRepository, get_repository


@pytest.fixture(autouse=True)
def reset_repo(monkeypatch):
    EngagementRepository._conn = None
    mem_repo = get_repository(":memory:")
    monkeypatch.setattr("common.db.get_repository", lambda db_path=None: mem_repo)
    monkeypatch.setattr("common.rate_limiter.get_repository", lambda db_path=None: mem_repo)
    yield
    mem_repo.close()
    EngagementRepository._conn = None


@pytest.fixture
def repo():
    r = get_repository(":memory:")
    yield r
    r.close()
    EngagementRepository._conn = None


@pytest.fixture
def sample_engagement():
    from common.models import EngagementRecord
    return EngagementRecord(
        platform="linkedin",
        engagement_type="post",
        content="Test post content",
        target="urn:li:person:test",
        status="pending_approval",
    )


@pytest.fixture
def test_db_path(tmp_path):
    db_path = str(tmp_path / "test_marketing.duckdb")
    os.environ["OPENCLAW_MARKETING_DB"] = db_path
    yield db_path
    if os.path.exists(db_path):
        os.remove(db_path)
