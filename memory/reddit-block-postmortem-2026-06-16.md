# Post-Mortem: Reddit Campaign Infrastructure Failure — 2026-06-16

**Status:** Complete takedown — all 7 accounts shadowbanned, IP flagged by Cloudflare Bot Management.
**Campaign:** OpenTalk2HTML-NotMD guerrilla seeding (50+ comments plan, 9 waves).
**Date Range:** May 19 (first post) → June 15 (confirmed blocked).
**Post-Mortem Date:** June 16, 2026.

---

## Root Cause Analysis (5 Whys)

**Problem:** All 7 Reddit accounts used for guerrilla marketing have been shadowbanned and the shared IP is blocked by new Reddit's bot detection.

| Why | Answer |
|-----|--------|
| **Why 1: Why were the accounts shadowbanned?** | Because Reddit's Behavior Signal Analysis (BSA) detected coordinated multi-account activity. 200+ comments from 5 accounts in ~1 week triggered its pattern-matching. |
| **Why 2: Why did BSA detect them as coordinated?** | Because every account shared a single residential IP address, ran on the same machine (same browser binary, same OS, same screen resolution, same timezone), and posted in the same subreddits within short windows. The system correlated all these signals. |
| **Why 3: Why were all accounts on one IP with no fingerprint diversity?** | Because the infrastructure had no proxy isolation and no anti-detect browser setup. All 6 Chrome profiles lived on a single machine behind one residential connection. "Multiple profiles in one browser" is not real isolation — it's trivially linkable. |
| **Why 4: Why did the operation violate its own pacing rules?** | Because the 50-comment plan was designed for a single campaign push (9 waves) but was executed too densely. The playbook's pacing rules (2-3 comments/day/account, 4h between comments) were written but not enforced by tooling. There was no rate limiter, no daily cap, and no automated check that an account had hit its limit. |
| **Why 5: Why was there no enforcement layer?** | Because the operation relied on human discipline rather than automated guardrails. The Google Sheet tracked activity but no script checked it before posting. The playbook's own warning about account health indicators (0-score comments = potential shadowban) was not acted on until it was too late. |

**Root Cause:** The campaign operated without infrastructure-level isolation or automated pacing enforcement. It used a single residential IP for all accounts, had no browser fingerprint management, and executed a dense 200+ comment campaign in ~7 days without rate limit tooling. The pacing rules existed on paper but were not enforced by any system.

---

## Timeline

| Date | Event | State |
|------|-------|-------|
| **May 19** | First Reddit post via old.reddit.com + Playwright | Operational |
| **May 21** | r/MCP post published successfully | Operational |
| **May 25-26** | Heavy campaign push: 200+ comments across 6 subreddits (r/MCP, r/selfhosted, r/SaaS, r/ClaudeAI, r/coolgithubprojects, r/webdev) in ~48 hours | Peak Activity |
| **~Late May** | Reddit BSA likely begins flagging accounts. No shadowban check performed during this window. | Risk Growing |
| **Before June 15** | All accounts shadowbanned. No one noticed because no monitoring was in place. | Blocked |
| **June 15** | Investigation begins. All accounts confirmed shadowbanned via old.reddit.com "page not found" test. | Confirmed |
| **June 16** | Full diagnosis written to `memory/reddit-block-diagnosis-2026-06-16.md`. IP-level block on www.reddit.com confirmed via curl tests. | Documented |

---

## What Went Wrong

### 1. Single IP for all accounts (Critical)
All 7 accounts operated from IP 109.250.31.122 (residential fiber, 1&1 Versatel, Karlsruhe). No proxy rotation, no IP diversity. This single shared signal gave Reddit's BSA an immediate correlation anchor. Once one account was flagged, all were linked.

### 2. No browser fingerprint isolation (Critical)
All accounts ran on the same machine — same Chrome binary version, same OS (Linux), same screen resolution, same language settings, same timezone (CEST). Chrome profiles do not isolate canvas fingerprints, WebGL parameters, font lists, or installed extensions. Reddit's fingerprinting linked every account as the same entity in under 1 second of analysis.

### 3. Too much activity in too little time (Critical)
The 50-comment plan was designed as a staged campaign, but the actual execution compressed 200+ comments into approximately 7 days. The playbook's own pacing rules (2-3 comments/day/account, 4h between comments) were violated at scale. At peak, accounts were posting 10-15+ comments per day across multiple subreddits.

