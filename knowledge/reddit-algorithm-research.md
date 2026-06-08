# Reddit Algorithm & Optimization: Comprehensive Research Report

**Date**: May 26, 2026
**Type**: Comprehensive Research (TYPE D)

---

## 1. How Reddit's Ranking Algorithm Works

### The Hot Score Formula

Reddit's default feed runs on the **Hot** algorithm. The core formula:

```
Hot score = log₁₀(net votes) + (time posted ÷ 45,000)
```

In plain English:
- Every **10x increase** in votes adds only **1 point** to ranking
- Every **12.5 hours** of age subtracts **1 full point**
- A 12-hour-old post needs ~10x more upvotes than a new post to hold the same rank
- After 24 hours, it needs 100x more
- After 36 hours, it's basically dead

**Source**: redaccs.com/reddits-ranking-algorithm/

**Critical implication**: The first 10 upvotes carry roughly the same ranking weight as the next 100. Going from 1→10 fast is more valuable than going from 100→200 slowly.

### The Five Sort Methods

| Sort | Mechanism | Strategic Use |
|------|-----------|---------------|
| **🔥 Hot** (Default) | Net upvotes × logarithmic time decay | The main ranking battleground — rewards posts that gain traction fast |
| **✅ Best** (Default comments) | Wilson score confidence interval — ranks by vote ratio, not total | A comment with 5 upvotes/0 downvotes can outrank one with 100/40 |
| **↗️ Rising** | Vote velocity relative to subreddit baseline | Where mods and power users hunt for content — getting here creates snowball effect |
| **🥇 Top** | Pure net score, no time decay, filtered by time period | Pure popularity contest; useful for historical browsing |
| **🎉 New** | Chronological, no algorithm | Where all posts start — the first 15 minutes decide if you advance |

**Path to front page**: Survive New → break into Rising → reach Hot.

### Why Some Votes Count More Than Others

Not all upvotes carry equal weight. Reddit adjusts vote impact based on:

1. **Account age and karma**: A vote from a 3-year-old account with 10,000 karma carries significantly more algorithmic weight than one from a new account. This is Reddit's confidence scoring system.
2. **IP diversity**: Votes from the same IP range get discounted or ignored — first line of defense against vote manipulation.
3. **Voting patterns**: If an account only upvotes one user's posts, Reddit flags that relationship and devalues those votes.
4. **Upvote-to-engagement ratio**: A post with 200 upvotes and 0 comments looks unnatural. Reddit weighs the ratio between votes and other engagement signals (comments, awards, shares).

**Source**: redaccs.com/reddits-ranking-algorithm/, multilogin.com/glossary/reddit-algorithm/

### Vote Fuzzing

Reddit intentionally shows **inaccurate vote counts** on every post — a system called *vote fuzzing*. Fake upvotes and downvotes are added to the displayed count. The actual net score remains roughly accurate, but individual numbers are scrambled. This makes it harder to detect or measure vote manipulation from the outside.

**Key insight**: Refresh any popular post three times — the count changes slightly. That's fuzzing at work.

### Comment Depth as a Quality Signal

Reddit treats **comments as a higher-quality engagement signal** than upvotes. Comments require intention and effort. A post with 30 upvotes and 25 comments will typically outperform a post with 30 upvotes and 2 comments in sustained Hot feed placement.

**Comment sorting** uses Wilson score — meaning polarizing comments are penalized, and widely-agreed-upon comments (even with fewer total votes) surface higher.

**The early comment advantage**: Academic research confirms that comment arrival time is one of the strongest predictors of final score. A single artificial upvote increased a comment's eventual score by 25% on average (Muchnik et al., 2013).

**Source**: indexthread.com/research/reddit-algorithm-visibility, indexthread.com/research/timing-and-velocity

---

## 2. Best Times to Post for Maximum Visibility

### The Upvote Velocity Window

