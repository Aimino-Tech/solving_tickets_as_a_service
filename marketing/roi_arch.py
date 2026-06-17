"""Marketing ROI Dashboard — Complete System Architecture Design.

This module defines the layered architecture, data pipeline, schema extensions,
self-healing loop, and all integration points for the Marketing ROI Dashboard.

ARCHITECTURE OVERVIEW
=====================

                           ┌─────────────────────────────────────┐
                           │         PRESENTATION LAYER          │
                           │  (Web Dashboard | TUI | CLI | API)  │
                           └──────────────────┬──────────────────┘
                                              │
                           ┌──────────────────▼──────────────────┐
                           │        ANALYTICS LAYER              │
                           │  (Engine | Predictor | Optimizer)   │
                           └──────────────────┬──────────────────┘
                                              │
                           ┌──────────────────▼──────────────────┐
                           │         DATA LAYER                  │
                           │  (CampaignStore + Schema Ext)       │
                           └──────────────────┬──────────────────┘
                                              │
               ┌──────────────────────────────┼──────────────────────────────┐
               │              ┌───────────────▼────────────────┐             │
               │              │      INGESTION PIPELINE        │             │
               │              │  (Collectors | Sync | Monitor) │             │
               │              └───────────────┬────────────────┘             │
               │                              │                              │
        ┌──────▼──────┐              ┌────────▼────────┐        ┌───────────▼───┐
        │ Google Sheet │              │  External APIs  │        │  Cron Jobs    │
        │ (Campaigns)  │              │ (GitHub, npm,   │        │  (Scheduler)  │
        └──────────────┘              │  X, Reddit)    │        └───────────────┘
                                      └─────────────────┘

LAYER BREAKDOWN
===============

1. INGESTION LAYER — Collects raw data from external sources
   - GoogleSheetIngestor: Sheet → CampaignStore sync (bidirectional)
   - MetricsCollector: GitHub/npm/X API polls → campaign_metrics table
   - ReplyMonitor: Reddit inbox → actions table with engagement metrics
   - CronScheduler: Orchestrates collection timing + alerts

2. DATA LAYER — SQLite persistence with extended schema
   - Existing: campaigns, actions, accounts, metrics tables
   - New: funnel_events, engagement_snapshots, ai_recommendations,
          cron_job_log, campaign_performance views

3. ANALYTICS LAYER — Computes KPIs, forecasts, recommendations
   - ROIAnalyticsEngine: Funnel math, attribution, ROI per action
   - PredictiveIndicator: Simple time-series forecasts (moving avg + trend)
   - CampaignOptimizer: Alternative strategy generator

4. PRESENTATION LAYER — Surfaces data via multiple channels
   - RestAPI: FastAPI/Flask endpoints for JSON data
   - WebDashboard: React (in plugins/dashboard/) with live panels
   - TUIPanels: Extended Dashboard class with new sections
   - AlertEngine: Push notifications via gateway (Telegram, Slack, etc.)

5. SELF-HEALING LOOP — Observe → Analyze → Recommend → Execute → Measure
   The closed feedback cycle that drives continuous improvement.
"""

from __future__ import annotations

import dataclasses
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from marketing.quality_score import compute_quality_score_from_campaign


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 1: DATA LAYER — Schema Extensions
# ═══════════════════════════════════════════════════════════════════════════════


class FunnelStage(str, Enum):
    """Marketing funnel stages — tracks progression from awareness to revenue."""

    AWARENESS = "awareness"        # Impression, view, reach
    ENGAGEMENT = "engagement"      # Like, comment, reply, share
    INTEREST = "interest"          # Click-through, visit, follow
    CONSIDERATION = "consideration"  # Sign up, trial, download
    CONVERSION = "conversion"      # Purchase, subscription
    RETENTION = "retention"        # Repeat, referral, advocacy


class EngagementType(str, Enum):
    """Types of guerrilla marketing engagement signals."""

    UPVOTE = "upvote"
    DOWNVOTE = "downvote"
    LIKE = "like"
    FAVORITE = "favorite"
    COMMENT = "comment"
    REPLY = "reply"
    SHARE = "share"
    SAVE = "save"
    FOLLOW = "follow"
    CLICK = "click"
    SIGNUP = "signup"
    MENTION = "mention"
    DM = "dm"
    REPORT = "report"          # Negative signal
    REMOVAL = "removal"        # Content removed by mods


class SignalDirection(str, Enum):
    """Whether a signal is positive, neutral, or negative for brand."""

    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"


# ── SQL DDL for schema extensions ──────────────────────────────────────────
# These are the NEW tables beyond what CampaignStore currently defines.

SCHEMA_EXTENSIONS_SQL = """
-- Engagement snapshots: per-campaign, per-platform engagement metrics
CREATE TABLE IF NOT EXISTS engagement_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    snapshot_date   TEXT NOT NULL,
    collected_at    TEXT NOT NULL,

    -- Volume metrics
    total_posts     INTEGER NOT NULL DEFAULT 0,
    total_comments  INTEGER NOT NULL DEFAULT 0,
    total_replies   INTEGER NOT NULL DEFAULT 0,

    -- Sentiment metrics
    positive_signals INTEGER NOT NULL DEFAULT 0,
    neutral_signals  INTEGER NOT NULL DEFAULT 0,
    negative_signals INTEGER NOT NULL DEFAULT 0,

    -- Engagement quality
    avg_reply_depth     REAL NOT NULL DEFAULT 0.0,
    unique_interactors  INTEGER NOT NULL DEFAULT 0,
    reply_rate          REAL NOT NULL DEFAULT 0.0,   -- replies per post ratio

    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_campaign
    ON engagement_snapshots(campaign_id, platform);

-- Funnel events: track user progression through the marketing funnel
CREATE TABLE IF NOT EXISTS funnel_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    action_id       INTEGER REFERENCES actions(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL,
    event_type      TEXT NOT NULL,         -- FunnelStage value
    engagement_type TEXT,                  -- EngagementType value
    signal_direction TEXT NOT NULL DEFAULT 'neutral',
    source_url      TEXT,
    profile_name    TEXT,
    metric_value    REAL NOT NULL DEFAULT 1.0,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    occurred_at     TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funnel_campaign
    ON funnel_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_funnel_type
    ON funnel_events(event_type);
CREATE INDEX IF NOT EXISTS idx_funnel_occurred
    ON funnel_events(occurred_at);

-- AI recommendations: self-healing loop output
CREATE TABLE IF NOT EXISTS ai_recommendations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL,     -- 'strategy', 'platform', 'content',
                                          -- 'timing', 'budget', 'angle'
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    rationale       TEXT NOT NULL,
    expected_impact TEXT NOT NULL,         -- e.g. "+15% engagement in 7 days"
    confidence      REAL NOT NULL DEFAULT 0.5,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected, executed
    metrics_before  TEXT NOT NULL DEFAULT '{}',       -- JSON snapshot of KPIs before
    metrics_after   TEXT NOT NULL DEFAULT '{}',        -- JSON snapshot of KPIs after
    applied_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendations_campaign
    ON ai_recommendations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_status
    ON ai_recommendations(status);

-- Cron job execution log
CREATE TABLE IF NOT EXISTS cron_job_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name        TEXT NOT NULL,
    job_type        TEXT NOT NULL,         -- 'monitor', 'digest', 'sync', 'analysis'
    platform        TEXT,
    status          TEXT NOT NULL,         -- 'running', 'completed', 'failed'
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    duration_ms     INTEGER,
    result_summary  TEXT,
    error_message   TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_job_date
    ON cron_job_log(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_job_status
    ON cron_job_log(status);

-- Campaign performance summary (materialized by periodic computation)
CREATE TABLE IF NOT EXISTS campaign_performance (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    computed_at     TEXT NOT NULL,

    -- Funnel metrics
    awareness_count   INTEGER NOT NULL DEFAULT 0,
    engagement_count  INTEGER NOT NULL DEFAULT 0,
    interest_count    INTEGER NOT NULL DEFAULT 0,
    consideration_count INTEGER NOT NULL DEFAULT 0,
    conversion_count  INTEGER NOT NULL DEFAULT 0,
    retention_count   INTEGER NOT NULL DEFAULT 0,

    -- Funnel conversion rates
    awareness_to_engagement REAL NOT NULL DEFAULT 0.0,
    engagement_to_interest  REAL NOT NULL DEFAULT 0.0,
    interest_to_consideration REAL NOT NULL DEFAULT 0.0,
    consideration_to_conversion REAL NOT NULL DEFAULT 0.0,
    conversion_to_retention REAL NOT NULL DEFAULT 0.0,

    -- ROI metrics
    total_signals     INTEGER NOT NULL DEFAULT 0,
    positive_signals  INTEGER NOT NULL DEFAULT 0,
    negative_signals  INTEGER NOT NULL DEFAULT 0,
    neutral_count     INTEGER NOT NULL DEFAULT 0,
    signal_ratio      REAL NOT NULL DEFAULT 0.0,
    estimated_reach   INTEGER NOT NULL DEFAULT 0,
    engagement_rate   REAL NOT NULL DEFAULT 0.0,
    quality_score     REAL NOT NULL DEFAULT 0.0,

    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perf_campaign
    ON campaign_performance(campaign_id);
"""


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 2: DATA PIPELINE — Sheet → Store → Analytics → Dashboard
# ═══════════════════════════════════════════════════════════════════════════════

