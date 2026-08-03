from __future__ import annotations
import logging, os
from typing import Any, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from stas_agent_interface.auth import AuthMiddleware, AuthError, AuthScope, get_default_auth_middleware
from stas_agent_interface.engine import STASEngine
from stas_agent_interface.models import SubmitIssueRequest, CheckStatusRequest, RunHistoryRequest, ListReposRequest, GetPricingRequest, SCOPE_HIERARCHY

logger = logging.getLogger(__name__)

def _ap(req: Request) -> dict[str, Any]:
    p: dict = {}
    ah = req.headers.get("authorization") or req.headers.get("Authorization","")
    if ah: p["headers"] = {"authorization": ah}
    xk = req.headers.get("x-api-key") or req.headers.get("X-Api-Key","")
    if xk: p["apiKey"] = xk
    return p
def _cs(auth: AuthMiddleware, token, cap: str) -> None:
    r = AuthMiddleware.get_required_scope_for_capability(cap)
    if r not in SCOPE_HIERARCHY.get(token.scope, {token.scope}): raise AuthError(f"Insufficient scope", 403)

def create_app(engine: Optional[STASEngine] = None, auth: Optional[AuthMiddleware] = None, require_auth: bool = True) -> FastAPI:
    eng = engine or STASEngine(); a = auth or get_default_auth_middleware()
    app = FastAPI(title="STAS Agent Interface API", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    @app.exception_handler(AuthError)
    async def aeh(rq: Request, exc: AuthError) -> JSONResponse: return JSONResponse(status_code=exc.status_code, content={"error": exc.message})
    @app.get("/health")
    async def health(): return {"status": "ok", "service": "stas-agent-interface", "version": "0.1.0"}
    @app.get("/capabilities")
    async def caps(rq: Request):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "list_capabilities")
        return eng.list_capabilities().model_dump(mode="json")
    @app.post("/issue")
    async def issue(rq: Request):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "submit_issue")
        b = await rq.json()
        try:
            req = SubmitIssueRequest(repo=b["repo"], title=b["title"], body=b["body"], labels=b.get("labels",[]))
        except KeyError as e: raise HTTPException(400, f"Missing: {e}")
        return (await eng.submit_issue(req)).model_dump(mode="json")
    @app.get("/status/{run_id}")
    async def status(run_id: str, rq: Request):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "check_status")
        return (await eng.check_status(CheckStatusRequest(run_id=run_id))).model_dump(mode="json")
    @app.get("/history")
    async def history(rq: Request, repo: Optional[str] = None, limit: int = 10):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "get_run_history")
        return (await eng.get_run_history(RunHistoryRequest(repo=repo, limit=min(limit,100)))).model_dump(mode="json")
    @app.get("/repos")
    async def repos(rq: Request, platform: Optional[str] = None):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "list_repos")
        return (await eng.list_repos(ListReposRequest(platform=platform))).model_dump(mode="json")
    @app.get("/pricing")
    async def pricing(rq: Request, plan_id: Optional[str] = None):
        if require_auth:
            t = a.authenticate_request(_ap(rq)); _cs(a, t, "get_pricing")
        return (await eng.get_pricing(GetPricingRequest(plan_id=plan_id))).model_dump(mode="json")
    @app.post("/auth/generate-key")
    async def genkey(rq: Request):
        if require_auth:
            t = a.authenticate_request(_ap(rq))
        ct = rq.headers.get("content-type","")
        b = await rq.json() if "application/json" in ct else {}
        try: sc = AuthScope(b.get("scope","read"))
        except ValueError: raise HTTPException(400, f"Invalid scope")
        raw, stored = a.key_store.generate_key(scope=sc, name=b.get("name","api-key"), expires_in_days=b.get("expires_in_days"))
        return {"api_key": raw, "key_prefix": stored.key_prefix, "scope": stored.scope.value, "name": stored.name}
    return app

def main() -> None:
    import uvicorn
    p = int(os.getenv("STAS_REST_PORT","8090"))
    ra = os.getenv("STAS_REQUIRE_AUTH","true").lower() == "true"
    uvicorn.run(create_app(require_auth=ra), host="0.0.0.0", port=p, log_level="info")

if __name__ == "__main__": main()
