#!/usr/bin/env python3
"""Shadowban Monitor for Reddit Accounts.

Passively checks accounts via old.reddit.com profile page title inspection.
No authentication, no API calls, no cookies, no external dependencies.

Detection confirmed in memory/reddit-block-diagnosis-2026-06-16.md:
  Shadowbanned  → <title>u/{username}: page not found</title>
  Healthy       → <title>overview for {username}</title>

Usage:
  python3 scripts/shadowban_monitor.py
  python3 scripts/shadowban_monitor.py --config /path/to/reddit-profiles.yaml
  python3 scripts/shadowban_monitor.py --quiet  # one-line cron output

Exit codes:
  0  → all healthy (or no accounts to check)
  1  → any account shadowbanned, error, or unknown status
"""

import argparse
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


# ── Minimal YAML parser (flat list-of-dicts with simple scalar values) ──────

def parse_yaml_list(filepath):
    """Parse a YAML file containing a top-level key mapped to a list of dicts.

    Handles the flat format used in reddit-profiles.yaml — no nested lists,
    no complex types, just indented key: value pairs under `- ` list items.
    """
    text = Path(filepath).read_text(encoding="utf-8")
    lines = text.splitlines()

    result = []
    current_item = None
    in_list = False

    for line in lines:
        stripped = line.strip()
        # Skip blanks and comments
        if not stripped or stripped.startswith("#"):
            continue

        # Detect list item: "- key: value" (possibly continued on following lines)
        if stripped.startswith("- "):
            if current_item is not None:
                result.append(current_item)
            current_item = {}
            in_list = True

            inline_match = re.match(r"^- (\w+):\s*(.*)", stripped)
            if inline_match:
                key, val = inline_match.group(1), inline_match.group(2).strip()
                current_item[key] = _parse_yaml_scalar(val)
            continue

        # Continuation of current list item: "  key: value"
        if in_list and current_item is not None and re.match(r"^\s+\w+:", line):
            kv_match = re.match(r"^\s+(\w+):\s*(.*)", line)
            if kv_match:
                key, val = kv_match.group(1), kv_match.group(2).strip()
                current_item[key] = _parse_yaml_scalar(val)
            continue

    if current_item is not None:
        result.append(current_item)

    return result


def _parse_yaml_scalar(val):
    """Parse a YAML scalar: null/None, quoted string, or bare string."""
    lower = val.lower()
    if lower in ("null", "~", ""):
        return None
    if (val.startswith('"') and val.endswith('"')) or \
       (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    return val


# ── Shadowban detection ─────────────────────────────────────────────────────

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)
TIMEOUT = 20  # seconds


def check_account(username):
    """Check a single Reddit account for shadowban status.

    Makes an anonymous HTTP GET to old.reddit.com/user/{username}/ and inspects
    the <title> tag. Returns a dict with keys:
        username, status, page_title, http_status, error
    """
    url = f"https://old.reddit.com/user/{username}/"
    result = {
        "username": username,
        "status": "unknown",
        "page_title": None,
        "http_status": None,
        "error": None,
    }

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    html = ""

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            result["http_status"] = resp.status
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        result["http_status"] = e.code
        result["error"] = f"HTTP {e.code}: {e.reason}"
        try:
            html = e.read().decode("utf-8", errors="replace")
        except Exception:
            html = ""
    except urllib.error.URLError as e:
        result["error"] = f"Connection failed: {e.reason}"
        return result
    except socket.timeout:
        result["error"] = "Timeout after {TIMEOUT}s"
        return result
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"
        return result

    # Extract <title> from HTML (case-insensitive, multi-line)
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if not title_match:
        result["error"] = "No <title> element found in response"
        return result

    title = title_match.group(1).strip()
    result["page_title"] = title
    title_lower = title.lower()

    # Determine status from title content
    if "page not found" in title_lower:
        result["status"] = "shadowbanned"
    elif f"overview for {username.lower()}" in title_lower:
        result["status"] = "healthy"
    elif "suspended" in title_lower or (
        "banned" in title_lower and "not found" not in title_lower
    ):
        result["status"] = "suspended"
    else:
        result["status"] = "unknown"
        result["error"] = f"Unrecognized page title: {title}"

    return result


# ── Logging ─────────────────────────────────────────────────────────────────

