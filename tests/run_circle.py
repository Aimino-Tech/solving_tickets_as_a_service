#!/usr/bin/env python3
"""
Circle Flow — Automation Test Runner + Linear Ticket Creator.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright python3 tests/run_circle.py

Flow:
  1. Run pytest automation suite
  2. Parse results (pass/fail/xfail/skip)
  3. On any FAILURE → create Linear ticket with:
     - Input: test name, file, request details
     - Output: actual response, status, error
     - Context: environment, base URL, browser, timestamp
     - Suggested Implementation: root cause + fix proposal
     - Acceptance Criteria: what passing test looks like
"""

import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AUTOMATION_DIR = REPO_ROOT / "tests" / "automation"
VENV_PYTHON = "/tmp/syntaro-test-env/bin/python3"
LINEAR_API_KEY = os.environ.get("LINEAR_API_KEY", "")
LINEAR_TEAM_ID = "f4cefcf7-7fb9-4e50-8e50-04a6d44a4ce1"  # AIM
LINEAR_PROJECT_ID = "9bc8e1d0-adb0-4eab-aca8-fb1aa6433b78"  # SYNTARO
BASE_URL = os.environ.get("BASE_URL", "http://localhost:5173")
BROWSER = os.environ.get("BROWSER", "chromium")


def run_tests() -> dict:
    """Run pytest and capture JSON results."""
    result_path = REPO_ROOT / "test-results" / f"circle-{int(time.time())}.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({
        "PLAYWRIGHT_BROWSERS_PATH": env.get("PLAYWRIGHT_BROWSERS_PATH", os.path.expanduser("~/.cache/ms-playwright")),
        "BASE_URL": BASE_URL,
    })

    cmd = [
        VENV_PYTHON, "-m", "pytest",
        str(AUTOMATION_DIR),
        "--tb=short",
        "--json-report",
        f"--json-report-file={result_path}",
        "--json-report-omit", "collectors",
        f"--browser={BROWSER}",
        f"--base-url={BASE_URL}",
        "-v",
    ]

    print(f"[circle] Running: {' '.join(cmd)}")
    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=REPO_ROOT)
    elapsed = time.time() - start

    print(f"[circle] Tests completed in {elapsed:.1f}s")
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)

    # Parse JSON report
    if result_path.exists():
        with open(result_path) as f:
            report = json.load(f)
        return {"report": report, "stdout": result.stdout, "stderr": result.stderr, "elapsed": elapsed, "returncode": result.returncode}

    # Fallback: parse stdout
    return {"report": None, "stdout": result.stdout, "stderr": result.stderr, "elapsed": elapsed, "returncode": result.returncode}


def parse_failures(run_result: dict) -> list[dict]:
    """Extract failure details from test results."""
    failures = []
    report = run_result.get("report")

    if report and "tests" in report:
        for test in report["tests"]:
            if test.get("outcome") == "failed":
                failures.append({
                    "name": test.get("nodeid", "unknown"),
                    "file": test.get("nodeid", "").split("::")[0],
                    "test_name": test.get("nodeid", "").split("::")[-1],
                    "outcome": "failed",
                    "call": test.get("call", {}),
                })
        return failures

    # Fallback: parse stdout for FAILED lines
    stdout = run_result.get("stdout", "")
    for line in stdout.split("\n"):
        if "FAILED" in line:
            failures.append({
                "name": line.split("FAILED")[-1].strip(),
                "file": "",
                "test_name": line.split("FAILED")[-1].strip(),
                "outcome": "failed",
                "call": {},
            })
    return failures


def build_linear_payload(failure: dict, run_result: dict) -> dict:
    """Build a Linear issue create payload with full context."""
    test_name = failure["name"]
    test_file = failure["file"]

    # Extract error details
    call_info = failure.get("call", {})
    error_msg = call_info.get("longrepr", "No details captured")
    crash_path = call_info.get("crash", {}).get("path", "")
    crash_line = call_info.get("crash", {}).get("lineno", "")
    crash_msg = call_info.get("crash", {}).get("message", "")

    # Extract assertion details from stdout
    stdout = run_result.get("stdout", "")
    assertion_detail = ""
    for line in stdout.split("\n"):
        if test_name.split("::")[-1] in line and ("AssertionError" in line or "assert" in line):
            assertion_detail = line.strip()
            break

    title = f"[Auto-Test] FAIL: {test_name}"

    body = f"""## 🚨 Test Failure Report

### Input
| Field | Value |
|-------|-------|
| **Test** | `{test_name}` |
| **File** | `{test_file}` |
| **Base URL** | `{BASE_URL}` |
| **Browser** | `{BROWSER}` |
| **Timestamp** | `{datetime.now(timezone.utc).isoformat()}` |
| **Run ID** | `{uuid.uuid4().hex[:12]}` |

### Output (Actual)
```
Status:  FAILED
Error:   {error_msg[:2000]}
{assertion_detail}
```

### Context
- **Environment**: {"CI" if os.environ.get("CI") else "Local"}
- **Host**: `{os.uname().nodename}`
- **Duration**: `{run_result.get("elapsed", 0):.1f}s`
- **Exit Code**: `{run_result.get("returncode")}`
- **Test Suite**: `{AUTOMATION_DIR}`

### Suggested Implementation

#### Root Cause
{_suggest_root_cause(test_name, error_msg)}

#### Fix
{_suggest_fix(test_name, error_msg, assertion_detail)}

### Acceptance Criteria
- [ ] Test `{test_name}` passes (status 200/201 as expected)
- [ ] No regression in related tests
- [ ] Edge cases handled (empty fields, invalid format, duplicate requests)
"""

    return {
        "query": """
            mutation IssueCreate($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue {
                        id
                        url
                        identifier
                    }
                }
            }
        """,
        "variables": {
            "input": {
                "teamId": LINEAR_TEAM_ID,
                "projectId": LINEAR_PROJECT_ID,
                "title": title,
                "description": body,
                "priority": 2,
            }
        },
    }


