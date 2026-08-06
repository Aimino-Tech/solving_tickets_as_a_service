# SYNTARO Dashboard Design System

## 1. Research Log

- **Tailwind v3.4** config: `tailwind.config.js` — brand indigo #4f46e5 ramp (brand-50..brand-900), slate neutrals, darkMode: 'class'.
- **Component classes** in `src/styles/index.css`: `.card`, `.btn-primary`, `.btn-secondary`, `.btn-oauth`, `.btn-danger`, `.input-field`, `.badge`, `.badge-success`, `.badge-warning`, `.badge-error`, `.badge-info`, `.badge-neutral`.
- **Existing components**: ProgressBar, StatusBadge, EmptyState, LoadingSkeleton — reuse patterns preserved.
- **Lucide-react** icons only. No new npm dependencies.
- **Pivot**: Removed abstract metric cards + health score gauge. Primary view is now repo-centric: aggregate runs per repo to show bugs detected, issues created, pending, done.

## 2. Design Tokens

### Colors (from tailwind.config.js)

| Token | Value | Usage |
|---|---|---|
| brand-50..900 | #eef2ff..#312e81 | Primary actions, links |
| slate-200/700/800/900 | — | Borders, cards, text in dark mode |
| green-100/600/900 | — | Pass/success states |
| yellow-100/500/900 | — | Warning states |
| red-100/600/900 | — | Critical/error states |
| blue-100/900 | — | Info badges |

### Semantic Colors

| Role | Light | Dark |
|---|---|---|
| Card bg | white | slate-900 |
| Card border | slate-200 | slate-800 |
| Text primary | gray-900 | gray-100 |
| Text secondary | gray-500 | gray-400 |

### Typography

| Element | Classes |
|---|---|
| Page title | `text-xl font-bold text-gray-900 dark:text-gray-100` |
| Card heading | `text-base font-semibold text-gray-900 dark:text-gray-100` |
| Label | `text-sm font-medium text-gray-500 dark:text-gray-400` |
| Caption | `text-xs text-gray-400 dark:text-gray-500` |
| Table cell | `text-sm tabular-nums` |

### Spacing

8px grid. Cards use `p-5`. Grid gaps: `gap-4` (dense), `gap-6` (normal). Section spacing: `space-y-4` or `space-y-6`.

### Borders & Radii

Cards: `rounded-lg border`. Buttons: `rounded-lg`. Badges: `rounded-full`.

### Motion

GPU-composited only: `transition-colors` on interactive elements. `animate-spin` on RefreshCw during refresh. `animate-pulse` on skeleton placeholders. Progress bars use `transition-all` for smooth fill.

## 3. Component Primitives

### Reused Existing
- `ProgressBar` — value/max prop, barClassName for color
- `StatusBadge` — status prop, uses badge-* classes
- `EmptyState` — title, hint, action props
- `SkeletonCardGrid` — loading state (4 cards for header row)

### New Components
- `RunFeedback` — inline Yes/No feedback buttons calling `runs.feedbackSubmit`

### Moved to Notification Bell
- Dashboard recommendations ("Low pass rate", "No fix runs yet", "No repositories connected", usage warnings) are now surfaced as `alert`/`system` notifications in the bell dropdown (`NotificationBell`) instead of page banners. `syncRecommendations()` in `notificationService` upserts them by `recId`; clicking a recommendation notification navigates to its `data.to` route.

## 4. Layout Architecture

```
DashboardHome
├── Loading: header skeleton + SkeletonCardGrid(count=4)
├── Error: card with error message
└── Loaded:
    ├── Header strip (plan label + "Fixes this period" + usage text + ProgressBar + action buttons + RefreshCw + "Updated Xs ago")
    ├── Primary chips: Bugs detected | Issues created | Pending | Done (only when hasData)
    ├── Secondary chips (always visible): Active Repos: N | Pass Rate: N% | Total Runs: N
    ├── Free user upgrade CTA (if free plan)
    ├── Repository health table (per-repo rows, clickable, expandable failed runs)
    │   └── Repo row: chevron + repo name | bugs | issues | pending | done | pass rate | last run
    │   └── Expanded: failed run issue# + errorMessage (monospace) + link to /runs?repo=X&status=failed
    ├── No repos + no runs: "Connect Repo" empty state
    ├── Has repos but no runs: "Get your first fix" guide (3 steps + Copy label + Connect repo)
    ├── Recent Fix Runs (compact single-line rows with StatusBadge + duration + cost + RunFeedback)
    └── Shortcut cards (Connected Repos, Plan & Usage)
```

