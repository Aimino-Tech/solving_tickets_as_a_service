"""Comprehensive tests for multi-tenant isolation (AIM-2017)."""

import os
import time
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.tenant_isolation import (
    TenantIsolationManager,
    get_tenant_manager,
)
from workers.orchestrator.tenant_limiter import (
    TenantConcurrencyLimiter,
    TenantTokenBucket,
    get_tenant_concurrency_limiter,
    get_tenant_token_bucket,
)
from workers.orchestrator.engine import PipelineEngine


class TestTenantQueueNaming:
    def test_queue_name_format(self):
        name = TenantIsolationManager.queue_name("tenant-abc")
        assert name == "stas.agents.tenant.tenant_abc"

    def test_queue_name_sanitizes_dots(self):
        name = TenantIsolationManager.queue_name("my.tenant")
        assert name == "stas.agents.tenant.my_tenant"

    def test_queue_name_short_uuid(self):
        tid = "a" * 100
        name = TenantIsolationManager.queue_name(tid)
        assert len(name) <= 84
        assert name.startswith("stas.agents.tenant.")

    def test_binding_key(self):
        key = TenantIsolationManager.binding_key("tenant-abc")
        assert key == "tenant_tenant-abc"

    def test_binding_key_prefix(self):
        key = TenantIsolationManager.binding_key("acme-corp")
        assert key.startswith("tenant_")

    def test_celery_queue_option(self):
        opts = TenantIsolationManager.celery_queue_option("t-1")
        assert opts == {"queue": "stas.agents.tenant.t_1"}

    def test_two_tenants_have_different_queues(self):
        q1 = TenantIsolationManager.queue_name("alpha")
        q2 = TenantIsolationManager.queue_name("beta")
        assert q1 != q2


