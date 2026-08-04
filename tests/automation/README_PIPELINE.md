# SYNTARO + OpenSymphony Automation Testing Pipeline

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                        Automation Test Runner                         │
│                    (@playwright/test + TypeScript)                    │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐       │
│  │ Core Engine                                                │       │
│  │  ├─ ActionLogger     — Logs every action (click, fill,     │       │
│  │  │                     scroll, navigate) with screenshot,  │       │
│  │  │                     DOM snapshot, timestamp, duration   │       │
│  │  ├─ ConsoleCapture   — Captures console.log/warn/error     │       │
│  │  │                     from page.on('console')             │       │
│  │  ├─ NetworkCapture   — Captures request/response URL,      │       │
│  │  │                     status, headers, duration           │       │
│  │  ├─ ScreenshotManager— Auto screenshot per step +          │       │
│  │  │                     pixelmatch vs baseline              │       │
│  │  ├─ OcrEngine        — Text extraction from screenshots    │       │
│  │  │                     (oc-vision MCP → tesseract)         │       │
│  │  ├─ VisionAssert     — Visual + OCR assertions             │       │
│  │  ├─ DebugContext     — Bundles logs + screenshots + trace  │       │
│  │  │                     on test failure                     │       │
│  │  ├─ OpenSymphonyClient— HTTP client for OpenSymphony BE    │       │
│  │  │                     (dispatch, status, result)          │       │
│  │  ├─ TicketManager    — Manages Big Tickets and merges      │       │
│  │  │                     tickets by similarity               │       │
│  │  └─ AutoTickets      — Auto-creates/updates tickets on     │       │
│  │                        test failure                        │       │
│  └────────────────────────────────────────────────────────────┘       │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐       │
│  │ Page Objects (Page Object Model)                           │       │
│  │  ├─ BasePage          — Base class with action logging     │       │
│  │  ├─ LoginPage         — Login / Register / Auth            │       │
│  │  ├─ DashboardPage     — Dashboard home, stats cards        │       │
│  │  ├─ RunsPage          — Runs history, filter, sort         │       │
│  │  ├─ RunDetailPage     — Run detail, logs, retry            │       │
│  │  ├─ AnalyticsPage     — Charts, KPIs, export               │       │
│  │  └─ SettingsPage      — Settings, API keys, prefs          │       │
│  └────────────────────────────────────────────────────────────┘       │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐       │
│  │ Test Suites                                                │       │
│  │  ├─ 01-health/        — FE + BE connectivity tests         │       │
│  │  ├─ 02-login/         — Login/Register UI tests            │       │
│  │  ├─ 03-dashboard/     — Dashboard tests                    │       │
│  │  ├─ 04-runs/          — Runs list/detail tests             │       │
│  │  ├─ 05-analytics/     — Analytics charts tests             │       │
│  │  └─ 06-integration/   — ★ FE+BE integration tests          │       │
│  │     ├─ dispatch-to-osy    — SYNTARO → OpenSymphony dispatch   │       │
│  │     └─ fe-be-consistency  — FE data matches BE data        │       │
│  └────────────────────────────────────────────────────────────┘       │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐       │
│  │ Reports (auto-generated, gitignored)                       │       │
│  │  reports/{testClass}/{testName}/                           │       │
│  │  ├─ actions.log       — JSON lines of every action         │       │
│  │  ├─ console.log       — JSON lines of console messages     │       │
│  │  ├─ network.log       — JSON lines of network events       │       │
│  │  ├─ step_*.png        — Screenshots per step               │       │
│  │  ├─ dom_*.html        — DOM snapshots                      │       │
│  │  ├─ bundle/summary.json— Debug bundle summary              │       │
│  │  └─ *_debug.zip       — Full debug context zip             │       │
│  └────────────────────────────────────────────────────────────┘       │
└───────────────────────────────────────────────────────────────────────┘

