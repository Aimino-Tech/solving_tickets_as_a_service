import pytest
from backoff import BackoffTracker, BACKOFF_SECONDS, wait_with_backoff


@pytest.fixture
def tracker():
    t = BackoffTracker(":memory:")
    yield t
    t.close()


def test_backoff_sequence_values():
    assert BACKOFF_SECONDS == [30, 60, 300, 900, 1800, 3600, 14400]


def test_get_wait_seconds_first_failure(tracker):
    assert tracker.get_wait_seconds(1) == 30


def test_get_wait_seconds_multiple_failures(tracker):
    assert tracker.get_wait_seconds(2) == 60
    assert tracker.get_wait_seconds(3) == 300
    assert tracker.get_wait_seconds(4) == 900
    assert tracker.get_wait_seconds(5) == 1800
    assert tracker.get_wait_seconds(6) == 3600
    assert tracker.get_wait_seconds(7) == 14400


def test_get_wait_seconds_caps_at_max(tracker):
    assert tracker.get_wait_seconds(10) == 14400
    assert tracker.get_wait_seconds(100) == 14400


def test_record_failure_creates_entry(tracker):
    bid = tracker.record_failure("reddit")
    info = tracker.get_backoff_info("reddit")
    assert len(info) == 1
    assert info[0]["failures"] == 1
    assert info[0]["platform"] == "reddit"


def test_record_multiple_failures(tracker):
    bid = tracker.record_failure("telegram")
    tracker.record_failure("telegram", bid)
    info = tracker.get_backoff_info("telegram")
    assert len(info) == 1
    assert info[0]["failures"] == 2


def test_record_success_resets(tracker):
    bid = tracker.record_failure("reddit")
    tracker.record_success(bid)
    info = tracker.get_backoff_info("reddit")
    assert info[0]["failures"] == 0
    assert info[0]["next_retry_at"] is None


def test_reset_backoff(tracker):
    bid = tracker.record_failure("reddit")
    tracker.reset_backoff(bid)
    info = tracker.get_backoff_info("reddit")
    assert info[0]["failures"] == 0


def test_get_due_retries_empty(tracker):
    due = tracker.get_due_retries()
    assert due == []


def test_get_backoff_info_all(tracker):
    tracker.record_failure("reddit")
    tracker.record_failure("telegram")
    info = tracker.get_backoff_info()
    assert len(info) == 2


def test_wait_with_backoff_respects_sequence():
    import time
    start = time.time()
    wait_with_backoff(1)
    elapsed = time.time() - start
    assert elapsed >= 25


def test_backoff_info_for_specific_platform(tracker):
    tracker.record_failure("reddit")
    tracker.record_failure("telegram")
    info = tracker.get_backoff_info("reddit")
    assert len(info) == 1
    assert info[0]["platform"] == "reddit"
