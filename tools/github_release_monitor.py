"""
GitHub Release Monitor tools for Hermes Agent.

Poll GitHub API for new releases and register lightweight webhook configs
for release monitoring.  State is persisted in a JSON file under
``HERMES_HOME/marketing/release_state.json``.

Registered tools:
  - ``github_check_releases`` — poll latest release, compare to last seen tag
  - ``github_register_webhook`` — store webhook config for a repo
"""

import json
import logging
import os
import ssl
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------

_STATE_DIRNAME = "marketing"
_STATE_FILENAME = "release_state.json"


def _get_state_path() -> Path:
    """Return the path to the release monitor state file."""
    return get_hermes_home() / _STATE_DIRNAME / _STATE_FILENAME


def _load_state() -> dict:
    """Load the release monitor state from disk."""
    state_path = _get_state_path()
    if state_path.exists():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load release state: %s", exc)
    return {}


def _save_state(state: dict) -> None:
    """Save the release monitor state to disk."""
    state_path = _get_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(state, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _github_api_get(path: str, token: str) -> dict | str:
    """Perform an authenticated GET request to the GitHub REST API.

    Returns the parsed JSON dict on success, or an error string on failure.
    """
    url = f"https://api.github.com{path}"
    try:
        req = Request(url)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("User-Agent", "Hermes-Agent/1.0")
        context = ssl.create_default_context()
        with urlopen(req, context=context, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except HTTPError as exc:
        if exc.code == 404:
            return json.dumps({"error": f"No releases found for repository (API 404)."})
        return json.dumps({"error": f"GitHub API HTTP {exc.code}: {exc.reason}"})
    except URLError as exc:
        return json.dumps({"error": f"GitHub API request failed: {exc.reason}"})
    except (json.JSONDecodeError, OSError) as exc:
        return json.dumps({"error": f"Failed to parse release data: {exc}"})


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def handle_check_releases(
    repo: str,
    since_tag: str | None = None,
    task_id: str | None = None,
) -> str:
    """Check the latest release of a GitHub repository.

    Args:
        repo: GitHub repository in ``"owner/repo"`` format.
        since_tag: Optional tag to compare against.  When omitted the stored
            state for the repo is used.

    Returns:
        A JSON string with the release check result.
    """
    del task_id  # unused — kept for handler signature compatibility

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        return json.dumps({"error": "GITHUB_TOKEN environment variable is not set."})

    result = _github_api_get(f"/repos/{repo}/releases/latest", token)
    if isinstance(result, str):
        # _github_api_get returned an error JSON string — pass it through
        return result

    tag_name = result.get("tag_name", "")
    if not tag_name:
        return json.dumps({"error": "Latest release response is missing tag_name."})

    state = _load_state()
    repo_state = state.setdefault("repos", {}).get(repo, {})
    last_seen = since_tag or repo_state.get("last_seen_tag", "")

    is_new = tag_name != last_seen

    if is_new:
        state.setdefault("repos", {})[repo] = {
            "last_seen_tag": tag_name,
        }
        _save_state(state)

    return json.dumps({
        "new": is_new,
        "release": result if is_new else None,
        "tag": tag_name,
        "published_at": result.get("published_at"),
        "html_url": result.get("html_url"),
    })


def handle_register_webhook(
    repo: str,
    events: list[str] | None = None,
    task_id: str | None = None,
) -> str:
    """Register a lightweight webhook config for release monitoring.

    Args:
        repo: GitHub repository in ``"owner/repo"`` format.
        events: List of event types to watch.  Defaults to ``["release"]``.

    Returns:
        A JSON string confirming the registration.
    """
    del task_id

    if not events:
        events = ["release"]

    state = _load_state()
    webhooks = state.setdefault("webhooks", {})
    webhooks[repo] = {
        "events": sorted(events),
    }
    _save_state(state)

    endpoint = f"hermes://marketing/webhook/{repo.replace('/', '--')}"

    return json.dumps({
        "status": "registered",
        "endpoint": endpoint,
        "repo": repo,
        "events": sorted(events),
    })


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


def check_release_monitor_requirements() -> bool:
    """Return True when ``GITHUB_TOKEN`` is set — required for API access."""
    return bool(os.environ.get("GITHUB_TOKEN", "").strip())


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

GITHUB_CHECK_RELEASES_SCHEMA = {
    "name": "github_check_releases",
    "description": (
        "Check the latest release of a GitHub repository and compare it "
        "against the last seen tag.  Updates internal state when a newer "
        "release is found.  Requires GITHUB_TOKEN environment variable."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "repo": {
                "type": "string",
                "description": (
                    "GitHub repository in 'owner/repo' format "
                    "(e.g. 'vercel/next.js')."
                ),
            },
            "since_tag": {
                "type": "string",
                "description": (
                    "Optional tag to compare against.  When omitted, uses "
                    "the last seen tag from internal state."
                ),
            },
        },
        "required": ["repo"],
    },
}

GITHUB_REGISTER_WEBHOOK_SCHEMA = {
    "name": "github_register_webhook",
    "description": (
        "Register a lightweight webhook configuration for release "
        "monitoring of a GitHub repository.  Stores the configuration "
        "in internal state.  Requires GITHUB_TOKEN environment variable."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "repo": {
                "type": "string",
                "description": (
                    "GitHub repository in 'owner/repo' format "
                    "(e.g. 'vercel/next.js')."
                ),
            },
            "events": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "List of event types to watch.  Defaults to "
                    "['release'].  Can include: 'release', 'push', "
                    "'create', etc."
                ),
            },
        },
        "required": ["repo"],
    },
}


# ---------------------------------------------------------------------------
# Registry registration
# ---------------------------------------------------------------------------
from tools.registry import registry

registry.register(
    name="github_check_releases",
    toolset="marketing",
    schema=GITHUB_CHECK_RELEASES_SCHEMA,
    handler=lambda args, **kw: handle_check_releases(
        repo=args.get("repo", ""),
        since_tag=args.get("since_tag"),
        task_id=kw.get("task_id"),
    ),
    check_fn=check_release_monitor_requirements,
    requires_env=["GITHUB_TOKEN"],
    emoji="🚀",
)

registry.register(
    name="github_register_webhook",
    toolset="marketing",
    schema=GITHUB_REGISTER_WEBHOOK_SCHEMA,
    handler=lambda args, **kw: handle_register_webhook(
        repo=args.get("repo", ""),
        events=args.get("events"),
        task_id=kw.get("task_id"),
    ),
    check_fn=check_release_monitor_requirements,
    requires_env=["GITHUB_TOKEN"],
    emoji="🔗",
)
