from __future__ import annotations
import hashlib, logging, os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import jwt as pyjwt
from pydantic import BaseModel, Field
from stas_agent_interface.models import AuthError, AuthScope, AuthToken, SCOPE_HIERARCHY

logger = logging.getLogger(__name__)

class StoredKey(BaseModel):
    key_hash: str
    key_prefix: str
    scope: AuthScope
    name: str
    created_at: datetime = datetime.now(timezone.utc)
    expires_at: Optional[datetime] = None

class APIKeyStore:
    def __init__(self):
        self._keys: dict[str, StoredKey] = {}
    def generate_key(self, scope: AuthScope, name: str = "unnamed", expires_in_days: Optional[int] = None) -> tuple[str, StoredKey]:
        raw = f"sk-{os.urandom(32).hex()}"
        kh = hashlib.sha256(raw.encode()).hexdigest()
        st = StoredKey(key_hash=kh, key_prefix=raw[:12], scope=scope, name=name, expires_at=datetime.now(timezone.utc)+timedelta(days=expires_in_days) if expires_in_days else None)
        self._keys[kh] = st
        return raw, st
    def add_key(self, raw_key: str, scope: AuthScope, name: str = "imported", expires_at: Optional[datetime] = None) -> StoredKey:
        kh = hashlib.sha256(raw_key.encode()).hexdigest()
        st = StoredKey(key_hash=kh, key_prefix=raw_key[:12], scope=scope, name=name, expires_at=expires_at)
        self._keys[kh] = st
        return st
    def lookup(self, raw_key: str) -> Optional[StoredKey]:
        kh = hashlib.sha256(raw_key.encode()).hexdigest()
        st = self._keys.get(kh)
        if st is None: return None
        if st.expires_at and st.expires_at < datetime.now(timezone.utc):
            del self._keys[kh]
            return None
        return st
    def revoke(self, key_prefix: str) -> bool:
        for kh, st in list(self._keys.items()):
            if st.key_prefix == key_prefix: del self._keys[kh]; return True
        return False
    def list_keys(self) -> list[StoredKey]:
        now = datetime.now(timezone.utc)
        return [k for k in self._keys.values() if not k.expires_at or k.expires_at > now]

class TokenManager:
    def __init__(self, secret: Optional[str] = None):
        self._secret = secret or os.getenv("STAS_JWT_SECRET", "") or hashlib.sha256(os.urandom(64)).hexdigest()
    def issue_token(self, scope: AuthScope, ttl_seconds: int = 3600, key_name: Optional[str] = None) -> AuthToken:
        now = datetime.now(timezone.utc)
        exp = now + timedelta(seconds=ttl_seconds)
        payload: dict[str, Any] = {"scope": scope.value, "iat": int(now.timestamp()), "exp": int(exp.timestamp()), "jti": os.urandom(16).hex()}
        if key_name: payload["name"] = key_name
        return AuthToken(token=pyjwt.encode(payload, self._secret, algorithm="HS256"), scope=scope, expires_at=exp, key_name=key_name)
    def validate_token(self, token: str) -> dict[str, Any]:
        try: return pyjwt.decode(token, self._secret, algorithms=["HS256"])
        except pyjwt.ExpiredSignatureError: raise AuthError("Token has expired", 401)
        except pyjwt.InvalidTokenError as exc: raise AuthError(f"Invalid token: {exc}", 401)
    def get_token_scope(self, token: str) -> AuthScope:
        return AuthScope(self.validate_token(token).get("scope", "read"))
    def check_scope(self, token: str, required_scope: AuthScope) -> bool:
        return required_scope in SCOPE_HIERARCHY.get(self.get_token_scope(token), {self.get_token_scope(token)})

class AuthMiddleware:
    def __init__(self, key_store: Optional[APIKeyStore] = None, token_manager: Optional[TokenManager] = None):
        self.key_store = key_store or APIKeyStore()
        self.token_manager = token_manager or TokenManager()
    def authenticate_request(self, params: dict[str, Any]) -> AuthToken:
        raw = params.get("apiKey") or params.get("api_key")
        if raw:
            st = self.key_store.lookup(raw)
            if st: return self.token_manager.issue_token(scope=st.scope, key_name=st.name)
            raise AuthError("Invalid API key", 401)
        hdrs = params.get("headers", {})
        if isinstance(hdrs, dict):
            ah = hdrs.get("authorization") or hdrs.get("Authorization") or hdrs.get("x-api-key") or hdrs.get("X-Api-Key")
            if ah:
                if ah.startswith("Bearer "):
                    try:
                        p = self.token_manager.validate_token(ah[7:])
                        return AuthToken(token=ah[7:], scope=AuthScope(p.get("scope","read")), expires_at=datetime.fromtimestamp(p.get("exp",0),tz=timezone.utc), key_name=p.get("name"))
                    except AuthError: pass
                if ah.startswith("sk-"):
                    st = self.key_store.lookup(ah.split(" ")[-1])
                    if st: return self.token_manager.issue_token(scope=st.scope, key_name=st.name)
                raise AuthError("Invalid authorization", 401)
        raise AuthError("Authentication required", 401)
    def require_scope(self, token: AuthToken, required_scope: AuthScope) -> None:
        if required_scope not in SCOPE_HIERARCHY.get(token.scope, {token.scope}):
            raise AuthError(f"Insufficient scope", 403)
    @staticmethod
    def get_required_scope_for_capability(name: str) -> AuthScope:
        return AuthScope.WRITE if name == "submit_issue" else AuthScope.READ

_default_ks: Optional[APIKeyStore] = None
_default_mw: Optional[AuthMiddleware] = None
def get_default_auth_middleware() -> AuthMiddleware:
    global _default_ks, _default_mw
    if _default_mw is None: _default_ks = APIKeyStore(); _default_mw = AuthMiddleware(key_store=_default_ks)
    return _default_mw
def get_default_key_store() -> APIKeyStore:
    get_default_auth_middleware(); return _default_ks
