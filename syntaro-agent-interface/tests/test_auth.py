import time, pytest
from syntaro_agent_interface.auth import APIKeyStore, AuthMiddleware, AuthError, TokenManager
from syntaro_agent_interface.models import AuthScope

class TestStore:
    def test_gen(self):
        s = APIKeyStore(); r, st = s.generate_key(AuthScope.WRITE, name="t")
        assert r.startswith("sk-")
    def test_lookup(self):
        s = APIKeyStore(); r, _ = s.generate_key(AuthScope.READ); assert s.lookup(r) is not None
    def test_invalid(self): assert APIKeyStore().lookup("sk-x") is None
    def test_revoke(self):
        s = APIKeyStore(); r, st = s.generate_key(AuthScope.READ); s.revoke(st.key_prefix); assert s.lookup(r) is None
    def test_list(self):
        s = APIKeyStore(); s.generate_key(AuthScope.READ); s.generate_key(AuthScope.WRITE); assert len(s.list_keys()) == 2

class TestToken:
    def test_issue(self):
        m = TokenManager(secret="test-secret-32bytes!!"); t = m.issue_token(AuthScope.WRITE, key_name="t")
        assert m.validate_token(t.token)["scope"] == "write"
    def test_scope(self):
        m = TokenManager(secret="test-secret-32bytes!!"); t = m.issue_token(AuthScope.ADMIN)
        assert m.get_token_scope(t.token) == AuthScope.ADMIN
    def test_check(self):
        m = TokenManager(secret="test-secret-32bytes!!"); t = m.issue_token(AuthScope.WRITE)
        assert m.check_scope(t.token, AuthScope.READ) and not m.check_scope(t.token, AuthScope.ADMIN)
    def test_invalid(self):
        with pytest.raises(AuthError): TokenManager(secret="x").validate_token("bad.jwt")
    def test_expired(self):
        m = TokenManager(secret="test-secret-32bytes!!"); t = m.issue_token(AuthScope.READ, ttl_seconds=0); time.sleep(0.05)
        with pytest.raises(AuthError): m.validate_token(t.token)

class TestMW:
    def test_apikey(self):
        s = APIKeyStore(); m = TokenManager(secret="test-secret-32bytes!!"); mw = AuthMiddleware(key_store=s, token_manager=m)
        r, _ = s.generate_key(AuthScope.READ); assert mw.authenticate_request({"apiKey": r}).scope == AuthScope.READ
    def test_bearer(self):
        m = TokenManager(secret="test-secret-32bytes!!"); mw = AuthMiddleware(token_manager=m)
        t = m.issue_token(AuthScope.WRITE); assert mw.authenticate_request({"headers":{"authorization":f"Bearer {t.token}"}}).scope == AuthScope.WRITE
    def test_noauth(self):
        with pytest.raises(AuthError): AuthMiddleware().authenticate_request({})
    def test_badkey(self):
        with pytest.raises(AuthError): AuthMiddleware().authenticate_request({"apiKey":"sk-x"})
    def test_scope_ok(self):
        s = APIKeyStore(); m = TokenManager(secret="test-secret-32bytes!!"); mw = AuthMiddleware(key_store=s, token_manager=m)
        r,_=s.generate_key(AuthScope.WRITE); t=mw.authenticate_request({"apiKey":r}); mw.require_scope(t, AuthScope.READ)
    def test_scope_fail(self):
        s = APIKeyStore(); m = TokenManager(secret="test-secret-32bytes!!"); mw = AuthMiddleware(key_store=s, token_manager=m)
        r,_=s.generate_key(AuthScope.READ); t=mw.authenticate_request({"apiKey":r})
        with pytest.raises(AuthError): mw.require_scope(t, AuthScope.WRITE)
    def test_capmap(self):
        assert AuthMiddleware.get_required_scope_for_capability("submit_issue") == AuthScope.WRITE
        assert AuthMiddleware.get_required_scope_for_capability("list_capabilities") == AuthScope.READ
