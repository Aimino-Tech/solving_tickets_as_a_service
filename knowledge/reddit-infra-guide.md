# Reddit Campaign Infrastructure Guide

**Purpose:** Prevent infrastructure-based detection and account correlation during guerrilla marketing operations.
**Context:** Rooted in the June 2026 takedown where 7 accounts were shadowbanned due to shared IP, shared fingerprint, and unenforced pacing.
**Philosophy:** Reddit's Ban Evasion Filter is a hard correlation match on connection-level signals. It does not analyze writing style or content. If the buyer-side environment is clean (fresh IP, fresh browser, no shared infrastructure), the filter does not trigger. Infrastructure isolation is not optional — it is the entire defense.

---

## 1. How Reddit's Ban Evasion Filter Works

Per Reddit's documentation, the Ban Evasion Filter scores incoming posts/comments against a confidence ladder (low/medium/high). It is an **opt-in subreddit-level tool**. Moderators choose a confidence level and lookback window.

**What it matches on (connection-level only):**

- IP range overlap with previously banned accounts
- Device fingerprint collisions
- Cookie and localStorage residue matches

**What it does NOT match on:**

- Writing style or content patterns
- Behavioral cadence or posting frequency
- Which subreddits an account posts in (guilt-by-association bans were disabled March 2026)

**Critical implication:** A clean infrastructure setup (unique IP + unique fingerprint + no shared cookies) will NOT trigger the Ban Evasion Filter, even if the account is posting in the same subreddits as a previously banned account. The filter is purely correlation-based.

**Source:** `knowledge/reddit-algorithm-research.md` lines 397-417.

---

## 2. Proxy Requirements

**Minimum viable setup: 5-10 residential proxies, one per account.**

