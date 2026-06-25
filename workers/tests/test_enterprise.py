"""Tests for enterprise tier."""
from __future__ import annotations
import os
from unittest.mock import MagicMock, patch
from workers.billing.enterprise import EnterprisePlan, EnterpriseFeature, FF, EPR, CA, get_enterprise_plan, get_feature_flags, get_compliance, create_stripe_product, is_enterprise, get_enterprise_ids, queue_config, provision_sync

def test_plan_id(): assert get_enterprise_plan().id == "enterprise"
def test_unlimited(): assert get_enterprise_plan().monthly_fix_limit == -1
def test_concurrency(): assert get_enterprise_plan().concurrent_fixes >= 50
def test_sso(): assert get_enterprise_plan().sso_saml
def test_to_dict():
    d = get_enterprise_plan().to_dict()
    assert d["id"] == "enterprise" and d["monthlyFixLimit"] == -1 and len(d["features"]) >= 5
def test_features_nonempty(): assert len(get_feature_flags()) >= 5
def test_features_have_keys(): assert all("key" in f and "label" in f for f in get_feature_flags())
def test_compliance_has_items(): assert len(get_compliance()) >= 3
def test_compliance_soc2(): assert any(a["type"] == "soc2" for a in get_compliance())
def test_stripe_no_key():
    with patch.dict(os.environ, {}, clear=True): assert create_stripe_product().success is False
def test_stripe_existing():
    with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk","STRIPE_ENTERPRISE_PRICE_ID":"price_custom"}):
        with patch("stripe.Price.retrieve") as m:
            p = MagicMock(); p.id = "price_custom"; p.product = "prod_e"
            m.return_value = p; r = create_stripe_product(); assert r.success and r.price_id == "price_custom"
def test_stripe_new():
    with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk","STRIPE_ENTERPRISE_PRICE_ID":"price_enterprise"}):
        with patch("stripe.Product.create") as mp, patch("stripe.Price.create") as mpr:
            mp.return_value = MagicMock(id="prod_n"); mpr.return_value = MagicMock(id="price_n")
            r = create_stripe_product(); assert r.success
def test_stripe_error():
    with patch.dict(os.environ, {"STRIPE_SECRET_KEY":"sk"}):
        with patch("stripe.Product.create", side_effect=Exception("err")): assert create_stripe_product().success is False
def test_provision():
    with patch("workers.billing.enterprise.create_stripe_product") as m:
        m.return_value = EPR(True, "p", "pr"); r = provision_sync(); assert r["success"] and r["productId"] == "p"
def test_tier_true():
    with patch.dict(os.environ, {"TENANT_A_TIER":"enterprise"}): assert is_enterprise("a") is True
def test_tier_false():
    with patch.dict(os.environ, {"TENANT_A_TIER":"free"}): assert is_enterprise("a") is False
def test_tier_default():
    with patch.dict(os.environ, {}, clear=True): assert is_enterprise("x") is False
def test_get_ids():
    with patch.dict(os.environ, {"TENANT_A_TIER":"enterprise","TENANT_B_TIER":"free"}):
        ids = get_enterprise_ids(); assert "a" in ids and "b" not in ids
def test_queue_priority(): assert queue_config()["priority"] == 10
def test_queue_timeout(): assert queue_config()["sandbox_timeout_ms"] >= 600000
def test_plan_dc(): p = EnterprisePlan(); assert p.id == "enterprise" and p.monthly_fix_limit == -1
def test_ff_dc(): f = FF("t","T","desc"); assert f.key == "t" and f.enabled
def test_ca_dc(): a = CA("i","n","t"); assert a.id == "i" and a.available
def test_epr_fail(): r = EPR(False, error="err"); assert not r.success
def test_epr_ok(): r = EPR(True, "p", "pr"); assert r.success and r.price_id == "pr"
def test_enum(): assert EnterpriseFeature.SSO_SAML.value == "sso_saml"
