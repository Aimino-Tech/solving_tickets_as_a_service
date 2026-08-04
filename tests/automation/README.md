# SYNTARO Automation Tests

Playwright-based UI automation tests for the SYNTARO dashboard (FE).

## Prerequisites

- Python 3.10+
- Playwright browsers installed (`playwright install chromium`)

## Quick Start

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium

# Start Vite dev server (terminal 1)
cd dashboard && npm run dev

# Start Express API server (terminal 2)
npm run dev:api

# Run all automation tests
cd tests/automation && python -m pytest -v
```

## Test Scripts

```bash
# All automation tests
npm run test:automation

# Health checks only
npm run test:automation:health

# Login UI tests
npm run test:automation:login

# Auth API tests
npm run test:automation:api
```

## Project Structure

```
tests/automation/
├── conftest.py          # Pytest fixtures (browser, page, api_context)
├── pytest.ini           # Pytest configuration
├── README.md            # This file
├── requirements.txt     # Python dependencies
├── pages/
│   ├── login_page.py    # Login page object
│   ├── dashboard_page.py   # Dashboard page object
│   ├── analytics_page.py   # Analytics page object
│   └── settings_page.py    # Settings page object
├── test_health.py       # Health check tests (FE + BE)
├── test_login.py        # Login page UI tests
├── test_auth_api.py     # Auth API tests
└── test_dashboard_navigation.py  # Navigation smoke tests
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5173` | Vite dev server URL |
| `SYNTARO_URL` | `http://localhost:3099` | Express API server URL |

## GitHub Issue Guidelines

When creating tickets from test failures:

1. **Title**: `[AUTO][{testName}] {brief description}`
2. **Labels**: Add `bug`, `automation`
3. **Body**: Include the full error message, screenshot paths, and console logs from the debug bundle
4. **Priority**: P0 for FE+BE integration failures, P1 for UI-only failures
