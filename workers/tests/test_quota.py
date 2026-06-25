"""
Comprehensive tests for workspace quota and isolation (AIM-2013).

Covers:
    workers.orchestrator.quota           -- DiskQuota, WorkspaceIsolation
    workers.orchestrator.workspace_quota -- QuotaManager, PeriodicCleanupTask
"""

from __future__ import annotations

import os
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.orchestrator.quota import (
    DiskQuota,
    WorkspaceIsolation,
    get_disk_quota,
    get_workspace_isolation,
    quota_for_tier,
    resolve_tier,
)
from workers.orchestrator.workspace_quota import (
    PeriodicCleanupTask,
    QuotaManager,
    get_periodic_cleanup,
    get_quota_manager,
)


# ===========================================================================
# Tier Resolution Tests
# ===========================================================================


class TestTierResolution:
    def test_defaults_to_free(self) -> None:
        assert resolve_tier("unknown-tenant") == "free"

    def test_explicit_tier(self) -> None:
        assert resolve_tier("t-1", "solo") == "solo"
        assert resolve_tier("t-1", "TEAM") == "team"
        assert resolve_tier("t-1", "Enterprise") == "enterprise"

    def test_via_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_ACME_CORP_TIER", "team")
        assert resolve_tier("acme-corp") == "team"

    def test_unknown_tier_defaults(self) -> None:
        assert resolve_tier("t-1", "platinum") == "free"

    def test_quota_for_tier_free(self) -> None:
        assert quota_for_tier("free") == 512 * 1024 * 1024

    def test_quota_for_tier_solo(self) -> None:
        assert quota_for_tier("solo") == 2 * 1024 * 1024 * 1024

    def test_quota_for_tier_team(self) -> None:
        assert quota_for_tier("team") == 5 * 1024 * 1024 * 1024

    def test_quota_for_tier_enterprise(self) -> None:
        assert quota_for_tier("enterprise") == 10 * 1024 * 1024 * 1024

    def test_quota_for_tier_unknown_defaults_to_free(self) -> None:
        assert quota_for_tier("platinum") == quota_for_tier("free")


# ===========================================================================
# DiskQuota Tests
# ===========================================================================