PIPELINE_FLOW = """
DATA PIPELINE: Google Sheet → MetricsStore → Analytics → Dashboard
===================================================================

PHASE 1: INGEST (push/pull cycle, triggered by cron every N hours)
───────────────────────────────────────────────────────────────────

  Google Sheet (reddit-campaign tab)
       │
       │  pull_from_sheet() — reads all rows, matches ContentID or content_preview
       ▼
  CampaignStore (campaigns.db)
       │
       │  inserts/updates in:
       │    • actions table (new sheet rows → new actions)
       │    • updates action status from sheet column
       ▼
  MetricsCollector.poll_all()
       │
       │  collect_github_metrics(repo)  → insert_metric()
       │  collect_npm_metrics(pkg)      → insert_metric()
       │  collect_x_mentions(keywords)  → insert_metric()
       ▼
  CampaignStore.metrics table
       │
       │  push_to_sheet() — writes all store actions back to sheet
       ▼
  Google Sheet (bi-directionally synced)


PHASE 2: ENRICH (after sheet sync, per-cycle transformation)
─────────────────────────────────────────────────────────────

  CampaignStore.actions table
       │
       │  Read all actions for active campaigns
       │  Classify by platform, action_type, status, profile
       ▼
  EngagementClassifier
       │
       │  For each action:
       │    • Map to FunnelStage based on action_type
       │      - 'comment' / 'post'     → AWARENESS
       │      - 'reply'                → ENGAGEMENT (reply received)
       │      - 'like' / 'favorite'    → ENGAGEMENT
       │      - 'signup' / 'click'     → INTEREST
       │      - 'trial' / 'download'   → CONSIDERATION
       │    • Determine SignalDirection from status
       │      - 'completed', 'posted'  → POSITIVE
       │      - 'pending'              → NEUTRAL
       │      - 'failed', 'removed'    → NEGATIVE
       ▼
  CampaignStore.funnel_events table (new events inserted)


PHASE 3: COMPUTE (periodic cron — daily or on-demand)
──────────────────────────────────────────────────────

  FunnelEvents + Actions + Metrics
       │
       │  ROIAnalyticsEngine.compute(campaign_id)
       │
       │  1. Count events per FunnelStage
       │  2. Compute conversion rates between stages
       │  3. Aggregate engagement signals by platform
       │  4. Calculate engagement_rate = total_signals / total_posts
       │  5. Compute signal_ratio = positive / (positive + negative)
       │  6. Estimate reach from metrics (stars * multiplier, etc.)
       │
       ▼
  CampaignStore.campaign_performance table (summary row per campaign)


PHASE 4: PRESENT (on dashboard load or periodically)
─────────────────────────────────────────────────────

  CampaignPerformance + Metrics + FunnelEvents + CronJobLog + AIRecommendations
       │
       │  Dashboard.show_full_dashboard()
       │     - Campaigns panel → campaign_performance + campaigns
       │     - Metrics panel → metrics table with sparklines
       │     - Funnel panel → campaign_performance funnel rates
       │     - Cron panel → cron_job_log (today's runs)
       │     - Recommendations panel → ai_recommendations (latest per campaign)
       │     - Engagement panel → engagement_snapshots (per-platform breakdown)
       │
       ▼
  TUI / Web Dashboard / REST API
"""


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 3: SELF-HEALING LOOP — Observe → Analyze → Recommend → Execute → Measure
# ═══════════════════════════════════════════════════════════════════════════════