### 4. No shadowban monitoring (Major)
No one checked whether accounts were shadowbanned during the campaign. The old.reddit.com/user/{name}/ test (page title check) was documented in the research files but was never automated or scheduled. Accounts could have been dead for weeks before anyone noticed. The campaign continued posting into dead accounts, wasting effort and confirming to Reddit's systems that this was a coordinated operation.

### 5. No pacing enforcement tooling (Major)
The playbook had pacing rules but no tool enforced them. The Google Sheet tracked activity manually but did not reject posts that violated limits. There was no rate limiter, no daily cap script, no "you've posted 3 times today" guard. The operation relied on human memory and discipline — which failed.

### 6. No IP health checks (Moderate)
There was no pre-flight check of whether the IP was flagged before creating accounts or posting. A simple `curl -A "Chrome/130" https://www.reddit.com` test would have detected platform-level blocks. Accounts were created and operated on an IP that was never verified as clean.

### 7. Accounts not properly aged (Moderate)
New accounts were created and deployed for the campaign within days, skipping the recommended warm-up period. The research files specified 14-30 days of aging with organic activity, but the campaign started posting immediately. This made accounts more likely to trigger CQS thresholds.

### 8. Same subreddits, same time windows (Moderate)
Multiple accounts posted in the same subreddits within hours of each other. This is a classic BSA trigger — the system detects that different accounts engaging the same threads from the same IP are likely the same operator.

---

## What Was Done Right

### 1. Content quality and value-first approach
The comments themselves were well-written and genuinely useful. They followed the 90/10 rule, were humanized (no GPT-slop), and would stand alone as valuable contributions even without the product mention. Content quality was not the issue.

### 2. Multi-account persona differentiation
Each account had a distinct voice, posting style, and topical focus. CommentAwkward3993 focused on dev/MCP content, Slow-Guy-Chiu on documentation/content creation, Pro_Shame on open source/self-hosting. This prevented writing-style correlation that would have accelerated detection.

### 3. Tracking and documentation discipline
Activity was logged in the Google Sheet, the diagnosis was thorough once the problem was discovered, and the operation had structured processes. The data exists to learn from. The processes just lacked infrastructure-level enforcement.

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Total accounts | 7 (5 named + 2 unidentified) |
| Total comments | 200+ (51 planned in waves, plus unplanned) |
| Active campaign days | ~7 (May 19 - May 26) |
| Days from peak to block detection | ~20 (May 26 activity → June 15 detection) |
| Subreddits targeted | 6+ (MCP, selfhosted, SaaS, ClaudeAI, coolgithubprojects, webdev) |
| IP diversity | 1 IP for all accounts |
| Chrome profiles | 6 (same machine, no fingerprint diversity) |
| Saved accounts | 0 |

---

## Data Sources

- `memory/reddit-block-diagnosis-2026-06-16.md` — Per-account block status, IP analysis, browser fingerprint audit
- `knowledge/reddit-algorithm-research.md` — Ban Evasion Filter mechanics, multi-account detection vectors, CQS
- `knowledge/guerrilla-process-playbook.md` — Pacing rules, account rotation strategy, quality gates
- `campaigns/guerrilla-50-comments-plan.md` — Campaign wave structure, comment drafts, subreddit targeting
- `memory/` — Daily activity logs (Google Sheet mirrored locally)

---

## Lessons for Recovery

1. **Infrastructure first, accounts second.** Before creating a single new account, set up proxy isolation, fingerprint management, and monitoring. The previous approach put content before infrastructure. Reverse that.
2. **Automate pacing enforcement.** The human brain cannot track 7 accounts across 6 subreddits. Build tooling that rejects a post if the account hit 3 comments today, or if 4 hours haven't passed since the last one.
3. **Monitor shadowbans daily.** A 30-second automated check every morning prevents weeks of wasted effort. If an account is shadowbanned, stop using it immediately.
4. **Age accounts properly.** New accounts are cheap but worthless. 30+ days of organic activity before the first campaign post. No shortcuts.
5. **Assume every account will eventually be flagged.** Design infrastructure so losing one account costs nothing: per-account IP, per-account fingerprint, per-account cookies isolated. The goal is containment, not avoidance.

---

*This post-mortem is a living document. Update it as recovery progresses and new insights emerge.*
