import os
import tempfile

import pytest

from workers.tenancy.tenant_queue import TenantQueueManager, STAS_TENANT_EXCHANGE
from workers.tenancy.workspace_isolation import WorkspaceIsolation
from workers.tenancy.rate_limiter import TenantRateLimiter, TokenBucketRateLimiter
from workers.tenancy.concurrency import TenantConcurrencyManager, TIER_CONCURRENCY_LIMITS


class TestTenantQueueManager:
    def test_get_queue_name(self):
        mgr = TenantQueueManager()
        assert mgr.get_queue_name("tenant-1") == "stas.tenant.tenant-1.dispatch"

    def test_get_queue_creates_once(self):
        mgr = TenantQueueManager()
        q1 = mgr.get_queue("tenant-1")
        q2 = mgr.get_queue("tenant-1")
        assert q1 is q2

    def test_task_route(self):
        mgr = TenantQueueManager()
        route = mgr.get_task_route("tenant-1")
        assert route["queue"] == "stas.tenant.tenant-1.dispatch"
        assert route["exchange"] == STAS_TENANT_EXCHANGE.name

    def test_different_tenants_have_different_queues(self):
        mgr = TenantQueueManager()
        q1 = mgr.get_queue("tenant-a")
        q2 = mgr.get_queue("tenant-b")
        assert q1.name != q2.name


class TestWorkspaceIsolation:
    def test_get_workspace_path(self):
        iso = WorkspaceIsolation(root="/tmp/test-workspaces")
        path = iso.get_workspace_path("tenant-1", "ISS-1")
        assert path == "/tmp/test-workspaces/tenant-1/ISS-1"

    def test_create_and_clean_workspace(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            iso = WorkspaceIsolation(root=tmpdir)
            path = iso.create_workspace("t1", "ISS-1")
            assert os.path.isdir(path)
            assert iso.clean_workspace("t1", "ISS-1") is True
            assert os.path.isdir(path) is False

    def test_workspace_isolation_between_tenants(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            iso = WorkspaceIsolation(root=tmpdir)
            p1 = iso.create_workspace("tenant-a", "ISS-1")
            p2 = iso.create_workspace("tenant-b", "ISS-1")
            assert p1 != p2
            assert "/tenant-a/" in p1
            assert "/tenant-b/" in p2


class TestTenantRateLimiter:
    def test_allows_free_tier_usage(self):
        limiter = TenantRateLimiter(redis_client=None)
        allowed, msg = limiter.check_dispatch_allowed("t1", "free")
        assert allowed is True

    def test_records_usage(self):
        limiter = TenantRateLimiter(redis_client=None)
        limiter.record_usage("t1", "free")
        usage = limiter.get_usage("t1", "free")
        assert usage["tenant_id"] == "t1"
        assert usage["tier"] == "free"

    def test_token_bucket_no_redis(self):
        bucket = TokenBucketRateLimiter(redis_client=None)
        assert bucket.check_and_consume("t1") is True
        assert bucket.get_remaining("t1") == 10.0


class TestTenantConcurrencyManager:
    def test_tier_limits(self):
        mgr = TenantConcurrencyManager(redis_client=None)
        assert mgr.get_max_concurrent("free") == 1
        assert mgr.get_max_concurrent("pro") == 3
        assert mgr.get_max_concurrent("enterprise") == 10

    def test_acquire_without_redis(self):
        mgr = TenantConcurrencyManager(redis_client=None)
        assert mgr.acquire("t1", "free") is True

    def test_release_without_redis(self):
        mgr = TenantConcurrencyManager(redis_client=None)
        mgr.release("t1")

    def test_get_status_without_redis(self):
        mgr = TenantConcurrencyManager(redis_client=None)
        status = mgr.get_status("t1", "pro")
        assert status["tenant_id"] == "t1"
        assert status["tier"] == "pro"


def test_tenants_can_run_agents_without_interference():
    mgr_a = TenantConcurrencyManager(redis_client=None)
    mgr_b = TenantConcurrencyManager(redis_client=None)
    assert mgr_a.get_max_concurrent("free") == 1
    assert mgr_b.get_max_concurrent("enterprise") == 10


def test_workspace_roots_fully_separated():
    with tempfile.TemporaryDirectory() as tmpdir:
        iso = WorkspaceIsolation(root=tmpdir)
        p_a = iso.create_workspace("tenant-a", "ISS-1")
        p_b = iso.create_workspace("tenant-b", "ISS-1")
        assert p_a.startswith(str(tmpdir / "tenant-a"))
        assert p_b.startswith(str(tmpdir / "tenant-b"))


def test_workspace_size():
    with tempfile.TemporaryDirectory() as tmpdir:
        iso = WorkspaceIsolation(root=tmpdir)
        path = iso.create_workspace("t1", "ISS-1")
        test_file = os.path.join(path, "test.txt")
        with open(test_file, "w") as f:
            f.write("hello" * 100)
        size = iso.get_workspace_size("t1", "ISS-1")
        assert size > 0
