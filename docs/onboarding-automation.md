# Onboarding Automation

Self-service onboarding for STAS users. Users can set up the bot without manual
assistance through a guided wizard that handles GitHub App installation,
Linear OAuth, repository configuration, and end-to-end verification.

## Architecture

```
User visits dashboard wizard
        │
        ▼
  OnboardingWizard.tsx (React)
        │
        ├── GET /api/onboarding/status          ─→ onboardingStateMachine.getState()
        ├── POST /api/onboarding/step/github     ─→ stateMachine.transition('github_installed')
        ├── POST /api/onboarding/step/linear     ─→ stateMachine.transition('linear_connected')
        ├── POST /api/onboarding/step/repos      ─→ onboardingRepoConfig.saveRepos()
        ├── POST /api/onboarding/step/labels     ─→ onboardingRepoConfig.updateLabels()
        ├── POST /api/onboarding/step/test-run   ─→ triggerTestRun()
        └── GET /api/onboarding/checklist         ─→ stateMachine.getChecklist()

  GitHub Webhooks
        │
        └── installation.created                 ─→ createInstallationWebhooks()
        └── installation.deleted                 ─→ createInstallationWebhooks()
```

## State Flow

```
not_started → github_installed → linear_connected → repos_configured
→ labels_set → test_run → completed
```

States are persisted in the `onboarding_state` DB table and survive server restarts.

## Files

| File | Purpose |
|---|---|
| `src/webhooks/installation.ts` | GitHub App installation lifecycle handler |
| `src/routes/auth/linear.ts` | Linear OAuth login and callback |
| `src/onboarding/state-machine.ts` | State machine with DB persistence |
| `src/onboarding/config.ts` | Repo/label configuration service |
| `src/onboarding/test-run.ts` | Test issue creation via GitHub API |
| `src/onboarding/routes.ts` | Setup wizard API endpoints |
| `src/onboarding/index.ts` | Barrel exports |
| `dashboard/src/pages/OnboardingWizard.tsx` | Step-by-step wizard UI |
| `src/db/migrations/008_onboarding.sql` | DB schema |
| `src/config.ts` | Extended configuration |
| `docs/onboarding-automation.md` | This document |

## Configuration

Add to your `.env` file:

```env
# GitHub App installation URL
GITHUB_APP_URL=https://github.com/apps/your-app-name/installations/new

# Linear OAuth credentials (optional — needed for Linear integration)
LINEAR_CLIENT_ID=your_linear_client_id
LINEAR_CLIENT_SECRET=your_linear_client_secret
LINEAR_REDIRECT_URI=http://localhost:3000/auth/linear/callback

# Onboarding defaults
ONBOARDING_DEFAULT_LABEL=stas:fix
ONBOARDING_TEST_ISSUE_TITLE=STAS Onboarding Test Issue

# Dashboard URL (for OAuth redirect back)
DASHBOARD_URL=http://localhost:5173
```

## API Endpoints

All onboarding endpoints are under `/api/onboarding`.

### `GET /api/onboarding/status`

Returns the current onboarding state and checklist.

**Query params:** `tenantId` (required)

**Response:**
```json
{
  "tenantId": "12345",
  "onboarded": false,
  "state": "github_installed",
  "currentStep": "github_installed",
  "nextStep": "linear_connected",
  "progressData": { "installationId": 12345 },
  "checklist": [
    { "state": "github_installed", "label": "GitHub App installed", "completed": true, "current": false },
    { "state": "linear_connected", "label": "Linear connected", "completed": false, "current": true },
    { "state": "repos_configured", "label": "Repositories configured", "completed": false, "current": false }
  ]
}
```

### `POST /api/onboarding/step/github`

Acknowledge GitHub App installation.

**Body:** `{ "tenantId": "12345", "installationId": 67890, "accountLogin": "my-org" }`

### `POST /api/onboarding/step/linear`

Store Linear OAuth completion. Called after the OAuth callback redirects back.

**Body:** `{ "tenantId": "12345", "organizationId": "linear-org-id" }`

### `POST /api/onboarding/step/repos`

Save repository whitelist and label configuration.

**Body:**
```json
{
  "tenantId": "12345",
  "repos": [
    { "owner": "my-org", "name": "my-repo", "installationId": 67890 }
  ],
  "labels": { "my-org/my-repo": ["stas:fix"] }
}
```

### `POST /api/onboarding/step/labels`

Configure labels for specific repos (creates them via GitHub API).

**Body:**
```json
{
  "tenantId": "12345",
  "labels": [
    { "owner": "my-org", "name": "my-repo", "labels": ["stas:fix"] }
  ]
}
```

### `POST /api/onboarding/step/test-run`

Create a test issue to verify the pipeline.

**Body:** `{ "tenantId": "12345", "owner": "my-org", "repo": "my-repo" }`

**Response:**
```json
{
  "success": true,
  "state": "test_run",
  "issueUrl": "https://github.com/my-org/my-repo/issues/1",
  "issueNumber": 1
}
```

### `GET /api/onboarding/checklist`

Returns the onboarding checklist with completion status.

### `GET /api/onboarding/repos`

Returns the configured repos for the tenant.

## Database Schema

### `onboarding_state`

| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| tenant_id | VARCHAR(255) | GitHub installation ID (unique) |
| state | VARCHAR(50) | Current state machine state |
| progress_data | JSONB | Metadata and progress data |
| created_at | TIMESTAMPTZ | Row creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### `tenant_repos`

| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| tenant_id | VARCHAR(255) | GitHub installation ID |
| owner | VARCHAR(255) | Repo owner |
| name | VARCHAR(255) | Repo name |
| installation_id | INTEGER | GitHub App installation ID |
| labels | TEXT[] | Trigger labels |
| created_at | TIMESTAMPTZ | Row creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### `billing` (extended)

| Column | Type | Description |
|---|---|---|
| linear_access_token | TEXT | Encrypted Linear OAuth token |
| linear_organization_id | VARCHAR(255) | Linear organization ID |

### `accounts` (extended)

| Column | Type | Description |
|---|---|---|
| onboarding_completed | BOOLEAN | Whether onboarding is complete |
| github_install_created_at | TIMESTAMPTZ | When the GitHub App was installed |
| github_install_deleted_at | TIMESTAMPTZ | When the GitHub App was uninstalled |

## OAuth Flow

### Linear

```
User clicks "Connect Linear"
  → GET /auth/linear/login
  → Redirect to Linear OAuth authorize URL
  → User authorizes the app
  → Linear redirects to /auth/linear/callback?code=...&state=...
  → Server exchanges code for access token
  → Token stored in billing.linear_access_token
  → Redirect to /onboarding?linear=connected
```

## Error Handling

All API endpoints return user-friendly error messages. Common errors:

- **Missing tenant ID** — Provide `x-tenant-id` header or `tenantId` query param
- **Invalid transition** — State machine prevents skipping steps
- **GitHub API errors** — Translated to actionable messages (permissions, missing repos)
- **Linear OAuth errors** — Clear messages about configuration issues

## Test Issue

The test issue created during onboarding:
1. Creates a GitHub issue with title "STAS Onboarding Test Issue"
2. Labels it with `stas:fix`
3. Posts a comment explaining this is a test run
4. Returns the issue URL for the wizard to display

The test verifies:
- GitHub App installation is working
- The app has issue creation permissions
- The label trigger will be detected
- The end-to-end pipeline is operational
