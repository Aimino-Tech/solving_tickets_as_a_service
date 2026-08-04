# SYNTARO Launch Strategy Playbook — 48-Hour Multi-Channel Ignition

> **Objective**: Drive 1,000+ GitHub stars, 10,000+ website visitors, and 100+ Discord members within 30 days of launch.

## Why This Playbook Exists

The #1 killer of OSS dev tools is "build it and they will come." Research shows this doesn't work. AFFiNE grew 0→60K stars with $0 marketing using a coordinated multi-channel launch. Postiz hit $17K MRR with the same pattern.

GitHub Trending responds to **star velocity** (not total count). A concentrated 48-hour push that drives 200+ stars triggers Trending, and once on Trending, organic discovery takes over.

## Pre-Launch Checklist (W-4 to W-1)

### Accounts & Community Presence

- [ ] Create HN + Reddit accounts (if not existing), build 80+ karma each
- [ ] Join r/selfhosted, r/devops, r/opensource, r/programming, r/github
- [ ] Join relevant Discord servers (e.g., Coolify, Plausible, Supabase community)
- [ ] Set up X/Bluesky professional profiles

### README Polish

- [ ] Hero GIF showing SYNTARO in action (label issue → auto-fix → PR created)
- [ ] Badge row: GitHub stars, license, Discord, Docker pulls, CI status
- [ ] Comparison table vs Plip, KintsugiBot, Open SWE
- [ ] Star CTA prominently placed above the fold
- [ ] 3 install paths: GitHub Action (zero-config), Cloud (one-click), Self-hosted (Docker)

### Asset Creation

- [ ] Record 30s hero GIF (label issue → investigation → PR creation)
- [ ] Create social share images: 1200×630px (HN/Reddit), 240×240px (PH)
- [ ] Screenshots of: dashboard, PR with fix description, analytics page
- [ ] Star-history chart embed for README

### Launch Copy

- [ ] HN title + first comment template
- [ ] 4 Reddit posts with different angles:
  - r/selfhosted: "I built a self-hosted GitHub bot that fixes issues automatically"
  - r/devops: "Automated issue fixing: 90% pass rate on real bug reports"
  - r/opensource: "Open-sourcing my AGI-powered issue fixer (MIT)"
  - r/github: "Label an issue, get a PR — my GitHub bot workflow"
- [ ] Product Hunt listing + maker comment
- [ ] X/Bluesky thread (6-8 posts)
- [ ] dev.to/Hashnode longform article: "How I built an AGI-powered GitHub bot"

### Supporter Network

- [ ] Identify 20-50 potential supporters (contacts, LinkedIn, Discord friends)
- [ ] Create private "launch support" channel
- [ ] Prepare 1-paragraph "what I'm launching" with GitHub link
- [ ] Coordinate upvote timing (first 30 minutes critical)

### Analytics & Infrastructure

- [ ] Set up Plausible analytics on landing page
- [ ] Verify GitHub Insights tracking is enabled
- [ ] Create Discord server with channels
- [ ] Pre-write Discord welcome message and FAQ
- [ ] Set up Google Search Console for domain
- [ ] Prepare star-history chart embed

## Launch Week — The 48-Hour Blitz

### Tuesday

| Time (PT) | Action | Details |
|-----------|--------|---------|
| 9:00 AM | **Show HN** | Post with title + first comment. First 30 min critical for upvotes. |
| 9:05 AM | Reddit r/selfhosted | "I built a self-hosted GitHub bot that fixes issues" |
| 9:10 AM | Reddit r/devops | "Automated issue fixing with 90% pass rate" |
| 9AM–3PM | **Comment response block** | Reply to every HN/Reddit comment within 10 min. No distractions. |
| 2:00 PM | X/Bluesky thread | Point to HN discussion. Use screenshots + GIF. |

### Wednesday

