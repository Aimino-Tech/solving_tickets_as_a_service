"""Tests for merge queue: QueueEntry, _FileLedger, MergeQueue manager,
middleware signal handlers, and Celery tasks."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from workers.merge_queue.queue import (
    CONFLICT_LABEL,
    MERGE_QUEUE_LABEL,
    QueueEntry,
    _FileLedger,
    _aggregate_check_conclusion,
    _ci_is_pending,
    _ci_passes,
    _get_check_runs,
    _get_combined_ci_status,
    MergeQueue,
)
from workers.merge_queue.middleware import (
    _auto_enqueue_on_pr_created,
    connect_merge_queue_middleware,
)
from workers.review.models import MergeResult, MergeStrategy
from workers.tasks.merge_queue import (
    label_conflict_pr,
    process_merge_queue,
    resolve_conflicts,
)


class TestQueueEntry:
    def test_defaults(self):
        entry = QueueEntry(repo_name="o/r", pr_number=1, issue_id="ISS-1")
        assert entry.status == "queued"
        assert entry.merge_strategy == "squash"
        assert entry.error == ""
        assert entry.pr_url == ""

    def test_to_dict_roundtrip(self):
        entry = QueueEntry(
            repo_name="o/r", pr_number=42, issue_id="AIM-2051",
            status="ci_passed", pr_url="https://github.com/o/r/pull/42",
        )
        restored = QueueEntry.from_dict(entry.to_dict())
        assert restored.repo_name == "o/r"
        assert restored.pr_number == 42
        assert restored.status == "ci_passed"


class TestFileLedger:
    @pytest.fixture
    def ledger_path(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        yield path
        if Path(path).exists():
            Path(path).unlink()

    def test_put_and_get(self, ledger_path):
        ledger = _FileLedger(path=ledger_path)
        ledger.put(QueueEntry(repo_name="o/r", pr_number=1, issue_id="ISS-1"))
        assert ledger.get("o/r#1") is not None
        assert ledger.get("o/r#1").issue_id == "ISS-1"

    def test_remove(self, ledger_path):
        ledger = _FileLedger(path=ledger_path)
        ledger.put(QueueEntry(repo_name="o/r", pr_number=1, issue_id="ISS-1"))
        ledger.remove("o/r", 1)
        assert ledger.get("o/r#1") is None

    def test_next_pending(self, ledger_path):
        ledger = _FileLedger(path=ledger_path)
        ledger.put(QueueEntry(repo_name="o/a", pr_number=2, issue_id="ISS-2", status="ci_passed"))
        ledger.put(QueueEntry(repo_name="o/b", pr_number=3, issue_id="ISS-3", status="queued"))
        ledger.put(QueueEntry(repo_name="o/c", pr_number=4, issue_id="ISS-4", status="merged"))
        entry = ledger.next_pending()
        assert entry is not None
        assert entry.pr_number == 2

    def test_next_pending_none(self, ledger_path):
        ledger = _FileLedger(path=ledger_path)
        ledger.put(QueueEntry(repo_name="o/r", pr_number=5, issue_id="ISS-5", status="merged"))
        assert ledger.next_pending() is None

    def test_persistence(self, ledger_path):
        ledger1 = _FileLedger(path=ledger_path)
        ledger1.put(QueueEntry(repo_name="o/r", pr_number=10, issue_id="AIM-1"))
        ledger2 = _FileLedger(path=ledger_path)
        assert ledger2.get("o/r#10") is not None

    def test_entries_by_status(self, ledger_path):
        ledger = _FileLedger(path=ledger_path)
        ledger.put(QueueEntry(repo_name="o/r", pr_number=20, issue_id="AIM-1", status="queued"))
        ledger.put(QueueEntry(repo_name="o/r", pr_number=21, issue_id="AIM-2", status="merged"))
        assert len(ledger.entries_by_status("merged")) == 1

    def test_corrupted_ledger_does_not_crash(self):
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            f.write("not valid json")
            path = f.name
        try:
            ledger = _FileLedger(path=path)
            assert ledger.all() == []
        finally:
            Path(path).unlink(missing_ok=True)


class TestCiHelpers:
    def test_aggregate_check_conclusion_all_success(self):
        assert _aggregate_check_conclusion({
            "check_runs": [{"status": "completed", "conclusion": "success"}],
        }) == "success"

    def test_aggregate_check_conclusion_failure(self):
        assert _aggregate_check_conclusion({
            "check_runs": [{"status": "completed", "conclusion": "failure"}],
        }) == "failure"

    def test_aggregate_check_conclusion_pending(self):
        assert _aggregate_check_conclusion({
            "check_runs": [{"status": "in_progress", "conclusion": None}],
        }) == "pending"

    def test_aggregate_check_conclusion_empty(self):
        assert _aggregate_check_conclusion({"check_runs": []}) is None

    def test_ci_passes(self):
        assert _ci_passes({"state": "success"}, {"conclusion": "success"}) is True
        assert _ci_passes({"state": "failure"}, {"conclusion": "success"}) is False
        assert _ci_passes({"state": "pending"}, {"conclusion": None}) is False

    def test_ci_is_pending(self):
        assert _ci_is_pending({"state": "pending"}, {"conclusion": None}) is True
        assert _ci_is_pending({"state": "success"}, {"conclusion": "success"}) is False


class TestGetCombinedCiStatus:
    def test_success(self):
        client = MagicMock()
        client._request.return_value = {"state": "success", "statuses": []}
        result = _get_combined_ci_status(client, "o/r", "abc123")
        assert result["state"] == "success"


class TestGetCheckRuns:
    def test_success(self):
        client = MagicMock()
        client._request.return_value = {"check_runs": [{"status": "completed", "conclusion": "success"}]}
        result = _get_check_runs(client, "o/r", "abc123")
        assert result["conclusion"] == "success"

    def test_api_error_returns_none(self):
        client = MagicMock()
        client._request.side_effect = Exception("API error")
        result = _get_check_runs(client, "o/r", "abc123")
        assert result["conclusion"] is None


class TestMergeQueue:
    @pytest.fixture
    def queue(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        q = MergeQueue(ledger_path=path)
        yield q
        if Path(path).exists():
            Path(path).unlink()

    def test_enqueue(self, queue):
        entry = queue.enqueue("o/r", 42, "AIM-1", pr_url="http://pr")
        assert entry.status == "queued"
        assert queue.get_entry("o/r", 42) is not None

    def test_enqueue_duplicate_updates(self, queue):
        queue.enqueue("o/r", 1, "AIM-1")
        queue.enqueue("o/r", 1, "AIM-1-updated")
        assert queue.get_entry("o/r", 1).issue_id == "AIM-1-updated"

    def test_dequeue(self, queue):
        queue.enqueue("o/r", 1, "AIM-1")
        queue.dequeue("o/r", 1)
        assert queue.get_entry("o/r", 1) is None

    def test_list_queue_order(self, queue):
        queue.enqueue("o/r", 1, "AIM-1")
        queue.enqueue("o/r", 2, "AIM-2")
        assert [e.pr_number for e in queue.list_queue()] == [1, 2]

    def test_entries_by_status(self, queue):
        queue.enqueue("o/r", 1, "AIM-1")
        queue._set_status("o/r", 1, "merged")
        assert len(queue.entries_by_status("merged")) == 1

    def test_check_ci_passes(self, queue):
        client = MagicMock()
        client._request.side_effect = [
            {"head": {"sha": "abc123"}},
            {"state": "success", "statuses": []},
            {"check_runs": [{"status": "completed", "conclusion": "success"}]},
        ]
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.check_ci("o/r", 1) == "passed"

    def test_check_ci_fails(self, queue):
        client = MagicMock()
        client._request.side_effect = [
            {"head": {"sha": "abc123"}},
            {"state": "failure", "statuses": []},
        ]
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.check_ci("o/r", 1) == "failed"

    def test_check_ci_pending(self, queue):
        client = MagicMock()
        client._request.side_effect = [
            {"head": {"sha": "abc123"}},
            {"state": "pending", "statuses": []},
        ]
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.check_ci("o/r", 1) == "pending"

    def test_poll_ci_timeout(self, queue):
        client = MagicMock()
        pr_info = {"head": {"sha": "abc123"}}
        commit_pending = {"state": "pending", "statuses": []}
        check_runs = {"check_runs": [{"status": "in_progress", "conclusion": None}]}
        client._request.side_effect = [
            pr_info, commit_pending, check_runs,
            pr_info, commit_pending, check_runs,
            pr_info, commit_pending, check_runs,
        ]
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.poll_ci_with_timeout("o/r", 1, max_retries=2, interval=0) == "timeout"

    def test_label_conflict(self, queue):
        client = MagicMock()
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 42, "AIM-1")
        queue.label_conflict("o/r", 42)
        client._request.assert_called_with(
            "POST", "/repos/o/r/issues/42/labels",
            json_body={"labels": [CONFLICT_LABEL]},
        )

    def test_label_merge_queue(self, queue):
        client = MagicMock()
        queue._gh_factory = lambda: client
        queue.label_merge_queue("o/r", 42)
        client._request.assert_called_with(
            "POST", "/repos/o/r/issues/42/labels",
            json_body={"labels": [MERGE_QUEUE_LABEL]},
        )

    def test_detect_conflicts_via_api(self, queue):
        client = MagicMock()
        client.check_mergeable.return_value = {"mergeable": False, "mergeable_state": "dirty"}
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.detect_conflicts("o/r", 1) is True

    def test_detect_no_conflicts(self, queue):
        client = MagicMock()
        client.check_mergeable.return_value = {"mergeable": True, "mergeable_state": "clean"}
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        assert queue.detect_conflicts("o/r", 1) is False

    def test_process_next_no_pending(self, queue):
        assert queue.process_next()["status"] == "no_pending"

    def test_process_next_merged(self, queue):
        client = MagicMock()
        queue._gh_factory = lambda: client
        queue.enqueue("o/r", 1, "AIM-1")
        with patch.object(queue, "poll_ci_with_timeout", return_value="passed"):
            with patch.object(queue, "detect_conflicts", return_value=False):
                with patch(
                    "workers.merge_queue.queue._merge_via_api",
                    return_value=MergeResult(status="merged", merge_sha="abc"),
                ):
                    result = queue.process_next()
        assert result["status"] == "merged"
        assert result["merge_sha"] == "abc"

    def test_try_github_merge_queue_unavailable(self, queue):
        client = MagicMock()
        client._request.side_effect = Exception("Not found")
        queue._gh_factory = lambda: client
        assert queue.try_github_merge_queue("o/r") is False


class TestMiddleware:
    def test_connect_is_idempotent(self):
        connect_merge_queue_middleware()

    @patch("workers.merge_queue.middleware._get_queue")
    def test_auto_enqueue_on_success(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = None
        task = MagicMock()
        task.name = "workers.tasks.pr_creation.create_pull_request"
        with patch("workers.merge_queue.middleware.merge_tasks.process_merge_queue.delay"):
            _auto_enqueue_on_pr_created(
                task_id="t", task=task, state="SUCCESS",
                retval={
                    "status": "created", "number": 42, "html_url": "http://pr",
                    "repo_info": {"owner": "owner", "repo": "repo"},
                    "fix_result": {"issue_id": "AIM-1"},
                },
            )
        mock_queue.enqueue.assert_called_once()

    def test_auto_enqueue_skips_non_pr_task(self):
        task = MagicMock()
        task.name = "workers.celery_app.ping"
        _auto_enqueue_on_pr_created(task_id="t", task=task, state="SUCCESS", retval={})

    def test_auto_enqueue_skips_failed_state(self):
        task = MagicMock()
        task.name = "workers.tasks.pr_creation.create_pull_request"
        _auto_enqueue_on_pr_created(task_id="t", task=task, state="FAILURE", retval={"status": "created"})

    def test_auto_enqueue_skips_already_exists(self):
        task = MagicMock()
        task.name = "workers.tasks.pr_creation.create_pull_request"
        _auto_enqueue_on_pr_created(task_id="t", task=task, state="SUCCESS", retval={"status": "already_exists"})

    @patch("workers.merge_queue.middleware._get_queue")
    def test_auto_enqueue_idempotent(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = QueueEntry(repo_name="o/r", pr_number=42, issue_id="AIM-1")
        task = MagicMock()
        task.name = "workers.tasks.pr_creation.create_pull_request"
        with patch("workers.merge_queue.middleware.merge_tasks.process_merge_queue.delay") as mock_delay:
            _auto_enqueue_on_pr_created(
                task_id="t", task=task, state="SUCCESS",
                retval={"status": "created", "number": 42, "repo_info": {"owner": "o", "repo": "r"}},
            )
        mock_queue.enqueue.assert_not_called()
        mock_delay.assert_not_called()


class TestProcessMergeQueueTask:
    @patch("workers.tasks.merge_queue._get_queue")
    def test_process_queue_with_explicit_pr(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = None
        mock_queue.process_next.return_value = {"status": "no_pending", "entry": None}
        result = process_merge_queue.run(
            issue_id="AIM-1", repo_name="o/r", pr_number=42, pr_url="http://pr",
        )
        assert result["status"] == "no_pending"
        mock_queue.enqueue.assert_called_once()
        mock_queue.process_next.assert_called_once()

    @patch("workers.tasks.merge_queue._get_queue")
    def test_process_queue_merged(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = QueueEntry(repo_name="o/r", pr_number=1, issue_id="AIM-1")
        mock_queue.process_next.return_value = {"status": "merged", "entry": None, "merge_sha": "abc"}
        result = process_merge_queue.run(issue_id="AIM-1", repo_name="o/r", pr_number=1)
        assert result["status"] == "merged"

    @patch("workers.tasks.merge_queue._get_queue")
    def test_process_queue_conflict_triggers_resolve(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = None
        mock_queue.process_next.return_value = {
            "status": "conflict",
            "entry": QueueEntry(repo_name="o/r", pr_number=1, issue_id="AIM-1"),
        }
        with patch("workers.tasks.merge_queue.resolve_conflicts.delay") as mock_resolve:
            result = process_merge_queue.run(
                issue_id="AIM-1", repo_name="o/r", pr_number=1, workspace_path="/ws",
            )
        assert result["status"] == "conflict"
        mock_resolve.assert_called_once()


class TestResolveConflictsTask:
    @patch("workers.tasks.merge_queue._get_queue")
    def test_resolve_success(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.resolve_conflicts.return_value = {
            "status": "resolved", "resolved": ["src/main.py"], "failed": [],
        }
        with patch("workers.tasks.merge_queue.process_merge_queue.delay") as mock_retry:
            result = resolve_conflicts.run(
                issue_id="AIM-1", repo_name="o/r", pr_number=1, workspace_path="/ws",
            )
        assert result["status"] == "resolved"
        assert result["action"] == "retry_merge"
        mock_retry.assert_called_once()

    @patch("workers.tasks.merge_queue._get_queue")
    def test_resolve_partial(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.resolve_conflicts.return_value = {
            "status": "partial", "resolved": ["a.py"],
            "failed": [{"file": "b.py", "error": "err"}],
        }
        result = resolve_conflicts.run(
            issue_id="AIM-1", repo_name="o/r", pr_number=1, workspace_path="/ws",
        )
        assert result["action"] == "human_review"

    def test_resolve_no_workspace(self):
        result = resolve_conflicts.run(
            issue_id="AIM-1", repo_name="o/r", pr_number=1, workspace_path="",
        )
        assert result["status"] == "no_workspace"


class TestLabelConflictPrTask:
    @patch("workers.tasks.merge_queue._get_queue")
    def test_label_conflict(self, mock_get_queue):
        mock_queue = MagicMock()
        mock_get_queue.return_value = mock_queue
        mock_queue.get_entry.return_value = QueueEntry(repo_name="o/r", pr_number=1, issue_id="AIM-1")
        result = label_conflict_pr.run(issue_id="AIM-1", repo_name="o/r", pr_number=1)
        assert result["status"] == "labeled"
        mock_queue.label_conflict.assert_called_once_with("o/r", 1)


@pytest.fixture
def e2e_queue():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    q = MergeQueue(ledger_path=path)
    yield q
    if Path(path).exists():
        Path(path).unlink()


class TestProcessNextE2E:
    @patch("workers.merge_queue.queue._merge_via_api")
    def test_full_merge_flow(self, mock_merge, e2e_queue):
        client = MagicMock()
        e2e_queue._gh_factory = lambda: client
        client._request.return_value = {"head": {"sha": "abc123"}}
        mock_merge.return_value = MergeResult(status="merged", merge_sha="def456")
        e2e_queue.enqueue("o/r", 1, "AIM-1")
        with patch.object(e2e_queue, "poll_ci_with_timeout", return_value="passed"):
            with patch.object(e2e_queue, "detect_conflicts", return_value=False):
                result = e2e_queue.process_next()
        assert result["status"] == "merged"
        assert e2e_queue.get_entry("o/r", 1) is None