| Requirement | Non-Negotiable? | Why |
|-------------|----------------|-----|
| Residential IPs (not datacenter, not VPN) | Yes | Datacenter IPs are pre-flagged. VPN exit nodes are on blocklists. Residential IPs from real ISPs are the only reliable option. |
| One IP per account | Yes | Two accounts on one IP = correlated. When one gets banned, both are lost. |
| Geo-diverse across accounts | Strongly recommended | Five accounts from five German cities is fine. Five accounts from one German city is suspicious. Mix Germany, Netherlands, Austria, Spain, Sweden. |
| No known provider IPs | Yes | Avoid major proxy sellers (BrightData, Oxylabs, SmartProxy, SOAX) whose IP ranges are cataloged. Use smaller providers or buy from residential ISP resellers. |
| Sticky sessions (IP doesn't change mid-session) | Yes | An account switching IPs mid-conversation is a stronger red flag than one static IP. |
| Rotating only on explicit trigger | Yes | Rotate IP only when the account is retired or the IP gets flagged. Do not rotate daily — that creates its own suspicious pattern. |

**Blocked proxy types:**

- VPN services (NordVPN, ExpressVPN, Mullvad, ProtonVPN)
- Datacenter proxies (AWS, GCP, DigitalOcean, Hetzner)
- Free web proxies
- Tor exit nodes
- Public SOCKS5 lists

**Check each proxy before use:**

```bash
# Test if IP is accessible (no block page)
curl -x http://proxy:port -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130" \
  https://www.reddit.com/ 2>&1 | grep -i "blocked\|security\|captcha"

# Should return clean HTML, not a block page.
```

---

## 3. Anti-Detect Browser Setup

Regular Chrome profiles are not isolated enough. Canvas fingerprinting, WebGL rendering, font enumeration, and audio context processing all produce consistent results across profiles on the same machine, making them trivially linkable.

### Recommended Approach: Anti-Detect Browser

Use AdsPower, GoLogin, Multilogin, or Dolphin Anty. These applications create fully isolated browser environments where every fingerprint parameter is randomized per profile.

**Minimum required fingerprint randomization per profile:**

| Signal | Requirement | What to Set |
|--------|-------------|-------------|
| User agent | Unique per account | Match to a real browser version. Vary between Chrome/Firefox/Edge across accounts. |
| Screen resolution | Unique per account | Vary by 100-200px. Match common real resolutions (1920x1080, 1440x900, 1366x768). |
| Timezone | Match proxy country | German IP + Europe/Berlin. Spanish IP + Europe/Madrid. Mismatch = instant flag. |
| Language | Match proxy country | de-DE for German IP, es-ES for Spanish IP. |
| Platform | Vary per account | Win32, Win64, MacIntel, Linux x86_64. |
| Canvas fingerprint | Auto-randomized | Anti-detect browsers handle this. Never disable — randomization is the point. |
| WebGL vendor/renderer | Auto-randomized | Each profile renders a slightly different WebGL image. |
| Font list | Auto-randomized | Different subsets of installed fonts per profile. |
| Audio context | Auto-randomized | Slight variations in audio processing pipeline. |
| WebRTC | Disabled or proxy-only | Prevents real IP leak. Set to "proxy-only" mode. |
| Client rects | Auto-randomized | Slight variations in DOM measurement results. |

### Per-Profile Data Isolation (Critical)

| Item | Requirement |
|------|-------------|
| Cookies | **Must NOT be shared.** Each profile must have its own cookie store. This is the most common leak. |
| localStorage | Isolated per profile. |
| IndexedDB | Isolated per profile. |
| Extensions | Same set = correlation risk. Vary installed extensions per account cluster. |
| Browser cache | Isolated per profile. |

---

## 4. Per-Account Isolation Checklist

Before creating or using any account, verify:

```
□ Account has its own unique residential IP (not shared with any other account)
□ Account has its own anti-detect browser profile (unique fingerprint across all signals)
□ Account's proxy geolocation matches its browser timezone and language
□ Account's cookies are fully isolated (no cross-profile leakage)
□ Account has its own email (not shared — burner emails are fine as long as they're unique)
□ Account has no connection to any other account's phone number or recovery method
□ Account's browser profile has WebRTC disabled (no real IP leak)
□ Account's IP passes the pre-flight curl test (no block page from Reddit)
```

---

## 5. IP Rotation Strategy

### Rotation Rules

| Situation | Action |
|-----------|--------|
| IP gets flagged (returns Reddit block page) | Immediately remove from rotation. Do not create new accounts on it. |
| Account shadowbanned | **Do not rotate the IP.** The IP now has negative reputation. Retire it with the account. |
| Account completed its lifecycle | Retire the IP. It has been associated with a marketing account and cannot be reused cleanly. |
| IP health check fails | Remove from pool. Flag for replacement. |

### Health Checks (Run Weekly)

```bash
# Test 1: Desktop UA on www.reddit.com (should return clean, no block page)
curl -s -x http://proxy:port -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0" \
  https://www.reddit.com/ | grep -c "BLOCKED\|blocked\|Security\|captcha"

# Test 2: API endpoint (should return 200, not 403)
curl -s -o /dev/null -w "%{http_code}" -x http://proxy:port \
  -A "Mozilla/5.0" https://www.reddit.com/.json
```

**Score:** 0 blocks = clean. 1+ blocks = retire IP.

### Proxy Pool Size

| Accounts | Minimum Proxies | Recommended |
|----------|----------------|-------------|
| 1-3 | 3 | 5 |
| 4-7 | 7 | 10 |
| 8-15 | 15 | 20 |

One proxy per account, plus 2-3 spares for rotation when IPs get burned.

---

## 6. Account Lifecycle

### Phase 1: Creation (Day 0)

- Use unique email per account (protonmail, tutanota, or disposable domains)
- Use unique IP from the proxy pool
- Create account from a NEW anti-detect profile (not one that's been used)
- Complete verification (email + phone if required) with unique phone number
- **Do NOT immediately customize the account** — no bio, no avatar, no profile edits. Reddit watches new accounts.

### Phase 2: Warm-up (Day 1-30)

**Goal:** Build CQS (Contributor Quality Score), karma, and account age before any marketing activity.

| Week | Activity | Daily Limit |
|------|----------|-------------|
| 1 | Browse only. No posts, no comments, no votes. Read the frontpage for 10 min/day. | 0 |
| 2 | Upvote 5-10 posts/day. Leave 1-2 low-stakes comments in safe subreddits (r/AskReddit, r/funny, r/aww). Comment must be genuinely on-topic. | 1-2 comments |
| 3 | 2-3 comments/day across varied subreddits. No pattern. No product mentions. | 2-3 comments |
| 4 | 3-4 comments/day. Can start posting in campaign-relevant subreddits for non-campaign content. Still no marketing. | 3-4 comments |

**Signs the account is ready for campaign use:**

- 100+ comment karma
- 30+ days old
- Activity in 5+ unrelated subreddits
- No AutoMod removals in the last 7 days
- Posts visible to logged-out users (incognito check)

### Phase 3: Active Campaign (Day 31+)

- Follow pacing rules exactly (see playbook §2.2 Wave Planning)
- 2-3 comments/day/account maximum
- At least 4 hours between comments from the same account
- Never post in more than 2 subreddits per day per account
- 90/10 value-to-bridge ratio
- Daily shadowban check (see §7)

### Phase 4: Retirement

- Retire an account when:
  - It has been flagged (shadowban, mod ban, or consistent 0-score comments)
  - It has completed 3+ campaigns and accumulated visible posting history
  - The account IP has negative reputation
- **Retirement = permanent.** Do not attempt to recover shadowbanned accounts.
- Archive account metadata (not passwords/credentials) to tracking sheet for reference.

---

## 7. Monitoring Setup

### Daily Shadowban Check (MANDATORY)

**Method:** Check user page on old.reddit.com.

```bash
curl -s -x http://proxy:port \
  "https://old.reddit.com/user/{username}/" | \
  grep -oP '<title>\K[^<]+'
```

- Active user: `<title>overview for {username}</title>`
- Shadowbanned: `<title>u/{username}: page not found (or similar)</title>`

**Automated check:** Run this for all accounts daily. Log results. If any account shows "page not found", immediately:
1. Stop all activity from that account
2. Flag the account's IP as potentially burned
3. Do not create new accounts on that IP

### Weekly Proxy Health Check

Run the curl tests from §5 against every proxy in the pool. Log passing/failing status.

### Activity Log Review

- Cross-reference daily comment counts against pacing rules
- If any account exceeded 3 comments in a day, investigate and add tooling to prevent recurrence
- If any IP is used by more than one account, flag immediately (this should never happen)

### Google Sheet Integration

The tracking sheet should have columns for:
- Date
- Account
- IP (proxy used)
- Comment count (day)
- Cumulative comments (week)
- Shadowban status (pass/fail from automated check)
- IP health (pass/fail from weekly test)

---

## Quick Reference Card

```
BEFORE CREATING ACCOUNTS:
  □ 5-10 residential proxies (one per account, geo-diverse)
  □ Anti-detect browser installed (AdsPower/GoLogin/Multilogin/Dolphin Anty)
  □ Proxy pre-flight test passed for each IP
  □ Infrastructure isolation plan documented

PER ACCOUNT:
  □ Unique IP
  □ Unique browser fingerprint (all signals)
  □ Timezone + language match proxy country
  □ WebRTC disabled
  □ Unique email address
  □ Anti-detect profile fully randomized

WARM-UP (30 days minimum):
  □ Week 1: Browse only
  □ Week 2: 1-2 comments/day (safe subs)
  □ Week 3: 2-3 comments/day (varied subs)
  □ Week 4: 3-4 comments/day (pre-campaign)
  □ Milestone: 100+ karma, 30+ days, clean record

DURING CAMPAIGN:
  □ Max 3 comments/day/account
  □ Min 4h between comments (same account)
  □ Max 2 subreddits/day/account
  □ 90/10 value-to-bridge ratio
  □ Daily shadowban check
  □ Weekly proxy health check

ON DETECTION:
  □ Shadowbanned account → stop immediately → retire account + IP
  □ Flagged IP → remove from pool → do not reuse
  □ Never attempt recovery — accounts are dead at shadowban
```

---

*Infrastructure is the foundation. Without isolation, content quality and pacing discipline cannot protect you. Every account that gets burned is infrastructure cost, not content failure.*
