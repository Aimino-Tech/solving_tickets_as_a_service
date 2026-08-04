from __future__ import annotations
import enum
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field

class AuthScope(str, enum.Enum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"

SCOPE_HIERARCHY: dict[AuthScope, set[AuthScope]] = {
    AuthScope.READ: {AuthScope.READ},
    AuthScope.WRITE: {AuthScope.READ, AuthScope.WRITE},
    AuthScope.ADMIN: {AuthScope.READ, AuthScope.WRITE, AuthScope.ADMIN},
}

class AuthToken(BaseModel):
    token: str
    scope: AuthScope
    expires_at: datetime
    key_name: Optional[str] = None

class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class Capability(BaseModel):
    name: str
    description: str
    required_scope: AuthScope
    parameters: dict[str, Any] = {}
    returns: dict[str, Any] = {}

class CapabilityList(BaseModel):
    capabilities: list[Capability]
    protocol_version: str = "1.0.0"
    server_version: str = "0.1.0"

class SubmitIssueRequest(BaseModel):
    repo: str = Field(..., min_length=1, pattern=r"^[\w.-]+/[\w.-]+$")
    title: str = Field(..., min_length=1, max_length=1000)
    body: str = Field(..., min_length=1, max_length=100000)
    labels: list[str] = []

class SubmitIssueResponse(BaseModel):
    run_id: str = ""
    status: str = "queued"
    created_at: datetime = datetime.now()
    poll_url: Optional[str] = None

class CheckStatusRequest(BaseModel):
    run_id: str = Field(..., min_length=1)

class CheckStatusResponse(BaseModel):
    run_id: str
    status: str = "unknown"
    phase: str = "queued"
    progress_pct: float = 0.0
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class RunEntry(BaseModel):
    run_id: str
    repo: str
    issue_title: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    result_url: Optional[str] = None

class RunHistoryRequest(BaseModel):
    repo: Optional[str] = None
    limit: int = 10

class RunHistoryResponse(BaseModel):
    runs: list[RunEntry] = []
    total: int = 0

class RepoEntry(BaseModel):
    name: str
    platform: str = "github"
    private: bool = False
    active: bool = True

class ListReposRequest(BaseModel):
    platform: Optional[str] = None

class ListReposResponse(BaseModel):
    repos: list[RepoEntry] = []
    total: int = 0

class PlanEntry(BaseModel):
    id: str
    name: str
    description: str
    amount_cents: int
    monthly_fix_limit: int
    premium_models: bool = False
    concurrent_fixes: int = 1

class GetPricingRequest(BaseModel):
    plan_id: Optional[str] = None

class GetPricingResponse(BaseModel):
    plans: list[PlanEntry] = []
    active_plan: Optional[str] = None
