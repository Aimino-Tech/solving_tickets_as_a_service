from __future__ import annotations
from typing import Any
import httpx
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.models import EngagementRecord
from app.common.db import get_repository
from app.common.rate_limiter import linkedin_limiter, RateLimitExceeded

API_BASE = "https://api.linkedin.com"
API_VERSION = "2.0.0"


class LinkedInAPIError(Exception):
    def __init__(self, status_code: int, message: str, response_body: str = ""):
        self.status_code = status_code
        self.response_body = response_body
        super().__init__(f"LinkedIn API error {status_code}: {message}")


class LinkedInAPIClient:
    def __init__(self, access_token: str | None = None):
        self.access_token = access_token or settings.linkedin_access_token
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "X-Restli-Protocol-Version": API_VERSION,
            "Content-Type": "application/json",
        }

    def post_content(
        self,
        commentary: str,
        person_id: str | None = None,
        visibility: str = "PUBLIC",
        article_url: str | None = None,
    ) -> EngagementRecord:
        limiter = linkedin_limiter()
        limiter.check()

        pid = person_id or settings.linkedin_user_urn.replace("urn:li:person:", "")

        post_body: dict[str, Any] = {
            "author": f"urn:li:person:{pid}",
            "commentary": commentary,
            "visibility": visibility,
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        if article_url:
            post_body["content"] = {
                "article": {"source": article_url},
            }

        record = EngagementRecord(
            platform="linkedin",
            engagement_type="post",
            content=commentary,
            target=f"urn:li:person:{pid}",
            status="pending_approval",
            metadata={"visibility": visibility, "article_url": article_url},
        )

        repo = get_repository()
        repo.log_engagement(record)

        if not settings.auto_approve:
            return record

        try:
            resp = httpx.post(
                f"{API_BASE}/rest/posts",
                headers=self.headers,
                json=post_body,
                timeout=30,
            )
            if resp.status_code == 201:
                record.mark_sent()
                repo.update_status(record.id, "sent")
            elif resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", "60"))
                record.mark_rate_limited(retry_after)
                repo.update_status(record.id, "rate_limited")
            else:
                error_msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                record.mark_failed(error_msg)
                repo.update_status(record.id, "failed", error=error_msg)
                raise LinkedInAPIError(resp.status_code, resp.text[:200], resp.text)
        except httpx.RequestError as e:
            error_msg = f"Request failed: {e}"
            record.mark_failed(error_msg)
            repo.update_status(record.id, "failed", error=error_msg)
            raise LinkedInAPIError(0, error_msg)

        return record

    def approve_and_send(self, record_id: str, approved_by: str = "operator") -> EngagementRecord:
        repo = get_repository()
        records = repo.query(platform="linkedin", status="pending_approval")
        target = next((r for r in records if r.id == record_id), None)
        if not target:
            raise ValueError(f"No pending engagement found: {record_id}")

        pid = settings.linkedin_user_urn.replace("urn:li:person:", "")
        post_body = {
            "author": f"urn:li:person:{pid}",
            "commentary": target.content,
            "visibility": target.metadata.get("visibility", "PUBLIC"),
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        try:
            resp = httpx.post(
                f"{API_BASE}/rest/posts",
                headers=self.headers,
                json=post_body,
                timeout=30,
            )
            if resp.status_code == 201:
                repo.update_status(record_id, "sent", approved_by=approved_by)
                target.status = "sent"
            elif resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", "60"))
                repo.update_status(record_id, "rate_limited", error=f"429 retry_after={retry_after}")
                target.status = "rate_limited"
            else:
                error_msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                repo.update_status(record_id, "failed", error=error_msg)
                raise LinkedInAPIError(resp.status_code, resp.text[:200], resp.text)
        except httpx.RequestError as e:
            error_msg = f"Request failed: {e}"
            repo.update_status(record_id, "failed", error=error_msg)
            raise LinkedInAPIError(0, error_msg)

        return target