Systems Under Test:
┌─────────────────────┐          ┌─────────────────────────────┐
│  SYNTARO (Frontend)    │          │  OpenSymphony (Backend)     │
│  React Dashboard    │──HTTP──▶ │  Elixir/Phoenix API         │
│  Express Server     │  POST    │  ├─ POST /api/v1/dispatch   │
│  Port 3000          │  +Auth   │  ├─ GET  /healthz           │
│                     │◀─────────│  └─ Port 4096               │
└─────────────────────┘          └─────────────────────────────┘
```

## Setup & Requirements

### Dependencies
- Node.js >= 20
- Playwright browsers: `npx playwright install chromium`
- (Optional) Tesseract for OCR: `apt-get install tesseract-ocr`
- (Optional) oc-vision MCP server for advanced vision

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_URL` | `http://localhost:3000` | SYNTARO frontend URL |
| `OSY_URL` | `http://localhost:4096` | OpenSymphony backend URL |
| `OSY_API_KEY` | — | API key for OpenSymphony auth |
| `AUTOMATION_ROOT` | `./tests/automation` | Root directory for reports |

### How to Run

```bash
# Run all automation tests
npx playwright test --config tests/automation/playwright.config.ts

# Run a specific test suite
npx playwright test tests/automation/tests/01-health --config tests/automation/playwright.config.ts

# Run integration tests only (requires both FE + BE)
npx playwright test tests/automation/tests/06-integration --config tests/automation/playwright.config.ts

# Run with UI mode (debug)
npx playwright test --ui --config tests/automation/playwright.config.ts

# Update visual baselines
UPDATE_BASELINES=true npx playwright test --config tests/automation/playwright.config.ts
```

### Docker Compose (Full Stack)

```yaml
# docker-compose.test.yml
services:
  syntaro:
    image: syntaro:latest
    ports: ["3000:3000"]
    environment:
      - OPENSYMPHONY_DISPATCH_URL=http://opensymphony:4096/api/v1/dispatch
  opensymphony:
    image: opensymphony:latest
    ports: ["4096:4096"]
    environment:
      - SYMPHONY_API_KEYS=test-api-key
  postgres:
    image: postgres:16
  rabbitmq:
    image: rabbitmq:4-management
```

## How to Add a New Test

1. **Identify the component**: Is it FE (SYNTARO dashboard), BE (OpenSymphony API), or integration?

2. **Create Page Object** (if new page):
   ```typescript
   // pages/MyNewPage.ts
   import { BasePage } from './BasePage.js';
   export class MyNewPage extends BasePage {
     // Define locators and actions
   }
   ```

3. **Create test file**:
   ```typescript
   // tests/03-my-feature/my-test.test.ts
   import { test, expect } from '../../fixtures/syntaro-fixtures.js';

   test.describe('My Feature', () => {
     test('works correctly', async ({ loggedPage }) => {
       // Use loggedPage for automatic action logging
       await loggedPage.actionLogger.navigate('/my-feature');

       // Assertions
       expect(await loggedPage.title()).toContain('My Feature');

       // Debug info is automatically captured on failure
     });

     test('integration with BE', async ({ osyClient }) => {
       const result = await osyClient.dispatch({...});
       expect(result.success).toBeTruthy();
     });
   });
   ```

4. **Run the test**: `npx playwright test --config tests/automation/playwright.config.ts`

## How to Interpret Reports

After running tests, reports are in `tests/automation/reports/`:

### actions.log (every action)
```json
{"step":1,"timestamp":"...","action":"navigate","selector":"http://...","url":"...","title":"...","screenshotPath":"...","durationMs":1234}
{"step":2,"timestamp":"...","action":"click","selector":"Sign In button","coordinates":{"x":320,"y":480},"url":"...","screenshotPath":"...","durationMs":567}
```

### console.log (every console message)
```json
{"timestamp":"...","type":"info","text":"Page loaded","location":"https://..."}
{"timestamp":"...","type":"error","text":"Failed to load resource","location":"https://..."}
```

### network.log (every request/response)
```json
{"timestamp":"...","type":"request","method":"GET","url":"https://...","status":200,"durationMs":45}
{"timestamp":"...","type":"response","method":"POST","url":"https://...","status":500,"durationMs":1200}
```