SELF_HEALING_LOOP = """
SELF-HEALING IMPROVEMENT LOOP
==============================

The closed feedback cycle that drives continuous marketing improvement.

                    ┌───────────────────┐
                    │     OBSERVE       │  ← Metrics, sheet data, engagement events
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │     ANALYZE       │  ← Compare vs targets, detect trends/anomalies
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │    RECOMMEND      │  ← Generate alternative strategies
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │     EXECUTE       │  ← Apply recommendation, adjust campaign
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │     MEASURE       │  ← Track outcomes, compute delta
                    └────────┬──────────┘
                             │
                             └──→ Back to OBSERVE (continuous)


ITERATION DETAILS
─────────────────

ITERATION 1: Brand Awareness
  OBSERVE:   Total impressions, posts published, subreddit reach
  ANALYZE:   Is post volume meeting daily targets (5+/day)?
             Which platforms have highest reach?
  RECOMMEND: Increase posting frequency on high-reach platforms
             Adjust content angles based on upvote patterns
  EXECUTE:   ExecutionEngine schedules additional posts
  MEASURE:   Δ impressions after 48h vs baseline

ITERATION 2: User Engagement
  OBSERVE:   Reply rate, comment depth, likes/favorites per post
  ANALYZE:   Which content types drive most engagement?
             Reply-to-post ratio trending up or down?
  RECOMMEND: Shift to question-based hooks for higher reply rate
             Engage in reply chains for depth
  EXECUTE:   HumanizationGate adjusts tone, ReplyMonitor activates
  MEASURE:   Δ reply rate, Δ avg reply depth, Δ unique interactors

ITERATION 3: Lead Generation
  OBSERVE:   Click-through rate, signups, DM inquiries
  ANALYZE:   Conversion funnel: awareness → interest → consideration
             Where is the biggest drop-off?
  RECOMMEND: Add soft CTAs, optimize link placement
             Pin high-performing content for longer visibility
  EXECUTE:   Update content pipeline with refined CTAs
  MEASURE:   Δ signup rate, Δ consideration-stage events

ITERATION 4: Revenue Impact
  OBSERVE:   Trial starts, paid conversions, referral traffic
  ANALYZE:   Cost per acquisition, ROI per campaign wave
             LTV of guerrilla-acquired users vs other channels
  RECOMMEND: Double down on highest-ROI platforms/angles
             Sunset underperforming tactics
  EXECUTE:   CampaignOptimizer reallocates budget/effort
  MEASURE:   Δ revenue, Δ CPA, overall ROI


SELF-HEALING SCHEDULE
─────────────────────

  ┌─────────────┬───────────┬───────────────────────┐
  │  Frequency  │  Action   │  Trigger              │
  ├─────────────┼───────────┼───────────────────────┤
  │  Every 6h   │  Digest   │  Cron: monitor-sync    │
  │  Daily 7am  │  Analysis │  Cron: daily-analysis  │
  │  Daily 8am  │  Report   │  Cron: daily-report    │
  │  Weekly Sun │  Strategy │  Cron: weekly-review   │
  │  On-demand  │  Execute  │  Agent command / API   │
  └─────────────┴───────────┴───────────────────────┘

  Each cycle:
    1. Pull latest sheet data → CampaignStore
    2. Collect external metrics (GitHub, npm)
    3. Run engagement classification → funnel_events
    4. Compute campaign_performance summary
    5. Compare vs targets → detect gaps (observe)
    6. Generate AI recommendations (analyze → recommend)
    7. If auto-approve: execute via existing tools (execute)
    8. Monitor post-execution deltas (measure)
"""


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 4: COMPONENT DEFINITIONS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class ROIAnalyticsConfig:
    """Configuration for the ROI analytics engine."""

    # Funnel stage weightings for engagement → revenue estimation
    funnel_weights: dict[str, float] = field(default_factory=lambda: {
        "awareness": 0.01,        # $0.01 per impression
        "engagement": 0.05,       # $0.05 per like/comment
        "interest": 0.25,         # $0.25 per click-through
        "consideration": 1.00,    # $1.00 per signup/trial
        "conversion": 50.00,      # $50.00 per paid conversion
        "retention": 25.00,       # $25.00 per retained user
    })

    # Platform multipliers (engagement quality per platform)
    platform_multipliers: dict[str, float] = field(default_factory=lambda: {
        "reddit": 1.0,        # Baseline
        "hn": 1.5,            # Higher quality developer engagement
        "twitter": 0.5,       # Lower depth per engagement
        "linkedin": 1.2,      # Professional network, higher LTV
        "discord": 0.8,       # Community engagement, variable quality
        "threads": 0.6,       # New platform, building
        "instagram": 0.4,     # Visual platform, lower intent
    })

    # Predictive model parameters
    forecast_window_days: int = 14
    min_data_points: int = 5
    trend_smoothing_factor: float = 0.3  # Exponential smoothing alpha

    # Self-healing thresholds
    engagement_decline_threshold: float = -0.15   # 15% decline triggers alarm
    funnel_dropoff_threshold: float = 0.40         # 40%+ drop-off triggers intervention
    min_confidence_for_auto_execute: float = 0.75  # Auto-execute if confidence >= 75%


@dataclass
class ComponentMap:
    """Maps every system component to its file location and responsibility."""

    # ── Ingestion Layer ──────────────────────────────────────────────────

    ingestor_sheet: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/sheet_sync.py",
        "class": "SheetSync",
        "responsibility": "Bidirectional Google Sheet ↔ SQLite sync",
        "methods": "sync_bidirectional(), pull_from_sheet(), push_to_sheet()",
    })

    ingestor_metrics: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/metrics.py",
        "class": "MetricsCollector",
        "responsibility": "Polls GitHub/npm/X APIs, stores in metrics table",
        "methods": "collect_all(), collect_github_metrics(), collect_npm_metrics()",
    })

    ingestor_replies: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/reply_monitor.py",
        "class": "ReplyMonitor",
        "responsibility": "Reddit inbox polling, reply classification, response generation",
        "methods": "run_monitor_cycle(), classify_reply(), generate_response()",
    })

    # ── Data Layer ───────────────────────────────────────────────────────

    store: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/store.py",
        "class": "CampaignStore",
        "responsibility": "SQLite-backed campaign, action, account, metric persistence",
        "methods": "create_campaign(), log_action(), insert_metric(), upsert_account()",
        "schema_file": "marketing/roi_arch.py",
        "schema_extensions": "SCHEMA_EXTENSIONS_SQL (funnel_events, engagement_snapshots, ai_recommendations, cron_job_log, campaign_performance)",
    })

    warmup: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/warmup.py",
        "class": "WarmupEngine",
        "responsibility": "10-phase Reddit account warmup scheduler",
        "methods": "tick_daily(), get_warmup_plan(), advance_phase(), is_account_ready()",
    })

    # ── Analytics Layer ──────────────────────────────────────────────────

    analytics_engine: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "ROIAnalyticsEngine",
        "responsibility": "Funnel computation, ROI attribution, performance aggregation",
        "methods": "compute_campaign_performance(), compute_funnel_rates(), estimate_roi(), detect_trends()",
        "dependencies": "CampaignStore, EngagementClassifier",
        "output_table": "campaign_performance",
    })

    classifier: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "EngagementClassifier",
        "responsibility": "Maps raw actions → funnel events with signal direction",
        "methods": "classify_action(), classify_batch(), build_engagement_snapshot()",
        "output_table": "funnel_events, engagement_snapshots",
    })

    predictor: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "PredictiveIndicator",
        "responsibility": "Simple time-series forecasts using moving averages and trend lines",
        "methods": "forecast_engagement(), forecast_signups(), detect_anomaly()",
        "inputs": "funnel_events, campaign_performance, metrics",
    })

    optimizer: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "CampaignOptimizer",
        "responsibility": "Generates alternative strategies based on performance gaps",
        "methods": "generate_alternatives(), recommend_platform_shift(), recommend_content_angle()",
        "output_table": "ai_recommendations",
    })

    # ── Self-Healing Loop ────────────────────────────────────────────────

    healing_loop: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "SelfHealingLoop",
        "responsibility": "Orchestrates observe → analyze → recommend → execute → measure cycle",
        "methods": "run_cycle(), run_weekly_review(), generate_strategy_report()",
        "schedule": "Every 6h (digest), daily (analysis), weekly (strategy)",
    })

    # ── Alert Engine ──────────────────────────────────────────────────────

    alert_engine: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/roi_arch.py",  # New class to be created
        "class": "AlertEngine",
        "responsibility": "Threshold-based alerting via gateway (Telegram, Slack, Discord)",
        "methods": "check_thresholds(), send_alert(), send_daily_briefing()",
        "alert_channels": "gateway (telegram, slack, discord, email)",
        "thresholds": "engagement_decline, funnel_dropoff, zero_activity_48h, signup_target_miss",
    })

    # ── Presentation Layer ───────────────────────────────────────────────

    dashboard_tui: dict[str, str] = field(default_factory=lambda: {
        "file": "marketing/dashboard.py",
        "class": "Dashboard",
        "responsibility": "CLI/TUI panels for campaign status, accounts, metrics, pending, daily report",
        "extension_needed": "Add: show_funnel_panel(), show_cron_panel(), show_recommendations_panel(), show_engagement_panel()",
    })

    dashboard_web_plugin: dict[str, str] = field(default_factory=lambda: {
        "file": "plugins/dashboard/",  # Needs creation
        "class": "MarketingROIWebDashboard",
        "responsibility": "React-based web dashboard with real-time updates",
        "endpoints": {
            "GET /api/roi/campaigns": "List all campaigns with performance summary",
            "GET /api/roi/campaign/<id>": "Detailed campaign metrics + funnel",
            "GET /api/roi/engagement": "Engagement metrics by platform",
            "GET /api/roi/cron": "Today's cron job status",
            "GET /api/roi/recommendations": "Active AI recommendations",
            "GET /api/roi/funnel": "Funnel conversion data",
            "GET /api/roi/forecast": "Predictive indicators",
        },
    })

    # ── Existing Cron Tools ──────────────────────────────────────────────

    cron_check: dict[str, str] = field(default_factory=lambda: {
        "file": "cron/hermes_marketing_check.py",
        "class": "main()",
        "responsibility": "Hourly marketing check, daily digest, sheet sync",
        "flags": "--daily-digest, --sheet-sync",
    })

    cron_scheduler: dict[str, str] = field(default_factory=lambda: {
        "file": "cron/scheduler.py",
        "responsibility": "Scheduled job management (add, list, pause, resume, remove)",
    })


