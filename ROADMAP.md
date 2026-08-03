# SYNTARO Roadmap

## Overview

This roadmap covers SYNTARO development from MVP through enterprise. It evolves based on user feedback, market conditions, and technical progress.

## Legend

- ✅ **Done** — shipped and operational
- 🔜 **In Progress** — actively being built
- 📋 **Planned** — specced and queued
- 💡 **Idea** — exploring, not committed

---

## Phase 1: MVP (Current) ✅

Core functionality: label → fix → PR.

### Shipped
- ✅ GitHub webhook receiver (Express, signature verified)
- ✅ Triage pipeline — classify issue type before fixing
- ✅ OpenCode agent integration — investigation → fix → test → PR
- ✅ Sandbox support — Docker (local) + E2B (cloud)
- ✅ Verification gate — run tests before opening PR
- ✅ Retry logic — configurable delays, max 4 retries, DLQ support
- ✅ BullMQ queue — Redis-backed job processing
- ✅ Issue comment progress updates
- ✅ Multi-platform support — GitHub, GitLab, Bitbucket, Linear, Jira
- ✅ Rate limiting — per-account + per-repo token bucket
- ✅ Sentry error tracking
- ✅ Health endpoint (`/health`)
- ✅ Dead-letter queue for failed jobs
- ✅ Webhook retry system — exponential backoff with polling
- ✅ Slack/Telegram/WhatsApp multi-channel notifications
- ✅ Admin dashboard with queue monitoring
- ✅ E2B sandbox provider
- ✅ Basic billing usage tracking (Redis-based)
- ✅ Self-hosted deployment (Docker Compose)

---

## Phase 2: SaaS Launch (Next) 🔜

Hosted service with dashboard, billing, and free tier.

### In Progress
- 🔜 Stripe billing integration — Solo ($49/mo), Team ($149/mo)
- 🔜 Cloud Free tier — 10 fixes/mo, no credit card
- 🔜 Usage metering — monthly fix limits per plan
- 🔜 Zero-downtime migrations
- 🔜 GitHub Marketplace listing
- 🔜 Cloud deployment — Fly.io / Railway

### Planned
- 📋 Usage dashboard — run history, diff viewer, analytics
- 📋 Audit log — structured fix records
- 📋 Free tier PQL — convert at limit (10 fixes/month cap, hard stop)
- 📋 Data Processing Agreement (DPA) — "Won't Train" guarantee
- 📋 RapidAPI marketplace listing
- 📋 Team plan (SSO/SAML, team roles)
- 📋 Enterprise tier (custom pricing, VPC, SLA)

---

## Phase 3: Growth 📋

Scale adoption through virality and ecosystem.

### Product
- 📋 Viral PR footer — "Fixed by SYNTARO" with shareable run page
- 📋 MCP server for agent-to-agent discovery
- 📋 One-click GitHub OAuth
- 📋 Comparison pages — "SYNTARO vs Plip", "SYNTARO vs Devin"
- 📋 Shareable run pages (public/expiring links)
- 📋 SOC2 readiness
- 📋 SAST pipeline (semgrep/CodeQL) integration

### Growth
- 📋 Viral PR footer
- 📋 Product Hunt launch
- 📋 Hacker News launch
- 📋 Competitor comparison pages
- 📋 Technical blog: "How we fixed 10,000 issues with AI"

---

## Phase 4: Monetization 💡

### Planned
- 💡 Usage-based overages beyond plan limits
- 💡 Self-host → Cloud upgrade paths
- 💡 Enterprise: custom pricing, dedicated infra, SLAs
- 💡 Partner integrations
- 💡 OpenClaw multi-channel: Slack/Telegram command interface

---

## Key Milestones

| Milestone | Target | Status |
|---|---|---|
| MVP shipped | Q2 2026 | ✅ |
| SaaS launch | Q3 2026 | 🔜 |
| Free tier with hard cap (10 fixes/mo) | Q3 2026 | 🔜 |
| Solo $49/mo + Team $149/mo billing live | Q3 2026 | 🔜 |
| 500 active repos | Q3 2026 | 📋 |
| 2,000 active repos | Q4 2026 | 📋 |
| 5,000 active repos | Q1 2027 | 📋 |
| $10k MRR | Q1 2027 | 📋 |
| Enterprise deals | Q2 2027 | 📋 |
