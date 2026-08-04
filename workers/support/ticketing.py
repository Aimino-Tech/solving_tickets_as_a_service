"""
Jira Service Management (JSM) ticketing integration for SYNTARO support.

Provides functions to create, read, and update customer requests in Jira Service
Management using the JSM REST API (``/rest/servicedeskapi/``).

Usage::

    from workers.support.ticketing import create_ticket, get_ticket, add_comment

    # Create a customer request
    ticket = create_ticket(
        service_desk_id="1",
        request_type_id="10",
        summary="Need help with webhook setup",
        description="User cannot configure webhooks on the pro tier",
        raise_on_auth_error=False,
    )
    if ticket:
        print(f"Created {ticket.issue_key} -- status: {ticket.status}")

    # Get ticket status
    status = get_ticket("PROJ-123")
    print(status.status, status.request_type)

    # Add an internal note (only visible to agents)
    add_comment("PROJ-123", "Investigating...", is_internal=True)

    # Add a public comment (visible to the customer)
    add_comment("PROJ-123", "We've fixed this issue.", is_internal=False)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

JSM_API_BASE: str = os.getenv("JSM_API_BASE", "").rstrip("/")
JSM_EMAIL: str = os.getenv("JSM_EMAIL", "")
JSM_API_TOKEN: str = os.getenv("JSM_API_TOKEN", "")
JSM_DEFAULT_SERVICE_DESK_ID: str = os.getenv("JSM_DEFAULT_SERVICE_DESK_ID", "")
JSM_DEFAULT_REQUEST_TYPE_ID: str = os.getenv("JSM_DEFAULT_REQUEST_TYPE_ID", "")
JSM_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("JSM_REQUEST_TIMEOUT_SECONDS", "30"))

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class TicketResult:
    """Represents a JSM customer request created or fetched via the API."""

    issue_key: str = ""
    summary: str = ""
    status: str = ""
    request_type: str = ""
    created_at: str = ""
    updated_at: str = ""
    service_desk_id: str = ""
    description: str = ""
    errors: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def fallback(cls) -> TicketResult:
        """Return a safe, empty fallback."""
        return cls()

    @property
    def is_valid(self) -> bool:
        return bool(self.issue_key)


@dataclass
class CommentResult:
    """Result of posting a comment or internal note on a JSM ticket."""

    comment_id: str = ""
    issue_key: str = ""
    is_internal: bool = False
    created_at: str = ""
    errors: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def fallback(cls) -> CommentResult:
        return cls()

    @property
    def is_valid(self) -> bool:
        return bool(self.comment_id)


@dataclass
class RequestTypeResult:
    """A JSM request type available on a service desk."""

    id: str = ""
    name: str = ""
    description: str = ""
    group: str = ""
    issue_type_name: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _build_auth() -> httpx.BasicAuth | None:
    """Return Jira BasicAuth when credentials are available, else None."""
    if JSM_EMAIL and JSM_API_TOKEN:
        return httpx.BasicAuth(JSM_EMAIL, JSM_API_TOKEN)
    return None


def _get_headers() -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_ticket(
    summary: str,
    description: str = "",
    service_desk_id: str | None = None,
    request_type_id: str | None = None,
    raise_on_auth_error: bool = False,
    extra_fields: dict[str, Any] | None = None,
) -> TicketResult:
    """Create a customer request in Jira Service Management.

    Uses the JSM REST API v3
    ``/rest/servicedeskapi/servicedesk/{serviceDeskId}/request`` endpoint.

    Parameters
    ----------
    summary:
        Brief title for the request.
    description:
        Detailed description of the issue.
    service_desk_id:
        Service desk (project) ID. Falls back to ``JSM_DEFAULT_SERVICE_DESK_ID``
        env var, then returns a fallback result with an error.
    request_type_id:
        Request type ID. Falls back to ``JSM_DEFAULT_REQUEST_TYPE_ID`` env var,
        then returns a fallback result with an error.
    raise_on_auth_error:
        If ``True``, raise ``ValueError`` when credentials are missing.
    extra_fields:
        Additional fields to include in the request (e.g. priority, custom
        fields).

    Returns
    -------
    TicketResult
        Created ticket info on success, or a fallback with ``errors`` populated.
    """
    auth = _build_auth()
    if not auth:
        msg = (
            "JSM credentials not configured -- set JSM_EMAIL and "
            "JSM_API_TOKEN environment variables"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    sid = service_desk_id or JSM_DEFAULT_SERVICE_DESK_ID
    if not sid:
        msg = (
            "No service_desk_id provided and JSM_DEFAULT_SERVICE_DESK_ID "
            "not set in environment"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    rtid = request_type_id or JSM_DEFAULT_REQUEST_TYPE_ID
    if not rtid:
        msg = (
            "No request_type_id provided and JSM_DEFAULT_REQUEST_TYPE_ID "
            "not set in environment"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    url = f"{JSM_API_BASE}/rest/servicedeskapi/servicedesk/{sid}/request"

    payload: dict[str, Any] = {
        "serviceDeskId": sid,
        "requestTypeId": rtid,
        "requestFieldValues": {
            "summary": summary,
            "description": description,
        },
    }

    if extra_fields:
        payload["requestFieldValues"].update(extra_fields)

    try:
        with httpx.Client(timeout=JSM_REQUEST_TIMEOUT_SECONDS) as client:
            resp = client.post(url, headers=_get_headers(), json=payload, auth=auth)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
    except httpx.HTTPStatusError as exc:
        msg = (
            f"HTTP error creating JSM ticket: {exc.response.status_code} "
            f"{exc.response.text[:500]}"
        )
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result
    except httpx.RequestError as exc:
        msg = f"Request error creating JSM ticket: {exc}"
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result
    except Exception as exc:
        msg = f"Unexpected error creating JSM ticket: {exc}"
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    return _parse_ticket_response(data, sid)


def get_ticket(
    issue_key: str,
    raise_on_auth_error: bool = False,
) -> TicketResult:
    """Fetch a customer request from Jira Service Management.

    Uses ``/rest/servicedeskapi/request/{issueKey}``.

    Parameters
    ----------
    issue_key:
        Jira issue key (e.g. ``PROJ-123``).
    raise_on_auth_error:
        If ``True``, raise ``ValueError`` when credentials are missing.

    Returns
    -------
    TicketResult
        Ticket details on success, or a fallback with ``errors`` populated.
    """
    auth = _build_auth()
    if not auth:
        msg = (
            "JSM credentials not configured -- set JSM_EMAIL and "
            "JSM_API_TOKEN environment variables"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    if not issue_key:
        msg = "issue_key is required to fetch a ticket"
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    url = f"{JSM_API_BASE}/rest/servicedeskapi/request/{issue_key}"

    try:
        with httpx.Client(timeout=JSM_REQUEST_TIMEOUT_SECONDS) as client:
            resp = client.get(url, headers=_get_headers(), auth=auth)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        msg = (
            f"HTTP error fetching JSM ticket {issue_key}: "
            f"{exc.response.status_code} {exc.response.text[:500]}"
        )
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result
    except httpx.RequestError as exc:
        msg = f"Request error fetching JSM ticket {issue_key}: {exc}"
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result
    except Exception as exc:
        msg = f"Unexpected error fetching JSM ticket {issue_key}: {exc}"
        logger.error(msg)
        result = TicketResult.fallback()
        result.errors.append(msg)
        return result

    return _parse_ticket_response(data, "")


def add_comment(
    issue_key: str,
    body: str,
    is_internal: bool = False,
    raise_on_auth_error: bool = False,
) -> CommentResult:
    """Add a comment (public or internal note) to a JSM ticket.

    Uses the JSM REST API v3
    ``/rest/servicedeskapi/request/{issueKey}/comment`` endpoint.

    Parameters
    ----------
    issue_key:
        Jira issue key to comment on.
    body:
        Comment text. Supports Atlassian Document Format or plain text.
    is_internal:
        If ``True``, the comment is an internal note (visible only to agents).
    raise_on_auth_error:
        If ``True``, raise ``ValueError`` when credentials are missing.

    Returns
    -------
    CommentResult
        Result with comment ID on success, or a fallback with ``errors``.
    """
    auth = _build_auth()
    if not auth:
        msg = (
            "JSM credentials not configured -- set JSM_EMAIL and "
            "JSM_API_TOKEN environment variables"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result

    if not issue_key:
        msg = "issue_key is required to add a comment"
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result

    if not body:
        msg = "comment body is empty"
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result

    url = f"{JSM_API_BASE}/rest/servicedeskapi/request/{issue_key}/comment"

    payload: dict[str, Any] = {
        "body": body,
        "public": not is_internal,
    }

    try:
        with httpx.Client(timeout=JSM_REQUEST_TIMEOUT_SECONDS) as client:
            resp = client.post(url, headers=_get_headers(), json=payload, auth=auth)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        msg = (
            f"HTTP error posting comment on JSM ticket {issue_key}: "
            f"{exc.response.status_code} {exc.response.text[:500]}"
        )
        logger.error(msg)
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result
    except httpx.RequestError as exc:
        msg = f"Request error posting comment on JSM ticket {issue_key}: {exc}"
        logger.error(msg)
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result
    except Exception as exc:
        msg = f"Unexpected error posting comment on JSM ticket {issue_key}: {exc}"
        logger.error(msg)
        result = CommentResult.fallback()
        result.errors.append(msg)
        return result

    return _parse_comment_response(data, issue_key, is_internal)


def list_request_types(
    service_desk_id: str | None = None,
    raise_on_auth_error: bool = False,
) -> list[RequestTypeResult]:
    """List available request types for a service desk.

    Uses ``/rest/servicedeskapi/servicedesk/{serviceDeskId}/requesttype``.

    Parameters
    ----------
    service_desk_id:
        Service desk (project) ID. Falls back to env var.
    raise_on_auth_error:
        If ``True``, raise ``ValueError`` when credentials are missing.

    Returns
    -------
    list[RequestTypeResult]
        List of available request types. Empty list on error.
    """
    auth = _build_auth()
    if not auth:
        msg = (
            "JSM credentials not configured -- set JSM_EMAIL and "
            "JSM_API_TOKEN environment variables"
        )
        logger.warning(msg)
        if raise_on_auth_error:
            raise ValueError(msg)
        return []

    sid = service_desk_id or JSM_DEFAULT_SERVICE_DESK_ID
    if not sid:
        logger.warning(
            "No service_desk_id provided and JSM_DEFAULT_SERVICE_DESK_ID "
            "not set in environment"
        )
        return []

    url = f"{JSM_API_BASE}/rest/servicedeskapi/servicedesk/{sid}/requesttype"

    try:
        with httpx.Client(timeout=JSM_REQUEST_TIMEOUT_SECONDS) as client:
            resp = client.get(url, headers=_get_headers(), auth=auth)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error listing JSM request types: %s %s",
            exc.response.status_code,
            exc.response.text[:500],
        )
        return []
    except httpx.RequestError as exc:
        logger.error("Request error listing JSM request types: %s", exc)
        return []
    except Exception as exc:
        logger.error("Unexpected error listing JSM request types: %s", exc)
        return []

    values = data.get("values", [])
    return [
        RequestTypeResult(
            id=rt.get("id", ""),
            name=rt.get("name", ""),
            description=rt.get("description", ""),
            group=rt.get("group", ""),
            issue_type_name=(
                rt.get("issueType", {}).get("name", "")
                if isinstance(rt.get("issueType"), dict)
                else ""
            ),
            raw=rt,
        )
        for rt in values
    ]


# ---------------------------------------------------------------------------
# Response parsers
# ---------------------------------------------------------------------------


def _parse_ticket_response(data: dict[str, Any], sid: str) -> TicketResult:
    """Parse a JSM API response into a ``TicketResult``."""
    issue_key = data.get("issueKey", data.get("key", ""))
    current_status = data.get("currentStatus", {}) or {}
    issue_type = data.get("issueType", data.get("type", {})) or {}
    request_field_values = data.get("requestFieldValues", {}) or {}
    created_at = data.get("createdDate", data.get("createdAt", ""))
    updated_at = data.get("updatedDate", data.get("updatedAt", ""))

    created_iso = _normalize_timestamp(created_at) if created_at else ""
    updated_iso = _normalize_timestamp(updated_at) if updated_at else ""

    desc = request_field_values.get("description", "")
    if not desc:
        desc = data.get("description", "")

    return TicketResult(
        issue_key=issue_key,
        summary=request_field_values.get("summary", data.get("summary", "")),
        status=current_status.get("status", current_status.get("name", "")),
        request_type=issue_type.get("name", data.get("requestType", {}).get("name", "")),
        created_at=created_iso,
        updated_at=updated_iso,
        service_desk_id=sid or data.get("serviceDeskId", ""),
        description=desc,
        raw=data,
    )


def _parse_comment_response(
    data: dict[str, Any],
    issue_key: str,
    is_internal: bool,
) -> CommentResult:
    """Parse a JSM comment API response into a ``CommentResult``."""
    comment_id = data.get("id", data.get("commentId", ""))
    created_at = data.get("created", data.get("createdAt", ""))
    created_iso = _normalize_timestamp(created_at) if created_at else ""

    return CommentResult(
        comment_id=str(comment_id),
        issue_key=issue_key,
        is_internal=is_internal,
        created_at=created_iso,
        raw=data,
    )


def _normalize_timestamp(ts: str) -> str:
    """Normalize a timestamp to ISO-8601 format."""
    if not ts:
        return ""
    if ts.startswith("/Date("):
        try:
            epoch_part = ts[6:].split("+")[0].split("-")[0].split(")")[0]
            epoch_ms = int(epoch_part)
            return datetime.fromtimestamp(epoch_ms / 1000).isoformat()
        except (ValueError, IndexError):
            pass
    return ts


# ---------------------------------------------------------------------------
# Configuration validation
# ---------------------------------------------------------------------------


def check_config() -> list[str]:
    """Validate JSM configuration and return list of issues.

    Returns an empty list if the configuration is complete.
    """
    issues: list[str] = []
    if not JSM_API_BASE:
        issues.append("JSM_API_BASE is not set")
    if not JSM_EMAIL:
        issues.append("JSM_EMAIL is not set")
    if not JSM_API_TOKEN:
        issues.append("JSM_API_TOKEN is not set")
    if JSM_EMAIL and JSM_API_TOKEN:
        auth = _build_auth()
        if auth is None:
            issues.append("JSM credentials could not build valid auth")
    return issues
