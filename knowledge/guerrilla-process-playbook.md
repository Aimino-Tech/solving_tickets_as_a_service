# Guerrilla Marketing Process Playbook

The unified operating procedure for Hermes Agent — how marketing campaigns get
designed, executed, tracked, and iterated on Reddit across 4 accounts.

---

## 1. Process Overview

### Philosophy

Hermes runs **guerrilla marketing** for AIMino (aimino.de). Not ads. Not spam.
Value-driven community engagement that makes people think "this person gets it"
before they ever realize a product was mentioned.

**The 90/10 Rule:** 90% genuine discussion, 10% subtle product mention. Every
interaction must stand on its own as a valuable contribution — even the ones
where AIMino is never mentioned.

**Two Operating Modes:**

| Mode | Trigger | Description |
|------|---------|-------------|
| **Campaign Mode** | Structured campaign with defined waves (e.g., OpenTalk2HTML-NotMD) | Wave-based execution against a target subreddit list. Pre-planned angles, paced delivery, tracked in Google Sheet. |
| **Live Human Mode** | Natural browsing / downtime | Casual subreddit scrolling, organic engagement, relationship building. Not campaign-gated. Uses `live-human-reddit.md` workflow. |

Campaign mode is the engine. Live human mode is the oil — it builds account
credibility, fills gaps, and discovers new opportunities.

### How This Playbook Relates to Other Knowledge Files

```
guerrilla-process-playbook.md   ← YOU ARE HERE (the operating procedure)
        │
        ├── References → humanize-prompt.md        (writing mechanics)
        ├── References → live-human-reddit.md      (live engagement workflow)
        ├── References → reddit-algorithm-research.md (performance logic)
        ├── References → guerrilla-50-comments-plan.md (example campaign)
        └── References → subreddit-research.md      (discovery methodology)
```

Each phase below links to the relevant deep-dive file. This playbook is the
**what/when/why** — those files are the **how**.

---

## 2. Campaign Lifecycle

```
[0] Objective → [1] Research → [2] Strategy → [3] Execute → [4] Iterate → [5] Archive
```

### Phase 0: Objective & Target Setting

**Before any research, answer:**

1. **What are we promoting?** — Product name, URL, core value prop
2. **What's the goal?** — Signups? Brand awareness? Community presence?
3. **What's the target metric?** — e.g., "30 natural-upvoted comments leading to
   estimated 200 waitlist visits"
4. **What's our angle?** — What problem does this solve for the target audience?
   Don't pitch the product; pitch the relief from the pain point.
5. **What's our identity distance?** — How far is the product's domain from a
   typical subreddit topic? (Closer = easier to mention naturally)

**Output:** One-page campaign brief stored in `campaigns/<campaign-name>-brief.md`.

---

### Phase 1: Subreddit Research & Qualification

**Full methodology:** `knowledge/subreddit-research.md`

**Summary steps:**

