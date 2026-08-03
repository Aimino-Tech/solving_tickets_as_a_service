---
name: automation-testing
description: Automation testing skill using Python + PyTest + Playwright for Web/API, with self-healing selectors, RCA, and vision-based automation.
version: 1.0.0
author: SYNTARO
license: MIT
tags:
  - testing
  - playwright
  - pytest
  - automation
  - e2e
  - api-testing
  - self-healing
  - rca
  - vision-automation
categories:
  - testing
  - developer-tools
  - ci-cd
platforms:
  - opencode
  - openclaw
  - claude-code
---

# Automation Testing Skill

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Web Automation | **Playwright** | Fast, auto-waiting, low flaky, cross-browser |
| API Testing | **requests** + Playwright APIRequestContext | Lightweight, no extra dependency |
| Mobile | Appium | Standard for native/hybrid mobile |
| Test Runner | **PyTest** | Pythonic, fixtures, parallel, rich plugins |
| Assertions | PyTest built-in + `pytest-playwright` | Native integration |

## Agent Roles

### 1. Test Code Generation

Read User Story / API Spec (OpenAPI/Swagger) → generate test cases + complete Playwright/PyTest code.

**Workflow:**
```
User Story / OpenAPI Spec
  → Parse requirements (Agent)
  → Generate test scenarios (positive/negative/edge)
  → Write Playwright page-object + test files
  → Run & validate
```

### 2. Self-Healing Selectors

When UI changes break CSS/XPath selectors, Agent reads current DOM and updates selectors.

**Workflow:**
```
Test failure (element not found)
  → Capture current DOM snapshot
  → Identify changed element by context (text, aria-label, nearby stable element)
  → Propose new selector
  → Update page object
  → Re-run test
```

### 3. Root Cause Analysis (RCA)

When CI/CD test fails, Agent reads logs, stack trace, and screenshots to determine root cause.

**Workflow:**
```
CI/CD test failure
  → Collect: console logs, trace.zip, screenshot.png, video.webm
  → Classify: app bug | network flake | test flake | infra issue
  → Summarize with evidence
  → Suggest fix or re-run strategy
```

### 4. Vision Automation (Multimodal)

For multimodal agents — "look" at browser screen, click buttons, fill forms without hardcoded selectors.

**Workflow:**
```
Agent sees screenshot of target page
  → Identifies interactive elements visually
  → Clicks / types based on visual understanding
  → Validates result vision + DOM
```

## Quick Start

### Prerequisites

```bash
pip install pytest pytest-playwright playwright
playwright install chromium
```

### Project Structure

```
tests/
├── conftest.py              # Shared fixtures (page, api_context, base_url)
├── pages/                   # Page Object Model
│   ├── login_page.py
│   └── register_page.py
├── api/                     # API test helpers
│   └── auth_api.py
└── test_auth.py             # Test scenarios
```

### Running Tests

```bash
# All tests
pytest tests/ -v

# With HTML report
pytest tests/ --html=report.html

# Parallel
pytest tests/ -n auto

# Markers
pytest tests/ -m "smoke"
pytest tests/ -m "regression"
```

### Example: Login Page Test

```python
# tests/test_auth.py
import re
from playwright.sync_api import Page, expect

def test_login_page_has_expected_elements(page: Page, base_url: str):
    page.goto(f"{base_url}/login")
    expect(page.get_by_role("heading", name="SYNTARO")).to_be_visible()
    expect(page.get_by_text("Sign In")).to_be_visible()
    expect(page.get_by_text("Register")).to_be_visible()
```

### Example: API Test with Playwright

```python
def test_register_api_returns_201(api_context, base_url):
    resp = api_context.post(f"{base_url}/api/v1/auth/register", {
        "email": "test@example.com",
        "password": "password123",
        "name": "Test User"
    })
    assert resp.status == 201
    data = resp.json()
    assert "token" in data
```

## Tools

### `run_tests`

Execute test suite with specified markers and options.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `test_path` | string | `tests/` | Path to test directory or file |
| `markers` | string | — | PyTest markers to filter (`smoke`, `regression`, `e2e`) |
| `headed` | bool | `false` | Run browser in headed mode (visible) |
| `workers` | int | `1` | Parallel worker count |
| `report` | bool | `true` | Generate HTML report |
| `tracing` | string | `off` | Playwright trace: `off`, `on`, `retain-on-failure` |

### `analyze_failure`

Analyze a failed test run for root cause.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `trace_path` | string | Path to trace.zip |
| `log_path` | string | Path to test output log |
| `screenshot_dir` | string | Directory with failure screenshots |

### `heal_selector`

Suggest updated selector from current DOM.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `url` | string | Target page URL |
| `broken_selector` | string | The failing selector |
| `element_description` | string | Human description of target element |

## Authentication

The test suite reads `BASE_URL` from environment (default: `http://localhost:5173`).

```bash
export BASE_URL=http://localhost:5173
pytest tests/
```

## Error Handling

| Error | Likely Cause | Action |
|---|---|---|
| `PlaywrightTimeoutError` | Element not visible | Check selector / page load |
| `404 on API call` | Backend not running or route missing | Verify server on target port |
| `Connection refused` | App not running | Start dev server |
| `Flaky test (intermittent)` | Race condition | Add `page.wait_for_*` |