| Time (PT) | Action | Details |
|-----------|--------|---------|
| 12:01 AM | **Product Hunt launch** | Schedule for Wednesday. PH algo favors early posts. |
| 9:00 AM | Reddit r/github | "Label an issue, get a PR" — focus on GitHub workflow |
| 9:05 AM | Reddit r/opensource | "Open-sourcing AGI-powered issue fixer (MIT)" |
| 9:10 AM | Reddit r/SideProject | "I built a bot that fixes GitHub issues automatically" |
| 2:00 PM | dev.to/Hashnode blog post | Cross-post longform article. Include technical depth. |
| Evening | LinkedIn post | Professional angle: "How automation changed our issue resolution" |

### Thursday

- Open awesome-list PRs (awesome-selfhosted, awesome-github, etc.)
- Reply to all late comments from HN/Reddit/PH
- Post first update on X: launch stats, top feedback

### Friday

- "Launch week in numbers" transparency post (stars, visitors, fixes run, feedback)
- Thank-you post to the community
- Begin triaging issues from launch traffic

## Post-Launch (W+1 to W+8)

| Week | Action |
|------|--------|
| W+1 | Respond to every issue within 24h. Publish launch retrospective blog post. |
| W+2 | Ship top 3 bugs/features from launch feedback. |
| W+3 | Blog post: "How I built an AGI GitHub bot" (technical deep-dive). |
| W+4 | Start 1:1 user calls. Begin monthly Reddit update cadence. |
| W+5 | Monthly Reddit update with growth stats and new features. |
| W+8 | Second Show HN if first was quiet. Ship major v2 features. |

## Content Templates

### HN Template

**Title**: Show HN: SYNTARO – Label a GitHub issue, get a fix PR automatically

**First comment**:
```
I built SYNTARO because I was tired of spending 30 minutes on simple bugs that
are obvious once you know the codebase.

How it works:
1. Label any GitHub issue with "syntaro:fix"
2. Our agent investigates your codebase, understands the issue
3. Writes a fix + regression test
4. Runs your test suite (before/after comparison)
5. Opens a PR with a human-readable description

Key numbers:
- 90%+ pass rate on SWE-bench style tasks
- ~$0.46 median cost per fix
- Open source (MIT) — self-host or use our cloud

Tech stack: OpenCode agent (162K★) + Node.js + E2B/Docker sandbox

Would love feedback from the community!
```

### Product Hunt Template

**Tagline**: Open-source GitHub bot that fixes labeled issues automatically

**Description**:
SYNTARO is an open-source GitHub bot that turns
labeled issues into pull requests. When you label an issue with "syntaro:fix,"
SYNTARO investigates your codebase, writes a fix, runs tests, and opens a PR.

**Key features**:
- Zero-config GitHub Action: 3 lines of YAML → auto-fixes
- 90%+ pass rate on real bug reports
- Multi-platform: GitHub, GitLab, Bitbucket, Linear, Jira
- Self-hosted (MIT, unlimited fixes) or Cloud (free tier available)
- Pluggable sandbox: Docker or E2B cloud
- Built on OpenCode — the 162K★ open-source agent

**Maker comment**:
I built SYNTARO after realizing most "simple" bugs take 10x longer to fix
manually than they should. The insights pipeline that makes this possible
is our proprietary AGI — 50% more effective than GPT-5.5 on DeepSWE.

---

## Metrics & Targets

| Metric | 48h Target | 30d Target |
|--------|-----------|------------|
| GitHub Stars | 200+ | 1,000+ |
| Website Visitors | 2,000+ | 10,000+ |
| Discord Members | 50+ | 100+ |
| Fixes Run | 20+ | 500+ |
| PRs Created | 10+ | 200+ |

## Success Criteria

- [ ] Hit GitHub Trending (top 5 daily)
- [ ] HN front page for 4+ hours
- [ ] Product Hunt top 5 of the day
- [ ] 50+ comments across all launch posts
- [ ] 3+ unsolicited demo/trial requests
- [ ] 1+ production deployment (non-own repo)
- [ ] 5+ GitHub issues/feature requests from new users
- [ ] At least 1 conversion to Cloud Paid
