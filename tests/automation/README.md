# STAS Automation Tests

Automated E2E tests for STAS (Solving Tickets As A Service) using Playwright + pytest.

## Prerequisites

- Python 3.12+
- Playwright (chromium browser installed)
- STAS dashboard Vite dev server running on port 5173 (or custom `STAS_FE_URL`)
- STAS backend running on port 3000 (or custom `STAS_BACKEND_URL`) — optional, tests skip gracefully

## Setup

```bash
pip install playwright pytest
python3 -m playwright install chromium
```

## Running Tests

```bash
# Run all automation tests
cd tests/automation
python3 -m pytest -v

# Run with custom URLs
STAS_FE_URL=http://localhost:3099 STAS_BACKEND_URL=http://localhost:4096 python3 -m pytest -v

# Run specific test file
python3 -m pytest test_login.py -v

# Run with timeout (30s per test)
python3 -m pytest --timeout=30 -v

# Run API tests only
python3 -m pytest test_auth_api.py -v

# Run health tests only
python3 -m pytest test_health.py -v
```

## Test Structure

```
tests/automation/
├── conftest.py          # Shared fixtures (browser, page, API contexts)
├── pages/
│   ├── login_page.py    # Login Page Object Model
├── test_login.py        # Login UI tests (16 tests)
├── test_auth_api.py     # Auth API tests (validation + Supabase-dependent)
├── test_health.py       # Health check tests (FE + BE)
└── README.md            # This file
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STAS_FE_URL` | `http://localhost:5173` | Dashboard Vite dev server URL |
| `STAS_BACKEND_URL` | `http://localhost:3000` | STAS API backend URL |

## Test Categories

- **Health tests**: Verify FE and BE endpoints are reachable
- **Login UI tests**: Page renders, tabs, form interactions
- **Auth API tests**: Input validation (400 responses), registration/login flows

Backend-dependent tests skip gracefully if the backend is not running.