def _suggest_root_cause(test_name: str, error_msg: str) -> str:
    """Suggest root cause based on error pattern."""
    if "404" in error_msg or "Not Found" in error_msg:
        return (
            "The API endpoint returned HTTP 404. Possible causes:\n"
            "1. Backend server not running or wrong port (check proxy config in vite.config.ts)\n"
            "2. Route not registered (check src/auth/routes.ts)\n"
            "3. Wrong API path prefix (client.ts uses `/api/v1/auth/register`)\n"
            "4. Port conflict — another app is occupying the expected port"
        )
    if "401" in error_msg or "Authentication required" in error_msg:
        return "The request is missing a valid auth token, or the backend requires authentication even for public routes."
    if "timeout" in error_msg.lower() or "TimeoutError" in error_msg:
        return "Test timed out waiting for element/page. Could be slow network, missing element, or race condition."
    if "selector" in error_msg.lower() or "element" in error_msg.lower():
        return "UI selector is stale — page structure may have changed. Run self-healing."

    return f"Unknown error. Manual investigation required.\n\nError: {error_msg[:500]}"


def _suggest_fix(test_name: str, error_msg: str, assertion_detail: str) -> str:
    """Suggest fix based on error pattern."""
    if "404" in error_msg:
        return (
            "1. Verify backend is running: `curl http://localhost:PORT/api/health`\n"
            "2. Check `dashboard/vite.config.ts` proxy targets\n"
            "3. Ensure auth routes are properly mounted in `src/server.ts`\n"
            "4. Run `docker compose up` if using containerized backend"
        )
    if "401" in error_msg:
        return "1. Check if `requireAuth` middleware is applied to public routes\n2. Verify `auth/routes.ts` does not use `requireAuth` on register/login"
    if "timeout" in error_msg.lower():
        return "1. Increase timeout or add explicit `wait_for_*` calls\n2. Check if page loaded correctly\n3. Verify element is in DOM"

    return "1. Investigate manually\n2. Fix code\n3. Re-run test to confirm pass"


def create_linear_ticket(payload: dict) -> dict | None:
    """Create a Linear issue via GraphQL API."""
    if not LINEAR_API_KEY or "your_key" in LINEAR_API_KEY:
        print("[circle] WARNING: No valid LINEAR_API_KEY — skipping ticket creation")
        print(f"[circle] Would create:\n  Title: {payload['variables']['input']['title']}")
        return None

    import urllib.request

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": LINEAR_API_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("data", {}).get("issueCreate", {}).get("success"):
                issue = result["data"]["issueCreate"]["issue"]
                print(f"[circle] ✅ Linear ticket created: {issue['url']}")
                return issue
            else:
                print(f"[circle] ❌ Failed to create Linear ticket: {result}")
                return None
    except Exception as e:
        print(f"[circle] ❌ Error creating Linear ticket: {e}")
        return None


def main():
    print("=" * 60)
    print("  SYNTARO Circle Flow — Automation Test Runner")
    print("=" * 60)

    # Step 1: Run tests
    run_result = run_tests()

    # Step 2: Parse failures
    failures = parse_failures(run_result)
    passed = 0
    xfailed = 0
    skipped = 0

    report = run_result.get("report")
    if report:
        passed = report.get("summary", {}).get("passed", 0)
        xfailed = report.get("summary", {}).get("xfailed", 0)
        skipped = report.get("summary", {}).get("skipped", 0)
    else:
        # Parse from stdout
        stdout = run_result.get("stdout", "")
        for line in stdout.split("\n"):
            if "passed" in line and "failed" not in line:
                m = re.search(r"(\d+)\s+passed", line)
                if m:
                    passed = int(m.group(1))
                m = re.search(r"(\d+)\s+xfailed", line)
                if m:
                    xfailed = int(m.group(1))
                m = re.search(r"(\d+)\s+skipped", line)
                if m:
                    skipped = int(m.group(1))

    print(f"\n[circle] Results: {passed} passed, {len(failures)} failed, {xfailed} xfailed, {skipped} skipped")

    if not failures:
        print("[circle] ✅ All tests passed — no Linear tickets needed")
        return 0

    # Step 3: Create Linear tickets for each failure
    print(f"\n[circle] Creating {len(failures)} Linear ticket(s)...")
    tickets_created = 0

    for failure in failures:
        payload = build_linear_payload(failure, run_result)
        result = create_linear_ticket(payload)
        if result:
            tickets_created += 1

    print(f"\n[circle] Done: {tickets_created}/{len(failures)} tickets created")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