@dataclass
class IntegrationPoints:
    """Every integration point between the ROI dashboard and existing Hermes infra."""

    integrations: dict[str, dict[str, str]] = field(default_factory=lambda: {
        "CampaignStore → Analytics": {
            "source": "marketing/store.py :: CampaignStore",
            "target": "marketing/roi_arch.py :: ROIAnalyticsEngine",
            "data": "campaigns, actions, metrics, accounts tables",
            "protocol": "Direct Python import (same process)",
        },
        "SheetSync → CampaignStore": {
            "source": "marketing/sheet_sync.py :: SheetSync",
            "target": "marketing/store.py :: CampaignStore",
            "data": "Action rows, status updates, content previews",
            "protocol": "CampaignStore methods (store.log_action, store.update_action)",
        },
        "Cron → SheetSync": {
            "source": "cron/hermes_marketing_check.py",
            "target": "marketing/sheet_sync.py :: SheetSync",
            "data": "--sheet-sync flag triggers sync_bidirectional()",
            "protocol": "CLI subprocess or direct Python call",
        },
        "Cron → Analytics": {
            "source": "cron/hermes_marketing_check.py",
            "target": "marketing/roi_arch.py :: ROIAnalyticsEngine",
            "data": "--daily-digest flag triggers compute + report",
            "protocol": "CLI subprocess or direct Python call",
        },
        "Cron → SelfHealingLoop": {
            "source": "cron/scheduler.py",
            "target": "marketing/roi_arch.py :: SelfHealingLoop",
            "data": "Scheduled job with --healing-loop flag",
            "protocol": "Cron job definition in cron/jobs.py",
        },
        "AlertEngine → Gateway": {
            "source": "marketing/roi_arch.py :: AlertEngine",
            "target": "gateway/run.py :: GatewayRunner",
            "data": "Alert messages delivered to Telegram/Slack/Discord",
            "protocol": "Gateway platform adapters (platforms/telegram.py, etc.)",
        },
        "Dashboard → CampaignStore": {
            "source": "marketing/dashboard.py :: Dashboard",
            "target": "marketing/store.py :: CampaignStore",
            "data": "Campaign, action, metric, funnel, recommendation queries",
            "protocol": "Direct CampaignStore method calls",
        },
        "Dashboard → Analytics": {
            "source": "marketing/dashboard.py :: Dashboard",
            "target": "marketing/roi_arch.py :: ROIAnalyticsEngine",
            "data": "Pre-computed campaign_performance table",
            "protocol": "Direct store queries (campaign_performance table)",
        },
        "Dashboard → TUI": {
            "source": "marketing/dashboard.py :: Dashboard",
            "target": "ui-tui/ (Ink-based TUI)",
            "data": "Printed panel output captured by TUI",
            "protocol": "stdout (same as existing CLI dashboard)",
        },
        "WebPlugin → REST API": {
            "source": "plugins/dashboard/ :: MarketingROIWebDashboard",
            "target": "REST API endpoints (TBD: FastAPI/Flask)",
            "data": "JSON campaign, funnel, engagement, cron, recommendations data",
            "protocol": "HTTP GET/POST, JSON response",
        },
        "Analytics → Recommendations": {
            "source": "marketing/roi_arch.py :: CampaignOptimizer",
            "target": "ai_recommendations table",
            "data": "Strategy recommendations with confidence scores",
            "protocol": "CampaignStore insert (ai_recommendations)",
        },
        "Planner → Analytics": {
            "source": "marketing/planner.py :: (recommendation engine)",
            "target": "marketing/roi_arch.py :: ROIAnalyticsEngine",
            "data": "Historical performance data for angle/platform recommendations",
            "protocol": "CampaignStore queries",
        },
        "ExecutionEngine → CampaignStore": {
            "source": "marketing/execution_engine.py :: ExecutionEngine",
            "target": "marketing/store.py :: CampaignStore",
            "data": "Wave execution results, action logging",
            "protocol": "store.log_action(), store.update_campaign_status()",
        },
        "WarmupEngine → CampaignStore": {
            "source": "marketing/warmup.py :: WarmupEngine",
            "target": "marketing/store.py :: CampaignStore (accounts table)",
            "data": "Account warmup phase, readiness status",
            "protocol": "store.upsert_account(), warmup.list_accounts()",
        },
    })


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 5: CLASS SHELLS — To be implemented
# ═══════════════════════════════════════════════════════════════════════════════


