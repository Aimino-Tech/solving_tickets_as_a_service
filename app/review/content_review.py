"""Content review pipeline.

Architecture:
  OpenClaw (agent) reads sheet → calls OpenCode (LLM) for evaluation → writes results back

Modes:
  fetch   - Read Draft items from the sheet, output JSON for OpenCode to evaluate
  review  - Take OpenCode's evaluation results and update the sheet
  auto    - Full pipeline: fetch → evaluate via OpenCode API → update sheet
            (only works if OpenCode API direct calls are available)

Usage:
  # Step 1: Fetch pending items for OpenCode to review
  python3 -m app.review.content_review fetch --limit 5

  # Step 2: Agent evaluates content (using OpenCode through agent reasoning)
  # ... then writes results back:
  python3 -m app.review.content_review review --input results.json

  # Auto mode (full pipeline, needs API quota):
  python3 -m app.review.content_review auto --limit 10 --approve-threshold 70
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from google.oauth2.service_account import Credentials
import gspread

# --- Constants ---
SPREADSHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SHEET_NAME = "guerrilla-content-plan"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]
SERVICE_ACCOUNT_PATH = "service-account-key.json"

# Column indices (0-based) based on actual sheet headers
COL_CONTENT_ID = 0
COL_ACTION_TYPE = 1
COL_PLATFORM = 2
COL_PLATFORM_URL = 3
COL_TACTIC = 4
COL_CONTENT = 5
COL_SCHEDULE = 6
COL_APPROVAL = 8
COL_STATUS = 9
COL_AGENT_NOTES = 11
COL_HUMAN_NOTES = 12

REVIEW_SYSTEM_PROMPT = """You are an expert content reviewer for a developer tools company (AIMino).
Our product is OpenTalk2HTML-NotMD — an open-source MCP server for HTML generation and web content processing.

Evaluate each content item on these criteria:
1. **quality_score** (0-100): Grammar, structure, clarity, readability
2. **platform_fit** (0-100): Is the tone and format right for the target platform/subreddit?
3. **engagement_potential** (0-100): Will developers actually engage with this?
4. **brand_alignment** (0-100): Does it match our technical, helpful, not-salesy voice?
5. **recommendation**: "approve" | "needs_revision" | "reject"
6. **notes**: Brief, actionable feedback (1-2 sentences)