class TestTenantConcurrency:
    def test_default_is_free(self):
        assert TenantIsolationManager.max_concurrent_agents() == 2

    def test_tier_free(self):
        assert TenantIsolationManager.max_concurrent_agents("free") == 2

    def test_tier_pro(self):
        assert TenantIsolationManager.max_concurrent_agents("pro") == 10

    def test_tier_enterprise(self):
        assert TenantIsolationManager.max_concurrent_agents("enterprise") == 50

    def test_unknown_tier_defaults_to_free(self):
        assert TenantIsolationManager.max_concurrent_agents("platinum") == 2

    def test_case_insensitive(self):
        assert TenantIsolationManager.max_concurrent_agents("PRO") == 10
        assert TenantIsolationManager.max_concurrent_agents("Enterprise") == 50

    def test_tenant_concurrency_limiter_acquire_release(self):
        with patch("workers.orchestrator.tenant_limiter._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_client.scard.return_value = 0
            mock_client.sadd.return_value = 1
            mock_get_redis.return_value = mock_client
            limiter = TenantConcurrencyLimiter()
            assert limiter.acquire("tenant-a", "job-1") is True
            assert limiter.acquire("tenant-b", "job-2") is True
            assert mock_client.sadd.call_count >= 2

    def test_tenant_a_full_does_not_block_tenant_b(self):
        with patch("workers.orchestrator.tenant_limiter._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            def scard_side_effect(key):
                if "tenant-a" in key:
                    return 2
                return 0
            mock_client.scard.side_effect = scard_side_effect
            mock_client.sadd.return_value = 1
            mock_get_redis.return_value = mock_client
            limiter = TenantConcurrencyLimiter()
            assert limiter.acquire("tenant-a", "job-3") is False
            assert limiter.acquire("tenant-b", "job-4") is True

    def test_tenant_concurrency_ceiling(self):
        with patch("workers.orchestrator.tenant_limiter._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_client.scard.return_value = 2
            mock_get_redis.return_value = mock_client
            limiter = TenantConcurrencyLimiter()
            with patch.dict(os.environ, {"TENANT_TENANT_A_TIER": "free"}, clear=False):
                assert limiter.acquire("tenant-a", "job-5") is False

    def test_tenant_concurrency_release(self):
        with patch("workers.orchestrator.tenant_limiter._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_get_redis.return_value = mock_client
            limiter = TenantConcurrencyLimiter()
            limiter.release("tenant-a", "job-1")
            mock_client.srem.assert_called_once_with("stas:tenant_concurrency:tenant-a", "job:job-1")

    def test_active_count(self):
        with patch("workers.orchestrator.tenant_limiter._get_redis") as mock_get_redis:
            mock_client = MagicMock()
            mock_client.scard.return_value = 3
            mock_get_redis.return_value = mock_client
            limiter = TenantConcurrencyLimiter()
            assert limiter.active_count("tenant-a") == 3


class TestTenantWorkspaceIsolation:
    def test_workspace_root_format(self):
        root = TenantIsolationManager.workspace_root("tenant-abc", "AIM-42")
        assert root == "/workspaces/tenant_abc/AIM-42"

    def test_workspace_root_with_github_issue(self):
        root = TenantIsolationManager.workspace_root("acme", "gh-42")
        assert root == "/workspaces/acme/gh-42"

    def test_different_tenants_have_different_roots(self):
        root_a = TenantIsolationManager.workspace_root("tenant-a", "ISSUE-1")
        root_b = TenantIsolationManager.workspace_root("tenant-b", "ISSUE-1")
        assert root_a != root_b

    def test_same_tenant_different_issues(self):
        root_1 = TenantIsolationManager.workspace_root("tenant-a", "AIM-1")
        root_2 = TenantIsolationManager.workspace_root("tenant-a", "AIM-2")
        assert root_1 != root_2
        assert root_1.endswith("AIM-1")
        assert root_2.endswith("AIM-2")

    def test_workspace_root_sanitizes_special_chars(self):
        root = TenantIsolationManager.workspace_root("my.corp/team", "issue/123")
        assert "my_corp" in root
        assert "issue_123" in root

    def test_empty_tenant_id_workspace(self):
        root = TenantIsolationManager.workspace_root("", "ISSUE-1")
        assert "ISSUE-1" in root
        assert root.startswith("/workspaces/")


class TestTenantRateLimit:
    @patch("workers.billing.tenant_isolation._get_redis")
    def test_check_rate_limit_allows(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 0
        mock_get_redis.return_value = mock_client
        manager = TenantIsolationManager()
        assert manager.check_rate_limit("tenant-a", max_requests=5, window_s=60) is True

    @patch("workers.billing.tenant_isolation._get_redis")
    def test_check_rate_limit_blocks(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 5
        mock_get_redis.return_value = mock_client
        manager = TenantIsolationManager()
        assert manager.check_rate_limit("tenant-a", max_requests=5, window_s=60) is False

    @patch("workers.billing.tenant_isolation._get_redis")
    def test_tenant_a_rate_limited_does_not_affect_tenant_b(self, mock_get_redis):
        mock_client = MagicMock()
        def zcard_side_effect(key):
            if "tenant-a" in key:
                return 5
            return 0
        mock_client.zcard.side_effect = zcard_side_effect
        mock_get_redis.return_value = mock_client
        manager = TenantIsolationManager()
        assert manager.check_rate_limit("tenant-a", max_requests=5, window_s=60) is False
        assert manager.check_rate_limit("tenant-b", max_requests=5, window_s=60) is True

    @patch("workers.billing.tenant_isolation._get_redis")
    def test_rate_limit_remaining(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.zcard.return_value = 3
        mock_get_redis.return_value = mock_client
        manager = TenantIsolationManager()
        remaining = manager.rate_limit_remaining("tenant-a", max_requests=10, window_s=60)
        assert remaining == 7

    @patch("workers.billing.tenant_isolation._get_redis")
    def test_rate_limit_reset(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        manager = TenantIsolationManager()
        manager.reset_rate_limit("tenant-a")
        mock_client.delete.assert_called_once()

    @patch("workers.billing.tenant_isolation._get_redis")
    def test_rate_limit_redis_unavailable(self, mock_get_redis):
        mock_get_redis.return_value = None
        manager = TenantIsolationManager()
        assert manager.check_rate_limit("tenant-a") is True
        assert manager.rate_limit_remaining("tenant-a") == 100


class TestTenantTokenBucket:
    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_consume_returns_true_when_tokens_available(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = [None, None]
        mock_get_redis.return_value = mock_client
        bucket = TenantTokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.consume("tenant-a") is True

    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_consume_returns_false_when_empty(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["0", str(time.time())]
        mock_get_redis.return_value = mock_client
        bucket = TenantTokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.consume("tenant-a") is False

    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_remaining_after_consumption(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["5", str(time.time())]
        mock_get_redis.return_value = mock_client
        bucket = TenantTokenBucket(capacity=10, refill_rate=1.0)
        remaining = bucket.remaining("tenant-a")
        assert remaining == pytest.approx(5, abs=0.1)

    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_reset(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        bucket = TenantTokenBucket()
        bucket.reset("tenant-a")
        assert mock_client.delete.call_count == 2

    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_independent_tenants(self, mock_get_redis):
        mock_client = MagicMock()
        def get_side_effect(key):
            if "tenant-a" in key and "ts" in key:
                return str(time.time())
            if "tenant-a" in key:
                return "10"
            if "tenant-b" in key and "ts" in key:
                return str(time.time())
            if "tenant-b" in key:
                return "0"
            return None
        mock_client.get.side_effect = get_side_effect
        mock_get_redis.return_value = mock_client
        bucket = TenantTokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.consume("tenant-a") is True
        assert bucket.consume("tenant-b") is False

    def test_redis_unavailable(self):
        bucket = TenantTokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.consume("tenant-a") is True
        assert bucket.remaining("tenant-a") >= 0


class TestTenantSummary:
    def test_tenant_summary_shape(self):
        summary = get_tenant_manager().tenant_summary("t-1")
        assert isinstance(summary, dict)
        assert summary["tenant_id"] == "t-1"
        assert "queue" in summary
        assert "binding_key" in summary
        assert "max_concurrent_agents" in summary
        assert "workspace_root" in summary
        assert "rate_limit_remaining" in summary

    def test_tenant_summary_tier_default(self):
        summary = get_tenant_manager().tenant_summary("t-1")
        assert summary["tier"] == "free"
        assert summary["max_concurrent_agents"] == 2


class TestPipelineTenantIntegration:
    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.pipelines.build_canvas")
    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_pipeline_start_with_tenant_context(
        self, mock_tl_redis, mock_build_canvas, mock_engine_redis
    ):
        mock_engine_client = MagicMock()
        mock_engine_client.get.return_value = None
        mock_engine_client.scard.return_value = 0
        mock_engine_client.sadd.return_value = 1
        mock_engine_redis.return_value = mock_engine_client

        mock_tl_client = MagicMock()
        mock_tl_client.scard.return_value = 0
        mock_tl_client.sadd.return_value = 1
        mock_tl_redis.return_value = mock_tl_client

        mock_canvas = MagicMock()
        mock_async_result = MagicMock()
        mock_async_result.id = "async-123"
        mock_canvas.delay.return_value = mock_async_result
        mock_build_canvas.return_value = mock_canvas

        engine = PipelineEngine()
        pipeline_id = engine.start_pipeline(
            "ISSUE-42", "stas:fix",
            {
                "tenant_id": "acme-corp",
                "tenant_tier": "pro",
                "repo_url": "https://github.com/test/repo.git",
                "issue_identifier": "gh-42",
            },
        )
        assert pipeline_id is not None

    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.pipelines.build_canvas")
    def test_pipeline_without_tenant_still_works(
        self, mock_build_canvas, mock_engine_redis
    ):
        mock_engine_client = MagicMock()
        mock_engine_client.get.return_value = None
        mock_engine_client.scard.return_value = 0
        mock_engine_client.sadd.return_value = 1
        mock_engine_redis.return_value = mock_engine_client

        mock_canvas = MagicMock()
        mock_async_result = MagicMock()
        mock_async_result.id = "async-456"
        mock_canvas.delay.return_value = mock_async_result
        mock_build_canvas.return_value = mock_canvas

        engine = PipelineEngine()
        pipeline_id = engine.start_pipeline(
            "ISSUE-99", "stas:fix",
            {"repo_url": "https://github.com/test/repo.git", "issue_identifier": "gh-99"},
        )
        assert pipeline_id is not None

    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.pipelines.build_canvas")
    @patch("workers.orchestrator.tenant_limiter._get_redis")
    def test_pipeline_state_includes_tenant(
        self, mock_tl_redis, mock_build_canvas, mock_engine_redis
    ):
        mock_engine_client = MagicMock()
        mock_engine_client.get.return_value = None
        mock_engine_client.scard.return_value = 0
        mock_engine_client.sadd.return_value = 1
        mock_engine_redis.return_value = mock_engine_client

        mock_tl_client = MagicMock()
        mock_tl_client.scard.return_value = 0
        mock_tl_client.sadd.return_value = 1
        mock_tl_redis.return_value = mock_tl_client

        mock_canvas = MagicMock()
        mock_async_result = MagicMock()
        mock_async_result.id = "async-789"
        mock_canvas.delay.return_value = mock_async_result
        mock_build_canvas.return_value = mock_canvas

        engine = PipelineEngine()
        engine.start_pipeline(
            "ISSUE-55", "stas:fix",
            {
                "tenant_id": "corp-a",
                "tenant_tier": "enterprise",
                "repo_url": "https://github.com/test/repo.git",
                "issue_identifier": "gh-55",
            },
        )
        set_calls = mock_engine_client.set.call_args_list
        state_writes = [call for call in set_calls if call[0][0].startswith("pipeline:")]
        assert len(state_writes) >= 1


class TestTenantEdgeCases:
    def test_manager_singleton(self):
        m1 = get_tenant_manager()
        m2 = get_tenant_manager()
        assert m1 is m2

    def test_concurrency_limiter_singleton(self):
        l1 = get_tenant_concurrency_limiter()
        l2 = get_tenant_concurrency_limiter()
        assert l1 is l2

    def test_token_bucket_singleton(self):
        b1 = get_tenant_token_bucket()
        b2 = get_tenant_token_bucket()
        assert b1 is b2

    def test_sanitize_workspace_root(self):
        root = TenantIsolationManager.workspace_root("tenant with spaces", "issue/path")
        assert root is not None
        assert len(root) > 0