### Debug Bundle (on test failure)
```
bundle/summary.json — action log summary, console summary, network summary
bundle/error.txt — error message + stack trace
bundle/trace.zip — Playwright trace (replay at https://trace.playwright.dev)
```

## Test Structure Rules

1. **Every action must be logged**: Use `BasePage.click()`, `BasePage.fill()`, etc.
2. **FE tests must verify BE**: Integration tests must call both FE (Playwright) and BE (OpenSymphonyClient)
3. **Health check before each suite**: global-setup verifies both FE and BE are alive
4. **Screenshot per step**: ActionLogger auto-captures screenshots before each action
5. **Debug bundle on failure**: DebugContext auto-bundles when a test fails
6. **Console + Network log every step**: ConsoleCapture + NetworkCapture auto-record

## Ticket Management

### Big Ticket Concept
- Tickets sharing the same **component** and **tags** are merged into one **Big Ticket**
- If a Big Ticket is not yet merged/closed, new context is appended instead of creating a new ticket
- On test failure, the system finds a matching Big Ticket or creates a new one

### Similarity Detection
1. **Default**: keyword + tag matching
2. **AI (when needed)**: calls OpenCode AI if keyword matching is insufficient

### Ticket Flow
```
Test Failure → AutoTickets.handleTestResult()
  → Find open Big Ticket with same component/tags
  → If found → append debug context
  → If not → create new Big Ticket
  → Save to tickets.json
```

## How to Write a Ticket (Agent Guidelines)

Every ticket MUST contain the following sections. AI agents tend to skip details or claim things work without verifying — follow this template strictly.

### Required Format

```markdown
# TICKET-{ID}: {Short Descriptive Title}

> **Project**: [SYNTARO](https://linear.app/aimino/project/syntaro-solving-tickets-as-a-service-7ce85efdc6bd/overview)
> **Team**: [AIM - All](https://linear.app/aimino/team/AIM/all)
> **Status**: `open` | `in_progress` | `merged` | `closed`
> **Type**: `bug` | `feature` | `task` | `automation`
> **Created**: {ISO date}
```

### 1. Input (What you started with)
- Exact problem or requirement
- Commands run, environment state, configuration used
- Files and directories involved
- Preconditions (what was running, what version)
- Links to relevant Linear issues (append if related to existing Big Ticket)

### 2. Output (What happened)
- Raw test results (not AI-summarized — paste actual terminal output)
- Logs from `reports/` directory (actions.log, console.log, network.log)
- Screenshots from the test run (attach from `reports/{testName}/`)
- Error messages (full stack traces, not just descriptions)
- Test pass/fail counts with specific test names

### 3. Context (Why it happened)
- Architecture overview relevant to this ticket
- Environment details (OS, Node version, ports, services running)
- What was actually running vs what was expected to be running
- Dependencies and their versions
- Configuration files and non-default settings
- Previous related tickets or issues

### 4. Suggested Implementation (How to fix it)
- Concrete file paths and line numbers
- Specific code changes needed (not vague suggestions)
- Trade-offs considered and chosen approach
- Migration plan if applicable
- Links to relevant existing code that handles similar cases

### 5. Acceptance Criteria (How to verify it's done)
Each criterion must be objectively verifiable:
```
### MUST HAVE
- [ ] `npm run test:automation` passes with zero failures
- [ ] Logs appear in `reports/{testName}/actions.log`
- [ ] Screenshots exist in `reports/{testName}/`

### SHOULD HAVE
- [ ] All console errors are zero

### NICE TO HAVE
- [ ] Performance benchmarks improve by 10%
```

### 6. AI Integrity Check (Because AI is Always Lying)
```
**What an AI might claim without verifying:**
- ❌ "All tests pass" → Run them yourself, check raw output
- ❌ "System is connected" → Ping both FE and BE health endpoints
- ❌ "Logs are captured" → Check `reports/` exists and has content
- ❌ "Screenshots show the page" → Open the actual PNG files
- ❌ "Integration works" → Verify both FE and BE are actually running

**How to verify:**
1. Run the test: `npm run test:automation:{suite}`
2. Check reports: `ls tests/automation/reports/{testName}/`
3. Read raw logs: `cat tests/automation/reports/{testName}/actions.log`
4. View screenshots: open the PNG files
5. Check both ends: curl FE /health and BE /healthz
6. Never trust an AI that says "it works" without showing evidence
```

