from __future__ import annotations
import os, logging
from typing import Any, Optional
import httpx
from stas_agent_interface.models import CapabilityList, SubmitIssueResponse, CheckStatusResponse, RunHistoryResponse, ListReposResponse, GetPricingResponse
logger = logging.getLogger(__name__)

class STASAgentClient:
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: float = 30.0):
        self._key = api_key or os.getenv("STAS_API_KEY","")
        self._url = (base_url or os.getenv("STAS_AGENT_URL","http://localhost:8090")).rstrip("/")
        self._to = timeout; self._http: Optional[httpx.Client] = None
    def _gh(self) -> httpx.Client:
        if self._http is None:
            h = {"Content-Type": "application/json"}
            if self._key:
                if self._key.startswith("sk-"): h["x-api-key"] = self._key
                else: h["Authorization"] = f"Bearer {self._key}"
            self._http = httpx.Client(base_url=self._url, timeout=self._to, headers=h)
        return self._http
    def list_capabilities(self) -> CapabilityList:
        return CapabilityList.model_validate(self._gh().get("/capabilities").raise_for_status().json())
    def submit_issue(self, repo: str, title: str, body: str, labels: Optional[list[str]] = None) -> SubmitIssueResponse:
        return SubmitIssueResponse.model_validate(self._gh().post("/issue", json={"repo":repo,"title":title,"body":body,"labels":labels or []}).raise_for_status().json())
    def check_status(self, run_id: str) -> CheckStatusResponse:
        return CheckStatusResponse.model_validate(self._gh().get(f"/status/{run_id}").raise_for_status().json())
    def get_run_history(self, repo: Optional[str] = None, limit: int = 10) -> RunHistoryResponse:
        p: dict[str,Any] = {"limit":limit}
        if repo: p["repo"] = repo
        return RunHistoryResponse.model_validate(self._gh().get("/history", params=p).raise_for_status().json())
    def list_repos(self, platform: Optional[str] = None) -> ListReposResponse:
        return ListReposResponse.model_validate(self._gh().get("/repos", params={"platform":platform} if platform else {}).raise_for_status().json())
    def get_pricing(self, plan_id: Optional[str] = None) -> GetPricingResponse:
        return GetPricingResponse.model_validate(self._gh().get("/pricing", params={"plan_id":plan_id} if plan_id else {}).raise_for_status().json())
    def close(self) -> None:
        if self._http: self._http.close(); self._http = None