## 5. Evaluation System

### Severity Levels

| Level | Pass Rate | Speed (seconds) | Color |
|---|---|---|---|
| good | >= 85% | <= 180 | green-600 |
| warning | 50-84% | 181-300 | yellow-500 |
| critical | < 50% | > 300 | red-600 |
| empty | null | null | gray-400 |

### Health Score Formula (used internally, not displayed as gauge)

```
score = round(passRate * 0.5 + speedScore * 0.3 + errorScore * 0.2)
```

Where:
- `passRate` = stats.passRate (0-100)
- `speedScore` = clamp(100 - (max(0, avgDurationSeconds - 180) / 600) * 100, 0, 100)
- `errorScore` = clamp(100 - (100 - passRate), 0, 100)

Null stats: score null, severity 'empty', breakdown zeros.

### Repo Health Aggregation

`aggregateRepoHealth(runs: Run[]): RepoHealth[]` groups runs by `repoOwner/repoName` and computes:
- `bugsDetected` — count of runs with status 'failed'
- `issuesCreated` — count of distinct issueNumber values
- `pending` — runs with status 'queued' | 'running'
- `done` — runs with status 'success'
- `passRate` — done / totalRuns * 100
- `lastRunAt` — most recent createdAt timestamp

Results sorted by lastRunAt descending.

### Recommendation Rules

| Condition | Severity | Title Key | Action |
|---|---|---|---|
| quota >= 80% && < 100% | warning | dashboard.usageWarning | Upgrade -> /billing |
| quota >= 100% | critical | dashboard.usageExhausted | -> /billing |
| passRate < 50 (with data) | critical | dashboard.passRateCritical | -> /runs?status=failed |
| passRate 50-84 (with data) | warning | dashboard.passRateWarning | none |
| no runs at all | info | dashboard.noRunsRec | -> /repos |
| no repos (activeRepos 0) | info | dashboard.noReposRec | -> /repos |

Pass-rate recommendations are suppressed when totalRuns === 0 (no real data).

### Usage Format

`formatUsage(used, limit, unlimited)` returns "0/10" style string.

### Repo Health with Failed Runs

`aggregateRepoHealth` also populates `failedRuns: Array<{ id, issueNumber, errorMessage }>` capped at 3 per repo. Used for the expandable drill-down in the repo table.

## 6. Polling & Live Data

- **Poll interval**: 20 seconds (`POLL_INTERVAL_MS`), refetches `runs.list({ perPage: 100 })` + `stats.get()` + `billing.plan()` + `repos.list()`
- **Abort handling**: previous in-flight request cancelled before starting next poll via `AbortController`
- **Skeleton**: initial load shows skeleton; polls NEVER flip back to skeleton
- **Cleanup**: interval + abort controller cleared on unmount
- **Test-safe**: polling interval doesn't fire before deferred promises resolve in jsdom; interval cleared on unmount prevents timer leaks

## 7. Interaction Patterns

- **Refresh button**: RefreshCw icon, `animate-spin` while refreshing, disabled during refresh
- **"Updated Xs ago"**: `formatRelativeTime(lastUpdated)` updated after each poll/manual refresh
- **Repo row expand**: click toggles failed runs drill-down (one at a time, local state `expandedRepo`)
- **Copy label**: `navigator.clipboard.writeText('syntaro:fix')` with `.catch()` fallback, brief "Copied!" state (2s timeout)
- **Zero-state guide**: 3-step "Get your first fix" card with Copy label button + Connect repo link
- **Empty-state logic**: "No repos connected" only when `repoList.length === 0 && allRuns.length === 0` (not when repos.list() 401s)
