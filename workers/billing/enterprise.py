"""Enterprise tier — pricing, Stripe product, feature flags, compliance."""
from __future__ import annotations
import logging, os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

BP = int(os.getenv("ENTERPRISE_BASE_PRICE_CENTS", "250000"))
PID = os.getenv("STRIPE_ENTERPRISE_PRICE_ID", "price_enterprise")

class EnterpriseFeature(Enum):
    SSO_SAML = "sso_saml"; DEDICATED_SUPPORT = "dedicated_support"
    COMPLIANCE_ARTIFACTS = "compliance_artifacts"; CUSTOM_SLA = "custom_sla"
    AUDIT_LOG_EXPORT = "audit_log_export"; PRIORITY_QUEUE = "priority_queue"
    PRIVATE_SANDBOX = "private_sandbox"; CUSTOM_WEBHOOKS = "custom_webhooks"
    UNLIMITED_FIXES = "unlimited_fixes"; SCIM_PROVISIONING = "scim_provisioning"

@dataclass
class EnterpriseFeatureFlag:
    key: str; label: str; description: str; enabled: bool = True; category: str = "enterprise"

@dataclass
class EnterprisePlan:
    id: str = "enterprise"; name: str = "Enterprise"
    description: str = "Unlimited fixes, SSO/SAML, dedicated support"
    base_price_cents: int = BP; stripe_price_id: str = PID
    monthly_fix_limit: int = -1; concurrent_fixes: int = 50
    features: list[EnterpriseFeatureFlag] = field(default_factory=list)
    dedicated_support: bool = True; custom_sla: bool = True
    sso_saml: bool = True; audit_log_export: bool = True
    priority_queue: bool = True; private_sandbox: bool = True
    compliance_artifacts: list[str] = field(default_factory=lambda: [
        "SOC 2 Type II", "HIPAA BAA", "PCI DSS", "ISO 27001", "DPA"])
    sla_tiers: list[dict] = field(default_factory=lambda: [
        {"level": "Platinum", "response_min": 15, "resolution_h": 2, "hours": "24/7"},
        {"level": "Gold", "response_min": 30, "resolution_h": 4, "hours": "24/7"},
        {"level": "Silver", "response_min": 60, "resolution_h": 8, "hours": "Business"}])

    def __post_init__(self) -> None:
        if not self.features:
            self.features = [EnterpriseFeatureFlag(k.value, k.name.replace("_"," ").title(), k.value.replace("_"," ")) for k in EnterpriseFeature]

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "basePriceCents": self.base_price_cents,
                "stripePriceId": self.stripe_price_id, "monthlyFixLimit": -1, "concurrentFixes": 50,
                "features": [asdict(f) for f in self.features], "ssoSaml": self.sso_saml,
                "complianceArtifacts": self.compliance_artifacts, "slaTiers": self.sla_tiers}

@dataclass
class ComplianceArtifact:
    id: str; name: str; description: str; type: str; version: str
    available: bool; valid_until: str | None = None

@dataclass
class EnterpriseProvisioningResult:
    success: bool; product_id: str | None = None; price_id: str | None = None; error: str | None = None

_plan: EnterprisePlan | None = None

def get_enterprise_plan() -> EnterprisePlan:
    global _plan
    if _plan is None: _plan = EnterprisePlan()
    return _plan

def get_enterprise_feature_flags() -> list[dict]:
    return [asdict(f) for f in get_enterprise_plan().features]

def is_enterprise_feature_enabled(key: str) -> bool:
    return any(f.key == key for f in get_enterprise_plan().features)

def get_compliance_artifacts() -> list[dict]:
    return [asdict(ComplianceArtifact(id=f"ca-{i}", name=n, description=n, type=t, version="2026-06", available=True))
            for i, (n, t) in enumerate([("SOC 2 Type II","soc2"),("HIPAA BAA","hipaa"),("PCI DSS","pci"),("ISO 27001","iso27001"),("DPA","dpa")])]

def create_enterprise_stripe_product() -> EnterpriseProvisioningResult:
    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not key: return EnterpriseProvisioningResult(False, error="No Stripe key")
    try:
        import stripe
        stripe.api_key = key
        existing = os.getenv("STRIPE_ENTERPRISE_PRICE_ID", "")
        if existing and existing != "price_enterprise":
            try:
                p = stripe.Price.retrieve(existing)
                return EnterpriseProvisioningResult(True, p.product if isinstance(p.product, str) else str(p.product), p.id)
            except: pass
        prod = stripe.Product.create(name="STAS Enterprise", metadata={"plan": "enterprise"})
        price = stripe.Price.create(product=prod.id, unit_amount=BP, currency="usd", recurring={"interval": "month"})
        return EnterpriseProvisioningResult(True, prod.id, price.id)
    except Exception as e:
        logger.error("Stripe product creation failed: %s", e)
        return EnterpriseProvisioningResult(False, error=str(e))

def provision_enterprise_stripe_product_sync() -> dict:
    r = create_enterprise_stripe_product()
    return {"success": r.success, "productId": r.product_id, "priceId": r.price_id, "error": r.error}

def is_enterprise_tier(tid: str) -> bool:
    return os.getenv(f"TENANT_{tid.upper().replace('-','_')}_TIER", "free").lower() == "enterprise"

def get_enterprise_tenant_ids() -> list[str]:
    return [k[len("TENANT_"):-len("_TIER")].lower().replace("_","-") for k, v in os.environ.items()
            if k.startswith("TENANT_") and k.endswith("_TIER") and v.lower() == "enterprise"]

def get_enterprise_queue_config() -> dict:
    return {"queue_name": "stas.agents.enterprise", "priority": 10,
            "max_concurrency": int(os.getenv("ENTERPRISE_MAX_CONCURRENCY","20")),
            "max_retries": int(os.getenv("ENTERPRISE_MAX_RETRIES","10")),
            "sandbox_timeout_ms": int(os.getenv("ENTERPRISE_SANDBOX_TIMEOUT_MS","1800000"))}
