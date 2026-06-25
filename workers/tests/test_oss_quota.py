"""Comprehensive tests for OSS workspace quota and isolation (AIM-2042)."""

import os
import time
from unittest.mock import MagicMock, call, patch

import pytest

from workers.orchestrator.oss_quota import (
    OssDiskQuota,
    OssLruCleanup,
    WorkspaceIsolation,
    get_disk_quota,
    get_lru_cleanup,
    get_workspace_isolation,
    _resolve_tier,
    _sanitize,
    _quota_for_tier,
    _lru_max_for_tier,
)


# =========================================================================
# Tier Resolution
# =========================================================================


class TestTierResolution:
    def test_default_tier_is_free(self):
        assert _resolve_tier("any-tenant") == "free"

    def test_explicit_tier(self):
        assert _resolve_tier("any-tenant", "pro") == "pro"

    def test_enterprise_tier(self):
        assert _resolve_tier("any-tenant", "enterprise") == "enterprise"

    def test_unknown_tier_defaults_to_free(self):
        assert _resolve_tier("any-tenant", "platinum") == "free"

    def test_case_insensitive(self):
        assert _resolve_tier("any-tenant", "PRO") == "pro"
        assert _resolve_tier("any-tenant", "Enterprise") == "enterprise"

    def test_env_var_override(self):
        with patch.dict(os.environ, {"TENANT_MY_TENANT_TIER": "pro"}, clear=False):
            assert _resolve_tier("my-tenant") == "pro"

    def test_quota_for_free_tier(self):
        quota = _quota_for_tier("free")
        assert quota == 512 * 1024 * 1024  # 512 MB

    def test_quota_for_pro_tier(self):
        quota = _quota_for_tier("pro")
        assert quota == 2 * 1024 * 1024 * 1024  # 2 GB

    def test_quota_for_enterprise(self):
        quota = _quota_for_tier("enterprise")
        assert quota == -1  # unlimited

    def test_lru_max_free(self):
        assert _lru_max_for_tier("free") == 5

    def test_lru_max_pro(self):
        assert _lru_max_for_tier("pro") == 20

    def test_lru_max_enterprise(self):
        assert _lru_max_for_tier("enterprise") == 100

    def test_unknown_tier_lru_defaults(self):
        assert _lru_max_for_tier("unknown") == 5


# =========================================================================
# Sanitize
# =========================================================================


class TestSanitize:
    def test_sanitize_keeps_alphanumeric(self):
        assert _sanitize("tenant-abc") == "tenant-abc"

    def test_sanitize_replaces_special_chars(self):
        assert _sanitize("my.corp/team") == "my_corp_team"

    def test_sanitize_truncates_long(self):
        long_name = "a" * 100
        result = _sanitize(long_name)
        assert len(result) == 64

    def test_sanitize_strips_spaces(self):
        assert _sanitize("tenant with spaces") == "tenant_with_spaces"


# =========================================================================
# WorkspaceIsolation
# =========================================================================


class TestWorkspaceIsolation:
    def test_workspace_root_format(self):
        root = WorkspaceIsolation.workspace_root("tenant-abc", "AIM-42")
        assert root == "/workspaces/tenant-abc/AIM-42"

    def test_workspace_root_with_github_issue(self):
        root = WorkspaceIsolation.workspace_root("acme", "gh-42")
        assert root == "/workspaces/acme/gh-42"

    def test_different_tenants_have_different_roots(self):
        root_a = WorkspaceIsolation.workspace_root("tenant-a", "ISSUE-1")
        root_b = WorkspaceIsolation.workspace_root("tenant-b", "ISSUE-1")
        assert root_a != root_b

    def test_same_tenant_different_issues(self):
        root_1 = WorkspaceIsolation.workspace_root("tenant-a", "AIM-1")
        root_2 = WorkspaceIsolation.workspace_root("tenant-a", "AIM-2")
        assert root_1 != root_2
        assert root_1.endswith("AIM-1")
        assert root_2.endswith("AIM-2")

    def test_workspace_root_sanitizes_special_chars(self):
        root = WorkspaceIsolation.workspace_root("my.corp/team", "issue/123")
        assert "my_corp" in root
        assert "issue_123" in root

    def test_ensure_isolation_valid(self):
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/acme/AIM-42", "acme"
        ) is True

    def test_ensure_isolation_path_traversal(self):
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/evil/etc/passwd", "acme"
        ) is False

    def test_ensure_isolation_outside_root(self):
        assert WorkspaceIsolation.ensure_isolation(
            "/tmp/malicious", "acme"
        ) is False

    def test_ensure_isolation_exact_root(self):
        assert WorkspaceIsolation.ensure_isolation(
            "/workspaces/acme", "acme"
        ) is True

    def test_list_tenant_workspaces_nonexistent(self):
        workspaces = WorkspaceIsolation.list_tenant_workspaces("nonexistent")
        assert workspaces == []

    def test_list_tenant_workspaces_with_dir(self, tmp_path):
        tenant_root = tmp_path / "workspaces" / "my_tenant"
        tenant_root.mkdir(parents=True)
        (tenant_root / "AIM-1").mkdir()
        (tenant_root / "AIM-2").mkdir()

        with patch("workers.orchestrator.oss_quota._WORKSPACE_ROOT", str(tmp_path / "workspaces")):
            workspaces = WorkspaceIsolation.list_tenant_workspaces("my_tenant")
            assert len(workspaces) == 2

    def test_all_tenant_roots(self, tmp_path):
        root = tmp_path / "workspaces"
        root.mkdir()
        (root / "tenant_a").mkdir()
        (root / "tenant_b").mkdir()

        with patch("workers.orchestrator.oss_quota._WORKSPACE_ROOT", str(root)):
            roots = WorkspaceIsolation.all_tenant_roots()
            assert len(roots) == 2


