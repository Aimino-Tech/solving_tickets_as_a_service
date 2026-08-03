"""
Bi-directional Jira ↔ PR linking.

Extracts Jira issue keys from PR metadata (title, description, branch name)
and creates links in both directions:

- **Jira → PR**: Posts a comment on the Jira issue with the PR URL
- **PR → Jira**: Appends a Jira Issues section to the PR description

Usage::

    from workers.integrations.support_link import link_pr_to_jira

    result = link_pr_to_jira(
        pr_url="https://github.com/owner/repo/pull/42",
        pr_title="[PROJ-123] Fix login bug",
        pr_body="Description of the fix",
        branch_name="fix/PROJ-123-login",
    )
    # result.jira_issue_keys -> ["PROJ-123"]
    # result.comments_posted -> [{"issue_key": "PROJ-123", "comment_id": "12345"}]
    # result.updated_pr_body -> original body + Jira issues section
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Matches Jira issue keys like PROJ-123, SYNTARO-42, TEAM_NAME-7
JIRA_ISSUE_KEY_PATTERN = re.compile(r"\b[A-Z][A-Z0-9_]+-\d+\b")

# Env-var defaults -- override via environment
JIRA_API_BASE = os.getenv("JIRA_API_BASE", "").rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")

# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class LinkResult:
    """Summary of a Jira <-> PR link operation."""

    jira_issue_keys: list[str] = field(default_factory=list)
    """Unique Jira issue keys found in the PR metadata."""

    pr_url: str = ""
    """URL of the pull request."""

    pr_title: str = ""
    """Title of the pull request."""

    comments_posted: list[dict[str, Any]] = field(default_factory=list)
    """List of successfully-posted Jira comments, each with ``issue_key`` and ``comment_id``."""

    errors: list[str] = field(default_factory=list)
    """Non-fatal error messages collected during the operation."""

    updated_pr_body: str = ""
    """PR description with the Jira Issues section appended (if not already present)."""

    jira_links_appended: bool = False
    """Whether the Jira issues section was appended to the PR body."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def link_pr_to_jira(
    pr_url: str,
    pr_title: str = "",
    pr_body: str = "",
    branch_name: str = "",
) -> LinkResult:
    """Bi-directionally link a Pull Request to Jira issues.

    Two-phase operation:

    1. **Extract** -- scan *pr_title*, *pr_body*, and *branch_name* for Jira
       issue keys (e.g. ``PROJ-123``).
    2. **Link** -- for each found key:
       - Post a comment on the Jira issue pointing to the PR.
       - Build a Jira Issues section to append to the PR body.

    Parameters
    ----------
    pr_url:
        Full URL of the pull request (e.g. ``https://github.com/o/r/pull/42``).
    pr_title:
        Pull request title.
    pr_body:
        Pull request description / body text.
    branch_name:
        Git branch name.

    Returns
    -------
    LinkResult
        Summary of what was linked, posted, and whether the PR body was updated.
    """
    result = LinkResult(pr_url=pr_url, pr_title=pr_title)

    # -- Phase 1: Extract Jira keys -----------------------------------------

    seen: set[str] = set()
    for source in (pr_title, pr_body, branch_name):
        for key in _extract_jira_keys(source):
            if key not in seen:
                seen.add(key)
                result.jira_issue_keys.append(key)

    if not result.jira_issue_keys:
        result.updated_pr_body = pr_body or ""
        logger.info("No Jira issue keys found in PR metadata")
        return result

    logger.info(
        "Found Jira issue keys in PR metadata: %s",
        ", ".join(result.jira_issue_keys),
    )

    # -- Phase 2a: Post comments on Jira issues (Jira -> PR) ------------------

    auth = _build_auth()
    if auth is None:
        logger.warning(
            "JIRA_EMAIL / JIRA_API_TOKEN not configured -- "
            "skipping Jira comment posting",
        )
        result.errors.append(
            "Jira credentials not configured (set JIRA_EMAIL and JIRA_API_TOKEN)",
        )
    else:
        for issue_key in result.jira_issue_keys:
            try:
                comment = _post_jira_comment(issue_key, pr_title, pr_url, auth)
                comment_id = comment.get("id", "")
                result.comments_posted.append({
                    "issue_key": issue_key,
                    "comment_id": comment_id,
                })
                logger.info(
                    "Posted Jira comment on %s (comment id=%s) for PR %s",
                    issue_key,
                    comment_id,
                    pr_url,
                )
            except httpx.HTTPStatusError as exc:
                msg = (
                    f"HTTP error posting comment on Jira issue {issue_key}: "
                    f"{exc.response.status_code} {exc.response.text[:200]}"
                )
                logger.error(msg)
                result.errors.append(msg)
            except httpx.RequestError as exc:
                msg = f"Request error posting comment on Jira issue {issue_key}: {exc}"
                logger.error(msg)
                result.errors.append(msg)
            except Exception as exc:  # noqa: BLE001
                msg = f"Unexpected error posting comment on Jira issue {issue_key}: {exc}"
                logger.error(msg)
                result.errors.append(msg)

    # -- Phase 2b: Build Jira section for PR body (PR -> Jira) ----------------

    existing_body = pr_body or ""
    jira_section = _build_jira_section(result.jira_issue_keys)

    # Only append if the section is not already present.  Use per-key
    # detection (checking each key has a link in the body) so that even
    # when *JIRA_API_BASE* differs from a previously-injected URL we
    # avoid duplication.
    if _section_already_present(existing_body, result.jira_issue_keys):
        result.updated_pr_body = existing_body
    else:
        result.updated_pr_body = existing_body.rstrip() + "\n\n" + jira_section
        result.jira_links_appended = True

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_jira_keys(text: str | None) -> list[str]:
    """Extract unique, ordered Jira issue keys from *text*."""
    if not text:
        return []
    return re.findall(JIRA_ISSUE_KEY_PATTERN, text)


