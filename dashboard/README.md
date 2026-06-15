# Aimino Tech — Marketing Dashboard

Interactive web dashboard for tracking marketing campaigns across all platforms.

**Company:** Aimino Tech GmbH
**Projects:** opendocswork-mcp (ODW), OpenTalk2HTML-NotMD (OT2H)

## Architecture

```
Google Sheet (data)  →  Apps Script (API)  →  HTML Dashboard (UI)
```

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Apps Script backend — reads sheet data, calculates metrics, serves API |
| `Index.html` | Dashboard UI — Chart.js charts, project cards, drill-down, health view |
| `appsscript.json` | Apps Script manifest |

## Deployment (Manual — 5 minutes)

### Step 1: Open Apps Script Editor
1. Go to [script.google.com](https://script.google.com)
2. Click **New Project**
3. Rename project to `AIMino Marketing Dashboard`

### Step 2: Copy Code
1. In the editor, you'll see `Code.gs` — replace its content with our `Code.gs`
2. Click **+** next to Files → **HTML** → name it `Index` → paste our `Index.html`
3. Click the gear icon (Project Settings) → check **Show "appsscript.json" manifest file** → paste our `appsscript.json`

### Step 3: Initialize Sheets
1. In the editor, select `initializeSheets` from the function dropdown
2. Click **Run** (this creates `daily-metrics` and `quality-log` tabs)
3. Authorize when prompted

### Step 4: Deploy
1. Click **Deploy** → **New deployment**
2. Select **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone** (or "Anyone with Google account")
5. Click **Deploy**
6. Copy the **Web app URL**

### Step 5: Set Up Daily Trigger
1. Select `setupDailyTrigger` from the function dropdown
2. Click **Run**
3. Authorize when prompted

## Features

### Overview Tab
- Global stats (today, week, month actions)
- Project cards with quality scores (A-F grade)
- Platform breakdown bars per project
- Trend chart (30 days)
- Goal progress bars
- Recent activity feed

### Platforms Tab
- Per-platform stats (Reddit, Twitter, LinkedIn, HN, Discord)
- Execution rate per platform
- Reddit subreddit breakdown table

### Health Tab
- Account health monitoring per Reddit profile
- Removal rate tracking
- Ban risk alerts

### Project Detail (Click any project card)
- Full project metadata
- Content type breakdown
- Subreddit performance
- Recent activity

## Quality Score Formula

Score = weighted average of:
- **Execution Rate** (30%): replied / total actions
- **Platform Coverage** (20%): active platforms / 5
- **Volume** (25%): total actions / 100 (capped at 1)
- **Low Removal** (15%): 1 - (removal rate × 10)
- **Marketplace Presence** (10%): published in marketplaces

## Updating

After making changes to Code.gs or Index.html:
1. Click **Deploy** → **Manage deployments**
2. Click **Edit** (pencil icon)
3. Select **New version**
4. Click **Deploy**