class EngagementClassifier:
    """Maps raw campaign actions → funnel events with signal direction.

    Pipeline:
        CampaignStore.get_actions(campaign_id)
            → For each action, determine FunnelStage + SignalDirection
            → Insert into funnel_events table
            → Aggregate into engagement_snapshots
    """

    STAGE_MAP: dict[str, str] = {
        # action_type → FunnelStage
        "post": "awareness",
        "comment": "awareness",
        "show hn": "awareness",
        "reply": "engagement",
        "reply_received": "engagement",
        "like": "engagement",
        "favorite": "engagement",
        "share": "engagement",
        "click": "interest",
        "visit": "interest",
        "follow": "interest",
        "signup": "consideration",
        "download": "consideration",
        "trial": "consideration",
        "purchase": "conversion",
        "subscribe": "conversion",
        "referral": "retention",
        "advocacy": "retention",
    }

    SIGNAL_MAP: dict[str, str] = {
        # status → SignalDirection
        "completed": "positive",
        "posted": "positive",
        "replied": "positive",
        "done": "positive",
        "pending": "neutral",
        "planned": "neutral",
        "draft": "neutral",
        "failed": "negative",
        "removed": "negative",
        "flagged": "negative",
    }

    def classify_action(self, action: dict, store: CampaignStore) -> int | None:
        """Classify a single action → funnel_event.

        Returns funnel_event ID or None if classification fails
        (missing action_id or campaign_id).
        """
        action_id = action.get("id")
        campaign_id = action.get("campaign_id")
        if not action_id or not campaign_id:
            return None

        # Skip if a funnel_event already exists for this action
        existing = store._fetchone(
            "SELECT id FROM funnel_events WHERE action_id = ?",
            (action_id,),
        )
        if existing:
            return existing["id"]

        event_type = self.STAGE_MAP.get(action.get("action_type", ""), "awareness")
        signal_direction = self.SIGNAL_MAP.get(action.get("status", ""), "neutral")

        # Determine engagement_type if action_type matches an EngagementType value
        valid_types = {e.value for e in EngagementType}
        engagement_type = action.get("action_type") if action.get("action_type") in valid_types else None

        now = datetime.now(timezone.utc).isoformat()

        cur = store._execute(
            """INSERT INTO funnel_events
               (campaign_id, action_id, platform, event_type, engagement_type,
                signal_direction, source_url, profile_name, metric_value,
                metadata_json, occurred_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                campaign_id,
                action_id,
                action.get("platform", ""),
                event_type,
                engagement_type,
                signal_direction,
                action.get("target_url"),
                action.get("profile_name"),
                1.0,
                "{}",
                action.get("timestamp", now),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def classify_batch(self, campaign_id: str, store: CampaignStore) -> dict:
        """Classify ALL actions for *campaign_id* that don't have funnel events yet.

        Returns stats dict with keys: classified, skipped, errors.
        """
        actions = store.get_actions(campaign_id)
        stats: dict[str, int] = {"classified": 0, "skipped": 0, "errors": 0}

        for action in actions:
            action_id = action.get("id")
            if not action_id or not action.get("campaign_id"):
                stats["errors"] += 1
                continue

            # Check upfront for existing funnel_event to distinguish skipped
            existing = store._fetchone(
                "SELECT id FROM funnel_events WHERE action_id = ?",
                (action_id,),
            )
            if existing:
                stats["skipped"] += 1
                continue

            try:
                event_id = self.classify_action(action, store)
                if event_id is not None:
                    stats["classified"] += 1
                else:
                    stats["errors"] += 1
            except Exception:
                stats["errors"] += 1

        return stats

    def build_engagement_snapshot(
        self,
        campaign_id: str,
        platform: str,
        snapshot_date: str,
        store: CampaignStore,
    ) -> dict:
        """Aggregate funnel_events into an engagement_snapshot row.

        Returns the full snapshot dict as stored in the database.
        """
        events = store._fetchall(
            "SELECT * FROM funnel_events"
            " WHERE campaign_id = ? AND platform = ? AND occurred_at <= ?",
            (campaign_id, platform, snapshot_date),
        )

        now = datetime.now(timezone.utc).isoformat()

        # Count by stage and signal
        total_posts = 0
        total_comments = 0
        total_replies = 0
        signal_counts: dict[str, int] = {"positive": 0, "neutral": 0, "negative": 0}
        unique_interactors: set[str] = set()

        for ev in events:
            stage = ev.get("event_type", "")
            signal = ev.get("signal_direction", "neutral")

            if signal in signal_counts:
                signal_counts[signal] += 1

            if stage == "awareness":
                total_posts += 1
            elif stage == "engagement":
                etype = ev.get("engagement_type")
                if etype in ("reply", "reply_received"):
                    total_replies += 1
                elif etype == "comment":
                    total_comments += 1
                else:
                    total_comments += 1

            pname = ev.get("profile_name")
            if pname:
                unique_interactors.add(pname)

        total_signals = len(events)
        reply_rate = total_replies / total_posts if total_posts > 0 else 0.0

        snapshot_id = store.insert_engagement_snapshot(
            campaign_id=campaign_id,
            platform=platform,
            snapshot_date=snapshot_date,
            collected_at=now,
            total_posts=total_posts,
            total_comments=total_comments,
            total_replies=total_replies,
            positive_signals=signal_counts["positive"],
            neutral_signals=signal_counts["neutral"],
            negative_signals=signal_counts["negative"],
            avg_reply_depth=0.0,
            unique_interactors=len(unique_interactors),
            reply_rate=reply_rate,
        )
        result = store._fetchone(
            "SELECT * FROM engagement_snapshots WHERE id = ?",
            (snapshot_id,),
        )
        return result or {}


class ROIAnalyticsEngine:
    """Core analytics engine — computes KPIs, funnel rates, ROI estimates.

    Key computations:
        1. Count events per FunnelStage per campaign per period
        2. Conversion rates: stage_i → stage_{i+1}
        3. Estimated ROI: sum(funnel_weights * event_count) per campaign
        4. Trend detection: compare current period vs previous period
        5. Platform effectiveness: engagement rate per platform
    """

    _DECAY_LAMBDA: float = math.log(2) / 14  # Half-life of 14 days

    # ── Time-decay multi-touch attribution ────────────────────────────────────

    def compute_attribution(
        self, campaign_id: str, store: "CampaignStore",
    ) -> dict[str, float]:
        """Time-decay weighted multi-touch attribution.

        For each conversion event, walks back through preceding funnel events
        and assigns partial credit with exponential time decay:

            weight = exp(-λ * days_since_event)

        where λ = ln(2) / 14 (half-life of 14 days).

        Returns a dict mapping ``{platform: attributed_value}``.
        """
        events = store.get_funnel_events(campaign_id)
        conversions = [e for e in events if e.get("event_type") == "conversion"]
        if not conversions:
            return {}

        attribution: dict[str, float] = defaultdict(float)

        for conv in conversions:
            conv_str = conv.get("occurred_at", "")
            try:
                conv_time = datetime.fromisoformat(conv_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue

            preceding = [
                e for e in events
                if e.get("occurred_at", "") < conv_str
            ]

            for event in preceding:
                ev_str = event.get("occurred_at", "")
                try:
                    ev_time = datetime.fromisoformat(ev_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue

                days_ago = (conv_time - ev_time).total_seconds() / 86400.0
                if days_ago < 0:
                    continue

                weight = math.exp(-self._DECAY_LAMBDA * days_ago)
                platform = event.get("platform", "unknown")
                cfg = ROIAnalyticsConfig()
                stage_weight = cfg.funnel_weights.get(
                    event.get("event_type", "awareness"), 0.01,
                )
                attribution[platform] += weight * stage_weight

        return dict(attribution)

    def compute_total_cost(
        self, campaign_id: str, duckdb_store: Any = None,
    ) -> float:
        """Compute total cost for a campaign from DuckDB costs table.

        Args:
            campaign_id: Campaign identifier.
            duckdb_store: Optional DuckDBStore instance. If None, returns 0.

        Returns:
            Total cost as a float.
        """
        if duckdb_store is None:
            return 0.0
        try:
            rows = duckdb_store.query(
                "SELECT COALESCE(SUM(total_cost), 0) as total FROM costs"
                " WHERE campaign_id = ?",
                [campaign_id],
            )
            return float(rows[0]["total"]) if rows else 0.0
        except Exception:
            return 0.0

    FUNNEL_ORDER: list[str] = [
        "awareness",
        "engagement",
        "interest",
        "consideration",
        "conversion",
        "retention",
    ]

    @staticmethod
    def compute_conversion_rate(
        from_stage: int, to_stage: int, stage_counts: dict[str, int]
    ) -> float:
        """Compute conversion rate from one funnel stage to the next."""
        if from_stage <= 0 or from_stage > len(ROIAnalyticsEngine.FUNNEL_ORDER):
            return 0.0
        prev_key = ROIAnalyticsEngine.FUNNEL_ORDER[from_stage - 1]
        curr_key = ROIAnalyticsEngine.FUNNEL_ORDER[from_stage]
        prev_count = stage_counts.get(prev_key, 0)
        if prev_count == 0:
            return 0.0
        curr_count = stage_counts.get(curr_key, 0)
        return min(1.0, curr_count / prev_count)

    def compute_campaign_performance(
        self, campaign_id: str, store: "CampaignStore",
        duckdb_store: Any = None,
    ) -> dict | None:
        """Main entry point — orchestrate full campaign performance computation.

        1. Look up the campaign; return ``None`` if not found.
        2. Compute engagement metrics, funnel rates, reach, ROI, and quality score.
        3. Persist to the ``campaign_performance`` table via *store*.
        4. Return the full performance dict.

        Args:
            duckdb_store: Optional DuckDBStore for cost data. Pass ``None``
                to skip cost-based ROI (uses funnel-only estimate).
        """
        campaign = store.get_campaign(campaign_id)
        if campaign is None:
            return None

        engagement = self.compute_engagement_metrics(campaign_id, store)
        funnel = self.compute_funnel_rates(campaign_id, store)
        reach = self.estimate_reach(campaign_id, store)
        roi = self.estimate_roi(campaign_id, store, duckdb_store=duckdb_store)
        qscore = compute_quality_score_from_campaign(store, campaign_id)

        now = datetime.now(timezone.utc).isoformat()

        perf_dict: dict[str, Any] = {
            "campaign_id": campaign_id,
            "computed_at": now,
            # Funnel counts
            "awareness_count": funnel.get("awareness_count", 0),
            "engagement_count": funnel.get("engagement_count", 0),
            "interest_count": funnel.get("interest_count", 0),
            "consideration_count": funnel.get("consideration_count", 0),
            "conversion_count": funnel.get("conversion_count", 0),
            "retention_count": funnel.get("retention_count", 0),
            # Conversion rates
            "awareness_to_engagement": funnel.get("awareness_to_engagement", 0.0),
            "engagement_to_interest": funnel.get("engagement_to_interest", 0.0),
            "interest_to_consideration": funnel.get("interest_to_consideration", 0.0),
            "consideration_to_conversion": funnel.get("consideration_to_conversion", 0.0),
            "conversion_to_retention": funnel.get("conversion_to_retention", 0.0),
            # Engagement metrics
            "total_signals": engagement.get("total_signals", 0),
            "positive_signals": engagement.get("positive_count", 0),
            "negative_signals": engagement.get("negative_count", 0),
            "neutral_count": engagement.get("neutral_count", 0),
            "signal_ratio": engagement.get("signal_ratio", 0.0),
            "estimated_reach": reach,
            "engagement_rate": engagement.get("engagement_rate", 0.0),
            "quality_score": qscore,
            # ROI estimate (extra context)
            "roi_estimated": roi.get("roi_estimated", 0.0),
            "confidence": roi.get("confidence", "low"),
        }

        store.insert_campaign_performance(**perf_dict)

        return perf_dict

    def compute_engagement_metrics(
        self, campaign_id: str, store: "CampaignStore"
    ) -> dict:
        """Compute engagement signal metrics for a campaign.

        Counts funnel events by signal direction and computes:
        - total_signals: total funnel events
        - positive_count / negative_count / neutral_count: by signal direction
        - signal_ratio: positive / (positive + negative)
        - engagement_rate: engagement events / awareness events

        Returns a dict with all computed metrics.
        """
        events = store.get_funnel_events(campaign_id)

        positive_count = sum(
            1 for e in events if e.get("signal_direction") == "positive"
        )
        negative_count = sum(
            1 for e in events if e.get("signal_direction") == "negative"
        )
        neutral_count = sum(
            1 for e in events if e.get("signal_direction") == "neutral"
        )

        total_signals = len(events)
        pos_neg_total = positive_count + negative_count
        signal_ratio = (
            positive_count / pos_neg_total if pos_neg_total > 0 else 0.0
        )

        awareness_count = sum(
            1 for e in events if e.get("event_type") == "awareness"
        )
        engagement_count = sum(
            1 for e in events if e.get("event_type") == "engagement"
        )
        engagement_rate = (
            engagement_count / awareness_count if awareness_count > 0 else 0.0
        )

        return {
            "total_signals": total_signals,
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
            "signal_ratio": signal_ratio,
            "engagement_rate": engagement_rate,
        }

    def compute_funnel_rates(
        self, campaign_id: str, store: "CampaignStore"
    ) -> dict:
        """Compute per-stage funnel counts and conversion rates.

        Counts funnel events by *event_type* (FunnelStage values) and computes
        conversion rates between each consecutive stage pair.

        Returns a dict containing all stage counts and conversion rates.
        """
        events = store.get_funnel_events(campaign_id)

        # Count per funnel stage
        stage_counts: dict[str, int] = {}
        for stage in self.FUNNEL_ORDER:
            stage_counts[stage] = sum(
                1 for e in events if e.get("event_type") == stage
            )

        result: dict[str, Any] = {}
        for stage in self.FUNNEL_ORDER:
            result[f"{stage}_count"] = stage_counts[stage]

        # Conversion rates between consecutive stages
        conversions = [
            ("awareness", "engagement"),
            ("engagement", "interest"),
            ("interest", "consideration"),
            ("consideration", "conversion"),
            ("conversion", "retention"),
        ]

        for from_stage, to_stage in conversions:
            prev_count = stage_counts.get(from_stage, 0)
            curr_count = stage_counts.get(to_stage, 0)
            rate = min(1.0, curr_count / prev_count) if prev_count > 0 else 0.0
            result[f"{from_stage}_to_{to_stage}"] = rate

        return result

    def estimate_reach(
        self, campaign_id: str, store: "CampaignStore"
    ) -> int:
        """Estimate total reach for a campaign.

        Uses a conservative heuristic:
        - Each positive signal ≈ 100 reach units
        - Each neutral signal ≈ 50 reach units
        """
        events = store.get_funnel_events(campaign_id)

        positive = sum(
            1 for e in events if e.get("signal_direction") == "positive"
        )
        neutral = sum(
            1 for e in events if e.get("signal_direction") == "neutral"
        )

        return (positive * 100) + (neutral * 50)

    def estimate_roi(
        self,
        campaign_id: str,
        store: "CampaignStore",
        duckdb_store: Any = None,
    ) -> dict:
        """Estimate ROI for a guerrilla marketing campaign.

        Uses time-decay multi-touch attribution (via compute_attribution)
        and cost data from DuckDB (via compute_total_cost). Falls back to
        partial estimates when data is unavailable.

        Confidence:
            - ``"high"`` when conversions exist, attribution computed, and cost > 0
            - ``"medium"`` when conversions exist but cost is unknown
            - ``"low"`` when no conversions exist
        """
        events = store.get_funnel_events(campaign_id)

        conversion_count = sum(
            1 for e in events if e.get("event_type") == "conversion"
        )
        engagement_count = sum(
            1 for e in events if e.get("event_type") == "engagement"
        )

        engagement_to_conversion_rate = (
            min(1.0, conversion_count / engagement_count)
            if engagement_count > 0
            else 0.0
        )

        # Compute time-decay attribution
        attribution = self.compute_attribution(campaign_id, store)
        total_value = sum(attribution.values())

        # Compute total cost from DuckDB
        total_cost = self.compute_total_cost(campaign_id, duckdb_store)

        # Calculate ROI
        if total_cost > 0:
            roi_estimated = (total_value - total_cost) / total_cost
        else:
            roi_estimated = total_value  # No cost = pure return

        # Confidence level
        if conversion_count > 0 and total_cost > 0 and total_value > 0:
            confidence = "high"
        elif conversion_count > 0:
            confidence = "medium"
        else:
            confidence = "low"

        return {
            "conversion_count": conversion_count,
            "engagement_to_conversion_rate": engagement_to_conversion_rate,
            "attribution": attribution,
            "total_value": round(total_value, 2),
            "total_cost": round(total_cost, 2),
            "roi_estimated": round(roi_estimated, 4),
            "confidence": confidence,
        }


class PredictiveIndicator:
    """Time-series forecasting for engagement metrics.

    Provides statistical forecasting methods: moving average, exponential
    smoothing, linear trend analysis, anomaly detection via z-score, and a
    full engagement-forecast pipeline that combines all techniques.

    All methods are ``@staticmethod`` so callers never need to instantiate.
    """

    @staticmethod
    def moving_average(series: list[float], window: int = 7) -> list[float]:
        """Centered moving average with partial-window handling at edges.

        For interior points the window is symmetric.  At the start, fewer
        left-side points are available, so the window shrinks on the left;
        at the end it shrinks on the right.  If the series is shorter than
        *window* it is returned unchanged.
        """
        n = len(series)
        if n < window:
            return list(series)

        half = window // 2
        result: list[float] = []
        for i in range(n):
            left = max(0, i - half)
            right = min(n, i + half + 1)
            chunk = series[left:right]
            avg = sum(chunk) / len(chunk)
            result.append(round(avg, 2))
        return result

    @staticmethod
    def exponential_smoothing(series: list[float], alpha: float = 0.3) -> list[float]:
        """Single exponential smoothing.

        ``result[0] = series[0]``.
        ``result[i] = alpha * series[i] + (1 - alpha) * result[i - 1]``.

        Returns ``[]`` when *series* is empty.
        """
        if not series:
            return []

        result: list[float] = [series[0]]
        for i in range(1, len(series)):
            smoothed = alpha * series[i] + (1 - alpha) * result[i - 1]
            result.append(round(smoothed, 2))
        return result

    @staticmethod
    def linear_trend(series: list[float]) -> dict:
        """Simple linear regression via least-squares.

        Returns *slope*, *intercept*, *r_squared*, and *direction*
        (``"increasing"`` / ``"decreasing"`` / ``"stable"``).

        When fewer than 2 data points are given, *slope* / *r_squared* are
        ``0.0`` and *direction* is ``"stable"``.
        """
        n = len(series)
        if n < 2:
            return {
                "slope": 0.0,
                "intercept": series[0] if series else 0.0,
                "r_squared": 0.0,
                "direction": "stable",
            }

        x_vals = list(range(n))
        x_mean = sum(x_vals) / n
        y_mean = sum(series) / n

        # Sxx, Syy, Sxy for slope and r²
        sxx = sum((x - x_mean) ** 2 for x in x_vals)
        syy = sum((y - y_mean) ** 2 for y in series)
        sxy = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, series))

        slope = sxy / sxx if sxx != 0 else 0.0
        intercept = y_mean - slope * x_mean
        r_squared = (sxy ** 2) / (sxx * syy) if sxx * syy != 0 else 0.0

        # Clamp r_squared to [0, 1] to account for floating point drift
        r_squared = max(0.0, min(1.0, r_squared))

        if slope > 0.01:
            direction = "increasing"
        elif slope < -0.01:
            direction = "decreasing"
        else:
            direction = "stable"

        return {
            "slope": round(slope, 4),
            "intercept": round(intercept, 4),
            "r_squared": round(r_squared, 4),
            "direction": direction,
        }

    @staticmethod
    def detect_anomaly(series: list[float], threshold: float = 2.0) -> list[int]:
        """Z-score anomaly detection.

        Returns the **indices** of points whose absolute z-score exceeds
        *threshold*.  Returns ``[]`` when *series* has fewer than 3 points
        or when ``std == 0`` (uniform data).
        """
        n = len(series)
        if n < 3:
            return []

        mean = sum(series) / n
        variance = sum((x - mean) ** 2 for x in series) / n
        std = math.sqrt(variance)

        if std == 0.0:
            return []

        return [
            i for i, x in enumerate(series)
            if abs(x - mean) / std > threshold
        ]

    @staticmethod
    def forecast_engagement(
        campaign_id: str,
        days: int = 14,
        store: Any = None,
    ) -> dict:
        """Full forecast pipeline for a single campaign.

        1. Fetches funnel events for the last 90 days.
        2. Groups by calendar date and separates awareness vs. engagement.
        3. Computes a daily engagement rate (engagement / awareness).
        4. Smooths the daily rate with a 7-day centered moving average.
        5. Fits a linear trend to the smoothed series.
        6. Extrapolates the trend line *days* into the future.
        7. Applies exponential smoothing as an alternative forecast.
        8. Detects z-score anomalies in the *original* (unsmoothed) series.

        Returns a structured dict described in the method docstring.
        Returns an error dict when *store* is ``None`` or no data exists.
        """
        if store is None:
            return {
                "campaign_id": campaign_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "error": "No store provided",
                "confidence": "low",
            }

        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        events = store.get_funnel_events(campaign_id, since=cutoff)

        if not events:
            return {
                "campaign_id": campaign_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "error": "No data available",
                "confidence": "low",
            }

        # ── Group by date ──────────────────────────────────────────────
        daily_engagement: dict[str, int] = defaultdict(int)
        daily_awareness: dict[str, int] = defaultdict(int)

        for ev in events:
            occurred = ev.get("occurred_at", "")
            # Extract date part from ISO timestamp
            date_key = occurred[:10] if occurred else ""
            if not date_key:
                continue
            event_type = ev.get("event_type", "")
            if event_type == "engagement":
                daily_engagement[date_key] += 1
            elif event_type == "awareness":
                daily_awareness[date_key] += 1

        if not daily_awareness:
            return {
                "campaign_id": campaign_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "error": "No awareness events to compute rate",
                "confidence": "low",
            }

        # ── Build sorted daily engagement rates ────────────────────────
        all_dates = sorted(set(daily_engagement.keys()) | set(daily_awareness.keys()))
        raw_rates: list[float] = []
        for d in all_dates:
            eng = daily_engagement.get(d, 0)
            awr = daily_awareness.get(d, 0)
            rate = eng / awr if awr > 0 else 0.0
            raw_rates.append(round(rate, 4))

        # ── Apply forecasts / analysis ─────────────────────────────────
        smoothed = PredictiveIndicator.moving_average(raw_rates, window=7)
        trend = PredictiveIndicator.linear_trend(smoothed)

        n_hist = len(smoothed)
        slope = trend["slope"]
        intercept = trend["intercept"]

        # Trend forecast: y = intercept + slope * x
        # x = 0 … n_hist-1 for historical, n_hist … n_hist+days-1 for future
        trend_forecast: list[float] = []
        for fi in range(days):
            x = n_hist + fi
            val = intercept + slope * x
            trend_forecast.append(round(max(0.0, val), 4))

        # Alternative forecast via exponential smoothing
        smoothed_fc = PredictiveIndicator.exponential_smoothing(raw_rates, alpha=0.3)
        # Extend with the last smoothed value as flat extrapolation
        last_smooth = smoothed_fc[-1] if smoothed_fc else 0.0
        alt_forecast: list[float] = [
            round(last_smooth, 4) for _ in range(days)
        ]

        # ── Anomaly detection on raw rates ─────────────────────────────
        anomaly_indices = PredictiveIndicator.detect_anomaly(raw_rates)
        anomaly_dates = [all_dates[i] for i in anomaly_indices if i < len(all_dates)]
        anomaly_values = [raw_rates[i] for i in anomaly_indices if i < len(raw_rates)]

        # ── Confidence level ───────────────────────────────────────────
        data_points = len(raw_rates)
        if data_points < 7:
            confidence = "low"
        elif data_points < 21:
            confidence = "medium"
        else:
            confidence = "high"

        generated_at = datetime.now(timezone.utc).isoformat()

        return {
            "campaign_id": campaign_id,
            "generated_at": generated_at,
            "historical": {
                "dates": all_dates,
                "engagement_rates": raw_rates,
                "smoothed_rates": smoothed,
            },
            "forecast": {
                "dates": [
                    (datetime.now(timezone.utc) + timedelta(days=d + 1)).strftime("%Y-%m-%d")
                    for d in range(days)
                ],
                "trend_forecast": trend_forecast,
                "smoothed_forecast": alt_forecast,
            },
            "trend": {
                "slope": trend["slope"],
                "direction": trend["direction"],
                "r_squared": trend["r_squared"],
            },
            "anomalies": {
                "indices": anomaly_indices,
                "dates": anomaly_dates,
                "values": anomaly_values,
            },
            "confidence": confidence,
        }


class CampaignOptimizer:
    """Generates alternative strategies based on performance data.

    Strategy types:
        - PLATFORM_SHIFT: Reallocate effort to higher-ROI platforms
        - CONTENT_ANGLE: Adjust content to better-performing angles
        - TIMING_OPTIMIZATION: Change posting schedule
        - ACCOUNT_ROTATION: Switch to better-warmed accounts
        - TONE_ADJUSTMENT: Modify humanization parameters

    Each recommendation is stored in ai_recommendations table with:
        - recommendation_type, title, description, rationale
        - expected_impact (quantified prediction)
        - confidence (0.0 - 1.0)
        - metrics_before (snapshot of KPIs before execution)
        - metrics_after (filled after measurement phase)
    """

    STRATEGY_TYPES = [
        "platform_shift",
        "content_angle",
        "timing_optimization",
        "account_rotation",
        "tone_adjustment",
        "frequency_change",
        "target_expansion",
        "reply_strategy",
    ]


class SelfHealingLoop:
    """Orchestrates the complete observe → analyze → recommend → execute → measure cycle.

    Lifecycle:
        1. observe() — Pull latest data from all sources
        2. analyze() — Compute KPIs, detect gaps, compare vs targets
        3. recommend() — Generate ranked list of improvement actions
        4. execute() — Apply top recommendations (auto or manual approval)
        5. measure() — Track outcome deltas, close the feedback loop

    Scheduling (via cron):
        - DIGEST (every 6h): Quick health check, observe + analyze only
        - DAILY (7am): Full digest + recommend
        - WEEKLY (Sunday 9am): Full loop + strategy generation
    """

    CYCLE_TYPES = {
        "digest": {
            "frequency": "every 6 hours",
            "phases": ["observe", "analyze"],
            "output": "Summary metrics + alert check",
        },
        "daily": {
            "frequency": "every day at 07:00 UTC",
            "phases": ["observe", "analyze", "recommend"],
            "output": "Daily report + recommendations queue",
        },
        "weekly": {
            "frequency": "every Sunday at 09:00 UTC",
            "phases": ["observe", "analyze", "recommend", "execute", "measure"],
            "output": "Strategy report + executed improvements + measured deltas",
        },
    }


class AlertEngine:
    """Threshold-based alerting — pushes critical signals to gateway platforms.

    Alert thresholds (configurable via ROIAnalyticsConfig):
        - ZERO_ACTIVITY_48H: No actions logged in 48 hours (P1 alert)
        - ENGAGEMENT_DECLINE: >15% drop in engagement week-over-week (P2)
        - FUNNEL_DROPOFF: >40% drop between consecutive funnel stages (P2)
        - SIGNUP_TARGET_MISS: Below daily signup target for 3+ days (P2)
        - ACCOUNT_STALLED: Warmup account stuck in same phase >2x duration (P3)
        - SHEET_SYNC_FAILURE: Sheet sync returned errors (P1)
        - RECOMMENDATION_READY: High-confidence recommendation awaiting review (P3)

    Delivery:
        - P1: Immediate push via gateway (Telegram bot DM)
        - P2: Grouped into daily briefing
        - P3: Included in weekly digest
    """

    PRIORITY_MAP = {
        "P1": "immediate",
        "P2": "daily",
        "P3": "weekly",
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  PART 6: IMPLEMENTATION PLAN
# ═══════════════════════════════════════════════════════════════════════════════

IMPLEMENTATION_PLAN = """
IMPLEMENTATION PRIORITIES (PHASED)
===================================

PHASE 1: Schema + Data Foundation (Day 1-2)
───────────────────────────────────────────
[P0] 1. Run SCHEMA_EXTENSIONS_SQL to add new tables to campaigns.db
[P0] 2. Implement EngagementClassifier — map existing actions → funnel events
[P1] 3. Backfill funnel_events from historical actions table
[P1] 4. Add cron_job_log table + logging in hermes_marketing_check.py

Files to create:
  - marketing/roi_arch.py (this file — all class shells)
Files to modify:
  - marketing/store.py (add new table DDL + query methods for new tables)
  - cron/hermes_marketing_check.py (add cron_job_log writes)

PHASE 2: Analytics Engine (Day 3-4)
────────────────────────────────────
[P0] 1. Implement ROIAnalyticsEngine.compute_campaign_performance()
[P0] 2. Implement PredictiveIndicator (moving avg, trend, anomaly detection)
[P1] 3. Build campaign_performance computation cron job
[P2] 4. Add engagement_snapshots aggregation

Files to modify:
  - marketing/roi_arch.py (implement ROIAnalyticsEngine, PredictiveIndicator)
  - cron/jobs.py (add daily-analysis cron job)
  - cron/hermes_marketing_check.py (add --compute flag)

PHASE 3: Self-Healing Loop (Day 5-6)
─────────────────────────────────────
[P0] 1. Implement CampaignOptimizer — generate alternative strategies
[P0] 2. Implement SelfHealingLoop — orchestration of observe→analyze→recommend→execute→measure
[P1] 3. Wire weekly-review cron to run full healing cycle
[P2] 4. Track recommendation outcomes (metrics_before → metrics_after)

Files to modify:
  - marketing/roi_arch.py (implement CampaignOptimizer, SelfHealingLoop)
  - marketing/config.py (add self-healing config section)
  - cron/jobs.py (add weekly-review cron job)

PHASE 4: Alert Engine (Day 7)
──────────────────────────────
[P0] 1. Implement AlertEngine threshold checks
[P0] 2. Build gateway notification delivery (Telegram DM for P1)
[P1] 3. Implement daily briefing (grouped P2 alerts)
[P2] 4. Build weekly digest (P3 alerts + performance summary)

Files to create:
  - marketing/alert_engine.py (or inline in roi_arch.py)
Files to modify:
  - gateway/run.py (add /alert-status command)
  - hermes_cli/commands.py (if needed for alert commands)

PHASE 5: Dashboard Extensions (Day 8-10)
─────────────────────────────────────────
[P0] 1. Extend Dashboard class with funnel, cron, recommendations panels
[P0] 2. Build REST API endpoints for ROI data
[P1] 3. Build web dashboard plugin (React)
[P2] 4. Add live-update via WebSocket for running campaigns

Files to modify:
  - marketing/dashboard.py (add show_funnel_panel, show_cron_panel, etc.)
  - plugins/dashboard/ (create web dashboard)
  - Add REST API server (FastAPI/Flask in plugins/ or standalone)
"""

# ── Quick-reference: action_to_funnel mapping (used by EngagementClassifier) ─

ACTION_TYPE_TO_FUNNEL: dict[str, str] = {
    # Publishing actions → Awareness
    "post": "awareness",
    "show hn": "awareness",
    "comment": "awareness",
    "share": "awareness",
    "tweet": "awareness",
    "thread": "awareness",

    # Response actions → Engagement
    "reply": "engagement",
    "reply_received": "engagement",
    "like": "engagement",
    "favorite": "engagement",
    "upvote": "engagement",
    "save": "engagement",

    # Interest signals
    "click": "interest",
    "visit": "interest",
    "follow": "interest",

    # Consideration signals
    "signup": "consideration",
    "download": "consideration",
    "trial": "consideration",
    "demo": "consideration",

    # Conversion signals
    "purchase": "conversion",
    "subscribe": "conversion",
    "payment": "conversion",

    # Retention signals
    "referral": "retention",
    "advocacy": "retention",
    "testimonial": "retention",
}

# ── Default engagement quality scores ──────────────────────────────────────

ENGAGEMENT_QUALITY: dict[str, float] = {
    # Passive signals (low engagement value)
    "view": 0.1,
    "impression": 0.05,
    "reach": 0.1,

    # Low-effort signals
    "upvote": 0.3,
    "like": 0.3,
    "save": 0.4,
    "favorite": 0.4,

    # Medium-effort signals
    "comment": 1.0,
    "reply": 1.5,
    "share": 1.5,

    # High-intent signals
    "follow": 2.0,
    "click": 2.0,
    "mention": 2.5,
    "dm": 3.0,

    # Conversion signals
    "signup": 5.0,
    "download": 3.0,
    "trial": 5.0,
    "purchase": 10.0,
    "referral": 8.0,
}