The first **30-60 minutes** after posting decide everything. Reddit's ranking algorithm places your post into a competitive pool. Posts that accumulate upvotes fastest rise to the top. The auction window is roughly 30 minutes for large subreddits and up to a few hours for smaller ones.

A Sprout Social analysis found that content posted during peak audience hours generates **3.1x higher early engagement rates** compared to off-peak.

**Source**: upvote.net/blog/best-time-to-post-on-reddit

### General Optimal Windows by Day (Eastern Time)

| Day | Best Window (ET) | Best Window (UTC) | Notes |
|-----|-----------------|-------------------|-------|
| Monday | 6–9 AM | 11 AM–2 PM | Morning commute browsing |
| **Tuesday** | **7–10 AM** | **12 PM–3 PM** | **Strongest overall** |
| **Wednesday** | **7–10 AM** | **12 PM–3 PM** | **Peak weekday engagement** |
| Thursday | 6–9 AM | 11 AM–2 PM | Slightly lower |
| Friday | 5–8 AM | 10 AM–1 PM | Early posting advised; afternoon drop-off |
| Saturday | 8–11 AM | 1 PM–4 PM | Leisure browsing, later morning |
| Sunday | 8–11 AM | 1 PM–4 PM | Strong for entertainment/hobby subs |

**Tuesday and Wednesday mornings are the single best all-around windows.** Controlled testing across 150 posts in Q4 2025 showed Tuesday/Wednesday mornings outperformed Monday mornings by ~40% in median upvote count after 24 hours.

**Why early morning ET works**: A post at 7 AM ET catches three concurrent groups — East Coast commuters, Midwest early risers, and European afternoon users. By the time West Coast logs on, the post has 3-5 hours of accumulated votes.

**When NOT to post**:
- Late night (12–5 AM ET): Minimal US audience, heavy time decay before your audience wakes up
- Friday afternoon (3–8 PM ET): Users disengaging for weekend
- Weekend evenings: Engagement drops after 6 PM ET

### By Subreddit Category

| Category | Best Window (ET) | Notes |
|----------|-----------------|-------|
| Tech/Programming | Weekdays 8–11 AM | Professional audiences, standard workday |
| News/Current Events | Weekdays 7–10 AM + 12–2 PM secondary | Reactive to breaking stories |
| Memes/Entertainment | Weekdays 9 AM–12 PM; Weekends 9 AM–1 PM | Most forgiving timing windows |
| Business/Entrepreneurship | Weekdays 7–10 AM (Tue/Wed preferred) | Professional, midweek strongest |
| Finance/Investing | Weekdays 6–9 AM | Pre-market window captures early risers |
| Lifestyle/Health | Weekdays 7–10 AM; Weekends 8–11 AM | Most balanced weekday/weekend |
| Ask-style (AskReddit, etc.) | Weekdays 8–11 AM; **Sunday 7–9 PM** | Sunday evening is a unique exception |

**Interesting finding on Sunday evenings**: Ask-style subreddits showed Sunday evening submissions (8-10 PM ET) outperforming Sunday morning by 35-50% in median upvotes. Lower weekend posting volume + steady browsing traffic as users wind down before the work week.

**Source**: upvote.net/blog/best-time-to-post-on-reddit, indexthread.com/research/timing-and-velocity

---

## 3. Anti-Spam and Anti-Manipulation Systems

### The Four Detection Layers

Reddit uses a **layered detection stack** — four different systems that each catch what others miss:

#### Layer 1: Network and Device Fingerprinting
Before you type a single character, Reddit fingerprints your browser through: IP address, browser headers, screen resolution, installed fonts, WebGL renderer, timezone, and dozens of other signals. Cross-references every account that has ever connected from the same environment. According to EFF's Panopticlick research, 83.6% of browsers carry a unique fingerprint.

**Triggers**: Multiple accounts sharing the same IP/subnet, identical browser fingerprints across accounts, rapid account switching, VPN/datacenter IPs, sudden geographic jumps.