### Big Ticket Rule
- **ALWAYS** check `tests/automation/.tickets/` for existing open tickets with the same component/tags before creating a new one
- If found → append to the existing ticket (add sections, update acceptance criteria)
- If not found → create a new Big Ticket
- Monitoring tickets: ONE Big Ticket per component, not one per test failure

## Adding New Pages to POM

```typescript
// pages/MyPage.ts
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class MyPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  // Define locators as getters
  get myButton(): Locator {
    return this.page.getByRole('button', { name: 'Submit' });
  }

  // Define actions that use logging
  async doSomething(): Promise<void> {
    await this.click(this.myButton, 'My button');
    await this.waitForLoad();
  }
}
```

## Current System Status

### What's Automated
| Component | Coverage | Tests |
|-----------|----------|-------|
| FE Health | ✅ | connectivity.test.ts |
| FE Login UI | ✅ | login.test.ts |
| BE Health | ✅ | connectivity.test.ts |
| FE→BE Dispatch | ✅ | dispatch-to-osy.test.ts |
| FE+BE Consistency | ✅ | fe-be-consistency.test.ts |
| FE Dashboard | 🏗️ | Pending |
| FE Runs | 🏗️ | Pending |
| FE Analytics | 🏗️ | Pending |
| FE Settings | 🏗️ | Pending |
| OCR/Visual | 🏗️ | Pending |

### How the System Works
1. **Test Runner**: `@playwright/test` with TypeScript
2. **Action Logging**: Custom `ActionLogger` wraps every Playwright action
3. **Console Capture**: `page.on('console')` — records every console message
4. **Network Capture**: `page.on('request'/'response')` — records every network event
5. **Screenshot Management**: Auto screenshot per step, pixelmatch vs baseline
6. **OCR/Vision**: oc-vision MCP (primary) → tesseract (fallback)
7. **Ticket Management**: Auto-creates/updates Big Ticket on test failure
8. **Debug Bundle**: On test failure, zips all context (screenshots, logs, trace)

## Agent-Facing Commands

```bash
# Run the full automation test suite
npx playwright test --config tests/automation/playwright.config.ts

# Run with HTML reporter
npx playwright test --reporter=html --config tests/automation/playwright.config.ts

# View HTML report
npx playwright show-report tests/automation/reports/html

# Open Playwright Trace
npx playwright show-trace tests/automation/reports/*/bundle/trace.zip

# View latest ticket
cat tests/automation/.tickets/BIG-001-automation-testing-system.md
```

## Current Tickets

| ID | Title | Status | Location |
|----|-------|--------|----------|
| BIG-001 | Automation Testing System — SYNTARO (FE) + OpenSymphony (BE) | `open` | `.tickets/BIG-001-automation-testing-system.md` |

> **Note**: Linear API is not configured in this environment (`LINEAR_API_KEY` missing). Tickets are stored as markdown files in `tests/automation/.tickets/`. To create Linear tickets:
> 1. Set `LINEAR_API_KEY` environment variable
> 2. Or configure `tracker.api_key` in `symphony.yml`
> 3. Then use the `linear_graphql` tool to create issues

## Known Issues

| Issue | Cause | Workaround |
|-------|-------|------------|
| `Must start tracing before stopping` | Playwright `request` fixture with `trace: 'on'` | Use native `fetch()` instead of `request` fixture |
| Dashboard assets 404 in dev mode | Vite dev server not serving assets | Build dashboard with `cd dashboard && npm run build` |
| OpenSymphony integration tests skip | BE not running | Start OSY on port 4096, or set `OSY_URL` |
| Linear API not available | No `LINEAR_API_KEY` set | Set env var or use file-based tickets in `.tickets/` |
