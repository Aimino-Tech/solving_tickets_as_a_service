"""
Marketing campaign tools for Hermes Agent.

Provides agent-facing tools for autonomous marketing campaigns: create
campaigns, log actions, query actions, check account warmup status, verify
content humanization, monitor GitHub releases, and generate market reports.

All tools are registered under the ``"marketing"`` toolset and are available
on all platforms when the toolset is enabled.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy imports for optional marketing dependencies
# ---------------------------------------------------------------------------

try:
    from marketing.store import CampaignStore

    _campaign_store_available = True
except ImportError:
    CampaignStore = None  # type: ignore[assignment]
    _campaign_store_available = False

try:
    from marketing.warmup import WarmupEngine

    _warmup_engine_available = True
except ImportError:
    WarmupEngine = None  # type: ignore[assignment]
    _warmup_engine_available = False

# HumanizationGate is planned but may not exist yet.
try:
    from marketing.humanization_gate import HumanizationGate

    _humanization_gate_available = True
except ImportError:
    HumanizationGate = None  # type: ignore[assignment]
    _humanization_gate_available = False

# GitHub release monitor ships as a built-in tool module.
try:
    from tools.github_release_monitor import handle_check_releases

    _release_monitor_available = True
except ImportError:
    handle_check_releases = None  # type: ignore[assignment]
    _release_monitor_available = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GLOBAL_STORE: CampaignStore | None = None


def _get_store() -> CampaignStore:
    """Return a singleton CampaignStore, creating it on first call."""
    global _GLOBAL_STORE
    if _GLOBAL_STORE is None:
        _GLOBAL_STORE = CampaignStore()
    return _GLOBAL_STORE


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def _handle_campaign_create(
    name: str,
    product: str,
    config: dict[str, Any] | None = None,
    task_id: str | None = None,
) -> str:
    """Create a new marketing campaign.

    Args:
        name: Human-readable campaign name.
        product: Product identifier this campaign is for.
        config: Optional extra configuration dict (keys: start_date, end_date,
            target_subreddits, etc.).

    Returns:
        JSON string with ``campaign_id`` on success.
    """
    del task_id  # unused — kept for handler signature compatibility

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available (marketing.store not installed)"})

    cfg: dict[str, Any] = dict(config or {})
    cfg["name"] = name
    cfg["product"] = product

    try:
        store = _get_store()
        campaign_id = store.create_campaign(cfg)
        return json.dumps({"success": True, "campaign_id": campaign_id})
    except Exception as exc:
        logger.exception("campaign_create failed")
        return json.dumps({"error": f"Failed to create campaign: {exc}"})


def _handle_campaign_list(
    status: str | None = None,
    task_id: str | None = None,
) -> str:
    """List all campaigns, optionally filtered by status.

    Args:
        status: Optional status filter (e.g. ``"draft"``, ``"active"``,
            ``"completed"``).

    Returns:
        JSON string with a ``campaigns`` list.
    """
    del task_id

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available"})

    try:
        store = _get_store()
        campaigns = store.list_campaigns(status=status)
        return json.dumps({"success": True, "campaigns": campaigns})
    except Exception as exc:
        logger.exception("campaign_list failed")
        return json.dumps({"error": f"Failed to list campaigns: {exc}"})


def _handle_campaign_status(
    campaign_id: str,
    task_id: str | None = None,
) -> str:
    """Return details for a single campaign.

    Args:
        campaign_id: The campaign's UUID (8-char hex).

    Returns:
        JSON string with the full campaign dict.
    """
    del task_id

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available"})

    try:
        store = _get_store()
        campaign = store.get_campaign(campaign_id)
        if not campaign:
            return json.dumps({"error": f"Campaign {campaign_id!r} not found"})
        return json.dumps({"success": True, "campaign": campaign})
    except Exception as exc:
        logger.exception("campaign_status failed")
        return json.dumps({"error": f"Failed to get campaign: {exc}"})


def _handle_action_log(
    campaign_id: str,
    platform: str,
    action_type: str,
    target_url: str | None = None,
    content_preview: str | None = None,
    score: float | None = None,
    status: str | None = None,
    profile_name: str | None = None,
    task_id: str | None = None,
) -> str:
    """Log an action taken during a campaign.

    Args:
        campaign_id: Campaign UUID.
        platform: Platform name (e.g. ``"reddit"``, ``"twitter"``).
        action_type: Type of action (e.g. ``"comment"``, ``"post"``,
            ``"reply"``).
        target_url: URL the action was performed on.
        content_preview: Short preview/snippet of the content.
        score: Numeric score/rating for this action.
        status: Action status (default ``"pending"``).
        profile_name: Profile/account name used for this action.

    Returns:
        JSON string with the new ``action_id``.
    """
    del task_id

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available"})

    try:
        store = _get_store()
        kwargs: dict[str, Any] = {}
        if target_url is not None:
            kwargs["target_url"] = target_url
        if content_preview is not None:
            kwargs["content_preview"] = content_preview
        if score is not None:
            kwargs["score"] = score
        if status is not None:
            kwargs["status"] = status
        if profile_name is not None:
            kwargs["profile_name"] = profile_name

        action_id = store.log_action(campaign_id, platform, action_type, **kwargs)
        return json.dumps({"success": True, "action_id": action_id})
    except Exception as exc:
        logger.exception("action_log failed")
        return json.dumps({"error": f"Failed to log action: {exc}"})


def _handle_action_query(
    campaign_id: str,
    since: str | None = None,
    platform: str | None = None,
    task_id: str | None = None,
) -> str:
    """Query logged actions for a campaign.

    Args:
        campaign_id: Campaign UUID.
        since: Optional ISO-8601 timestamp — only actions after this time
            are returned.
        platform: Optional platform filter.

    Returns:
        JSON string with an ``actions`` list.
    """
    del task_id

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available"})

    try:
        store = _get_store()
        actions = store.get_actions(campaign_id, since=since, platform=platform)
        return json.dumps({"success": True, "actions": actions})
    except Exception as exc:
        logger.exception("action_query failed")
        return json.dumps({"error": f"Failed to query actions: {exc}"})


def _handle_account_status(
    name: str | None = None,
    task_id: str | None = None,
) -> str:
    """Return warmup status for one or all tracked accounts.

    Args:
        name: Optional account name.  When omitted, status for every tracked
            account is returned.

    Returns:
        JSON string with warmup phase info.
    """
    del task_id

    if not _warmup_engine_available:
        return json.dumps({"error": "WarmupEngine not available (marketing.warmup not installed)"})

    try:
        engine = WarmupEngine()
        if name:
            try:
                phase = engine.get_current_phase(name)
                return json.dumps({"success": True, "account": name, "phase": phase})
            except KeyError:
                return json.dumps({"error": f"Account {name!r} not found. Initialise it with account_warmup_progress first."})
        accounts = engine.list_accounts()
        return json.dumps({"success": True, "accounts": accounts})
    except Exception as exc:
        logger.exception("account_status failed")
        return json.dumps({"error": f"Failed to get account status: {exc}"})


def _handle_account_warmup_progress(
    name: str,
    task_id: str | None = None,
) -> str:
    """Return the full warmup plan and current progress for an account.

    Initialises the account if it hasn't been seen before.

    Args:
        name: Account name.

    Returns:
        JSON string with the 10-phase warmup schedule and current phase.
    """
    del task_id

    if not _warmup_engine_available:
        return json.dumps({"error": "WarmupEngine not available (marketing.warmup not installed)"})

    try:
        engine = WarmupEngine()
        plan = engine.get_warmup_plan(name)
        return json.dumps({"success": True, "plan": plan})
    except Exception as exc:
        logger.exception("account_warmup_progress failed")
        return json.dumps({"error": f"Failed to get warmup progress: {exc}"})


def _handle_humanization_check(
    content: str,
    platform: str = "reddit",
    task_id: str | None = None,
) -> str:
    """Check whether *content* sounds human-generated on the given platform.

    Args:
        content: The text to check.
        platform: Target platform context (default ``"reddit"``).

    Returns:
        JSON string with ``human_score``, ``issues``, and ``suggestions``.
    """
    del task_id

    if not _humanization_gate_available:
        return json.dumps({
            "warning": (
                "HumanizationGate is not installed. Install "
                "marketing.humanization_gate to enable humanisation "
                "checks."
            ),
            "human_score": None,
            "issues": [],
            "suggestions": [],
        })

    try:
        gate = HumanizationGate()
        result = gate.check(content, platform=platform)
        return json.dumps({"success": True, "result": result})
    except Exception as exc:
        logger.exception("humanization_check failed")
        return json.dumps({"error": f"Humanisation check failed: {exc}"})


def _handle_release_check(
    repo: str,
    task_id: str | None = None,
) -> str:
    """Check the latest GitHub release for a repository.

    Delegates to ``github_release_monitor.handle_check_releases``.

    Args:
        repo: GitHub repository in ``"owner/repo"`` format.

    Returns:
        JSON string with release info (see ``github_check_releases``).
    """
    if not _release_monitor_available:
        return json.dumps({"error": "Release monitor not available (tools.github_release_monitor not loaded)"})

    try:
        return handle_check_releases(repo=repo, task_id=task_id)
    except Exception as exc:
        logger.exception("release_check failed")
        return json.dumps({"error": f"Release check failed: {exc}"})


def _handle_market_report(
    start_date: str | None = None,
    end_date: str | None = None,
    task_id: str | None = None,
) -> str:
    """Generate an aggregated marketing metrics summary.

    Args:
        start_date: Optional ISO-8601 start date for the report window.
        end_date: Optional ISO-8601 end date for the report window.

    Returns:
        JSON string with campaign counts, action totals, and per-campaign
        summaries.
    """
    del task_id

    if not _campaign_store_available:
        return json.dumps({"error": "CampaignStore not available"})

    try:
        store = _get_store()
        campaigns = store.list_campaigns()

        total_campaigns = len(campaigns)
        total_actions = 0
        status_counts: dict[str, int] = {}
        campaign_summaries: list[dict[str, Any]] = []

        for camp in campaigns:
            camp_id = camp["id"]
            camp_status = camp.get("status", "unknown")
            status_counts[camp_status] = status_counts.get(camp_status, 0) + 1

            actions = store.get_actions(camp_id, since=start_date, platform=None)
            if end_date:
                actions = [
                    a for a in actions
                    if a.get("timestamp", "") <= end_date
                ]

            total_actions += len(actions)

            campaign_summaries.append({
                "id": camp_id,
                "name": camp.get("name", ""),
                "product": camp.get("product", ""),
                "status": camp_status,
                "action_count": len(actions),
                "created_at": camp.get("created_at", ""),
            })

        return json.dumps({
            "success": True,
            "report": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_campaigns": total_campaigns,
                "total_actions": total_actions,
                "status_breakdown": status_counts,
                "campaigns": campaign_summaries,
            },
        })
    except Exception as exc:
        logger.exception("market_report failed")
        return json.dumps({"error": f"Failed to generate market report: {exc}"})


# ---------------------------------------------------------------------------
# Availability checks
# ---------------------------------------------------------------------------


def _check_github_token() -> bool:
    """Return True when ``GITHUB_TOKEN`` is set — required for release_check."""
    return bool(os.environ.get("GITHUB_TOKEN", "").strip())


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

CAMPAIGN_CREATE_SCHEMA = {
    "name": "campaign_create",
    "description": (
        "Create a new marketing campaign.  Stores campaign metadata in the "
        "local SQLite database and returns a unique campaign ID."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Human-readable campaign name (e.g. 'Q3 Reddit Launch').",
            },
            "product": {
                "type": "string",
                "description": "Product or project this campaign is for (e.g. 'OpenTalk2HTML-NotMD').",
            },
            "config": {
                "type": "object",
                "description": (
                    "Optional extra configuration.  Known keys: start_date, "
                    "end_date, target_subreddits, budget, notes."
                ),
                "additionalProperties": True,
            },
        },
        "required": ["name", "product"],
    },
}

CAMPAIGN_LIST_SCHEMA = {
    "name": "campaign_list",
    "description": (
        "List all marketing campaigns, optionally filtered by status.  "
        "Returns campaign IDs, names, products, and current statuses."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "description": (
                    "Optional status filter: 'draft', 'active', 'paused', "
                    "'completed', 'archived'.  Omit to list all campaigns."
                ),
            },
        },
        "required": [],
    },
}

CAMPAIGN_STATUS_SCHEMA = {
    "name": "campaign_status",
    "description": (
        "Return full details for a single campaign including its metadata "
        "and configuration."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "campaign_id": {
                "type": "string",
                "description": "Campaign UUID (8-char hex, returned by campaign_create).",
            },
        },
        "required": ["campaign_id"],
    },
}

ACTION_LOG_SCHEMA = {
    "name": "action_log",
    "description": (
        "Log an action taken during a campaign.  Records platform, action "
        "type, optional metadata (URL, content preview, score), and the "
        "profile/account used."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "campaign_id": {
                "type": "string",
                "description": "Campaign UUID the action belongs to.",
            },
            "platform": {
                "type": "string",
                "description": "Platform where the action occurred (e.g. 'reddit', 'twitter', 'discord').",
            },
            "action_type": {
                "type": "string",
                "description": "Type of action (e.g. 'comment', 'post', 'reply', 'dm', 'upvote').",
            },
            "target_url": {
                "type": "string",
                "description": "Optional URL the action was performed on.",
            },
            "content_preview": {
                "type": "string",
                "description": "Optional short preview or snippet of the action content.",
            },
            "score": {
                "type": "number",
                "description": "Optional numeric score or rating (e.g. upvote count, karma gained).",
            },
            "status": {
                "type": "string",
                "description": "Action status (default 'pending'): 'pending', 'posted', 'failed', 'deleted'.",
            },
            "profile_name": {
                "type": "string",
                "description": "Profile or account name used for this action (e.g. 'CommentAwkward3993').",
            },
        },
        "required": ["campaign_id", "platform", "action_type"],
    },
}

ACTION_QUERY_SCHEMA = {
    "name": "action_query",
    "description": (
        "Query logged actions for a campaign with optional filters for "
        "time range and platform."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "campaign_id": {
                "type": "string",
                "description": "Campaign UUID to query actions for.",
            },
            "since": {
                "type": "string",
                "description": (
                    "Optional ISO-8601 timestamp. Only actions logged after "
                    "this time are returned."
                ),
            },
            "platform": {
                "type": "string",
                "description": "Optional platform filter (e.g. 'reddit', 'twitter').",
            },
        },
        "required": ["campaign_id"],
    },
}

ACCOUNT_STATUS_SCHEMA = {
    "name": "account_status",
    "description": (
        "Return warmup status for a specific account or all tracked "
        "accounts.  Shows current phase, days completed, goals, and "
        "marketing readiness."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "Optional account name (e.g. 'CommentAwkward3993').  "
                    "When omitted, status for every tracked account is returned."
                ),
            },
        },
        "required": [],
    },
}

ACCOUNT_WARMUP_PROGRESS_SCHEMA = {
    "name": "account_warmup_progress",
    "description": (
        "Return the full 10-phase warmup plan for an account, including "
        "the current phase, days completed, daily action limits, and "
        "phase-specific goals.  Initialises the account if it hasn't been "
        "seen before."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Account name to check (e.g. 'CommentAwkward3993').",
            },
        },
        "required": ["name"],
    },
}

HUMANIZATION_CHECK_SCHEMA = {
    "name": "humanization_check",
    "description": (
        "Analyse *content* and return a human-likeness score, detected "
        "AI-isms, and improvement suggestions.  Helps ensure marketing "
        "copy sounds natural on the target platform."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The text content to check for human-likeness.",
            },
            "platform": {
                "type": "string",
                "description": (
                    "Target platform context.  Affects the reference "
                    "corpus used for comparison.  Default: 'reddit'."
                ),
            },
        },
        "required": ["content"],
    },
}

RELEASE_CHECK_SCHEMA = {
    "name": "release_check",
    "description": (
        "Check the latest GitHub release for a repository.  Delegates to "
        "the GitHub release monitor.  Requires GITHUB_TOKEN."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "repo": {
                "type": "string",
                "description": (
                    "GitHub repository in 'owner/repo' format "
                    "(e.g. 'Aimino-Tech/OpenTalk2HTML-NotMD')."
                ),
            },
        },
        "required": ["repo"],
    },
}

MARKET_REPORT_SCHEMA = {
    "name": "market_report",
    "description": (
        "Generate an aggregated marketing metrics summary across all "
        "campaigns.  Includes total campaign count, action totals, "
        "status breakdown, and per-campaign summaries."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "start_date": {
                "type": "string",
                "description": (
                    "Optional ISO-8601 start date.  Only actions on or "
                    "after this date are counted."
                ),
            },
            "end_date": {
                "type": "string",
                "description": (
                    "Optional ISO-8601 end date.  Only actions on or "
                    "before this date are counted."
                ),
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# Registry registration
# ---------------------------------------------------------------------------
from tools.registry import registry

# Campaign management
registry.register(
    name="campaign_create",
    toolset="marketing",
    schema=CAMPAIGN_CREATE_SCHEMA,
    handler=lambda args, **kw: _handle_campaign_create(
        name=args.get("name", ""),
        product=args.get("product", ""),
        config=args.get("config"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

registry.register(
    name="campaign_list",
    toolset="marketing",
    schema=CAMPAIGN_LIST_SCHEMA,
    handler=lambda args, **kw: _handle_campaign_list(
        status=args.get("status"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

registry.register(
    name="campaign_status",
    toolset="marketing",
    schema=CAMPAIGN_STATUS_SCHEMA,
    handler=lambda args, **kw: _handle_campaign_status(
        campaign_id=args.get("campaign_id", ""),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

# Action logging and querying
registry.register(
    name="action_log",
    toolset="marketing",
    schema=ACTION_LOG_SCHEMA,
    handler=lambda args, **kw: _handle_action_log(
        campaign_id=args.get("campaign_id", ""),
        platform=args.get("platform", ""),
        action_type=args.get("action_type", ""),
        target_url=args.get("target_url"),
        content_preview=args.get("content_preview"),
        score=args.get("score"),
        status=args.get("status"),
        profile_name=args.get("profile_name"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

registry.register(
    name="action_query",
    toolset="marketing",
    schema=ACTION_QUERY_SCHEMA,
    handler=lambda args, **kw: _handle_action_query(
        campaign_id=args.get("campaign_id", ""),
        since=args.get("since"),
        platform=args.get("platform"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

# Account warmup
registry.register(
    name="account_status",
    toolset="marketing",
    schema=ACCOUNT_STATUS_SCHEMA,
    handler=lambda args, **kw: _handle_account_status(
        name=args.get("name"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

registry.register(
    name="account_warmup_progress",
    toolset="marketing",
    schema=ACCOUNT_WARMUP_PROGRESS_SCHEMA,
    handler=lambda args, **kw: _handle_account_warmup_progress(
        name=args.get("name", ""),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

# Content humanization check
registry.register(
    name="humanization_check",
    toolset="marketing",
    schema=HUMANIZATION_CHECK_SCHEMA,
    handler=lambda args, **kw: _handle_humanization_check(
        content=args.get("content", ""),
        platform=args.get("platform", "reddit"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)

# GitHub release monitoring (gated on GITHUB_TOKEN)
registry.register(
    name="release_check",
    toolset="marketing",
    schema=RELEASE_CHECK_SCHEMA,
    handler=lambda args, **kw: _handle_release_check(
        repo=args.get("repo", ""),
        task_id=kw.get("task_id"),
    ),
    check_fn=_check_github_token,
    requires_env=["GITHUB_TOKEN"],
)

# Aggregated market report
registry.register(
    name="market_report",
    toolset="marketing",
    schema=MARKET_REPORT_SCHEMA,
    handler=lambda args, **kw: _handle_market_report(
        start_date=args.get("start_date"),
        end_date=args.get("end_date"),
        task_id=kw.get("task_id"),
    ),
    check_fn=lambda: True,
    requires_env=[],
)