class TestDiskQuotaCheck:
    @patch("workers.orchestrator.quota._get_redis")
    def test_check_quota_allows_when_under_limit(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_get_redis.return_value = mock_client
        quota = DiskQuota(per_workspace_bytes=256 * 1024 * 1024)
        assert quota.check_quota("tenant-a") is True

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_quota_blocks_when_over_limit(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = [str(512 * 1024 * 1024)]  # at quota
        mock_get_redis.return_value = mock_client
        quota = DiskQuota(per_workspace_bytes=1)  # needs 1 more byte
        assert quota.check_quota("tenant-a") is False

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_quota_allows_unlimited_tier(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["999999999"]
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        assert quota.check_quota("tenant-enterprise", tier="enterprise") is True

    def test_check_quota_allows_when_redis_unavailable(self) -> None:
        with patch("workers.orchestrator.quota._get_redis", return_value=None):
            quota = DiskQuota()
            assert quota.check_quota("tenant-a") is True

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_quota_allows_on_error(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.side_effect = RuntimeError("Redis timeout")
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        assert quota.check_quota("tenant-a") is True

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_quota_with_estimated_bytes(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = [str(500 * 1024 * 1024)]
        mock_get_redis.return_value = mock_client
        quota = DiskQuota(per_workspace_bytes=256 * 1024 * 1024)
        # Remaining is 12 MB, but estimated is 50 MB
        remaining = 512 * 1024 * 1024 - 500 * 1024 * 1024
        assert remaining < 50 * 1024 * 1024
        assert quota.check_quota("tenant-a", estimated_bytes=50 * 1024 * 1024) is False

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_per_workspace_quota_under_limit(self, mock_get_redis: MagicMock) -> None:
        with patch("os.path.isdir", return_value=True):
            with patch("os.scandir") as mock_scandir:
                entry = MagicMock()
                entry.is_file.return_value = True
                entry.is_dir.return_value = False
                entry.stat.return_value.st_size = 100
                mock_scandir.return_value = [entry]

                quota = DiskQuota(per_workspace_bytes=1024)
                assert quota.check_per_workspace_quota("/fake/path") is True

    @patch("workers.orchestrator.quota._get_redis")
    def test_check_per_workspace_quota_over_limit(self, mock_get_redis: MagicMock) -> None:
        with patch("os.path.isdir", return_value=True):
            with patch("os.scandir") as mock_scandir:
                entry = MagicMock()
                entry.is_file.return_value = True
                entry.is_dir.return_value = False
                entry.stat.return_value.st_size = 2000
                mock_scandir.return_value = [entry]

                quota = DiskQuota(per_workspace_bytes=1024)
                assert quota.check_per_workspace_quota("/fake/path") is False

    def test_check_per_workspace_quota_nonexistent(self) -> None:
        with patch("os.path.isdir", return_value=False):
            quota = DiskQuota()
            assert quota.check_per_workspace_quota("/nonexistent") is True


class TestDiskQuotaUsage:
    @patch("workers.orchestrator.quota._get_redis")
    def test_record_usage(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        quota.record_usage("tenant-a", "/workspaces/t_a/issue-1", 1024)
        mock_client.hincrby.assert_called_once_with(
            "stas:quota:tenant-a:usage", "/workspaces/t_a/issue-1", 1024,
        )
        mock_client.expire.assert_called_once()

    @patch("workers.orchestrator.quota._get_redis")
    def test_release_usage(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        quota.release_usage("tenant-a", "/workspaces/t_a/issue-1")
        mock_client.hdel.assert_called_once_with(
            "stas:quota:tenant-a:usage", "/workspaces/t_a/issue-1",
        )

    @patch("workers.orchestrator.quota._get_redis")
    def test_get_tenant_usage(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100", "200", "300"]
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        assert quota.get_tenant_usage("tenant-a") == 600

    @patch("workers.orchestrator.quota._get_redis")
    def test_get_tenant_usage_empty(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = []
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        assert quota.get_tenant_usage("tenant-a") == 0

    def test_get_tenant_usage_no_redis(self) -> None:
        with patch("workers.orchestrator.quota._get_redis", return_value=None):
            quota = DiskQuota()
            assert quota.get_tenant_usage("tenant-a") == 0

    @patch("workers.orchestrator.quota._get_redis")
    def test_get_tenant_quota(self, mock_get_redis: MagicMock) -> None:
        quota = DiskQuota()
        assert quota.get_tenant_quota("tenant-a", "free") == 512 * 1024 * 1024
        assert quota.get_tenant_quota("tenant-a", "solo") == 2 * 1024 * 1024 * 1024
        assert quota.get_tenant_quota("tenant-a", "enterprise") == 10 * 1024 * 1024 * 1024

    @patch("workers.orchestrator.quota._get_redis")
    def test_get_tenant_remaining(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["104857600"]  # 100 MB used
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        remaining = quota.get_tenant_remaining("tenant-a", "free")
        assert remaining == 512 * 1024 * 1024 - 100 * 1024 * 1024

    def test_record_usage_no_redis(self) -> None:
        with patch("workers.orchestrator.quota._get_redis", return_value=None):
            quota = DiskQuota()
            # Should not raise
            quota.record_usage("tenant-a", "/ws", 1024)

    def test_release_usage_no_redis(self) -> None:
        with patch("workers.orchestrator.quota._get_redis", return_value=None):
            quota = DiskQuota()
            quota.release_usage("tenant-a", "/ws")  # Should not raise


class TestDiskQuotaDirSize:
    @patch("os.scandir")
    def test_dir_size_single_file(self, mock_scandir: MagicMock) -> None:
        entry = MagicMock()
        entry.is_file.return_value = True
        entry.is_dir.return_value = False
        entry.stat.return_value.st_size = 500
        mock_scandir.return_value = [entry]

        size = DiskQuota._dir_size("/path")
        assert size == 500

    @patch("os.scandir")
    def test_dir_size_nested(self, mock_scandir: MagicMock) -> None:
        # First call: root with one file and one dir
        inner_file = MagicMock()
        inner_file.is_file.return_value = True
        inner_file.is_dir.return_value = False
        inner_file.stat.return_value.st_size = 300

        inner_dir = MagicMock()
        inner_dir.is_file.return_value = False
        inner_dir.is_dir.return_value = True
        inner_dir.path = "/path/sub"

        root_file = MagicMock()
        root_file.is_file.return_value = True
        root_file.is_dir.return_value = False
        root_file.stat.return_value.st_size = 200

        mock_scandir.side_effect = [
            [root_file, inner_dir],  # first call -> root
            [inner_file],             # second call -> subdir
        ]

        size = DiskQuota._dir_size("/path")
        assert size == 500  # 200 + 300

    @patch("os.scandir")
    def test_dir_size_empty(self, mock_scandir: MagicMock) -> None:
        mock_scandir.return_value = []
        size = DiskQuota._dir_size("/empty")
        assert size == 0


# ===========================================================================
# WorkspaceIsolation Tests
# ===========================================================================


class TestWorkspaceIsolation:
    def test_workspace_root_format(self) -> None:
        root = WorkspaceIsolation.workspace_root("tenant-abc", "AIM-42")
        assert root == "/workspaces/tenant-abc/AIM-42"

    def test_workspace_root_with_github_issue(self) -> None:
        root = WorkspaceIsolation.workspace_root("acme", "gh-42")
        assert root == "/workspaces/acme/gh-42"

    def test_different_tenants_different_roots(self) -> None:
        root_a = WorkspaceIsolation.workspace_root("tenant-a", "ISSUE-1")
        root_b = WorkspaceIsolation.workspace_root("tenant-b", "ISSUE-1")
        assert root_a != root_b

    def test_same_tenant_different_issues(self) -> None:
        root_1 = WorkspaceIsolation.workspace_root("tenant-a", "AIM-1")
        root_2 = WorkspaceIsolation.workspace_root("tenant-a", "AIM-2")
        assert root_1 != root_2
        assert root_1.endswith("AIM-1")
        assert root_2.endswith("AIM-2")

    def test_sanitizes_special_chars(self) -> None:
        root = WorkspaceIsolation.workspace_root("my.corp/team", "issue/123")
        assert "my_corp" in root
        assert "issue_123" in root

    def test_ensure_isolation_valid(self) -> None:
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/tenant_abc/AIM-42", "tenant_abc",
        ) is True

    def test_ensure_isolation_valid_exact_root(self) -> None:
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/tenant_abc", "tenant_abc",
        ) is True

    def test_ensure_isolation_path_traversal(self) -> None:
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/other_tenant/AIM-42", "tenant_abc",
        ) is False

    def test_ensure_isolation_escapes_root(self) -> None:
        assert WorkspaceIsolation.ensure_isolation(
            "/etc/passwd", "tenant_abc",
        ) is False

    def test_list_tenant_workspaces_empty(self) -> None:
        with patch("os.path.isdir", return_value=False):
            ws = WorkspaceIsolation.list_tenant_workspaces("tenant-empty")
            assert ws == []

    def test_list_tenant_workspaces(self) -> None:
        with patch("os.path.isdir", return_value=True):
            with patch("os.listdir", return_value=["AIM-1", "AIM-2"]):
                with patch("os.path.isdir", side_effect=[True, True, True]):
                    ws = WorkspaceIsolation.list_tenant_workspaces("tenant-a")
                    assert len(ws) == 2
                    assert all("tenant-a" in w for w in ws)

    def test_all_tenant_roots_empty(self) -> None:
        with patch("os.path.isdir", return_value=False):
            roots = WorkspaceIsolation.all_tenant_roots()
            assert roots == []

    def test_all_tenant_roots(self) -> None:
        with patch("os.path.isdir", return_value=True):
            with patch("os.listdir", return_value=["t1", "t2", "t3"]):
                with patch("os.path.isdir", side_effect=[True, True, True, True]):
                    roots = WorkspaceIsolation.all_tenant_roots()
                    assert len(roots) == 3


# ===========================================================================
# QuotaManager Tests
# ===========================================================================


class TestQuotaManager:
    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_can_create_workspace_true(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=["ws1"]):
            mgr = QuotaManager()
            assert mgr.can_create_workspace("tenant-a") is True

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_can_create_workspace_blocked_by_disk(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = [str(512 * 1024 * 1024)]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        mgr = QuotaManager(DiskQuota(per_workspace_bytes=1))
        assert mgr.can_create_workspace("tenant-a") is False

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_can_create_workspace_blocked_by_count(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(
            WorkspaceIsolation, "list_tenant_workspaces",
            return_value=[f"ws{i}" for i in range(100)],
        ):
            mgr = QuotaManager()
            assert mgr.can_create_workspace("tenant-a") is False

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_prepare_workspace_creates_dir(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch("os.makedirs") as mock_makedirs:
            mgr = QuotaManager()
            path = mgr.prepare_workspace("tenant-a", "AIM-42")
            assert "/workspaces/tenant-a/AIM-42" in path
            mock_makedirs.assert_called_once()

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_record_and_release_workspace(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch("os.path.isdir", return_value=True):
            with patch("os.scandir") as mock_scandir:
                entry = MagicMock()
                entry.is_file.return_value = True
                entry.is_dir.return_value = False
                entry.stat.return_value.st_size = 500
                mock_scandir.return_value = [entry]

                mgr = QuotaManager()
                mgr.record_workspace_usage("tenant-a", "/workspaces/t_a/ws1")
                assert mock_client.hincrby.called

                mgr.release_workspace("tenant-a", "/workspaces/t_a/ws1")
                assert mock_client.hdel.called

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_get_usage_summary(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["104857600"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=["ws1", "ws2"]):
            mgr = QuotaManager()
            summary = mgr.get_usage_summary("tenant-a", "free")
            assert summary["tenant_id"] == "tenant-a"
            assert summary["tier"] == "free"
            assert summary["used_bytes"] == 104857600
            assert summary["quota_bytes"] == 512 * 1024 * 1024
            assert summary["workspace_count"] == 2
            assert summary["max_workspaces"] == 5
            assert summary["unlimited"] is False

    def test_can_create_workspace_no_redis(self) -> None:
        with patch("workers.orchestrator.quota._get_redis", return_value=None):
            with patch("workers.orchestrator.workspace_quota._get_redis", return_value=None):
                mgr = QuotaManager()
                assert mgr.can_create_workspace("tenant-a") is True


# ===========================================================================
# QuotaManager LRU Eviction Tests
# ===========================================================================


class TestQuotaManagerLRU:
    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_evict_lru_noop_when_under_limit(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.zcard.return_value = 3  # 3 tracked, limit is 5 for free
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        mgr = QuotaManager()
        evicted = mgr.evict_lru_workspaces("tenant-a")
        assert evicted == []

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_evict_lru_removes_oldest(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.zcard.return_value = 7  # 7 tracked, limit is 5 for free
        mock_client.zrange.return_value = ["/ws/old1", "/ws/old2"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch("os.path.isdir", return_value=False):  # paths don't exist
            mgr = QuotaManager()
            evicted = mgr.evict_lru_workspaces("tenant-a")
            assert len(evicted) == 2
            assert "/ws/old1" in evicted
            assert "/ws/old2" in evicted

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_evict_lru_dry_run(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.zcard.return_value = 7
        mock_client.zrange.return_value = ["/ws/old1", "/ws/old2"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        mgr = QuotaManager()
        evicted = mgr.evict_lru_workspaces("tenant-a", dry_run=True)
        assert len(evicted) == 2
        # Should not have called shutil.rmtree
        mock_client.zrem.assert_not_called()

    def test_evict_no_redis(self) -> None:
        with patch("workers.orchestrator.workspace_quota._get_redis", return_value=None):
            mgr = QuotaManager()
            assert mgr.evict_lru_workspaces("tenant-a") == []

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_evict_all_for_tenant(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.zrange.return_value = ["/ws/1", "/ws/2", "/ws/3"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch("os.path.isdir", return_value=False):
            mgr = QuotaManager()
            count = mgr.evict_all_for_tenant("tenant-a")
            assert count == 3


# ===========================================================================
# PeriodicCleanupTask Tests
# ===========================================================================


class TestPeriodicCleanupTask:
    @patch("workers.orchestrator.workspace_quota._get_redis")
    def test_cleanup_skips_when_recent(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        cleanup = PeriodicCleanupTask()
        # First run should pass (no last_cleanup)
        cleanup.run()
        # Second run immediately after should skip
        result = cleanup.run()
        assert result == {}

    @patch("workers.orchestrator.workspace_quota._get_redis")
    def test_cleanup_forced(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.scan.return_value = (0, [])
        mock_get_redis.return_value = mock_client
        cleanup = PeriodicCleanupTask()
        result = cleanup.run(force=True)
        assert isinstance(result, dict)

    @patch("workers.orchestrator.workspace_quota._get_redis")
    def test_cleanup_scans_tenants(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.scan.return_value = (0, ["stas:quota:t-1:usage", "stas:quota:t-2:usage"])
        mock_client.zcard.return_value = 3  # under limit, no eviction
        mock_get_redis.return_value = mock_client

        cleanup = PeriodicCleanupTask()
        result = cleanup.run(force=True)
        # Both tenants under limit, so no evictions
        assert result == {}

    def test_cleanup_no_redis(self) -> None:
        with patch("workers.orchestrator.workspace_quota._get_redis", return_value=None):
            cleanup = PeriodicCleanupTask()
            assert cleanup.run(force=True) == {}


# ===========================================================================
# Singleton Tests
# ===========================================================================


class TestQuotaSingletons:
    def test_get_disk_quota_singleton(self) -> None:
        q1 = get_disk_quota()
        q2 = get_disk_quota()
        assert q1 is q2

    def test_get_workspace_isolation_singleton(self) -> None:
        w1 = get_workspace_isolation()
        w2 = get_workspace_isolation()
        assert w1 is w2

    def test_get_quota_manager_singleton(self) -> None:
        m1 = get_quota_manager()
        m2 = get_quota_manager()
        assert m1 is m2

    def test_get_periodic_cleanup_singleton(self) -> None:
        p1 = get_periodic_cleanup()
        p2 = get_periodic_cleanup()
        assert p1 is p2


# ===========================================================================
# Tier-Configurable Limit Tests
# ===========================================================================


class TestTierConfigurableLimits:
    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_free_tier_limits(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=[]):
            mgr = QuotaManager()
            summary = mgr.get_usage_summary("tenant-a", "free")
            assert summary["quota_bytes"] == 512 * 1024 * 1024
            assert summary["max_workspaces"] == 5

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_solo_tier_limits(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=[]):
            mgr = QuotaManager()
            summary = mgr.get_usage_summary("tenant-a", "solo")
            assert summary["quota_bytes"] == 2 * 1024 * 1024 * 1024
            assert summary["max_workspaces"] == 20

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_team_tier_limits(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=[]):
            mgr = QuotaManager()
            summary = mgr.get_usage_summary("tenant-a", "team")
            assert summary["quota_bytes"] == 5 * 1024 * 1024 * 1024
            assert summary["max_workspaces"] == 50

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_enterprise_tier_limits(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(WorkspaceIsolation, "list_tenant_workspaces", return_value=[]):
            mgr = QuotaManager()
            summary = mgr.get_usage_summary("tenant-a", "enterprise")
            assert summary["quota_bytes"] == 10 * 1024 * 1024 * 1024
            assert summary["max_workspaces"] == 100


# ===========================================================================
# Edge Cases
# ===========================================================================


class TestQuotaEdgeCases:
    def test_sanitize_special_chars(self) -> None:
        from workers.orchestrator.quota import _sanitize
        assert _sanitize("abc-123_def") == "abc-123_def"
        assert _sanitize("abc/def:ghi") == "abc_def_ghi"
        assert _sanitize("  spaces  ") == "__spaces__"

    def test_sanitize_truncates(self) -> None:
        from workers.orchestrator.quota import _sanitize
        long_name = "a" * 200
        assert len(_sanitize(long_name)) == 64

    @patch("workers.orchestrator.workspace_quota._get_redis")
    @patch("workers.orchestrator.quota._get_redis")
    def test_workspace_count_independent_per_tenant(
        self, mock_quota_redis: MagicMock, mock_wq_redis: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]
        mock_quota_redis.return_value = mock_client
        mock_wq_redis.return_value = mock_client

        with patch.object(
            WorkspaceIsolation, "list_tenant_workspaces",
            side_effect=[
                ["ws1", "ws2", "ws3", "ws4", "ws5"],  # tenant-a: full
                ["ws1"],  # tenant-b: one workspace
            ],
        ):
            mgr = QuotaManager()
            assert mgr.can_create_workspace("tenant-a") is False
            assert mgr.can_create_workspace("tenant-b") is True

    @patch("workers.orchestrator.quota._get_redis")
    def test_get_tenant_remaining_unlimited(self, mock_get_redis: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["500"]
        mock_get_redis.return_value = mock_client
        quota = DiskQuota()
        remaining = quota.get_tenant_remaining("tenant-a", "enterprise")
        # Enterprise: 10 GB quota, 500 bytes used
        assert remaining == 10 * 1024 * 1024 * 1024 - 500
