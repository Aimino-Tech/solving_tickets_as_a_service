"""Enterprise tier — pricing, Stripe product, feature flags, compliance."""
from __future__ import annotations
import logging, os
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
logger = logging.getLogger(__name__)
BP = int(os.getenv("ENTERPRISE_BASE_PRICE_CENTS", "250000"))
class EnterpriseFeature(Enum):
    SSO_SAML = "sso_saml"; DEDICATED_SUPPORT = "dedicated_support"
    COMPLIANCE_ARTIFACTS = "compliance_artifacts"; CUSTOM_SLA = "custom_sla"
    AUDIT_LOG_EXPORT = "audit_log_export"; PRIORITY_QUEUE = "priority_queue"
    PRIVATE_SANDBOX = "private_sandbox"; UNLIMITED_FIXES = "unlimited_fixes"
@dataclass
class FF: key: str; label: str; description: str; enabled: bool = True; category: str = "enterprise"
@dataclass
class EnterprisePlan:
    id: str = "enterprise"; name: str = "Enterprise"
    base_price_cents: int = BP; monthly_fix_limit: int = -1; concurrent_fixes: int = 50
    features: list[FF] = field(default_factory=list); sso_saml: bool = True
    def __post_init__(self):
        if not self.features:
            self.features = [FF(f.value, f.name.replace("_"," ").title(), "") for f in EnterpriseFeature]
    def to_dict(self) -> dict:
        return {"id":self.id,"name":self.name,"basePriceCents":self.base_price_cents,"monthlyFixLimit":-1,"concurrentFixes":50,"features":[asdict(f) for f in self.features],"ssoSaml":self.sso_saml}
@dataclass
class CA: id: str; name: str; type: str; available: bool = True
@dataclass
class EPR: success: bool; product_id: str | None = None; price_id: str | None = None; error: str | None = None
_plan: EnterprisePlan | None = None
def get_enterprise_plan() -> EnterprisePlan:
    global _plan
    if _plan is None: _plan = EnterprisePlan()
    return _plan
def get_feature_flags() -> list[dict]: return [asdict(f) for f in get_enterprise_plan().features]
def get_compliance() -> list[dict]:
    return [asdict(CA(f"ca-{i}",n,t)) for i,(n,t) in enumerate([("SOC 2","soc2"),("HIPAA BAA","hipaa"),("PCI DSS","pci"),("ISO 27001","iso27001"),("DPA","dpa")])]
def create_stripe_product() -> EPR:
    k = os.getenv("STRIPE_SECRET_KEY","")
    if not k: return EPR(False, error="No key")
    try:
        import stripe; stripe.api_key = k
        pid = os.getenv("STRIPE_ENTERPRISE_PRICE_ID","")
        if pid and pid != "price_enterprise":
            try: p = stripe.Price.retrieve(pid); return EPR(True, str(p.product) if not isinstance(p.product,str) else p.product, p.id)
            except: pass
        prod = stripe.Product.create(name="STAS Enterprise", metadata={"plan":"enterprise"})
        price = stripe.Price.create(product=prod.id, unit_amount=BP, currency="usd", recurring={"interval":"month"})
        return EPR(True, prod.id, price.id)
    except Exception as e: logger.error("Stripe error: %s",e); return EPR(False, error=str(e))
def provision_sync() -> dict:
    r = create_stripe_product()
    return {"success":r.success,"productId":r.product_id,"priceId":r.price_id,"error":r.error}
def is_enterprise(tid: str) -> bool:
    return os.getenv(f"TENANT_{tid.upper().replace('-','_')}_TIER","free").lower() == "enterprise"
def get_enterprise_ids() -> list[str]:
    return [k[len("TENANT_"):-len("_TIER")].lower().replace("_","-") for k,v in os.environ.items() if k.startswith("TENANT_") and k.endswith("_TIER") and v.lower()=="enterprise"]
def queue_config() -> dict:
    return {"queue":"stas.agents.enterprise","priority":10,"max_concurrency":int(os.getenv("ENTERPRISE_MAX_CONCURRENCY","20")),"max_retries":int(os.getenv("ENTERPRISE_MAX_RETRIES","10")),"sandbox_timeout_ms":int(os.getenv("ENTERPRISE_SANDBOX_TIMEOUT_MS","1800000"))}