# =========================================================================
# OssDiskQuota
# =========================================================================


class TestOssDiskQuota:
    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_check_quota_allows_when_under(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100"]  # 100 bytes used
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota(per_workspace_bytes=256)
        # Free tier has 512 MB quota, used only 100 bytes
        assert quota.check_quota("tenant-a") is True

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_check_quota_blocks_when_exceeded(self, mock_get_redis):
        mock_client = MagicMock()
        # Return usage that exceeds free tier quota (512 MB)
        mock_client.hvals.return_value = [str(513 * 1024 * 1024)]
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota(per_workspace_bytes=256)
        assert quota.check_quota("tenant-a") is False

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_check_quota_with_estimated_bytes(self, mock_get_redis):
        mock_client = MagicMock()
        # Return usage close to quota
        mock_client.hvals.return_value = [str(500 * 1024 * 1024)]
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota(per_workspace_bytes=256)
        # 500 MB used, 12 MB remaining, requesting 256 MB — should block
        assert quota.check_quota("tenant-a", estimated_bytes=256 * 1024 * 1024) is False

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_check_quota_pro_tier(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.hvals.return_value = [str(1024 * 1024 * 1024)]  # 1 GB
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota(per_workspace_bytes=256)
        # Pro tier has 2 GB quota, 1 GB used — should allow
        assert quota.check_quota("tenant-a", tier="pro") is True

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_check_quota_enterprise_unlimited(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.hvals.return_value = [str(100 * 1024 * 1024 * 1024)]  # 100 GB
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota(per_workspace_bytes=256)
        # Enterprise tier unlimited — should always allow
        assert quota.check_quota("tenant-a", tier="enterprise") is True

    def test_check_quota_redis_unavailable(self):
        with patch("workers.orchestrator.oss_quota._get_redis", return_value=None):
            quota = OssDiskQuota()
            assert quota.check_quota("tenant-a") is True  # graceful degradation

    def test_per_workspace_quota_nonexistent(self):
        quota = OssDiskQuota(per_workspace_bytes=100)
        assert quota.check_per_workspace_quota("/nonexistent/path") is True

    def test_per_workspace_quota_within(self, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        (ws / "file.txt").write_text("a" * 50)

        quota = OssDiskQuota(per_workspace_bytes=100)
        assert quota.check_per_workspace_quota(str(ws)) is True

    def test_per_workspace_quota_exceeded(self, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        (ws / "file.txt").write_text("a" * 200)

        quota = OssDiskQuota(per_workspace_bytes=100)
        assert quota.check_per_workspace_quota(str(ws)) is False

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_record_and_get_usage(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota()
        quota.record_usage("tenant-a", "/workspaces/a/ws1", 1024)
        mock_client.hincrby.assert_called_once_with(
            "stas:oss:quota:tenant-a:usage", "/workspaces/a/ws1", 1024
        )

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_release_usage(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota()
        quota.release_usage("tenant-a", "/workspaces/a/ws1")
        mock_client.hdel.assert_called_once_with(
            "stas:oss:quota:tenant-a:usage", "/workspaces/a/ws1"
        )

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_get_tenant_usage(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.hvals.return_value = ["100", "200", "300"]
        mock_get_redis.return_value = mock_client

        quota = OssDiskQuota()
        assert quota.get_tenant_usage("tenant-a") == 600

    def test_get_tenant_usage_no_redis(self):
        with patch("workers.orchestrator.oss_quota._get_redis", return_value=None):
            quota = OssDiskQuota()
            assert quota.get_tenant_usage("tenant-a") == 0

    def test_get_tenant_quota_free(self):
        quota = OssDiskQuota()
        assert quota.get_tenant_quota("tenant-a") == 512 * 1024 * 1024

    def test_get_tenant_quota_pro(self):
        quota = OssDiskQuota()
        assert quota.get_tenant_quota("tenant-a", "pro") == 2 * 1024 * 1024 * 1024

    def test_get_tenant_remaining_free(self, tmp_path):
        with patch("workers.orchestrator.oss_quota._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_client.hvals.return_value = [str(100 * 1024 * 1024)]  # 100 MB used
            mock_get_redis.return_value = mock_client

            quota = OssDiskQuota()
            remaining = quota.get_tenant_remaining("tenant-a")
            # 512 MB - 100 MB = 412 MB
            assert remaining == 412 * 1024 * 1024

    def test_get_tenant_remaining_unlimited(self):
        with patch("workers.orchestrator.oss_quota._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_get_redis.return_value = mock_client

            quota = OssDiskQuota()
            remaining = quota.get_tenant_remaining("tenant-a", "enterprise")
            assert remaining == -1

    def test_dir_size(self, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        (ws / "a.txt").write_text("a" * 100)
        (ws / "b.txt").write_text("b" * 200)
        sub = ws / "sub"
        sub.mkdir()
        (sub / "c.txt").write_text("c" * 300)

        size = OssDiskQuota._dir_size(str(ws))
        assert size == 600


# =========================================================================
# OssLruCleanup
# =========================================================================


class TestOssLruCleanup:
    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_record_access(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        lru.record_access("tenant-a", "/workspaces/a/ws1")
        assert mock_client.zadd.called

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_remove_workspace(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        lru.remove_workspace("tenant-a", "/workspaces/a/ws1")
        mock_client.zrem.assert_called_once_with(
            "stas:oss:lru:tenant-a:access", "/workspaces/a/ws1"
        )

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_evict_lru_no_excess(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 3  # 3 workspaces, free limit is 5
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        evicted = lru.evict_lru("tenant-a")
        assert evicted == []

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_evict_lru_with_excess(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 7  # 7 workspaces, free limit is 5 — 2 excess
        mock_client.zrange.return_value = ["/workspaces/a/old1", "/workspaces/a/old2"]
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        with patch("workers.orchestrator.oss_quota.os.path.isdir", return_value=False):
            evicted = lru.evict_lru("tenant-a")
            # Paths don't exist, so no filesystem removal, but still removed from Redis
            assert len(evicted) == 2

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_evict_lru_dry_run(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 7
        mock_client.zrange.return_value = ["/workspaces/a/old1"]
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        evicted = lru.evict_lru("tenant-a", dry_run=True)
        assert len(evicted) == 1
        # Should not have called zrem or shutil
        mock_client.zrem.assert_not_called()

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_evict_lru_removes_directory(self, mock_get_redis, tmp_path):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 7
        ws_to_evict = tmp_path / "old_workspace"
        ws_to_evict.mkdir()
        (ws_to_evict / "file.txt").write_text("data")

        mock_client.zrange.return_value = [str(ws_to_evict)]
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        with patch("workers.orchestrator.oss_quota.os.path.isdir", return_value=True):
            with patch("workers.orchestrator.oss_quota.shutil.rmtree") as mock_rmtree:
                evicted = lru.evict_lru("tenant-a")
                assert len(evicted) == 1
                mock_rmtree.assert_called_once_with(str(ws_to_evict))

    @patch("workers.orchestrator.oss_quota._get_redis")
    def test_evict_all_for_tenant(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zrange.return_value = ["/ws/a", "/ws/b"]
        mock_get_redis.return_value = mock_client

        lru = OssLruCleanup()
        with patch("workers.orchestrator.oss_quota.os.path.isdir", return_value=False):
            count = lru.evict_all_for_tenant("tenant-a")
            assert count == 2

    def test_evict_lru_no_redis(self):
        with patch("workers.orchestrator.oss_quota._get_redis", return_value=None):
            lru = OssLruCleanup()
            assert lru.evict_lru("tenant-a") == []

    def test_periodic_cleanup_respects_interval(self):
        lru = OssLruCleanup()
        lru._last_cleanup = time.time()  # just ran
        result = lru.periodic_cleanup(force=False)
        assert result == {}  # skipped due to interval

    def test_periodic_cleanup_force(self):
        lru = OssLruCleanup()
        lru._last_cleanup = time.time()
        with patch("workers.orchestrator.oss_quota._get_redis", return_value=None):
            result = lru.periodic_cleanup(force=True)
            assert result == {}  # no Redis, no-op


# =========================================================================
# Singletons
# =========================================================================


class TestSingletons:
    def test_disk_quota_singleton(self):
        q1 = get_disk_quota()
        q2 = get_disk_quota()
        assert q1 is q2

    def test_workspace_isolation_singleton(self):
        w1 = get_workspace_isolation()
        w2 = get_workspace_isolation()
        assert w1 is w2

    def test_lru_cleanup_singleton(self):
        l1 = get_lru_cleanup()
        l2 = get_lru_cleanup()
        assert l1 is l2