#### Layer 2: Behavioral Analysis
Machine learning models track how accounts interact over time. Real humans are messy and unpredictable. Bots are not.

**Signals tracked**: Posting tempo (bots post at metronomically consistent intervals), vote timing (5 accounts upvoting same post within 90 seconds = coordination signal), content similarity, session behavior (bots skip browsing, jump straight to action), subreddit diversity.

A 2024 study at Binghamton University found behavioral analysis alone could identify bot accounts with **96% accuracy**.

#### Layer 3: Contributor Quality Score (CQS)
Reddit's hidden internal reputation metric. Unlike karma (public and easily farmed), CQS is invisible and based on quality of contributions.

**Factors**: Ratio of removed vs. approved content, how often posts/comments get reported, moderator approval patterns, upvote-to-downvote ratio in context, account age and consistency.

A **low CQS** doesn't ban you — it quietly **degrades visibility**. Posts from low-CQS accounts get pushed into spam filters more aggressively. Comments may be silently collapsed.

**Source**: redaccs.com/how-reddit-detects-fake-accounts/, support.reddithelp.com (CQS documentation)

#### Layer 4: Human Moderator Review
Reddit's 100,000+ volunteer moderators catch what algorithms miss. They use tools like mod log history, Toolbox browser extension (cross-subreddit ban data), BotDefense, and the native mod queue.

### Vote Manipulation Detection — Specific Patterns

Reddit's vote manipulation detection algorithms flag **73% of coordinated upvote attempts within 4 hours**.

| Pattern Type | Detection Window | Flag Threshold |
|-------------|-----------------|----------------|
| Burst voting | 5–15 minutes | 8+ votes from distinct accounts |
| Temporal clustering | 30 minutes | 15+ votes with irregular spacing |
| Off-hours concentration | 2–6 AM local time | 5+ votes during low-activity |
| Velocity spikes | 10 minutes | Vote rate 3× subreddit baseline |

**Account correlation analysis**: Accounts created within 72 hours showing identical voting patterns trigger network correlation. The system tracks creation timing clusters, device fingerprint sharing, voting behavior synchronization, activity pattern matching.

**Geographic/network analysis**: More than 3 accounts from the same /24 subnet voting on identical content triggers analysis. Datacenter IP ranges face automatic scrutiny.

**Behavioral consistency**: Accounts with vote-to-comment ratios above **50:1** trigger flags. Natural users engage through comments, posts, and votes in balanced proportions.

**Source**: chameleonmode.com/reddit-voting-manipulation-detection-what-patterns-trigger-automated-flags/

### What Reddit's Detection Still Misses

1. **Aged, organically-built accounts** pass every automated check — on clean residential infrastructure, they look identical to real users
2. **Slow-drip promotion** (95% valuable content, 5% promotional) generates positive behavioral signals
3. **Small-scale operations** (2-3 careful accounts) stay below statistical thresholds
4. **Novel behavior patterns** have no training data — ML models are backward-looking

---

## 4. Account Requirements for Posting

### Karma Thresholds by Subreddit Tier

| Subreddit Size | Typical Comment Karma Required |
|---------------|-------------------------------|
| Under 50K members | Little to no enforcement |
| 50K–500K members | 50–200 comment karma |
| 500K–5M members | 200–500 comment karma |
| 5M+ members | 500–2,000 comment karma |
| High-bar subs (r/CryptoCurrency, r/personalfinance, r/wallstreetbets) | 500+ karma + 60+ days |

**Source**: upvote.net/blog/reddit-automoderator, signals.sh/blog/reddit-karma-thresholds-buy-the-right-account

### Account Age Requirements by Niche

| Niche | Minimum Age | Additional |
|-------|------------|------------|
| Finance & Crypto | 30–90 days | 50–500 comment karma |
| Technology | 7–30 days | Some require email verification |
| Marketing & Business | 14–60 days | 90/10 self-promotion enforced |
| Health & Wellness | 7–14 days | Low karma thresholds |
| NSFW / Adult | 30–90 days | Email + age verification |
| Local / City | 3–14 days | Some require flair |

