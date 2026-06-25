"""Tests for enterprise tier module."""
from __future__ import annotations
import os
from unittest.mock import MagicMock, patch
import pytest
from workers.billing.enterprise import (
    EnterprisePlan, EnterpriseFeature, EnterpriseFeatureFlag,
    EnterpriseProvisioningResult, ComplianceArtifact,
    get_enterprise_plan, get_enterprise_feature_flags,
    is_enterprise_feature_enabled, get_compliance_artifacts,
    create_enterprise_stripe_product, is_enterprise_tier,
    get_enterprise_tenant_ids, get_enterprise_queue_config,
    provision_enterprise_stripe_product_sync,
)

class TestEnterprisePlan:
    def test_plan_id(self): assert get_enterprise_plan().id == "enterprise"
    def test_unlimited_fixes(self): assert get_enterprise_plan().monthly_fix_limit == -1
    def test_high_concurrency(self): assert get_enterprise_plan().concurrent_fixes >= 50
    def test_positive_price(self): assert get_enterprise_plan().base_price_cents > 0
    def test_has_stripe_id(self): assert get_enterprise_plan().stripe_price_id != ""
    def test_sso_enabled(self): assert get_enterprise_plan().sso_saml is True
    def test_dedicated_support(self): assert get_enterprise_plan().dedicated_support is True
    def test_to_dict(self):
        d = get_enterprise_plan().to_dict()
        assert d["id"] == "enterprise"
        assert d["monthlyFixLimit"] == -1
        assert len(d["features"]) >= 5

class TestFeatures:
    def test_all_defined(self): assert len(EnterpriseFeature.all_features()) >= 5
    def test_flags_have_keys(self):
        for f in get_enterprise_feature_flags():
            assert "key" in f and "label" in f and "description" in f
    def test_unique_keys(self):
        keys = [f["key"] for f in get_enterprise_feature_flags()]
        assert len(keys) == len(set(keys))
    def test_security_features(self):
        sec = [f for f in get_enterprise_feature_flags() if f["category"] == "security"]
        assert len(sec) >= 2

class TestCompliance:
    def test_artifacts_not_empty(self): assert len(get_compliance_artifacts()) >= 3
    def test_artifacts_have_fields(self):
        for a in get_compliance_artifacts():
            assert "id" in a and "name" in a and "type" in a
    def test_soc2_present(self):
        assert any(a["type"] == "soc2" for a in get_compliance_artifacts())
    def test_all_available(self):
        assert all(a["available"] for a in get_compliance_artifacts())

class TestStripe:
    def test_no_key(self):
        with patch.dict(os.environ, {}, clear=True):
            r = create_enterprise_stripe_product()
            assert r.success is False and r.error is not None
    def test_existing_price(self):
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk_test","STRIPE_ENTERPRISE_PRICE_ID":"price_custom"}):
            with patch("stripe.Price.retrieve") as m:
                p = MagicMock(); p.id = "price_custom"; p.product = "prod_e"
                m.return_value = p
                r = create_enterprise_stripe_product()
                assert r.success and r.price_id == "price_custom"
    def test_creates_new(self):
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk_test","STRIPE_ENTERPRISE_PRICE_ID":"price_enterprise"}):
            with patch("stripe.Product.create") as mp, patch("stripe.Price.create") as mpr:
                mp.return_value = MagicMock(id="prod_new")
                mpr.return_value = MagicMock(id="price_new")
                r = create_enterprise_stripe_product()
                assert r.success and r.product_id == "prod_new"
    def test_stripe_error(self):
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk_test"}):
            with patch("stripe.Product.create", side_effect=Exception("API error")):
                assert create_enterprise_stripe_product().success is False
    def test_provision_sync(self):
        with patch("workers.billing.enterprise.create_enterprise_stripe_product") as m:
            m.return_value = EnterpriseProvisioningResult(True, "p", "pr")
            r = provision_enterprise_stripe_product_sync()
            assert r["success"] and r["productId"] == "p"

class TestTierCheck:
    def test_enterprise_true(self):
        with patch.dict(os.environ, {"TENANT_ACME_TIER":"enterprise"}):
            assert is_enterprise_tier("acme") is True
    def test_enterprise_false(self):
        with patch.dict(os.environ, {"TENANT_ACME_TIER":"free"}):
            assert is_enterprise_tier("acme") is False
    def test_default_false(self):
        with patch.dict(os.environ, {}, clear=True):
            assert is_enterprise_tier("x") is False
    def test_get_tenant_ids(self):
        with patch.dict(os.environ, {"TENANT_A_TIER":"enterprise","TENANT_B_TIER":"free"}):
            ids = get_enterprise_tenant_ids()
            assert "a" in ids and "b" not in ids

class TestQueue:
    def test_priority(self): assert get_enterprise_queue_config()["priority"] == 10
    def test_high_concurrency(self): assert get_enterprise_queue_config()["max_concurrency"] >= 10
    def test_long_timeout(self): assert get_enterprise_queue_config()["sandbox_timeout_ms"] >= 600_000

class TestEdgeCases:
    def test_plan_no_mock(self):
        p = EnterprisePlan(); assert p.id == "enterprise" and p.monthly_fix_limit == -1
    def test_feature_flag(self):
        f = EnterpriseFeatureFlag("t","T","desc"); assert f.key == "t" and f.enabled
    def test_compliance_dc(self):
        a = ComplianceArtifact("id","n","d","t","1",True); assert a.id == "id"
    def test_provision_fail(self):
        r = EnterpriseProvisioningResult(False, error="err"); assert not r.success
    def test_provision_ok(self):
        r = EnterpriseProvisioningResult(True, "p", "pr"); assert r.success and r.price_id == "pr"
