import pytest
from fastapi.testclient import TestClient
from syntaro_agent_interface.auth import APIKeyStore, TokenManager, AuthMiddleware
from syntaro_agent_interface.models import AuthScope
from syntaro_agent_interface.rest_api import create_app

@pytest.fixture
def setup():
    s=APIKeyStore(); m=TokenManager(secret="test-secret-32bytes!!"); mw=AuthMiddleware(key_store=s,token_manager=m)
    wk,_=s.generate_key(AuthScope.WRITE,"wk"); rk,_=s.generate_key(AuthScope.READ,"rk")
    return {"mw":mw,"wk":wk,"rk":rk}

@pytest.fixture
def app(setup): return TestClient(create_app(auth=setup["mw"],require_auth=True))

class TestHealth:
    def test(self, app): r=app.get("/health"); assert r.status_code==200 and r.json()["status"]=="ok"

class TestCaps:
    def test_auth(self, app, setup): r=app.get("/capabilities",headers={"x-api-key":setup["rk"]}); assert r.status_code==200
    def test_noauth(self, app): assert app.get("/capabilities").status_code==401
    def test_badkey(self, app): assert app.get("/capabilities",headers={"x-api-key":"sk-bad"}).status_code==401

class TestSubmit:
    def test_write(self, app, setup):
        r=app.post("/issue",json={"repo":"o/r","title":"T","body":"B"},headers={"x-api-key":setup["wk"]});
        assert r.status_code==200 and r.json()["status"]=="failed"
    def test_read_rejected(self, app, setup):
        r=app.post("/issue",json={"repo":"o/r","title":"T","body":"B"},headers={"x-api-key":setup["rk"]}); assert r.status_code==403
    def test_missing(self, app, setup):
        r=app.post("/issue",json={"repo":"o/r"},headers={"x-api-key":setup["wk"]}); assert r.status_code==400

class TestStatus:
    def test(self, app, setup): r=app.get("/status/x",headers={"x-api-key":setup["rk"]}); assert r.status_code==200

class TestHistory:
    def test(self, app, setup): r=app.get("/history",headers={"x-api-key":setup["rk"]}); assert r.status_code==200

class TestRepos:
    def test(self, app, setup): r=app.get("/repos",headers={"x-api-key":setup["rk"]}); assert r.status_code==200

class TestPricing:
    def test(self, app, setup): r=app.get("/pricing",headers={"x-api-key":setup["rk"]}); assert r.status_code==200 and len(r.json()["plans"])==4
    def test_filter(self, app, setup):
        r=app.get("/pricing?plan_id=solo",headers={"x-api-key":setup["rk"]}); d=r.json()
        assert d["plans"][0]["id"]=="solo" and d["plans"][0]["amount_cents"]==4900

class TestGenKey:
    def test(self, app, setup):
        r=app.post("/auth/generate-key",json={"scope":"read","name":"nk"},headers={"x-api-key":setup["wk"]})
        assert r.status_code==200 and r.json()["api_key"].startswith("sk-")
    def test_bad_scope(self, app, setup):
        r=app.post("/auth/generate-key",json={"scope":"bad"},headers={"x-api-key":setup["wk"]}); assert r.status_code==400
