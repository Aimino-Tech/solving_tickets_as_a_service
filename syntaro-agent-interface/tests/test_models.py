from datetime import datetime
from stas_agent_interface.models import AuthScope, Capability, CapabilityList, SCOPE_HIERARCHY, SubmitIssueRequest, SubmitIssueResponse, CheckStatusRequest, CheckStatusResponse, RunHistoryRequest, RunHistoryResponse, RunEntry, ListReposResponse, RepoEntry, GetPricingResponse, PlanEntry

class TestScope:
    def test_hierarchy(self):
        assert AuthScope.READ in SCOPE_HIERARCHY[AuthScope.READ]
        assert AuthScope.READ in SCOPE_HIERARCHY[AuthScope.WRITE]
        assert AuthScope.ADMIN in SCOPE_HIERARCHY[AuthScope.ADMIN]
        assert AuthScope.WRITE not in SCOPE_HIERARCHY[AuthScope.READ]

class TestCap:
    def test_basic(self):
        c = Capability(name="x", description="y", required_scope=AuthScope.READ)
        assert c.name == "x"
    def test_list(self):
        cl = CapabilityList(capabilities=[Capability(name="c",description="d",required_scope=AuthScope.READ)])
        assert len(cl.capabilities) == 1

class TestSubmit:
    def test_req(self):
        r = SubmitIssueRequest(repo="o/r", title="T", body="B", labels=["bug"])
        assert r.title == "T"
    def test_resp(self):
        r = SubmitIssueResponse(run_id="r1", status="queued"); assert r.run_id == "r1"

class TestStatus:
    def test_req(self):
        r = CheckStatusRequest(run_id="r1"); assert r.run_id == "r1"
    def test_resp(self):
        r = CheckStatusResponse(run_id="r1", status="done", phase="done", progress_pct=100.0); assert r.progress_pct == 100.0
    def test_error(self):
        r = CheckStatusResponse(run_id="r1", status="fail", phase="fail", error="err"); assert r.error == "err"

class TestHistory:
    def test_defaults(self):
        r = RunHistoryRequest(); assert r.limit == 10
    def test_resp(self):
        e = RunEntry(run_id="r1", repo="o/r", issue_title="T", status="ok", created_at=datetime.now())
        r = RunHistoryResponse(runs=[e], total=1); assert r.total == 1

class TestRepos:
    def test_resp(self):
        r = ListReposResponse(repos=[RepoEntry(name="o/r",platform="github")], total=1); assert r.repos[0].name == "o/r"

class TestPricing:
    def test_resp(self):
        p = PlanEntry(id="solo", name="S", description="D", amount_cents=4900, monthly_fix_limit=100, premium_models=True, concurrent_fixes=3)
        r = GetPricingResponse(plans=[p], active_plan="solo"); assert r.plans[0].amount_cents == 4900