def _build_auth() -> httpx.BasicAuth | None:
    """Return Jira BasicAuth when credentials are available, else ``None``."""
    if JIRA_EMAIL and JIRA_API_TOKEN:
        return httpx.BasicAuth(JIRA_EMAIL, JIRA_API_TOKEN)
    return None


def _section_already_present(body: str, issue_keys: list[str]) -> bool:
    """Check whether *body* already contains links for all *issue_keys*.

    Detects ``[KEY-123](.../browse/KEY-123)`` references -- this is more
    robust than exact string matching because *JIRA_API_BASE* might differ
    between injection runs.
    """
    if not body or not issue_keys:
        return False
    return all(
        re.search(rf"\[{re.escape(key)}\]\([^)]*/browse/{re.escape(key)}\)", body)
        for key in issue_keys
    )


def _build_jira_section(issue_keys: list[str]) -> str:
    """Build a Markdown section linking to Jira issues.

    Produces something like::

        ### Jira Issues

        - [PROJ-123](https://your-domain.atlassian.net/browse/PROJ-123)
    """
    base = JIRA_API_BASE or "https://your-domain.atlassian.net"
    links = "\n".join(
        f"- [{key}]({base}/browse/{key})" for key in issue_keys
    )
    return f"### Jira Issues\n\n{links}"


def _post_jira_comment(
    issue_key: str,
    pr_title: str,
    pr_url: str,
    auth: httpx.BasicAuth,
) -> dict[str, Any]:
    """Post an Atlassian Document Format comment on *issue_key*.

    Uses the Jira REST API v3 ``/rest/api/3/issue/{key}/comment`` endpoint.
    The body is sent as ADF (Atlassian Document Format) -- the standard format
    required by Jira Cloud.
    """
    url = f"{JIRA_API_BASE}/rest/api/3/issue/{issue_key}/comment"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    comment_text = (
        f"Pull Request linked to this issue:\n"
        f"Title: {pr_title}\n"
        f"URL: {pr_url}"
    )

    payload = {
        "body": {
            "version": 1,
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": comment_text},
                    ],
                },
            ],
        },
    }

    with httpx.Client() as client:
        resp = client.post(url, headers=headers, json=payload, auth=auth)
        resp.raise_for_status()
        return resp.json()