Respond with a JSON array of objects, one per item. Example:
[
  {
    "content_id": "R001",
    "quality_score": 85,
    "platform_fit": 90,
    "engagement_potential": 75,
    "brand_alignment": 88,
    "recommendation": "approve",
    "notes": "Good technical depth. Consider adding a specific benchmark number."
  }
]"""


# ── Sheet Auth ──────────────────────────────────────────────────────────────

def _get_sheets_service():
    """Get Google Sheets API service."""
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_PATH, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def _get_gspread_client():
    """Get gspread client for easier read/write."""
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_PATH, scopes=SCOPES)
    return gspread.authorize(creds)


# ── Read ────────────────────────────────────────────────────────────────────

def fetch_items(limit: int = None, status_filter: str = "Draft") -> list[dict[str, Any]]:
    """Read content items from the sheet that need review."""
    gc = _get_gspread_client()
    sh = gc.open_by_key(SPREADSHEET_ID)
    ws = sh.worksheet(SHEET_NAME)
    all_rows = ws.get_all_values()

    if not all_rows:
        print("Sheet is empty.", file=sys.stderr)
        return []

    headers = all_rows[0]
    rows = all_rows[1:]

    items = []
    for row in rows:
        if len(row) < 11:
            continue  # skip incomplete rows

        approval = row[COL_APPROVAL].strip()
        # Only include items that match the status filter
        if status_filter and approval != status_filter:
            continue

        item = {
            "content_id": row[COL_CONTENT_ID].strip(),
            "action_type": row[COL_ACTION_TYPE].strip(),
            "platform": row[COL_PLATFORM].strip(),
            "platform_url": row[COL_PLATFORM_URL].strip(),
            "tactic": row[COL_TACTIC].strip(),
            "content": row[COL_CONTENT].strip(),
            "schedule": row[COL_SCHEDULE].strip(),
            "current_status": approval,
        }
        items.append(item)

    if limit and len(items) > limit:
        items = items[:limit]

    return items


# ── Write ───────────────────────────────────────────────────────────────────

def update_sheet(results: list[dict[str, Any]]) -> dict[str, int]:
    """Update the sheet with OpenCode's evaluation results.

    Each result should have:
      - content_id: str  (matches ContentID)
      - recommendation: "approve" | "needs_revision" | "reject"
      - notes: str (feedback, written to Agent's Notes column)

    Updates:
      - Approval column: "Approved" | "Draft" | "Rejected"
      - Agent's Notes column: evaluation feedback
    """
    gc = _get_gspread_client()
    sh = gc.open_by_key(SPREADSHEET_ID)
    ws = sh.worksheet(SHEET_NAME)
    all_rows = ws.get_all_values()

    if not all_rows:
        return {"updated": 0, "not_found": len(results)}

    headers = all_rows[0]
    rows = all_rows[1:]

    # Build content_id → row_number mapping (1-indexed, +2 because header + 0-index)
    id_to_row = {}
    for i, row in enumerate(rows):
        cid = row[COL_CONTENT_ID].strip() if len(row) > COL_CONTENT_ID else ""
        if cid:
            id_to_row[cid] = i + 2  # +2 = header row (1) + 0-index adjustment

    updated = 0
    not_found = 0

    for result in results:
        cid = result.get("content_id", "")
        recommendation = result.get("recommendation", "").strip().lower()
        notes = result.get("notes", "").strip()

        row_num = id_to_row.get(cid)
        if not row_num:
            print(f"  ContentID '{cid}' not found in sheet", file=sys.stderr)
            not_found += 1
            continue

        # Map recommendation to Approval value
        if recommendation == "approve":
            new_approval = "Approved"
        elif recommendation == "reject":
            new_approval = "Rejected"
        else:
            new_approval = "Draft"  # needs_revision stays as Draft

        # Update Approval column (H) and Agent's Notes column (J)
        range_approval = f"{_col_letter(COL_APPROVAL)}{row_num}"
        range_notes = f"{_col_letter(COL_AGENT_NOTES)}{row_num}"

        try:
            ws.update(values=[[new_approval]], range_name=range_approval, value_input_option="RAW")
            if notes:
                # Append to existing notes or set new
                existing_notes = rows[row_num - 2][COL_AGENT_NOTES].strip() if row_num - 2 < len(rows) and len(rows[row_num - 2]) > COL_AGENT_NOTES else ""
                if existing_notes:
                    # Prepend new notes with separator
                    combined = f"{notes} | {existing_notes}"
                else:
                    combined = notes
                ws.update(values=[[combined]], range_name=range_notes, value_input_option="RAW")

            updated += 1
            print(f"  ✓ {cid} → {new_approval}" + (f" ({notes})" if notes else ""))
        except Exception as e:
            print(f"  ✗ {cid} update failed: {e}", file=sys.stderr)

    return {"updated": updated, "not_found": not_found}


def _col_letter(index: int) -> str:
    """Convert 0-based column index to Google Sheets column letter."""
    letter = ""
    while index >= 0:
        letter = chr(ord("A") + (index % 26)) + letter
        index = index // 26 - 1
    return letter


# ── OpenCode Evaluation ────────────────────────────────────────────────────

def evaluate_via_opencode(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Send items to OpenCode API for quality review.

    Falls back to simple heuristic scoring if API is unavailable.
    """
    api_key = os.environ.get("OPENCODE_API_KEY", "")
    if not api_key:
        return _fallback_evaluate(items)

    # Build input prompt
    input_lines = []
    for item in items:
        input_lines.append(
            f"[ID:{item['content_id']}] Platform:{item['platform']} "
            f"Tactic:{item['tactic']} "
            f"Content:{item['content'][:500]}"
        )
    input_text = "\n---\n".join(input_lines)

    try:
        resp = httpx.post(
            "https://opencode.ai/zen/go/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-v4-flash",
                "messages": [
                    {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Review these content items:\n\n{input_text}"},
                ],
                "temperature": 0.3,
                "max_tokens": 2000,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )

        if resp.status_code == 429:
            print("OpenCode API: monthly usage limit reached, using fallback.", file=sys.stderr)
            return _fallback_evaluate(items)

        resp.raise_for_status()
        result_text = resp.json()["choices"][0]["message"]["content"]

        # Extract JSON from response
        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0].strip()
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0].strip()

        parsed = json.loads(result_text)
        evaluations = parsed.get("scores", parsed) if isinstance(parsed, dict) else parsed
        if isinstance(evaluations, dict) and "content_id" in evaluations:
            evaluations = [evaluations]

        return evaluations

    except Exception as e:
        print(f"OpenCode API call failed: {e}", file=sys.stderr)
        return _fallback_evaluate(items)


