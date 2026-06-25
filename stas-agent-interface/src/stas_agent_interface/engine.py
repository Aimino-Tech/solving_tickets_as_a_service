from __future__ import annotations
import json, logging, os
from datetime import datetime, timezone
from typing import Any, Optional
import httpx
from stas_agent_interface.models import Capability, CapabilityList, AuthScope, SubmitIssueRequest, SubmitIssueResponse, CheckStatusRequest, CheckStatusResponse, RunHistoryRequest, RunHistoryResponse, RunEntry, ListReposRequest, ListReposResponse, RepoEntry, GetPricingRequest, GetPricingResponse, PlanEntry

logger = logging.getLogger(__name__)

CAPABILITY_DEFINITIONS: list[Capability] = [
    Capability(name="list_capabilities", description="Auto-discover all STAS capabilities", required_scope=AuthScope.READ),
    Capability(name="submit_issue", description="Submit a GitHub issue to the STAS fix pipeline", required_scope=AuthScope.WRITE),
    Capability(name="check_status", description="Check phased progress of a fix run", required_scope=AuthScope.READ),
    Capability(name="get_run_history", description="List recent fix runs", required_scope=AuthScope.READ),
    Capability(name="list_repos", description="List configured repositories", required_scope=AuthScope.READ),
    Capability(name="get_pricing", description="Get subscription pricing and tiers", required_scope=AuthScope.READ),
]

STAS_PLANS: list[PlanEntry] = [
    PlanEntry(id="free", name="Free", description="10 fixes/mo", amount_cents=0, monthly_fix_limit=10),
    PlanEntry(id="solo", name="Solo", description="100 fixes/mo, premium models", amount_cents=4900, monthly_fix_limit=100, premium_models=True, concurrent_fixes=3),
    PlanEntry(id="team", name="Team", description="500 fixes/mo, priority support", amount_cents=14900, monthly_fix_limit=500, premium_models=True, concurrent_fixes=10),
    PlanEntry(id="enterprise", name="Enterprise", description="Unlimited fixes", amount_cents=0, monthly_fix_limit=999999, premium_models=True, concurrent_fixes=50),
]

class STASEngine:
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None):
        self._api_url = (api_url or os.getenv("STAS_API_URL", "http://localhost:3000")).rstrip("/")
        self._api_key = api_key or os.getenv("STAS_API_KEY", "")
        self._http: Optional[httpx.AsyncClient] = None
    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None:
            hdrs = {"Content-Type": "application/json"}
            if self._api_key: hdrs["Authorization"] = f"Bearer {self._api_key}"
            self._http = httpx.AsyncClient(base_url=self._api_url, timeout=30.0, headers=hdrs)
        return self._http
    def list_capabilities(self) -> CapabilityList:
        return CapabilityList(capabilities=CAPABILITY_DEFINITIONS)
    async def submit_issue(self, req: SubmitIssueRequest) -> SubmitIssueResponse:
        try:
            resp = await (await self._get_http()).post("/api/fix", json={"repoUrl": f"https://github.com/{req.repo}", "issueTitle": req.title, "issueBody": req.body})
            resp.raise_for_status()
            d = resp.json()
            return SubmitIssueResponse(run_id=d.get("jobId",""), status=d.get("status","queued"), poll_url=d.get("pollUrl"))
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            logger.error("submit_issue failed: %s", e)
            return SubmitIssueResponse(status="failed")
    async def check_status(self, req: CheckStatusRequest) -> CheckStatusResponse:
        try:
            resp = await (await self._get_http()).get(f"/api/fix/{req.run_id}")
            if resp.status_code == 404: return CheckStatusResponse(run_id=req.run_id, status="not_found", phase="unknown")
            resp.raise_for_status()
            d = resp.json()
            return CheckStatusResponse(run_id=req.run_id, status=d.get("status","unknown"), phase=d.get("status","unknown"), progress_pct=_s2p(d.get("status","queued")), result_url=d.get("resultUrl"), error=d.get("error"))
        except httpx.RequestError as e:
            return CheckStatusResponse(run_id=req.run_id, status="error", phase="unknown", error=str(e))
    async def get_run_history(self, req: RunHistoryRequest) -> RunHistoryResponse:
        runs = _load_history(req.repo, req.limit)
        return RunHistoryResponse(runs=runs, total=len(runs))
    async def list_repos(self, req: ListReposRequest) -> ListReposResponse:
        repos = _load_repos(req.platform)
        return ListReposResponse(repos=repos, total=len(repos))
    async def get_pricing(self, req: GetPricingRequest) -> GetPricingResponse:
        plans = [p for p in STAS_PLANS if p.id == req.plan_id] if req.plan_id else list(STAS_PLANS)
        return GetPricingResponse(plans=plans)
    async def close(self) -> None:
        if self._http: await self._http.aclose(); self._http = None

def _s2p(s: str) -> float:
    return {"queued":5.0,"triaging":20.0,"dispatching":35.0,"verifying":60.0,"reviewing":80.0,"completed":100.0,"failed":100.0,"cancelled":100.0}.get(s,0.0)
def _load_history(rf: Optional[str], lim: int) -> list[RunEntry]:
    try:
        with open(os.getenv("FIX_REGISTRY_PATH","/tmp/stas-fix-registry.json")) as f: reg = json.load(f)
    except: return []
    entries = []
    for fid, fd in reg.items():
        repo = fd.get("repo","")
        if rf and repo != rf: continue
        entries.append(RunEntry(run_id=fid, repo=repo, issue_title=f"Issue #{fd.get('issue_number','?')}", status=fd.get("status","unknown"), created_at=_pd(fd.get("created_at")) or datetime.now(timezone.utc)))
    entries.sort(key=lambda e: e.created_at, reverse=True)
    return entries[:lim]
def _load_repos(pf: Optional[str]) -> list[RepoEntry]:
    try:
        with open(os.getenv("FIX_REGISTRY_PATH","/tmp/stas-fix-registry.json")) as f: reg = json.load(f)
    except: return []
    seen = {}
    for fd in reg.values():
        r = fd.get("repo","")
        if r and r not in seen: seen[r] = RepoEntry(name=r, platform=pf or "github")
    return list(seen.values())
def _pd(v: Any) -> Optional[datetime]:
    if isinstance(v, str):
        try: return datetime.fromisoformat(v)
        except: pass
    return None