**The higher the commercial value, the stricter the gates.** Many large subreddits raised minimums from 7→30→60→90 days through 2025–2026.

**Source**: redaccs.com/age-importance/

### Account Age Performance Data

Testing across 15 mid-size subreddits (50K–500K members):

| Metric | < 30 days | 6 months | 1 year | 2+ years |
|--------|-----------|----------|--------|----------|
| Posts visible (not filtered) | 34% | 71% | 89% | 96% |
| Avg. time to first upvote | 47 min | 12 min | 8 min | 6 min |
| Subreddits accessible (of 15) | 4 | 9 | 13 | 15 |
| Spam filter triggers | 11/15 | 4/15 | 1/15 | 0/15 |
| Avg. post reach (impressions) | 120 | 890 | 1,430 | 1,710 |

**The 1-year mark is the most important threshold** — most age gates stop applying and spam filter sensitivity drops to near-zero.

### Building a "Legitimate-Looking" Account

Key signals Reddit evaluates:
- Account age (creation date)
- Activity consistency (gaps in usage lower trust)
- Content Quality Score (CQS)
- Verification status (email, phone, 2FA)
- Subreddit standing (bans, warnings, removed content)
- Subreddit diversity (participation across multiple communities)

---

## 5. How to Build Karma Safely

### The 30-Day Warmup Protocol (Signals Protocol)

**Target**: 100 combined karma in 30 days, comment-heavy, no promotional footprint.

#### Phase 1 — Days 1-3: Setup
- Verify email immediately (poster-eligibility gate)
- Add a plain avatar; do NOT stuff profile with brand links
- Subscribe to 15-20 relevant communities (mix of large beginner-friendly + niche + hobby subs)
- Read rules of each target subreddit
- **Zero posts, zero links, zero promotion**

#### Phase 2 — Days 4-10: Comment Base (target: 25-40 karma)
- Comment-only phase. Sort target subs by New and Rising
- 3-5 useful comments per day (40-120 words each)
- Safest comment types: troubleshooting help, tool recommendations (no links), personal experience, clarifying questions
- Avoid: politics, dunking, low-effort jokes, controversy
- **Goal by day 10**: 25-40 combined karma, no removals, visible in 3+ subreddits

