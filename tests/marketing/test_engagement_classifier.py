"""Tests for EngagementClassifier — Wave 1.3 of the Marketing ROI Dashboard.

Covers classify_action, classify_batch, duplicate detection.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from marketing.roi_arch import EngagementClassifier
from marketing.store import CampaignStore


@pytest.fixture
def store(tmp_path) -> CampaignStore:
    """Return a fresh CampaignStore backed by a temp SQLite database."""
    db_path = tmp_path / "test_campaigns.db"
    return CampaignStore(str(db_path))


@pytest.fixture
def classifier() -> EngagementClassifier:
    """Return a fresh EngagementClassifier instance."""
    return EngagementClassifier()


# ===================================================================
# classify_action — mapping
# ===================================================================


class TestClassifyActionMapping:
    def test_reply_maps_to_engagement(
        self, classifier: EngagementClassifier, store: CampaignStore,
    ) -> None:
        """``action_type="reply"`` should map to ``FunnelStage.ENGAGEMENT``."""
        camp_id = store.create_campaign({"name": "reply-test"})
        action_id = store.log_action(camp_id, "reddit", "reply", status="completed")
        actions = store.get_actions(camp_id)
        event_id = classifier.classify_action(actions[0], store)
        assert event_id is not None

        event = store._fetchone(
            "SELECT * FROM funnel_events WHERE id = ?", (event_id,),
        )
        assert event is not None
        assert event["event_type"] == "engagement"

    def test_removed_maps_to_negative_signal(
        self, classifier: EngagementClassifier, store: CampaignStore,
    ) -> None:
        """``status="removed"`` should map to ``SignalDirection.NEGATIVE``."""
        camp_id = store.create_campaign({"name": "removed-test"})
        action_id = store.log_action(camp_id, "reddit", "post", status="removed")
        actions = store.get_actions(camp_id)
        event_id = classifier.classify_action(actions[0], store)
        assert event_id is not None

        event = store._fetchone(
            "SELECT * FROM funnel_events WHERE id = ?", (event_id,),
        )
        assert event is not None
        assert event["signal_direction"] == "negative"


# ===================================================================
# classify_batch — stats
# ===================================================================


class TestClassifyBatch:
    def test_classify_batch_with_known_actions(
        self, classifier: EngagementClassifier, store: CampaignStore,
    ) -> None:
        """All known actions should be classified with correct stats."""
        camp_id = store.create_campaign({"name": "batch-test"})
        store.log_action(camp_id, "reddit", "post", status="completed")
        store.log_action(camp_id, "reddit", "reply", status="completed")
        store.log_action(camp_id, "reddit", "like", status="pending")

        stats = classifier.classify_batch(camp_id, store)

        assert stats == {"classified": 3, "skipped": 0, "errors": 0}

        events = store._fetchall("SELECT * FROM funnel_events")
        assert len(events) == 3

    def test_duplicate_classification_skipped(
        self, classifier: EngagementClassifier, store: CampaignStore,
    ) -> None:
        """Classifying the same actions twice should skip existing rows."""
        camp_id = store.create_campaign({"name": "dup-test"})
        store.log_action(camp_id, "reddit", "post", status="completed")

        stats1 = classifier.classify_batch(camp_id, store)
        assert stats1 == {"classified": 1, "skipped": 0, "errors": 0}

        events_before = store._fetchall("SELECT * FROM funnel_events")
        assert len(events_before) == 1

        stats2 = classifier.classify_batch(camp_id, store)
        assert stats2 == {"classified": 0, "skipped": 1, "errors": 0}

        events_after = store._fetchall("SELECT * FROM funnel_events")
        assert len(events_after) == 1
        assert events_after[0]["id"] == events_before[0]["id"]
