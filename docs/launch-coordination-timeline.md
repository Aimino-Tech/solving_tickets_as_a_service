# SYNTARO Launch Coordination Timeline — 48-Hour HN → Reddit → PH Drop Sequence

> **Objective**: Coordinate a multi-platform launch within a 2-hour window to maximize cross-traffic amplification, triggering GitHub Trending and HN front page.

## Section 1: Hour-by-Hour Launch Timeline

### Day -7: Pre-Seed Warmup

| Time | Action | Owner | Notes |
|------|--------|-------|-------|
| D-7 | DM 20-30 dev community leaders for early access + launch-day support | Marketing | Track responses in launch sheet |
| D-7 | Pre-notify newsletter contacts (pitches sent, follow-ups scheduled) | Marketing | 3-wave send: D-7, D-3, D-1 |
| D-7 | Activate beta users for launch-day comment support (Reddit, HN, PH) | Community | Provide comment templates |
| D-7 | Final review of all launch copy (HN post, tweets, Reddit posts, PH listing) | All | Lock copy — no changes after D-3 |
| D-5 | Set up launch-day Slack channel (#launch-war-room) | Ops | Invite all team members + beta supporters |
| D-5 | Deploy monitoring dashboards | Engineering | Grafana + Plausible + GitHub Insights |
| D-3 | Finalize demo GIF/video (under 5MB) | Design | Test on all target platforms |
| D-3 | Print launch day checklist for each team member | Ops | Physical copy on desk |
| D-1 | Confirm all beta users are ready and have their accounts | Community | DM confirmation to each supporter |
| D-1 | Verify all social accounts are logged in and accessible | All | HN, Reddit (x4 accounts), Twitter/X, PH |
| D-1 | Final infrastructure load test | Engineering | Verify auto-scaling and rate limits |

### Day 0: Launch Day (Tuesday or Wednesday)

**T-60min: Pre-Launch**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 8:00 AM | 14:00 | Deploy final version to staging → verify everything works | Engineering |
| 8:10 AM | 14:10 | Push GitHub release tag (v1.0.0) | Engineering |
| 8:15 AM | 14:15 | Run full test suite on staging | Engineering |
| 8:30 AM | 14:30 | Verify monitoring dashboards are live | Engineering |
| 8:45 AM | 14:45 | All team members have launch checklist on desk | All |
| 8:50 AM | 14:50 | Team standup in #launch-war-room — confirm roles | All |
| 8:55 AM | 14:55 | Log into all platforms — sessions verified | All |

**T+0min: HN Post (Primary Launch Event)**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 9:00 AM | 15:00 | **SUBMIT SHOW HN POST** | Marketing Lead |
| 9:01 AM | 15:01 | Share HN link in #launch-war-room | Marketing Lead |
| 9:02 AM | 15:02 | First 5 supporters upvote + comment (pre-arranged) | Community |
| 9:05 AM | 15:05 | Monitor HN/newest — flag if buried, repost if needed | All |
| 9:15 AM | 15:15 | Check HN traction score. If >5 points → proceed with Reddit | Marketing Lead |

**T+15min: Reddit Posts (Conditional on HN traction)**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 9:15 AM | 15:15 | Submit r/programming post | Content |
| 9:16 AM | 15:16 | Submit r/devtools post | Content |
| 9:17 AM | 15:17 | Submit r/MachineLearning post | Content |
| 9:20 AM | 15:20 | DO NOT link to HN — link to SYNTARO website directly | All |
| 9:25 AM | 15:25 | Supporters comment on Reddit posts | Community |

**T+30min: Twitter/X Launch Thread**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 9:30 AM | 15:30 | Publish tweet thread (10 tweets) | Marketing Lead |
| 9:31 AM | 15:31 | Pin thread to profile | Marketing Lead |
| 9:32 AM | 15:32 | All team members retweet + quote tweet | All |
| 9:35 AM | 15:35 | DM relevant Twitter/X influencers with demo link | Marketing |

**T+60min: Product Hunt Launch**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 10:00 AM | 16:00 | **SUBMIT PH LISTING** | Marketing Lead |
| 10:02 AM | 16:02 | Publish maker comment | Marketing Lead |
| 10:05 AM | 16:05 | First 5 beta user comments go live | Community |
| 10:10 AM | 16:10 | Share PH link in #launch-war-room | Marketing Lead |
| 10:15 AM | 16:15 | Monitor upvote trajectory — report every 15min in Slack | All |

**T+2h: Amplification Wave 1**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 11:00 AM | 17:00 | Cross-post to dev community Slack/Discord servers | Community |
| 11:05 AM | 17:05 | DM relevant Twitter/X influencers with demo | Marketing |
| 11:15 AM | 17:15 | Trigger newsletter send | Marketing |
| 11:30 AM | 17:30 | Respond to EVERY HN/Reddit comment (target: <10min response) | All |
| 12:00 PM | 18:00 | Lunch break rotation (team split into 2 shifts) | All |

**T+4h to T+8h: Sustained Engagement**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 1:00 PM | 19:00 | Engagement check — respond to all new comments | All |
| 2:00 PM | 20:00 | Second wave of social sharing (new tweets with quotes from HN) | Marketing |
| 3:00 PM | 21:00 | Report interim metrics in #launch-war-room | Marketing Lead |
| 4:00 PM | 22:00 | Follow up on any delayed newsletter sends | Marketing |
| 5:00 PM | 23:00 | Evening shift takes over | Ops |

**T+24h: Amplification Wave 2**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 9:00 AM | 15:00 | Check HN front page status | Marketing Lead |
| 9:15 AM | 15:15 | If on front page: post update/thank-you comment on HN | Marketing Lead |
| 9:30 AM | 15:30 | Second round of social sharing (engagement quotes) | Marketing |
| 10:00 AM | 16:00 | Follow up on newsletter contacts who didn't respond | Marketing |
| 11:00 AM | 17:00 | Cross-post to LinkedIn (professional angle) | Content |
| All day | All day | Continue responding to comments across all platforms | All |

**T+48h: Post-Launch Recovery & Metrics**

| Time (ET) | Time (CET) | Action | Owner |
|-----------|-----------|--------|-------|
| 9:00 AM | 15:00 | Compile final metrics (visits, installs, stars, signups, conversion) | Marketing Lead |
| 10:00 AM | 16:00 | Respond to remaining unanswered comments | All |
| 11:00 AM | 17:00 | Conduct launch retrospective meeting | All |
| 12:00 PM | 18:00 | Publish launch retrospective document | Marketing Lead |
| 2:00 PM | 20:00 | Plan next 30-day content sprint | All |

---

## Section 2: Team Roles & Responsibilities

| Role | Person | Responsibilities |
|------|--------|-----------------|
| **Launch Commander** | Marketing Lead | Overall coordination, go/no-go decisions, HN submission, PH submission |
| **Engineering Lead** | Lead Engineer | Deploy, monitoring, fix critical bugs during launch, performance watch |
| **Content Lead** | Content Writer | Reddit posts, Twitter thread, LinkedIn post, all copy |
| **Community Lead** | Community Manager | Coordinate beta supporters, respond to comments, cross-post to Discord/Slack |
| **Ops Lead** | Ops | Monitoring dashboards, metrics tracking, incident response |
| **Support Team** | All engineers | Respond to HN/Reddit/PH comments during launch window |

### Role Schedules

**Shift A (9:00 AM - 2:00 PM ET):** Launch Commander, Engineering Lead, Content Lead, Community Lead
**Shift B (2:00 PM - 7:00 PM ET):** Ops Lead, Support Team (2 engineers)
**Night Watch (7:00 PM - 9:00 AM ET):** 1 engineer on-call for infrastructure issues

---

## Section 3: Launch Day Checklist (30 Items)

### Pre-Launch (D-7 to D-1) — 10 items
- [ ] DM 20-30 dev community leaders for early access + launch-day support
- [ ] Pre-notify newsletter contacts (D-7, D-3, D-1 waves)
- [ ] Activate beta users for launch-day comment support
- [ ] Final review of all launch copy
- [ ] Set up #launch-war-room Slack channel
- [ ] Deploy monitoring dashboards (Grafana, Plausible, GitHub Insights)
- [ ] Finalize demo GIF/video (under 5MB)
- [ ] Confirm all beta users have accounts and login works
- [ ] Verify all social accounts logged in and accessible
- [ ] Final infrastructure load test

### Launch Day (T-60min to T+0min) — 6 items
- [ ] Deploy final version to staging → verify everything works
- [ ] Push GitHub release tag (v1.0.0)
- [ ] Run full test suite on staging
- [ ] Verify monitoring dashboards are live (open on second monitor)
- [ ] All team members have launch checklist on desk
- [ ] Team standup in #launch-war-room — confirm roles and go/no-go

### HN Launch Window (T+0min to T+30min) — 5 items
- [ ] Submit Show HN post (exact time: 9:00 AM ET / 15:00 CET)
- [ ] Share HN link in #launch-war-room immediately
- [ ] First 5 supporters upvote + comment
- [ ] Monitor HN/newest — flag if buried
- [ ] Check HN traction at T+15min (threshold: 5+ points)

### Amplification (T+15min to T+60min) — 5 items
- [ ] Submit Reddit posts (conditional on HN traction)
- [ ] Publish Twitter launch thread (10 tweets), pin to profile
- [ ] Team retweets + quote tweets
- [ ] Submit Product Hunt listing
- [ ] Publish maker comment + first 5 beta user comments

### Sustained Engagement (T+2h to T+48h) — 4 items
- [ ] Cross-post to dev community Slack/Discord servers
- [ ] Trigger newsletter send
- [ ] Respond to EVERY comment across all platforms (target: <10min)
- [ ] Post update/thank-you on HN if on front page at T+24h

---

## Section 4: Communication Channels

### During Launch

| Channel | Purpose | Participants |
|---------|---------|-------------|
| **#launch-war-room** (Slack) | Primary coordination — all comms | Full team |
| **#launch-alerts** (Slack) | Infrastructure alerts only | Engineering + Ops |
| **#launch-metrics** (Slack) | Automated metric updates every 30min | All (read-only) |
| **Phone tree** | Emergency escalation (outage, security incident) | Launch Commander + Engineering Lead |
| **Private DM thread** | Beta supporter coordination | Community Lead + Supporters |

### Communication Rules

1. **#launch-war-room is for launch coordination only** — no off-topic discussion during T-2h to T+4h
2. **All decisions go through Launch Commander** — no unilateral changes to launch sequence
3. **Incident protocol**: Engineering Lead decides severity. Sev1 (site down, auth broken) → phone tree. Sev2 (slow, non-critical bug) → #launch-alerts only, fix after launch window
4. **Metrics sharing**: Automated every 30min. Manual check when someone calls "metrics check"
5. **No external communication** about issues or incidents during launch window — respond with "We're looking into it"

---

## Section 5: Plan B — Low-Traction Fallback

### Trigger Conditions

Activate Plan B if **any** of the following occur at T+30min:

- HN post has <5 points
- Reddit posts have <2 upvotes each
- No organic comments on any platform
- No new GitHub stars in first 30 minutes

### Plan B Actions

| Time | Action | Owner |
|------|--------|-------|
| T+30min | **Launch Commander declares Plan B** in #launch-war-room | Marketing Lead |
| T+35min | **Double down on Reddit**: Post to 4 additional subreddits (r/selfhosted, r/SideProject, r/opensource, r/github) | Content |
| T+40min | **Accelerate PH launch**: Submit PH listing now (was scheduled for T+60min) | Marketing Lead |
| T+45min | **Activate personal networks**: All team members post on LinkedIn, Facebook, personal Twitter | All |
| T+50min | **Newsletter send now — full list** (not just pre-notified contacts) | Marketing |
| T+60min | **DM 10-15 developer influencers directly** with personalized messages | Marketing Lead |
| T+90min | **Post to dev.to and Hashnode**: Long-form article (have pre-written draft ready) | Content |
| T+120min | **Evaluate**: If still no traction, pivot to Phase 2 — "quiet launch" | Launch Commander |

### Plan B Fallback: Quiet Launch Mode

If Plan B also fails (no traction at T+4h):

1. **Accept the launch is quiet** — do not force it
2. **Focus on quality engagement**: respond to every comment, every question
3. **Gather feedback**: what's unclear? What needs improvement?
4. **Document everything**: which copies had issues? What confused people?
5. **Plan re-launch in 4-8 weeks** with improved messaging, more supporters, and better timing
6. **Use quiet period for product improvements** based on any feedback received

### What NOT to do in Plan B

- ❌ Do NOT post the same content again on same platform (flagged as spam)
- ❌ Do NOT buy upvotes or engage vote-ring services (permanent ban risk)
- ❌ Do NOT blame the algorithm, users, or timing publicly
- ❌ Do NOT delete the original posts — they can still get organic traffic
- ❌ Do NOT post a desperate "why isn't anyone interested?" update

---

## Section 6: Post-Launch Retro Template

### Launch Retrospective

**Date**: `[DATE]`
**Facilitator**: `[NAME]`
**Participants**: `[NAMES]`

### Metrics

| Metric | Target | Actual | Δ |
|--------|--------|--------|---|
| GitHub Stars (48h) | 200+ | `[ACTUAL]` | `[Δ]` |
| Website Visitors (48h) | 2,000+ | `[ACTUAL]` | `[Δ]` |
| Discord Members (48h) | 50+ | `[ACTUAL]` | `[Δ]` |
| Fixes Run (48h) | 20+ | `[ACTUAL]` | `[Δ]` |
| HN Points | 50+ | `[ACTUAL]` | `[Δ]` |
| PH Upvotes | 100+ | `[ACTUAL]` | `[Δ]` |
| Free Signups | 50+ | `[ACTUAL]` | `[Δ]` |
| Paid Conversions | 5+ | `[ACTUAL]` | `[Δ]` |

### What Went Well

1. `[TOP 3 THINGS]`

### What Didn't Go Well

1. `[TOP 3 THINGS]`

### Surprises

1. `[UNEXPECTED OUTCOMES]`

### Platform Performance

| Platform | Traffic | Engagement | Quality of Leads | Would Use Again? |
|----------|---------|------------|-----------------|-----------------|
| Hacker News | `[SCORE 1-5]` | `[SCORE 1-5]` | `[SCORE 1-5]` | `[Y/N]` |
| Reddit | `[SCORE 1-5]` | `[SCORE 1-5]` | `[SCORE 1-5]` | `[Y/N]` |
| Product Hunt | `[SCORE 1-5]` | `[SCORE 1-5]` | `[SCORE 1-5]` | `[Y/N]` |
| Twitter/X | `[SCORE 1-5]` | `[SCORE 1-5]` | `[SCORE 1-5]` | `[Y/N]` |

### Action Items

| Priority | Action | Owner | Deadline |
|----------|--------|-------|----------|
| P0 | `[CRITICAL FIX]` | `[OWNER]` | `[DATE]` |
| P1 | `[IMPORTANT]` | `[OWNER]` | `[DATE]` |
| P2 | `[NICE TO HAVE]` | `[OWNER]` | `[DATE]` |

### Next Launch Improvements

1. `[WHAT TO DO DIFFERENT NEXT TIME]`

---

## Appendix: Key Platform Rules

| Rule | Details |
|------|---------|
| **No URL shorteners** on HN or Reddit | They get flagged as spam automatically |
| **No vote manipulation** | No asking for upvotes, no vote rings |
| **No direct HN→Reddit cross-linking** | Link to SYNTARO website, not the HN post |
| **First 30 minutes critical on HN** | Pre-coordinate ~20 upvotes within first 5 minutes |
| **PH algorithm favors early posts** | Submit before 12:01 AM PT or within first hour |
| **Don't launch on major holidays** | Avoid Apple/Google/Microsoft event days |
| **All team members available T-2h to T+4h** | No meetings, no PTO during launch window |