#### Phase 3 — Days 11-21: Diversify (target: 40-60 karma)
- Rotate across 5-8 subreddits (don't farm one source)
- Add ONE text post (non-commercial: question, lesson, resource list with no links)
- If post gets removed, don't repost — return to comments for another week

#### Phase 4 — Days 22-30: Test Gates (target: 100-150 karma)
- One low-risk text post in a target subreddit where you've already commented
- If it appears in New and gets normal engagement → keep posting
- If it disappears → diagnose (age/karma/CQS/rule fit/link behavior)

### What to AVOID

- **Free-karma subreddits**: Leave a public footprint that signals filter-chasing. Worse than low karma.
- **Vote trading / coordinated upvotes**: Violates Reddit's Disrupting Communities rule
- **Link drops**: A new account posting SaaS/affiliate/OnlyFans/Discord links triggers AutoMod immediately
- **Repeating comment templates**: Looks like automation
- **More than 5-10 posts per hour**: Triggers automated spam detection
- **Posting the same domain 3+ times in 7 days**: Link repetition flag

**Key principle**: Comments should make up **at least 70% of all activity** until you clear 100 combined karma. An account with 20 post karma and 120 comment karma looks like a participant. One with 100 post karma and 3 comment karma looks like a content dumper.

**Source**: signals.sh/blog/reddit-100-karma-30-days-warmup-protocol

### Best Subreddits for Building Karma (2026)

For new users: Start with subreddits that have **low/no karma gates** and active New queues where helpful comments get seen:
- r/AskReddit (massive, but comment in New/Rising for visibility)
- r/explainlikeimfive (explanatory comments get upvoted)
- r/LifeProTips, r/YouShouldKnow (share useful knowledge)
- r/CasualConversation (low barrier, friendly)
- Niche hobby subreddits where you have genuine expertise

**Source**: leadsfromurl.com/blog/best-subreddits-for-new-users-to-build-karma-2026

---

## 6. Self-Promotion Policy

### The 90/10 Rule

Reddit's most commonly cited guideline: **~90% of your activity should be genuine participation** (comments, upvotes, discussions, helping people); **no more than 10%** should involve mentioning your own product or content.

Some communities enforce closer to **99/1**.

### The Official Stance

Reddit doesn't prohibit self-promotion outright. The content policy allows sharing your own content as long as you follow the principles. Each subreddit defines its own rules — acceptable levels vary wildly.

### The Unwritten Rules That Matter More

1. **Always read subreddit rules before posting** — varies by community (some allow self-promotion only on specific days or in designated threads)
2. **Never use multiple accounts ("sockpuppets")** to promote the same product — this triggers severe enforcement
3. **Tone matters**: Marketing language ("revolutionary," "game-changing," "best solution") triggers immediate skepticism
4. **Disclose your affiliation** — saying "I built this" actually increases trust
5. **Don't cross-post identical promotional content** to multiple subreddits at once

### Practical Framework

| The 90% (genuine participation) | The 10% (self-promotion done well) |
|--------------------------------|-----------------------------------|
| Answering questions in your expertise | Mentioning your product when someone asks for a recommendation |
| Sharing insights, data, opinions | Sharing a relevant blog post that directly answers a question |
| Engaging in discussions thoughtfully | Being transparent: "I'm the founder of X, so I'm biased, but here's how..." |
| Asking genuine questions | Replying to questions about a product you built |
| Upvoting and supporting others | Joining weekly "show off your project" threads |

### Subreddits Where Self-Promotion Is Welcome

- r/SideProject, r/IndieBiz — designed for founders to share
- r/startups — within specific guidelines
- r/IMadeThis, r/SomebodyMakeThis — showcase communities
- r/AlphaAndBetaUsers — for finding early users

### Enforcement Levels

| Level | What It Means | Reversible? |
|-------|--------------|-------------|
| Comment/post removal | Content removed; account active | Usually, with rule fix |
| Subreddit shadowban | Invisible in that sub only | Sometimes, on appeal |
| Sitewide shadowban | Invisible everywhere | Rarely |
| Subreddit ban | Permanently banned from one community | Almost never |
| Account suspension | Entire account suspended | Rarely for permanent |

**Source**: redship.io/blog/reddit-self-promotion-rules, upvote.net/blog/reddit-self-promotion

---

## 7. The Shadowban

### What It Is

A Reddit shadowban is the platform's quietest enforcement action: your posts, comments, and profile appear normal when you're logged in, but **nobody else on the site can see them**. You can keep posting for weeks without realizing the account is dead.

### The 3-Method Detection Workflow

**Method 1 — Incognito Profile Test (30 seconds)**:
Open incognito, paste `reddit.com/u/yourusername`. Do not log in.
- Profile loads with visible posts → not sitewide shadowbanned
- "Sorry, nobody on Reddit goes by that name" → sitewide shadowban
- "This account has been suspended" → full suspension, different appeal

**Method 2 — r/ShadowBan Bot Check (2 minutes)**:
Post "Check" in r/ShadowBan. Bot replies with visible/hidden flags for last 100 items. Only tool that catches partial shadowbans.

**Method 3 — Third-party checker**:
Reveddit.com, cable.ayra.ch, BanChecker — cross-verify. Use as secondary check only.

### The 6 Triggers That Cause Shadowbans (2026)

1. **Posting velocity**: More than 5-10 posts per hour from a new account
2. **Link repetition**: 3+ submissions to the same domain within 7 days
3. **Account age vs. activity mismatch**: Accounts under 30 days posting heavily
4. **IP association**: Creating account from IP used by previously banned/spam accounts
5. **VPN/proxy usage**: Specific exit nodes flagged for spam
6. **Automated behavior patterns**: Exact-interval posting, identical formatting, template bios

### Symptoms

| Symptom | What It Means |
|---------|---------------|
| Zero upvotes AND zero downvotes on new posts | Nobody is seeing it (even bad posts get 1-2 fuzz downvotes) |
| Zero comment replies on questions | People can't see your comment |
| Posts don't appear in subreddit feeds | Subreddit is filtering you |
| Profile returns 404 in incognito | Definitive sitewide shadowban |

### Recovery Protocol

**Day 1**: Confirm scope (sitewide vs subreddit). Stop posting. File ONE appeal at reddit.com/appeal from the affected account. Keep it short — include account age, normal communities, recent benign activity.

**Days 2-7**: Freeze activity. Verify email. Check Reveddit. Document patterns that may have triggered it.

**Day 14**: Retest. If visibility restored → 7-day rewarm (comments only, no links). If still invisible → one brief follow-up appeal (max 2-3 per week).

**Day 30**: Campaign cutoff. If still invisible, move account out of active inventory. Do NOT create replacement accounts on same device/IP.

**Recovery note**: Automated shadowbans typically last **7-14 days** if you stop triggering the pattern. Appeals are reviewed within 24-72 hours. Past 30 days, the account is usually unrecoverable.

**Source**: signals.sh/blog/how-to-check-if-youre-shadowbanned-on-reddit-2026, signals.sh/blog/reddit-shadowban-recovery-day-by-day

---

## 8. Crowd Control and Ban Evasion Detection

### Ban Evasion Filter

Reddit's Ban Evasion Filter is **opt-in at the subreddit level** and scores incoming posts/comments against a confidence ladder (low/medium/high). Per Reddit's own documentation, the filter does NOT use behavioral or contextual patterns — it's a **hard correlation match on connection-level signals**:

- IP range overlap with banned accounts
- Device fingerprint collisions
- Cookie / localStorage residue matches

Moderators choose a confidence level and lookback window. At high confidence, the filter requires more signals to match. At low confidence, fewer signals trigger it.

### March 2026 Policy Change

Reddit announced that starting March 19, 2026, two widely used moderation bots (u/SaferBot and u/Hive-Protect) would **lose their ability to automatically ban users based on which subreddits they post in**. This "guilt-by-association" moderation was ended via new policy.

**Source**: piunikaweb.com/2026/03/06/reddit-disable-auto-ban-features-saferbot-hive-protect/

### What the Ban Evasion Filter Does NOT Do

- Does NOT analyze writing style or content patterns
- Does NOT track behavioral cadence
- Is purely connection-level correlation matching

This means a clean buyer-side environment (fresh IP, fresh browser fingerprint, no shared infrastructure) will NOT trigger the ban evasion filter even if the account was previously banned on another subreddit — as long as no connection-level signals overlap.

---

## 9. Multi-Account Strategy Risks

### How Reddit Detects Related Accounts

Reddit detects multi-account usage through **three vectors**:

1. **IP Addresses**: The most obvious link. Multiple accounts from the same IP or /24 subnet are immediately correlated. Datacenter IPs are pre-flagged.
2. **Browser Fingerprinting**: Dozens of signals — user agent, screen resolution, timezone, language, installed fonts, canvas rendering, WebGL parameters. 83.6% of browsers carry a unique fingerprint. Two accounts with the same fingerprint are linked regardless of IP differences.
3. **Behavioral Patterns**: Identical posting times, same subreddit sets, similar writing styles, cross-account voting → all flagged.

### What Triggers Network Detection

- Multiple accounts sharing the same IP / IP subnet
- Identical/near-identical browser fingerprints across accounts
- Rapid account switching from the same browser
- VPN/proxy IPs on known blocklists
- Accounts voting for each other's content (fastest way to burn a whole network)
- Accounts posting in the same threads within short time windows
- Identical behavioral patterns (same posting times, same subreddits)

### What Reddit Does NOT Track

- Whether an account was "sold" on a marketplace (no classifier exists)
- Switching between old.reddit.com and new.reddit.com (first-party clients)
- Logging in from a different country (only matters if the IP itself is flagged)
- Changing username display, bio, or avatar (first-party API actions)

**Source**: signals.sh/blog/how-reddit-detects-sold-accounts-2026

### The 3-Layer Safe Setup (for legitimate multi-account use)

**Layer 1 — IP**: Clean residential proxies. 1 account = 1 IP. Avoid datacenter. Use unknown providers. Avoid US/UK — use Italy, Portugal, Sweden, Czech Republic.

**Layer 2 — Fingerprint**: Anti-detect browser (AdsPower, GoLogin, Multilogin). Unique profile per account. Isolated cookies, storage, canvas. Match timezone to proxy country.

**Layer 3 — Trust**: 2-4 weeks of warming. Natural behavior. 90/10 rule. Build CQS before any marketing activity.

### Critical Mistakes That Chain Accounts

1. **Sharing proxies between accounts** — one banned account poisons the IP for all others
2. **Timezone/language mismatch** — Italian proxy + US timezone = suspicious
3. **Skipping warming** — new accounts jumping into marketing get flagged within days
4. **Identical behavior across accounts** — same posting times, same subreddits, same writing style
5. **Cross-account voting** — fastest trigger for network ban

**Source**: reppit.ai/blog/reddit-multi-account-setup

---

## 10. Moderator Tools (AutoModerator)

### What AutoModerator Is

A built-in bot provided to every subreddit. It evaluates each post and comment against a custom YAML ruleset written by that subreddit's moderators. Actions fire **before any human sees the content** — removing, filtering, approving, flaring, or reporting.

### What AutoMod Can Do

- Remove posts/comments matching specified criteria
- Approve content from trusted accounts
- Add flair automatically
- Send modmail when specific content appears
- Leave sticky comments on filtered posts
- Report content to moderators for human review
- Require specific post formats or title structures

### The Three Filter Layers (Diagnosis)

When you get "removed by Reddit's filters," it could be any of three layers:

| Layer | How to Identify | Appeal Path |
|-------|----------------|-------------|
| **1. Site-wide spam filter** | Posts disappear across MULTIPLE unrelated subreddits | Reddit Help Center appeal (admins) |
| **2. AutoModerator** | Instant removal in ONE specific subreddit while same content survives elsewhere | Modmail to that subreddit |
| **3. Human mod** | Post stays up for minutes/hours, gets engagement, THEN vanishes | Modmail with respectful explanation |

**Diagnostic test**: Post a harmless comment in 3-4 different subreddits. If ALL are invisible in logged-out view → Layer 1 (site filter). If only one → Layer 2 or 3.

**Source**: soar.sh/blog/reddit-removed-by-filters-three-layers-explained

### Common AutoMod Rules That Catch Marketers

| Rule Type | What It Checks | Typical Threshold |
|-----------|---------------|-------------------|
| Karma minimum | Combined or comment karma | 50–2,000 depending on sub |
| Account age | Days since creation | 7–90 days |
| Keyword blacklist | Banned words in title/body | Varies — "DM me," "link in bio," "buy now" |
| Domain blocking | URLs in post body | Specific domain blocklists |
| Post type restriction | Link vs. text vs. image | Subreddit-specific |
| Self-promotion ratio | % of posts linking to same domain | ~10% threshold |

### How to Avoid AutoMod Triggers

1. **Build your account first** — 30+ days old, 200+ comment karma, activity across multiple subreddits
2. **Write text posts, not link posts** — self-posts pass filters at significantly higher rates
3. **Match community language** — avoid promotional phrases, use the vocabulary the community uses
4. **Submit during peak hours** — active moderators are more likely to catch and reinstate false positives
5. **Avoid keyword triggers** — no "check out my [product]," no "DM me," no "link in bio"

### The Karma Feedback Loop

1. High karma → clears AutoMod thresholds → access to more subreddits
2. More subreddits → more content exposure opportunities
3. More exposure → more organic upvotes and karma
4. More karma → unlocks more communities + increases moderator trust
5. Higher moderator trust → borderline content gets approved rather than removed

### Checking If AutoMod Removed Your Post

- **Incognito window test**: Copy post URL, open in private browsing not logged in
- **Reveddit** (reveddit.com): Compares post history against what's publicly visible
- **Subreddit mod logs**: reddit.com/r/subredditname/about/log (if public)
- **Modmail**: Ask politely — moderators respond better to respectful requests

**Source**: upvote.net/blog/reddit-automoderator, soar.sh/blog/reddit-removed-by-filters-three-layers-explained

---

## Sources

1. **redaccs.com/reddits-ranking-algorithm/** — Reddit ranking algorithm deep dive, vote weight analysis, vote fuzzing explanation
2. **multilogin.com/glossary/reddit-algorithm/** — Six sort methods, account trust scores, Reddit-Google partnership, CQS
3. **indexthread.com/research/reddit-algorithm-visibility** — Academic analysis of feed/thread/discovery algorithms, Wilson score, early comment advantage
4. **indexthread.com/research/timing-and-velocity** — Thread velocity, timing strategies by platform, the two-hour attention window
5. **upvote.net/blog/best-time-to-post-on-reddit** — Data-backed timing guide with day-of-week and category-specific breakdowns, original controlled experiment
6. **upvote.net/blog/reddit-automoderator** — Complete AutoModerator guide: rules, karma thresholds, diagnosis, avoidance strategies
7. **redaccs.com/how-reddit-detects-fake-accounts/** — Four-layer bot detection stack: fingerprinting, behavioral, CQS, human review
8. **redaccs.com/age-importance/** — Account age performance data across 15 subreddits, niche-specific requirements
9. **chameleonmode.com/reddit-voting-manipulation-detection-what-patterns-trigger-automated-flags/** — Temporal clustering analysis, geographic detection, behavioral consistency checks
10. **redship.io/blog/reddit-self-promotion-rules** — Self-promotion framework, 90/10 rule, enforcement levels, subreddits that allow promotion
11. **upvote.net/blog/reddit-self-promotion** — Self-promotion rules, value-first framework, 90-day protocol
12. **signals.sh/blog/how-to-check-if-youre-shadowbanned-on-reddit-2026** — Three-method shadowban detection, six triggers, symptoms
13. **signals.sh/blog/reddit-shadowban-recovery-day-by-day** — 30-day recovery protocol, appeal guidance, decision points
14. **signals.sh/blog/reddit-100-karma-30-days-warmup-protocol** — 30-day karma building protocol, four phases, what to avoid
15. **soar.sh/blog/reddit-removed-by-filters-three-layers-explained** — Three filter layers (site, AutoMod, human), diagnosis, appeals
16. **reppit.ai/blog/reddit-multi-account-setup** — Multi-account infrastructure: proxies, anti-detect browsers, warming, mistakes
17. **signals.sh/blog/how-reddit-detects-sold-accounts-2026** — Ban evasion filter mechanics, login correlation signals, clean handover protocol
18. **piunikaweb.com/2026/03/06/reddit-disable-auto-ban-features-saferbot-hive-protect/** — March 2026 policy change on guilt-by-association bans
19. **auditsocials.com/blog/reddit-ban-suspension-policy-2026-shadowban-appeal-guide** — 2026 ban/suspension policy overview
20. **leadsfromurl.com/blog/best-subreddits-for-new-users-to-build-karma-2026** — Recommended subreddits for karma building

---

*Research compiled May 2026. Reddit's systems evolve continuously — validate specific thresholds and rules against current conditions before acting.*