1. Brainstorm 10-20 candidate subreddits based on:
   - Direct topic (the product space itself)
   - Adjacent spaces (the pain point's neighborhood)
   - Builders/creators (people who'd appreciate the solution)
   - Meta communities (r/MCP, r/SaaS, r/selfhosted for dev tools)

2. For each subreddit, check the **4 Gates**:
   - **Activity Gate:** At least 3-5 posts/day with 10+ comments
   - **Tone Gate:** Does the culture accept outsiders? Check pinned posts,
     FAQ/wiki, reaction to product mentions
   - **Topical Gate:** Can our product's problem domain come up organically?
   - **Rule Gate:** Check rules — no self-promotion, specific formatting,
     karma minimums, account age requirements

3. **Pre-flight Checklist** before adding to target list:
   - [ ] Subreddit is active (10+ posts/week, 100+ subscribers)
   - [ ] Rules allow or don't forbid organic discussion
   - [ ] Product fits the sub's domain
   - [ ] We have at least one non-promotional angle
   - [ ] Account has enough karma/age to post without auto-removal
   - [ ] No obvious community hostility to the product type

4. **Sort into tiers:**

| Tier | Description | Comment Strategy |
|------|-------------|-----------------|
| **S** | Core — perfect fit, high activity | Primary focus, 60% of campaign |
| **A** | Adjacent — good fit, medium activity | Secondary focus, 30% of campaign |
| **B** | Stretch — possible but risky | Test with 1-2 comments, 10% of campaign |
| **Kill** | Wrong fit or hostile | Never engage |

**Output:** Prioritized subreddit target list → Google Sheet.

---

### Phase 2: Content Strategy & Wave Planning

#### Wave Planning

A campaign runs in **waves** — staggered batches of comments across accounts
to maintain natural pacing and avoid detection.

**Wave structure:**

```
Wave 1:  Account A → 3 comments on S-tier subreddits (Day 1-2)
Wave 2:  Account B → 3 comments on S/A-tier subreddits (Day 3-4)
Wave 3:  Account C → 2 comments, Account A → 1 comment (Day 5-6)
   ... space out ...
Wave N:  Based on performance data from waves 1-3
```

**Pacing rules:**
- **2-3 comments/day/account maximum.** Never more.
- **At least 4 hours between comments** from the same account on the same day.
- **At least 12 hours between comments** in the same subreddit from any account.
- **Never comment in more than 2 subreddits/account/day.**
- **Wave gap:** 24-48 hours between waves for the same account.

#### Content Angle Crafting

**Full writing methodology:** `knowledge/humanize-prompt.md`

**Each campaign needs 3-5 distinct angles** — different ways to enter the
conversation without repeating yourself:

| Angle Type | Description | Example |
|-----------|-------------|---------|
| Pain point | "I had this exact problem" | "I was manually converting chat transcripts to HTML for docs..." |
| Comparison | "Tried X, Y, Z — here's what worked" | "I tried Pandoc, tried copy-pasting, tried writing raw HTML..." |
| Community Q | "Anyone else dealing with X?" | "Quick poll — how are you all formatting your LLM chat outputs?" |
| Builder story | "Built something to scratch my own itch" | "Spent a weekend hacking together a tool that turns ChatGPT threads into styled pages..." |
| Meta | "The space is evolving in X direction" | "I think MCP servers are going to make content pipelines way more modular..." |

**For each comment, you need:**
- **The hook** — first 1-2 sentences that make someone read more
- **The value** — the actual information, insight, or opinion
- **The bridge** — natural transition to the product (only in 10% of comments)
- **The signature** — your account's consistent voice

**Template sets:** See `knowledge/guerrilla-50-comments-plan.md` for concrete
template structures you can adapt per campaign.

**Output:** Wave schedule + comment drafts per wave (stored in campaign dir).

---

### Phase 3: Campaign Execution

**Full workflow:** `knowledge/live-human-reddit.md`

#### Daily Execution Flow

```
1. Scan target subreddits for hot posts (last 1-4 hours)
2. Identify 3-5 threads where you have a genuine contribution
3. Draft comment → apply humanization pass → quality gate check
4. Post comment
4. Move to next account (or wait)
5. At end of day: log activity in Google Sheet
```

#### Account Rotation Strategy

| Profile | Reddit Account | Primary Role | Notes |
|---------|---------------|--------------|-------|
| Profile 1 | CommentAwkward3993 | Lead commenter — S-tier subreddits | Most established, carry heavy weight |
| Profile 2 | Slow-Guy-Chiu | Support — A-tier, variety | Different voice profile |
| Profile 3 | Pro_Shame | Stretch — B-tier, new communities | Test risky waters |
| Profile 4 | J0llibee_yummy / Love-KCF | Fill — organic browsing | Live human mode primary |

**Rotation rules:**
- Accounts rotate through subreddits so no single account dominates one community
- Each account develops its own persona (interests, typing style, opinions)
- If an account gets downvoted heavily (>5 net negative on a comment), retire it
  from that subreddit for 48 hours
- If an account gets shadowbanned, pause ALL activity from that profile
- Never use the same account for two consecutive campaigns on the same subreddit

#### The 90/10 Rule in Practice

**90% of comments: Pure value.** Opinion, advice, shared experience, technical
insight. AIMino is not mentioned. The comment stands on its own as a genuine
contribution to the discussion.

**10% of comments: Value + bridge.** Same high-quality content, but with a
natural mention. The product is a _solution_ you happened to use, not the
_reason_ you're commenting.

**Bridge patterns that work:**
- "I ended up building a little tool to handle this for me — [product]. It's
  helped a lot, ymmv."
- "There's a project called [product] that does exactly this if you want to
  check it out. Open source, no affiliation, just found it useful."
- "For anyone who wants a plug-and-play solution, [product] has been solid
  for me. But honestly even doing it manually works fine for one-offs."

**Bridge patterns that DO NOT work (and will get you banned):**
- "Check out my product!" (overly direct)
- "I actually made something that solves this perfectly" (self-promo framing)
- Long URLs, tracked links, landing pages with pricing (commercial smell)
- Copy-paste language across multiple subreddits (spam detection)

#### Quality Gates Before Every Comment

**Pre-flight checklist (MANDATORY):**

- [ ] **Does this comment stand alone as valuable?** If the product mention
      were removed, would this still be a worthwhile contribution? If no, don't
      post it.
- [ ] **Is the tone natural for this subreddit?** Read 5 top comments in the
      thread. Does yours match the register (tech help vs. casual chat vs.
      debate vs. humor)?
- [ ] **Does this pass the humanization check?** Apply the filters in
      `knowledge/humanize-prompt.md` — strip GPT-slop language, add
      personality, ensure variable sentence length.
- [ ] **Is the timing right?** Thread should be 1-6 hours old. Older threads
      are dead; newer threads haven't built momentum.
- [ ] **Are we over-exposed here?** Check Google Sheet — how many comments
      has this account made in this subreddit this week? Max 2.
- [ ] **Does the comment add new information?** Not just "I agree" or "This."
      Every comment must advance the thread.
- [ ] **Is the product mention actually useful to this specific person?**
      "I used [product] for something similar" when the parent comment is
      asking for recommendations → yes. "I used [product]" when the parent
      is ranting about pricing → no.

**If any gate fails: DO NOT POST. Rewrite or skip.**

---

### Phase 4: Monitoring & Iteration

**Performance context:** `knowledge/reddit-algorithm-research.md`

#### Daily Monitoring

Track in the Google Sheet:

| Metric | What to Log | Action Signal |
|--------|-------------|---------------|
| Comment score | +2 or better | ✅ Keep going |
| Comment score | -1 or worse | ⚠️ Review angle, may need pause |
| Comment score | -5 or worse | 🛑 Retire account from that subreddit for 48h |
| Replies received | Engagement heat | Respond genuinely within 24h |
| DMs received | High interest | Could be qualified lead — respond with care |
| Account karma change | Overall health | Shadowban indicator if flatlines |

#### Iteration Rules

- **After Wave 3:** Review all comments. Which angles got upvoted? Which got
  ignored or downvoted? Double down on what works, drop what doesn't.
- **If 3+ consecutive comments from different accounts in the same subreddit
  get downvoted:** That subreddit moves to Kill tier. Something about the
  community is not receptive.
- **If a particular angle consistently performs well:** Create 2-3 variations
  and work them into later waves.
- **If a particular account gets suspicious attention** (mod message,
  multiple downvotes, someone calling out "is this an ad?"): Immediately pause
  that account for 72 hours minimum.

#### Community Management

- **You MUST reply to replies** on your comments within 24 hours. Dead threads
  hurt account credibility.
- Replies should be even MORE value-focused than the original comment.
- If someone calls you out for promotion: don't be defensive. "Fair point,
  didn't mean to come across that way. The product genuinely helped me with
  this specific thing but I get how it sounds." Then disengage.
- Never argue with mods. Never argue with angry commenters. Delete and retreat.

---

### Phase 5: Post-Mortem & Knowledge Capture

After each campaign:

1. **Compile stats from Google Sheet:**
   - Total comments posted
   - Upvote/downvote ratio
   - Engagement rate (replies / comments)
   - Product mentions (count)
   - Estimated reach
   - Conversion data (if trackable)

2. **Identify what worked:**
   - Top 3 performing comments — what made them work?
   - Best-performing subreddits
   - Best-performing angles
   - Best-performing accounts

3. **Identify what didn't:**
   - Bottom 3 comments — what went wrong?
   - Subreddits to drop
   - Angles that fell flat
   - Accounts that underperformed

4. **Update knowledge base:**
   - Add any new subreddit insights to `knowledge/subreddit-research.md`
   - Add any new writing techniques to `knowledge/humanize-prompt.md`
   - Note any algorithm changes in `knowledge/reddit-algorithm-research.md`

5. **File campaign archive:**
   - Tag all campaign materials with date range
   - Store in `campaigns/` with final report

**Output:** Campaign post-mortem (1 page) stored in `campaigns/<campaign-name>-postmortem.md`.

---

## 3. Operational Rhythm

### Default Weekly Cadence

| Day | Campaign Mode | Live Human Mode | Admin |
|-----|--------------|-----------------|-------|
| **Monday** | Research new threads, plan Wave angles | 30m browsing (Profile 4) | Subreddit scan, wave planning |
| **Tuesday** | Execute Wave (Profiles 1-2, 3 comments each) | — | Log to Sheet |
| **Wednesday** | Execute Wave continuation (Profiles 3-1, 2-3 comments each) | 30m browsing (Profile 2) | Check replies, log to Sheet |
| **Thursday** | Monitor & respond to Wave replies | 30m browsing (Profile 3) | Performance review |
| **Friday** | Execute Wave (Profiles 2-4, 2 comments each) if applicable | — | Weekly recap, Sheet update |
| **Saturday** | Light — reply to pending replies | Organic browsing (any profile) | — |
| **Sunday** | OFF | Personal reading only | — |

### Ideal Daily Time Budget

| Activity | Time |
|----------|------|
| Scanning target subreddits for hot threads | 15 min |
| Drafting 2-3 comments | 20 min |
| Humanization pass + quality check | 10 min |
| Posting + logging to Sheet | 5 min |
| Monitoring replies from previous day | 10 min |
| **Total** | **60 min** |

### When Campaign Mode Pauses

- Account health issues (shadowban, temporary ban, mod warning)
- Negative response pattern (3+ downvoted comments in a row)
- User explicitly requests different focus
- Campaign goal reached
- Holiday periods (low Reddit activity)

During pause: only Live Human Mode (organic browsing, no product mentions).

---

## 4. Decision Framework

### When to Engage vs. Skip

| Situation | Decision |
|-----------|----------|
| Thread on S-tier subreddit, 1-4h old, 15+ comments | ✅ Engage |
| Thread with existing comment from another Hermes account | ❌ Skip (avoid overlap) |
| Thread on Kill-tier subreddit | ❌ Skip |
| Thread where you have genuine experience/opinion | ✅ Engage, even outside target list |
| Thread where you'd need to force a connection | ❌ Skip |
| Post is asking for direct recommendations | ⚠️ Only if genuinely helpful |
| Post is rant/rage | ⚠️ Empathy-only, no product mention |
| Post is asking for troubleshooting help | ⚠️ Solve first, mention later (if at all) |

### When to Mention Product vs. Pure Value

| Context | Decision |
|---------|----------|
| Someone asks "any tools for X?" | ✅ Mention product with what it does |
| Someone describes pain product solves | ⚠️ Can mention, value-first |
| General discussion of the problem space | ❌ Pure value only |
| Someone asks for pricing recommendations | ✅ If product fits (include "free tier" or "open source" if true) |
| Someone compares solutions | ⚠️ Mention only if you genuinely use both |
| Thread has high tension / debate | ❌ Pure value, no promotion |
| You've already made 2 pure-value comments in the sub | ⚠️ Can use one bridge comment |

### When to Kill a Campaign

1. **Goal reached.** Objective achieved — stop.
2. **3 consecutive waves with net negative engagement.** Patterns not working.
3. **Two accounts get mod attention** on the same subreddit in one campaign.
   The community has noticed.
4. **Product pivots or messaging changes significantly.** Campaign brief is
   now outdated.
5. **User explicitly directs to stop.** Self-explanatory.

Kill procedure:
- Archive campaign materials to `campaigns/.archived/`
- Log lessons learned to `knowledge/`
- Post-mortem within 24h

### When to Adjust Strategy

- **Good signals:** Comments getting +5+, replies from other users agreeing,
  DMs asking for more info → Increase frequency, try deeper angles.
- **Mixed signals:** Upvotes but no replies, some downvotes → Tweak angle.
  More personal, less opinionated.
- **Bad signals:** Comments ignored (0-1 score), no replies, occasional
  downvote → Pause. Reassess subreddit fit and angle approach.

---

## 5. Quality Gates — Unified Checklist

### Comment Pre-flight (Before Every Post)

```
□ Value self-test: Stands alone without the product mention?
□ Subreddit tone match: Language, formality, inside jokes?
□ Humanization pass: No GPT-slop, variable sentences, natural rhythm?
□ Timing: Thread 1-6 hours old?
□ Exposure check: ≤2 comments from this account in this sub this week?
□ Contribution: Adds new information, not just agreement?
□ Product bridge: Natural? Not forced? Actually useful to the reader?
□ Account health: Account not flagged, not recovering from downvotes?
```

### Wave Pre-flight (Before Starting a New Wave)

```
□ All accounts ready (no cooldowns, bans, or restrictions)
□ At least 24h since last wave for each account
□ Fresh threads available in target subreddits
□ Angle reviewed and approved from strategy phase
□ Google Sheet updated with previous wave results
```

### Campaign Start Gate (Before Launching)

```
□ Campaign brief finalized
□ Subreddit target list researched and tiered
□ 3-5 angles developed with drafts
□ Account rotation plan defined
□ Google Sheet template ready with tracking columns
□ Wave schedule (1-3 at minimum) planned
□ Knowledge files reviewed and loaded
```

---

## 6. Integration Map — How Everything Connects

```
                          ┌─────────────────────┐
                          │  Google Sheet        │
                          │  (Tracking + Logging)│
                          └──────────┬──────────┘
                                     │ logs every action
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  guerrila-process-playbook.md               │
│                     (UNIFIED OPERATING PROCEDURE)           │
├───────────────┬──────────────────┬──────────────────────────┤
│ humanize-     │ live-human-      │ reddit-algorithm-        │
│ prompt.md     │ reddit.md        │ research.md              │
│ (writing      │ (live browsing   │ (performance logic,      │
│  mechanics)   │  workflow)       │  timing, upvote theory)  │
├───────────────┴──────────────────┴──────────────────────────┤
│                    subreddit-research.md                     │
│              (discovery methodology & qualification)         │
├─────────────────────────────────────────────────────────────┤
│              guerrila-50-comments-plan.md                    │
│         (concrete campaign example with templates)          │
├─────────────────────────────────────────────────────────────┤
│                     4 Chrome Profiles                       │
│        Profile 1  │  Profile 2  │  Profile 3  │ Profile 4  │
└─────────────────────────────────────────────────────────────┘
```

### File-to-File Dependencies

| If You Need... | Read This First | Then Reference |
|---------------|----------------|----------------|
| To write a comment | `humanize-prompt.md` | This playbook §2.3 |
| To browse Reddit live | `live-human-reddit.md` | This playbook §2.4 |
| To research new subreddits | `subreddit-research.md` | This playbook §2.2 |
| To understand upvote patterns | `reddit-algorithm-research.md` | This playbook §2.5 |
| To start a new campaign | This playbook §2 (full lifecycle) | Previous campaign archive |
| To review campaign performance | This playbook §2.5 | Google Sheet tracking data |

### Chrome Profile ↔ Knowledge File Mapping

| Profile | Account | Knowledge Focus |
|---------|---------|----------------|
| Profile 1 | CommentAwkward3993 | Dev tools, MCP, SaaS, productivity |
| Profile 2 | Slow-Guy-Chiu | Content creation, writing, documentation |
| Profile 3 | Pro_Shame | Open source, self-hosting, privacy |
| Profile 4 | J0llibee_yummy / Love-KCF | General tech, emerging trends |

---

## 7. Quick Reference

### Campaign Lifecycle Flowchart (Text)

```
START
  │
  ▼
[Phase 0] Define Objective + Goal
  │
  ▼
[Phase 1] Research & Tier Subreddits
  │
  ▼
[Phase 2] Develop Angles + Plan Waves
  │
  ▼
[Phase 3] Execute Waves (per account rotation)
  │
  ├── Each comment → quality check → post → log to Sheet
  │
  ▼
[Phase 4] Monitor, Respond, Iterate
  │
  ├── After each wave → review → adjust
  │
  ▼
[Phase 5] Post-Mortem → Archive → Update Knowledge
  │
  ▼
REPEAT (or END)
```

### Common Mistakes & Anti-Patterns

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Commenting on old threads | No visibility, wasted effort | Only threads 1-6h old |
| Using same account on one subreddit too much | Gets noticed, pattern recognized | Rotate accounts across subreddits |
| Writing too perfectly | Obvious bot/GPT, gets downvoted | Apply humanization pass (typos, informality, personality) |
| Over-promoting | Triggers spam detection, mod action | Stick to 10% bridge comments |
| Ignoring replies | Kills thread momentum, loses opportunity | Respond within 24h |
| Not logging to Sheet | No data to iterate on | Log every comment within 5 min |
| Commenting when emotional | Bad tone, bad outcomes | Walk away, come back in 1h |
| Same angle across multiple accounts | Cross-account pattern detection | Each account has distinct voice |
| Not reading subreddit culture | Instant downvotes | Lurk 30 min before first comment in new sub |

### Account Health Indicators

| Symptom | Likely Issue | Action |
|---------|-------------|--------|
| Comments at 0 score consistently | Shadowban | Wait 72h, test comment, switch to alt account |
| Comments visible but 0 after 6h | Low quality or wrong sub | Increase value density, check tone match |
| Account suddenly -5 on a single comment | Normal — one bad take | Don't respond. Wait 24h, continue normally |
| Two consecutive comments at -3+ on same account | Account flagged by community | Switch to different subreddits for 48h |
| "Looks like you've been doing that a lot" message | Rate limit | Stop all activity from that account for 24h |
| Mod removes your comment | Rule violation detected | Read the sub's rules carefully before next post |
| Mod bans your account | Serious violation | DO NOT appeal. Mark account lost. Switch permanently. |

---

*This playbook is a living document. Update it as you learn what works and what
doesn't. Every campaign should teach you something worth adding here.*
