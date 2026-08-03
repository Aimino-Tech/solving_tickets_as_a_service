import json, os, tempfile, pytest
from syntaro_agent_interface.engine import STASEngine, CAPABILITY_DEFINITIONS, SYNTARO_PLANS, _s2p, _load_history, _load_repos
from syntaro_agent_interface.models import CapabilityList, SubmitIssueRequest, CheckStatusRequest, RunHistoryRequest, ListReposRequest, GetPricingRequest, AuthScope

class TestDefs:
    def test_all(self): n={c.name for c in CAPABILITY_DEFINITIONS}; assert len(n)==6 and "submit_issue" in n
    def test_write_scope(self): assert next(c for c in CAPABILITY_DEFINITIONS if c.name=="submit_issue").required_scope==AuthScope.WRITE
    def test_read_scopes(self):
        for n in ["list_capabilities","check_status","get_run_history","list_repos","get_pricing"]:
            assert next(c for c in CAPABILITY_DEFINITIONS if c.name==n).required_scope==AuthScope.READ

class TestPlans:
    def test_four(self): assert len(SYNTARO_PLANS)==4
    def test_free(self): p=next(p for p in SYNTARO_PLANS if p.id=="free"); assert p.amount_cents==0
    def test_solo(self): p=next(p for p in SYNTARO_PLANS if p.id=="solo"); assert p.amount_cents==4900
    def test_enterprise(self): p=next(p for p in SYNTARO_PLANS if p.id=="enterprise"); assert p.monthly_fix_limit==999999

class TestEngine:
    @pytest.fixture
    def e(self): return STASEngine(api_url="http://localhost:3000", api_key="t")
    def test_list(self, e): assert isinstance(e.list_capabilities(), CapabilityList)
    @pytest.mark.asyncio
    async def test_submit(self, e): r=await e.submit_issue(SubmitIssueRequest(repo="o/r",title="T",body="B")); assert r.status=="failed"
    @pytest.mark.asyncio
    async def test_check(self, e): r=await e.check_status(CheckStatusRequest(run_id="x")); assert r.status in ("not_found","error")
    @pytest.mark.asyncio
    async def test_history(self, e): r=await e.get_run_history(RunHistoryRequest()); assert isinstance(r.runs,list)
    @pytest.mark.asyncio
    async def test_repos(self, e): r=await e.list_repos(ListReposRequest()); assert isinstance(r.repos,list)
    @pytest.mark.asyncio
    async def test_pricing(self, e): r=await e.get_pricing(GetPricingRequest()); assert len(r.plans)==4
    @pytest.mark.asyncio
    async def test_pricing_filter(self, e): r=await e.get_pricing(GetPricingRequest(plan_id="solo")); assert len(r.plans)==1 and r.plans[0].id=="solo"

class TestHelpers:
    def test_s2p(self): assert _s2p("queued")==5.0 and _s2p("completed")==100.0 and _s2p("x")==0.0
    def test_history_empty(self): assert _load_history(None,10)==[]
    def test_history_file(self):
        with tempfile.NamedTemporaryFile(mode="w",suffix=".json",delete=False) as f:
            json.dump({"f1":{"repo":"o/r","issue_number":1,"status":"d","created_at":"2026-01-01T00:00:00"}},f); p=f.name
        os.environ["FIX_REGISTRY_PATH"]=p
        try: r=_load_history(None,10); assert len(r)==1 and r[0].run_id=="f1"
        finally: os.unlink(p); del os.environ["FIX_REGISTRY_PATH"]
    def test_repos_empty(self): assert _load_repos(None)==[]
    def test_repos_file(self):
        with tempfile.NamedTemporaryFile(mode="w",suffix=".json",delete=False) as f:
            json.dump({"f1":{"repo":"o/r1"},"f2":{"repo":"o/r2"}},f); p=f.name
        os.environ["FIX_REGISTRY_PATH"]=p
        try: r=_load_repos(None); assert len(r)==2
        finally: os.unlink(p); del os.environ["FIX_REGISTRY_PATH"]