def load_log(log_path):
    """Load existing shadowban log, return list of records."""
    if log_path.exists():
        try:
            data = json.loads(log_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            return []
    return []


def append_results(log_path, results):
    """Append results to the shadowban log file with unified timestamp."""
    log = load_log(log_path)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    for r in results:
        entry = {
            "username": r["username"],
            "status": r["status"],
            "detected_at": now,
            "page_title": r.get("page_title"),
            "http_status": r.get("http_status"),
        }
        if r.get("error"):
            entry["error"] = r["error"]
        log.append(entry)

    # Atomic write via temp file + rename
    tmp = log_path.with_suffix(".log.tmp")
    tmp.write_text(
        json.dumps(log, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(log_path)

    return log


# ── Summary ─────────────────────────────────────────────────────────────────

def build_summary(results):
    """Build a cron-ready summary string + exit-level indicator.

    Returns (multi_line_text, short_summary) where short_summary is:
      "OK"                              → all healthy
      "WARNING: N account(s) shadowbanned — name1, name2"  → some are banned
      "WARNING: Check completed with errors"                → HTTP/connection errors
      "WARNING: Some accounts returned unknown status"      → unrecognized titles
    """
    checked = [r for r in results if r["status"] != "skipped"]
    healthy = [r for r in checked if r["status"] == "healthy"]
    shadowbanned = [r for r in checked if r["status"] == "shadowbanned"]
    suspended = [r for r in checked if r["status"] == "suspended"]
    errors = [r for r in checked if r.get("error")]
    unknown = [r for r in checked if r["status"] == "unknown"]

    lines = []
    lines.append(f"Checked {len(checked)} account(s)")
    lines.append(f"  Healthy:     {len(healthy)}")
    lines.append(f"  Shadowbanned: {len(shadowbanned)}")
    if suspended:
        lines.append(f"  Suspended:    {len(suspended)}")

    # Determine summary line
    if shadowbanned or suspended:
        names = ", ".join(
            r["username"] for r in (shadowbanned + suspended)
        )
        lines.append(f"  Affected: {names}")
        summary = f"WARNING: {len(shadowbanned) + len(suspended)} account(s) shadowbanned — {names}"
    elif errors and not any(r["status"] == "healthy" for r in checked):
        summary = "WARNING: All checks failed with errors"
    elif errors:
        summary = "WARNING: Check completed with errors"
    elif unknown:
        summary = "WARNING: Some accounts returned unknown status"
    else:
        summary = "OK"

    if errors:
        lines.append(f"  Errors:     {len(errors)}")
        for e in errors:
            lines.append(f"    - {e['username']}: {e.get('error', 'unknown')}")

    if unknown:
        for u in unknown:
            lines.append(f"    ~ {u['username']}: unrecognized page title")

    lines.append(f"Summary: {summary}")
    return "\n".join(lines), summary


# ── Main ────────────────────────────────────────────────────────────────────

def resolve_project_root():
    """Find the hermes-agent project root (where config/ and memory/ live)."""
    script = Path(__file__).resolve()
    # Walk up from script directory to find project root (directory with config/)
    for parent in [script.parent, script.parent.parent]:
        if (parent / "config").is_dir() and (parent / "memory").is_dir():
            return parent
    # Fallback: caller's cwd
    return Path.cwd()


def main():
    parser = argparse.ArgumentParser(
        description="Check Reddit accounts for shadowban status via old.reddit.com"
    )
    parser.add_argument(
        "--config",
        default=None,
        help="Path to reddit-profiles.yaml (default: auto-discovered)",
    )
    parser.add_argument(
        "--log",
        default=None,
        help="Path to shadowban log JSON file (default: auto-discovered)",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print the summary line (useful for cron integration)",
    )

    args = parser.parse_args()

    # Resolve paths
    project_root = resolve_project_root()

    if args.config:
        config_path = Path(args.config)
    else:
        config_path = project_root / "config" / "reddit-profiles.yaml"

    if args.log:
        log_path = Path(args.log)
    else:
        log_path = project_root / "memory" / "shadowban-log.json"

    # Validate config
    if not config_path.exists():
        print(
            f"ERROR: Config file not found: {config_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Parse accounts from YAML
    try:
        raw_accounts = parse_yaml_list(config_path)
    except Exception as e:
        print(f"ERROR: Failed to parse config: {e}", file=sys.stderr)
        sys.exit(1)

    if not raw_accounts:
        print("ERROR: No accounts found in config", file=sys.stderr)
        sys.exit(1)

    # Filter to active accounts with defined usernames
    accounts = [
        a for a in raw_accounts
        if a.get("status") == "active" and a.get("username")
    ]

    if not accounts:
        print(
            "WARNING: No active accounts with usernames configured — nothing to check",
            file=sys.stderr,
        )
        sys.exit(0)

    # Check each account sequentially
    results = []
    for account in accounts:
        username = account["username"]
        if not args.quiet:
            print(f"Checking {username}...", end=" ", flush=True)

        result = check_account(username)
        results.append(result)

        if not args.quiet:
            icon = {
                "healthy": "✓",
                "shadowbanned": "✗",
                "suspended": "!!",
                "unknown": "?",
            }.get(result["status"], "?")
            status_text = result["status"]
            title_text = result.get("page_title") or result.get("error", "N/A")
            print(f"{icon} {status_text} — {title_text}", flush=True)

    # Ensure log directory exists
    log_path.parent.mkdir(parents=True, exist_ok=True)
    append_results(log_path, results)

    # Build and print summary
    full_text, short_summary = build_summary(results)

    if args.quiet:
        print(short_summary)
    else:
        print()
        print(full_text)

    # Exit code: 0 if summary is "OK", 1 otherwise
    if short_summary != "OK":
        sys.exit(1)


if __name__ == "__main__":
    main()