def _fallback_evaluate(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Simple heuristic evaluation when OpenCode API is unavailable."""
    results = []
    for item in items:
        content = item.get("content", "").lower()
        tactic = item.get("tactic", "").lower()

        # Quality heuristics
        quality = 50
        if len(content) > 100:
            quality += 10
        if len(content) > 300:
            quality += 10
        if any(w in content for w in ["benchmark", "example", "tutorial", "guide"]):
            quality += 10
        if any(w in content for w in ["npx", "github", "mcp", "html"]):
            quality += 10

        # Engagement potential (has hook, question, or compelling angle)
        engagement = 50
        if "?" in content:
            engagement += 10
        if any(w in content for w in ["cut", "reduced", "faster", "simple", "dead simple"]):
            engagement += 10
        if content.count("\n") > 5:
            engagement += 5

        # Platform fit (varies by tactic)
        platform_fit = 60
        if "tutorial" in tactic or "how-to" in tactic:
            platform_fit = 80
        elif "cost" in tactic or "savings" in tactic:
            platform_fit = 70
        elif "benchmark" in tactic or "comparison" in tactic:
            platform_fit = 75

        # Brand alignment
        brand = 70
        if any(w in content for w in ["self-host", "open source", "local", "privacy", "no cloud"]):
            brand += 10
        if any(w in content for w in ["enterprise", "security"]):
            brand += 5

        avg_score = (quality + engagement + platform_fit + brand) / 4
        if avg_score >= 70:
            recommendation = "approve"
        elif avg_score >= 50:
            recommendation = "needs_revision"
        else:
            recommendation = "reject"

        results.append({
            "content_id": item["content_id"],
            "quality_score": quality,
            "platform_fit": platform_fit,
            "engagement_potential": engagement,
            "brand_alignment": brand,
            "recommendation": recommendation,
            "notes": f"Auto-scored: quality={quality}, engagement={engagement}, platform_fit={platform_fit}, brand={brand}" if avg_score < 70 else ""
        })

    return results


# ── CLI ─────────────────────────────────────────────────────────────────────

def cmd_fetch(args: list[str]) -> None:
    """Fetch Draft items from the sheet and print as JSON."""
    limit = None
    status = "Draft"
    output_file = None

    i = 0
    while i < len(args):
        if args[i] == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
            i += 2
        elif args[i] == "--status" and i + 1 < len(args):
            status = args[i + 1]
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_file = args[i + 1]
            i += 2
        else:
            i += 1

    items = fetch_items(limit=limit, status_filter=status)
    output = json.dumps(items, indent=2, ensure_ascii=False)

    if output_file:
        Path(output_file).write_text(output, encoding="utf-8")
        print(f"Wrote {len(items)} items to {output_file}")
    else:
        print(output)


def cmd_review(args: list[str]) -> None:
    """Take evaluation results JSON and update the sheet."""
    input_file = None
    inline_json = None

    i = 0
    while i < len(args):
        if args[i] == "--input" and i + 1 < len(args):
            input_file = args[i + 1]
            i += 2
        elif args[i] == "--json" and i + 1 < len(args):
            inline_json = args[i + 1]
            i += 2
        else:
            i += 1

    if input_file:
        with open(input_file) as f:
            results = json.load(f)
    elif inline_json:
        results = json.loads(inline_json)
    else:
        results = json.loads(sys.stdin.read())

    if isinstance(results, dict):
        results = [results]

    stats = update_sheet(results)
    print(f"Done. Updated: {stats['updated']}, Not found: {stats['not_found']}")


def cmd_auto(args: list[str]) -> None:
    """Full auto pipeline: fetch → OpenCode evaluate → update sheet."""
    limit = None
    approve_threshold = 70

    i = 0
    while i < len(args):
        if args[i] == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
            i += 2
        elif args[i] == "--approve-threshold" and i + 1 < len(args):
            approve_threshold = int(args[i + 1])
            i += 2
        elif args[i] == "--status" and i + 1 < len(args):
            # auto mode only handles Draft → reviewed
            i += 2
        else:
            i += 1

    print(f"Fetching Draft items from sheet...")
    items = fetch_items(limit=limit, status_filter="Draft")
    print(f"Found {len(items)} items to review.")

    if not items:
        return

    print(f"Evaluating via OpenCode...")
    evaluations = evaluate_via_opencode(items)

    print(f"Updating sheet with {len(evaluations)} evaluations...")
    stats = update_sheet(evaluations)
    print(f"Done. Updated: {stats['updated']}, Not found: {stats['not_found']}")


def cmd_show_column_map(args: list[str]) -> None:
    """Show the column map of the sheet for reference."""
    gc = _get_gspread_client()
    sh = gc.open_by_key(SPREADSHEET_ID)
    ws = sh.worksheet(SHEET_NAME)
    headers = ws.row_values(1)
    print("Column map for '04-guerrilla-content-plan':")
    for i, h in enumerate(headers):
        print(f"  {_col_letter(i)} ({i}): {h}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    cmd_args = sys.argv[2:]

    commands = {
        "fetch": cmd_fetch,
        "review": cmd_review,
        "auto": cmd_auto,
        "columns": cmd_show_column_map,
    }

    handler = commands.get(command)
    if not handler:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(f"Available: {', '.join(commands.keys())}", file=sys.stderr)
        sys.exit(1)

    handler(cmd_args)
