"""
PLG self-serve onboarding back-end (AIM-2075).

Provides the worker-side logic for product-led growth onboarding:

- Usage-based display ("3/50 free fixes", tier detection)
- No-config detection (checks whether webhook + installation are active)
- Welcome issue auto-creator (opens a "try me" issue via GitHub API)

Communicates with the Express front-end via the worker HTTP API (Flask/FastAPI
endpoints mounted at /api/plg/*). All Redis state is shared with
workers/billing/usage.py for atomic usage counters.

── Design ─────────────────────────────────────────────────────────────────────
- Onboarding state is stored in Redis under ``stas:plg:{tenant_id}``
  (complementary to the OnboardingStateMachine in onboarding.py, which covers
  the wizard flow — this module covers the PLG-specific self-serve path).
- Welcome issue creation uses the GitHub App installation token (no user OAuth
  token needed — the installation token has write access to issues).
- Tier detection reuses the same env-var scheme as usage.py and enforcer.py.
- All errors are non-fatal: failures in welcome issue creation or webhook
  auto-config never block the onboarding flow.
────────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from celery import shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PLG_REDIS_PREFIX = "stas:plg:"
_PLG_TTL_S = int(os.getenv("PLG_TTL_S", str(30 * 24 * 3600)))  # 30 days

_TIER_MAX_ISSUES: dict[str, int] = {
    "free": int(os.getenv("TIER_FREE_MAX_ISSUES", "3")),
    "pro": int(os.getenv("TIER_PRO_MAX_ISSUES", "100")),
    "team": int(os.getenv("TIER_TEAM_MAX_ISSUES", "500")),
    "enterprise": int(os.getenv("TIER_ENTERPRISE_MAX_ISSUES", "-1")),
}

_WELCOME_ISSUE_TITLE = os.getenv("WELCOME_ISSUE_TITLE", "Welcome to STAS \u2014 try your first fix!")
_WELCOME_ISSUE_LABEL = os.getenv("WELCOME_ISSUE_LABEL", "stas:fix")

# ---------------------------------------------------------------------------
# Redis client (shared singleton)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("PLG Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class PlgState:
    """Per-tenant PLG onboarding state."""

    tenant_id: str
    github_installed: bool = False
    installation_id: int | None = None
    repo_selected: bool = False
    connected_repos: int = 0
    webhook_configured: bool = False
    welcome_issue_created: bool = False
    first_fix_completed: bool = False
    joined_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlgState:
        return cls(
            tenant_id=data["tenant_id"],
            github_installed=data.get("github_installed", False),
            installation_id=data.get("installation_id"),
            repo_selected=data.get("repo_selected", False),
            connected_repos=data.get("connected_repos", 0),
            webhook_configured=data.get("webhook_configured", False),
            welcome_issue_created=data.get("welcome_issue_created", False),
            first_fix_completed=data.get("first_fix_completed", False),
            joined_at=data.get("joined_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
        )


# ---------------------------------------------------------------------------
# Tier / usage helpers
# ---------------------------------------------------------------------------


def _resolve_tier(tenant_id: str) -> str:
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    tier = os.getenv(env_var, "free").lower()
    if tier in _TIER_MAX_ISSUES:
        return tier
    return "free"


def _tier_max_issues(tier: str) -> int:
    val = _TIER_MAX_ISSUES.get(tier, 3)
    if val < 0:
        return -1
    return val


def _build_display(count: int, remaining: int) -> str:
    total = count + max(0, remaining)
    if remaining < 0:
        return f"{count} fixes (unlimited)"
    return f"{count}/{total} free fixes"


def get_usage_summary(tenant_id: str) -> dict[str, Any]:
    """Get usage summary for PLG display.

    Reads from the shared usage counter in Redis (same keys as
    workers.billing.usage uses).
    """
    try:
        from workers.billing.usage import get_usage

        usage = get_usage(tenant_id)
        count = usage.get("count", 0)
    except Exception as exc:
        logger.warning("Usage lookup failed for tenant=%s -- %s", tenant_id, exc)
        count = 0

    tier = _resolve_tier(tenant_id)
    max_issues = _tier_max_issues(tier)

    if max_issues < 0:
        remaining = -1
    else:
        remaining = max(0, max_issues - count)

    return {
        "count": count,
        "remaining": remaining,
        "tier": tier,
        "display": _build_display(count, remaining),
    }


def check_no_config(tenant_id: str) -> dict[str, Any]:
    """Detect whether the tenant has any configuration gaps.

    Scans the PLG state and returns what is missing / already set.
    """
    state = _load_state(tenant_id)
    if state is None:
        return {
            "configured": False,
            "missing": ["github_installed", "webhook_configured", "repo_selected"],
            "items": {
                "github_installed": False,
                "webhook_configured": False,
                "repo_selected": False,
                "welcome_issue_created": False,
            },
        }

    items = {
        "github_installed": state.github_installed,
        "webhook_configured": state.webhook_configured,
        "repo_selected": state.repo_selected,
        "welcome_issue_created": state.welcome_issue_created,
    }
    missing = [k for k, v in items.items() if not v]

    return {
        "configured": len(missing) == 0,
        "missing": missing,
        "items": items,
    }


# ---------------------------------------------------------------------------
# PLG state persistence
# ---------------------------------------------------------------------------


def _redis_key(tenant_id: str) -> str:
    return f"{_PLG_REDIS_PREFIX}{tenant_id}"


def _load_state(tenant_id: str) -> PlgState | None:
    client = _get_redis()
    if client is None:
        return None
    try:
        raw = client.get(_redis_key(tenant_id))
        if raw:
            data = json.loads(raw)
            return PlgState.from_dict(data)
    except Exception as exc:
        logger.warning("Failed to load PLG state for %s -- %s", tenant_id, exc)
    return None


def _save_state(state: PlgState) -> None:
    state.updated_at = time.time()
    client = _get_redis()
    if client is None:
        logger.warning("Redis unavailable -- PLG state not saved for %s", state.tenant_id)
        return
    try:
        client.setex(_redis_key(state.tenant_id), _PLG_TTL_S, json.dumps(state.to_dict()))
    except Exception as exc:
        logger.warning("Failed to save PLG state for %s -- %s", state.tenant_id, exc)


def get_state(tenant_id: str) -> PlgState | None:
    return _load_state(tenant_id)


def get_or_create_state(tenant_id: str) -> PlgState:
    state = _load_state(tenant_id)
    if state is None:
        state = PlgState(tenant_id=tenant_id)
        _save_state(state)
    return state


def mark_github_installed(tenant_id: str, installation_id: int) -> PlgState:
    state = get_or_create_state(tenant_id)
    state.github_installed = True
    state.installation_id = installation_id
    _save_state(state)
    logger.info("PLG github_installed tenant=%s installation_id=%d", tenant_id, installation_id)
    return state


def mark_repo_selected(tenant_id: str, repo_count: int) -> PlgState:
    state = get_or_create_state(tenant_id)
    state.repo_selected = True
    state.connected_repos = repo_count
    _save_state(state)
    logger.info("PLG repo_selected tenant=%s repos=%d", tenant_id, repo_count)
    return state


def mark_webhook_configured(tenant_id: str) -> PlgState:
    state = get_or_create_state(tenant_id)
    state.webhook_configured = True
    _save_state(state)
    logger.info("PLG webhook_configured tenant=%s", tenant_id)
    return state


def mark_welcome_issue_created(tenant_id: str) -> PlgState:
    state = get_or_create_state(tenant_id)
    state.welcome_issue_created = True
    _save_state(state)
    logger.info("PLG welcome_issue_created tenant=%s", tenant_id)
    return state


def mark_first_fix_completed(tenant_id: str) -> PlgState:
    state = get_or_create_state(tenant_id)
    state.first_fix_completed = True
    _save_state(state)
    logger.info("PLG first_fix_completed tenant=%s", tenant_id)
    return state


def get_onboarding_summary(tenant_id: str) -> dict[str, Any]:
    """Get the full PLG onboarding summary for the status endpoint."""
    state = _load_state(tenant_id)
    usage = get_usage_summary(tenant_id)

    if state is None:
        return {
            "tenant_id": tenant_id,
            "state": "not_started",
            "github_installed": False,
            "repo_selected": False,
            "completed": False,
            "usage": usage,
            "connected_repos": 0,
            "installed_repos": 0,
            "first_fix_completed": False,
            "joined_at": None,
        }

    completed = (
        state.github_installed
        and state.repo_selected
        and state.webhook_configured
    )

    return {
        "tenant_id": tenant_id,
        "state": "completed" if completed else "in_progress",
        "github_installed": state.github_installed,
        "repo_selected": state.repo_selected,
        "completed": completed,
        "usage": usage,
        "connected_repos": state.connected_repos,
        "installed_repos": state.connected_repos,
        "first_fix_completed": state.first_fix_completed,
        "joined_at": state.joined_at,
    }


# ---------------------------------------------------------------------------
# Celery tasks: welcome issue creator
# ---------------------------------------------------------------------------


def _build_welcome_issue_body(bot_name: str) -> str:
    return (
        f"## Welcome to {bot_name}!\n"
        "\n"
        "I'm STAS, the AI-powered issue resolver. "
        "I can investigate bugs, write fixes, run your tests, and open a pull request "
        "\u2014 all from a single label.\n"
        "\n"
        "### Try me!\n"
        "\n"
        "1. **Keep this issue open** \u2014 don't close or modify it.\n"
        f"2. Add the **`{_WELCOME_ISSUE_LABEL}`** label to this issue.\n"
        "3. I'll automatically:\n"
        "   - Investigate the issue\n"
        "   - Write a fix\n"
        "   - Run your test suite\n"
        "   - Open a draft pull request\n"
        "\n"
        "### What to expect\n"
        "\n"
        "- **~2-4 minutes** from label to PR (depending on repo size)\n"
        "- A **draft PR** that you review and merge\n"
        "- **No config needed** \u2014 just the `stas:fix` label\n"
        "\n"
        "---\n"
        "\n"
        f"*Powered by [{bot_name}](https://stas.dev)*\n"
    )


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.billing.plg.create_welcome_issue",
)
def create_welcome_issue(
    self: Any,
    tenant_id: str,
    installation_id: int,
    repo_owner: str,
    repo_name: str,
) -> dict[str, Any]:
    """Celery task: create a welcome issue in the tenant's repo.

    Uses the GitHub App installation token to create an issue via the
    GitHub API. The issue is pre-labeled with ``stas:fix`` so the user
    can immediately trigger their first fix.
    """
    bot_name = os.getenv("BOT_NAME", "STAS")
    body = _build_welcome_issue_body(bot_name)

    try:
        token = _get_installation_token(installation_id)

        if not token:
            logger.error(
                "Failed to get installation token for tenant=%s installation_id=%d",
                tenant_id,
                installation_id,
            )
            return {"success": False, "error": "Failed to get installation token"}

        import httpx

        url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/issues"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "stas-plg/1.0",
        }
        payload = {
            "title": _WELCOME_ISSUE_TITLE,
            "body": body,
            "labels": [_WELCOME_ISSUE_LABEL],
        }

        resp = httpx.post(url, json=payload, headers=headers, timeout=30)

        if resp.status_code not in (201,):
            logger.error(
                "GitHub API error creating welcome issue: status=%d body=%s",
                resp.status_code,
                resp.text,
            )
            return {
                "success": False,
                "error": f"GitHub API returned {resp.status_code}: {resp.text[:200]}",
            }

        issue_data = resp.json()
        issue_url = issue_data.get("html_url", "")
        issue_number = issue_data.get("number", 0)

        mark_welcome_issue_created(tenant_id)

        logger.info(
            "Welcome issue created tenant=%s repo=%s/%s issue=%d",
            tenant_id,
            repo_owner,
            repo_name,
            issue_number,
        )

        return {
            "success": True,
            "issue_url": issue_url,
            "issue_number": issue_number,
        }

    except Exception as exc:
        logger.error(
            "Welcome issue creation failed tenant=%s repo=%s/%s -- %s",
            tenant_id,
            repo_owner,
            repo_name,
            exc,
        )
        return {"success": False, "error": str(exc)}


def _get_installation_token(installation_id: int) -> str | None:
    """Get a GitHub App installation access token.

    Uses GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY env vars to
    authenticate as the GitHub App and generate an installation token.
    """
    app_id = os.getenv("GITHUB_APP_ID")
    private_key = os.getenv("GITHUB_APP_PRIVATE_KEY")

    if not app_id or not private_key:
        logger.warning("GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not set -- cannot generate token")
        return None

    try:
        import time as _time
        import jwt as _jwt

        now = int(_time.time())
        payload = {
            "iat": now - 60,
            "exp": now + 600,
            "iss": app_id,
        }
        app_token = _jwt.encode(payload, private_key, algorithm="RS256")

        import httpx

        url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"
        headers = {
            "Authorization": f"Bearer {app_token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "stas-plg/1.0",
        }

        resp = httpx.post(url, headers=headers, timeout=30)

        if resp.status_code not in (201,):
            logger.error(
                "GitHub API error getting installation token: status=%d body=%s",
                resp.status_code,
                resp.text,
            )
            return None

        token_data = resp.json()
        return token_data.get("token")

    except Exception as exc:
        logger.error("Failed to get installation token: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Celery tasks: webhook auto-config
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.billing.plg.auto_configure_webhook",
)
def auto_configure_webhook(
    self: Any,
    tenant_id: str,
    installation_id: int,
    webhook_url: str,
) -> dict[str, Any]:
    """Celery task: auto-configure the GitHub webhook for a tenant.

    Checks whether a webhook already exists for the repo(s), and if not,
    creates one via the GitHub API.
    """
    token = _get_installation_token(installation_id)
    if not token:
        return {"configured": False, "error": "Failed to get installation token"}

    webhook_secret = os.getenv("GITHUB_WEBHOOK_SECRET", "stas-webhook-secret")

    try:
        import httpx

        repos_url = "https://api.github.com/installation/repositories"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "stas-plg/1.0",
        }

        repos_resp = httpx.get(repos_url, headers=headers, timeout=30)
        if repos_resp.status_code != 200:
            logger.error(
                "Failed to list repos for installation %d: status=%d",
                installation_id,
                repos_resp.status_code,
            )
            return {"configured": False, "error": f"Failed to list repos: {repos_resp.status_code}"}

        repos_data = repos_resp.json()
        repositories = repos_data.get("repositories", [])

        configured_count = 0
        webhook_ids: list[int] = []

        for repo in repositories:
            repo_full_name = repo.get("full_name", "")
            if not repo_full_name:
                continue

            owner, name = repo_full_name.split("/", 1)

            hooks_url = f"https://api.github.com/repos/{owner}/{name}/hooks"
            hooks_resp = httpx.get(hooks_url, headers=headers, timeout=30)

            if hooks_resp.status_code != 200:
                logger.warning("Failed to list hooks for %s: %d", repo_full_name, hooks_resp.status_code)
                continue

            existing_hooks = hooks_resp.json()
            already_configured = any(
                hook.get("config", {}).get("url", "").rstrip("/") == webhook_url.rstrip("/")
                for hook in existing_hooks
            )

            if already_configured:
                configured_count += 1
                for hook in existing_hooks:
                    if hook.get("config", {}).get("url", "").rstrip("/") == webhook_url.rstrip("/"):
                        webhook_ids.append(hook.get("id", 0))
                continue

            hook_payload = {
                "name": "web",
                "active": True,
                "events": ["issues", "issue_comment", "pull_request", "push"],
                "config": {
                    "url": webhook_url,
                    "content_type": "json",
                    "secret": webhook_secret,
                    "insecure_ssl": "0",
                },
            }

            create_resp = httpx.post(hooks_url, json=hook_payload, headers=headers, timeout=30)
            if create_resp.status_code in (201,):
                configured_count += 1
                hook_data = create_resp.json()
                webhook_ids.append(hook_data.get("id", 0))
                logger.info("Webhook created for %s (id=%d)", repo_full_name, hook_data.get("id", 0))
            else:
                logger.warning(
                    "Failed to create webhook for %s: status=%d body=%s",
                    repo_full_name,
                    create_resp.status_code,
                    create_resp.text[:200],
                )

        if configured_count > 0:
            mark_webhook_configured(tenant_id)

        return {
            "configured": configured_count > 0,
            "webhook_id": webhook_ids[0] if webhook_ids else None,
            "active": configured_count > 0,
            "events": ["issues", "issue_comment", "pull_request", "push"],
            "repos_configured": configured_count,
            "total_repos": len(repositories),
        }

    except Exception as exc:
        logger.error("Webhook auto-config failed for tenant=%s -- %s", tenant_id, exc)
        return {"configured": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Dashboard data aggregation
# ---------------------------------------------------------------------------


def get_dashboard_data(tenant_id: str, limit: int = 10) -> dict[str, Any]:
    """Aggregate dashboard data for a tenant.

    Combines PLG state, usage data, connected repos, and recent fix runs.
    """
    state = _load_state(tenant_id)
    usage = get_usage_summary(tenant_id)

    connected_repos: list[dict[str, Any]] = []
    recent_runs: list[dict[str, Any]] = []

    if state and state.installation_id:
        try:
            token = _get_installation_token(state.installation_id)
            if token:
                import httpx

                headers = {
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "stas-plg/1.0",
                }
                repos_resp = httpx.get(
                    "https://api.github.com/installation/repositories",
                    headers=headers,
                    timeout=15,
                )
                if repos_resp.status_code == 200:
                    repos_data = repos_resp.json()
                    for repo in repos_data.get("repositories", []):
                        connected_repos.append({
                            "owner": repo["owner"]["login"],
                            "name": repo["name"],
                            "active": True,
                        })
        except Exception as exc:
            logger.warning("Failed to fetch connected repos for %s -- %s", tenant_id, exc)

    try:
        import httpx as _httpx

        stas_api_url = os.getenv("STAS_API_URL", "https://api.stas.aimino.io")
        runs_resp = _httpx.get(
            f"{stas_api_url}/api/runs",
            params={"limit": limit, "tenantId": tenant_id},
            timeout=10,
        )
        if runs_resp.status_code == 200:
            runs_data = runs_resp.json()
            runs_list = runs_data.get("runs", []) if isinstance(runs_data, dict) else runs_data
            for run in runs_list[:limit]:
                recent_runs.append({
                    "id": run.get("id", ""),
                    "issue_title": run.get("issueTitle", run.get("issue_title", "Unknown")),
                    "status": run.get("status", "unknown"),
                    "repo": run.get("repo", run.get("repoName", "")),
                    "created_at": run.get("createdAt", run.get("created_at", "")),
                    "pr_url": run.get("prUrl", run.get("pr_url")),
                })
    except Exception as exc:
        logger.warning("Failed to fetch recent runs for %s -- %s", tenant_id, exc)

    onboarding_completed = bool(
        state
        and state.github_installed
        and state.repo_selected
        and state.webhook_configured
    ) if state else False

    return {
        "tenant_id": tenant_id,
        "usage": usage,
        "connected_repos": connected_repos,
        "recent_runs": recent_runs,
        "first_fix_completed": state.first_fix_completed if state else False,
        "onboarding_completed": onboarding_completed,
    }
