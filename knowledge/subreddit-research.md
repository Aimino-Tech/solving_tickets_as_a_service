# Subreddit Research & Community Adaptation Guide

> **Purpose**: Systematically research any subreddit's rules, culture, and tone before posting — so every engagement passes AutoMod, survives mod review, and gets upvoted by the community.
> **Philosophy**: Every subreddit is its own country. Laws, language, customs, and sense of humor vary. You wouldn't walk into a foreign city and start handing out flyers. Same principle applies here.
> **Pre-requisite**: Read `knowledge/reddit-algorithm-research.md` for timing and ranking mechanics. Read `knowledge/humanize-prompt.md` for human-sounding content generation.

---

## Table of Contents

1. [The Research Workflow](#1-the-research-workflow)
2. [Reading the Rules — What to Look For](#2-reading-the-rules--what-to-look-for)
3. [Reading the Room — Culture & Tone](#3-reading-the-room--culture--tone)
4. [Key Terminology & Reddit Infrastructure](#4-key-terminology--reddit-infrastructure)
5. [Subreddit Profiles](#5-subreddit-profiles)
   - [r/MCP](#rmcp)
   - [r/selfhosted](#rselfhosted)
   - [r/SaaS](#rsaas)
   - [r/ClaudeAI](#rclaudeai)
6. [Quick-Reference Checklists](#6-quick-reference-checklists)
7. [Testing Your Post — The Pre-Flight Check](#7-testing-your-post--the-pre-flight-check)

---

## 1. The Research Workflow

Every subreddit engagement follows this pipeline. Do not skip steps.

```
Phase 1: Discovery     →  Phase 2: Rules Audit    →  Phase 3: Room Reading
→  Phase 4: Draft      →  Phase 5: Adapt & Verify  →  Phase 6: Post & Monitor
```

### Phase 1 — Discovery (5 min)

Find the subreddit's information sources:

| Source | Where to Find It | What It Contains |
|--------|-----------------|------------------|
| **Sidebar** | Right column on old.reddit.com, "About" tab on mobile/new Reddit | Rule summary, member count, brief description |
| **Rules page** | `reddit.com/r/SUBREDDIT/about/rules/` | Full rule list with descriptions |
| **Wiki** | `reddit.com/r/SUBREDDIT/wiki/` or sidebar link | Extended guidelines, posting guides, FAQ |
| **Pinned posts** | Top of the subreddit feed sorted by Hot | Weekly threads, rule announcements, megathreads |
| **Subreddit info API** | Via MCP tools: `get_subreddit_info("subreddit")` | Metadata, rules list, subscriber count, description |
| **Related communities** | Sidebar or wiki "Related Subreddits" section | Adjacent communities (hand-curated by mods) |

### Phase 2 — Rules Audit (10 min)

Read every rule. Do not skim. For each rule, ask:

1. **What exactly is banned?** "No self-promotion" could mean anything from "no links at all" to "no unsolicited DMs."
2. **What are the exceptions?** Weekly feedback threads? Show-off Saturdays? Mod-approval?
3. **What's the enforcement style?** First offense = warning? Instant ban? Shadowban?
4. **What are the formatting requirements?** Required flair? Title templates? "[Review]" or "[Showcase]" prefixes?
5. **Are there karma/age gates?** Some subs hide minimums in the wiki or AutoMod config.
6. **What gets your URL blacklisted?** Repeated promotion of the same domain.

### Phase 3 — Room Reading (15 min)

Before typing a single word, absorb the community's character:

**Step 1 — Sort by "Top — This Month"**
- What topics get the most upvotes?
- What's the typical post length? (200 words? 2,000?)
- What's the tone of top comments? (Jokey? Academic? Blunt?)

**Step 2 — Sort by "New" for 10-15 posts**
- What gets removed? (Check Reveddit or incognito mode)
- What survives with 0 upvotes? (The community's indifference threshold)
- What gets instantly downvoted to 0?

**Step 3 — Read 5-10 comment threads deeply**
- Do top comments agree or disagree with the OP?
- Is there a community dialect? (Inside jokes, recurring references, specific jargon)
- How do members correct each other? (Helpful? Hostile?)
- What brands/tools/products get mentioned positively? Negatively?

**Step 4 — Search for your topic/competitor**
- `site:reddit.com/r/SUBREDDIT "competitor name"` — how have similar products been received?
- Search for "[product type] recommendation" — how do members ask for recs?
- Search for "I built" or "I made" — what pattern do these posts follow?

### Phase 4 — Draft (see humanize-prompt.md for full guidance)

### Phase 5 — Adapt & Verify

Run your draft through the checks in section 7 before posting.

### Phase 6 — Post & Monitor

- Post during peak hours for that subreddit category
- Stay online for the first 60 minutes to reply to comments
- If removed, modmail politely (do NOT repost)
- If it flops, diagnose: wrong timing? wrong angle? wrong tone?

---

## 2. Reading the Rules — What to Look For

### Common Rule Categories

| Category | What To Watch For |
|----------|------------------|
| **Self-promotion** | Is it banned outright? Allowed in megathreads only? Once per X days? Does "self-promotion" include mentioning your project in comments? |
| **Spam** | What velocity triggers removal? More than 1 post/week? Same URL repeated? |
| **Post quality** | Minimum length? Effort expectations? "Low-effort" removals are at mod discretion |
| **Flair requirements** | Is flair mandatory? Is there a specific "Promotion" or "Self-Post" flair? |
| **Title formatting** | Required brackets? `[Showcase]`, `[Question]`, `[Help]` — some subs auto-remove non-conforming titles |
| **Account requirements** | Minimum age? Minimum karma in that subreddit specifically? |
| **Feedback/launch posts** | Many subs relegate these to weekly megathreads. Posting outside = removal |
| **Blog posts / external links** | Some subs ban link posts entirely. Text-only with link in comments. |
| **Disclosure** | Affiliation disclosure required? "I built this" vs hiding it |

### The 3 Enforcement Tiers

| Tier | Typical Rule Language | What It Means |
|------|----------------------|---------------|
| **Permissive** | "Self-promotion is allowed but keep it reasonable" | Wide latitude but mods have discretion. 90/10 rule still applies. |
| **Restricted** | "No self-promotion. Use the weekly thread." | Zero tolerance outside the designated channel. Even genuine answers mentioning your product risk removal. |
| **Banned** | "No promotional content of any kind" | Don't mention your product. Don't link. Don't even hint. |

### Where Rules Hide

Not all rules are in the sidebar. Check:

1. **The wiki** — often has detailed posting guidelines not summarized in the sidebar
2. **Pinned "Welcome" or "Rules Update" posts** — recent rule changes live here
3. **AutoMod removal messages** — when your post gets removed, the modmail may explain *why* with specific rule references
4. **Old Reddit sidebar** (`old.reddit.com/r/SUBREDDIT`) — sometimes has more detail than new Reddit
5. **Submission page** — the "submit a post" page often has inline rules or reminders

---

## 3. Reading the Room — Culture & Tone

### The Seven Axes of Subreddit Culture

Analyze every subreddit along these axes:

| Axis | Spectrum | How to Measure |
|------|----------|----------------|
| **Technical depth** | Casual ↔ Expert | Do top posts assume prior knowledge? Are comments full of jargon/acronyms? |
| **Promotional tolerance** | Welcoming ↔ Hostile | Search "I built" — what happens? Ratio of positive to negative reactions. |
| **Humor level** | Deadpan ↔ Jokey | Look at top comments on serious posts. Memes in comments? |
| **Formality** | Structured ↔ Chaotic | Post templates? Required flairs? Title formatting rules? |
| **Negativity/cynicism** | Supportive ↔ Skeptical | Do members default to trust or suspicion? How do they treat newcomers vs veterans? |
| **Commercial vs OSS** | Paid-product friendly ↔ Open-source only | Mention pricing — does it get upvoted or buried? |
| **Recurring hot topics** | What keeps coming up | Check "Top — Month" for 3 months running. These are the community's obsessions. |

### Tone Signals to Observe

| Signal | What It Tells You |
|--------|-------------------|
| **Upvoted comments use jargon freely** | Technical audience — precision matters more than accessibility |
| **Top posts are personal stories** | Narrative-first culture — data dumps will feel out of place |
| **Frequent "well actually" corrections** | Pedantic culture — get your facts exact |
| **Short, punchy comments dominate** | Efficiency culture — long posts get skimmed or skipped |
| **"I built" posts get 80% positive engagement** | Builder-friendly — good for project showcases |
| **"I built" posts get 50%+ skeptical/debate comments** | Inquisitive audience — you need to defend your architectural decisions |
| **Members refer to each other by username** | Tight-knit — lurk longer before posting |
| **Affiliate links or "referral" get called out instantly** | High scam-awareness — transparency is mandatory |

### The "First 5 Comments" Test

When you sort a new post by "Old," the first 5 comments set the tone for the entire thread. Read them on successful posts from your target subreddit:

- What's the ratio of agreement to pushback?
- Does the OP engage with pushback or ignore it?
- What follow-up questions surface repeatedly?

---

## 4. Key Terminology & Reddit Infrastructure

### AutoModerator

Every subreddit can configure AutoModerator — a bot that scans every post/comment against YAML rules before a human sees it. It can remove, filter, approve, flair, or report content.

**What AutoMod checks on every post:**
- Account age and karma (hidden thresholds per subreddit)
- Title keywords and formatting
- Domain/URL patterns in posts and comments
- Link-to-text ratio
- Post frequency from the same user
- Specific keyword triggers ("check out", "DM me", "link in bio")

**AutoMod bypass signals:**
- High account age (1yr+ = near-zero AutoMod scrutiny)
- High karma in that subreddit specifically
- Previous approved content from your account
- Reddit Contributor Quality Score (CQS) — hidden internal score

### Flair Systems

| Flair Type | What It Does | Why It Matters |
|------------|-------------|----------------|
| **Post flair** | Categories posts (e.g., "Question", "Showcase", "Tutorial") | Required in many subs — missing flair = auto-removal |
| **User flair** | Badge next to username (e.g., "Verified Developer") | Can signal trustworthiness or expertise |
| **OC/Original Content flair** | Marks self-made content | Sometimes required for promotion |

### Megathreads

Many subreddits consolidate specific content types into recurring megathreads:
- "Share Your Startup Saturday" (r/SaaS)
- "Weekly Feedback Thread"
- "Self-Promotion Sunday"
- "What are you working on?"

**Rule**: Posting the content type outside the megathread = auto-removal, even if it follows every other rule.

### Reveddit

A third-party tool (`reveddit.com`) that shows removed content — your own and others'. Essential for diagnosing whether your content was removed by AutoMod vs human mod.

---

## 5. Subreddit Profiles

### r/MCP

**Focus**: Model Context Protocol — tool-building, MCP servers, AI agent infrastructure, protocol specification, integrations

**Estimated size**: Mid-size (growing rapidly with the MCP ecosystem)

**Tone**: Technical, tool-focused, builder-first
- Deeply technical audience — assumes familiarity with LLMs, function calling, tool schemas
- AI content is native to the subreddit — no need to "translate" for a general audience
- Enthusiastic about new MCP servers, tools, and use cases
- Skeptical of shallow wrappers, hype without substance

**Unwritten rules / culture:**
- Share architecture and source code — "I built an MCP server for X" posts do well when they include actual implementation details
- Comparison posts (MCP vs Function Calling, MCP vs ACP) perform well
- GitHub links are expected and welcomed
- The community is early-stage enough that genuine contributions get amplified

**Self-promotion tolerance**: **High** — but only for MCP-related tools. Show your architecture, share what you learned, include the repo.

**Do:**
- Share detailed technical write-ups of your MCP server implementation
- Include code examples, architecture diagrams, benchmark comparisons
- Ask for feedback on design decisions
- Mention your product as the subject of an implementation case study

**Don't:**
- Post a landing page with no technical substance
- Pitch SaaS products unrelated to MCP infrastructure
- Post the same MCP server announcement across 10 subreddits

**Example framing that works:**
> "I built an MCP server for X — here's why I chose Y over Z for transport, and what I'd do differently next time."

---

### r/selfhosted

**Focus**: Self-hosted software alternatives, home labs, privacy, open-source tools, replacing SaaS with self-managed solutions

**Size**: ~350K+ members

**Tone**: Practical, cost-conscious, DIY, anti-marketing
- Hates marketing speak with a passion. "Disruptive," "game-changing," "seamless" = instant downvote magnet
- Deeply practical — "what problem does this solve" is the only question that matters
- Privacy and data sovereignty are core values
- Cost-conscious — will compare your pricing against self-hosting the equivalent stack for free
- Skeptical of SaaS pricing models (that's the whole point of the subreddit)

**Stated rules (summary):**
- Posts must center on self-hosting
- Open-source preferred, commercial must be upfront about pricing
- No low-effort posts (subjective — determined by community reports)
- Be civil
- No spam
- AI projects require a top-level comment with transparency about AI involvement
- New projects go in a specific monthly thread (not main feed)
- Submission headline should match article title
- No duplicate text from blog/GitHub — just post the link

**Unwritten rules / culture:**
- The community is passionate about keeping the feed high-quality. "No low-effort posts" rule gives mods discretion to remove content the community doesn't want.
- **The "price test"**: If your tool isn't free/open-source, be upfront about cost. Hiding pricing or using "contact us" will get your post destroyed.
- **The "docker test"**: Does it have a Docker image? If not, expect questions about deployment.
- **AI projects** face extra scrutiny after a flood of AI-generated submissions. The subreddit implemented mandatory AI-involvement transparency. If your project uses AI, say so clearly.
- Long-time members have seen hundreds of "alternatives to X." Your differentiation needs to be obvious in the first paragraph.

**Self-promotion tolerance**: **Medium** — tolerated if:
1. It's open-source (or at least source-available)
2. Pricing is transparent (no "contact us")
3. You post in the correct monthly project thread (not main feed for new projects)
4. The tool genuinely solves a self-hosting problem

**Do:**
- Open-source your tool or make it source-available
- Include a Docker image and simple deployment instructions
- Be transparent about pricing from the first sentence
- Post in the monthly "what are you working on" or new projects thread
- Compare your tool honestly against existing self-hosted alternatives

**Don't:**
- Use any marketing language
- Hide pricing
- Post a landing page with no GitHub repo
- Submit without a Docker compose example
- Post a SaaS product that could just as easily be replaced by a self-hosted tool

**Example framing that works:**
> "I built an open-source alternative to [SaaS tool] that you can self-host. Docker image included, SQLite backend, no telemetry. Here's how it compares to the existing options: [honest comparison]."

---

### r/SaaS

**Focus**: Software as a Service — building, launching, growing SaaS businesses. Founders, operators, indie hackers.

**Size**: ~400K+ members

**Tone**: Founder-to-founder, analytical, metrics-obsessed, low tolerance for pitchy content
- Values data and real numbers over opinion
- Skeptical of claims without evidence ("500% growth" with no breakdown = downvoted)
- Technical — majority have built and shipped at least one product
- Pricing model discussions are a recurring theme
- Treats "I just launched" posts as content, not advertising — but expects substance
- High competition for attention with 400K+ members

**Stated rules:**
- No non-productive self-promotion
- Feedback requests must go in weekly feedback thread
- Posts must be SaaS-relevant
- Blog posts follow specific rules
- Self-promotion limited to once every 60 days (April 2026 rule tightening)
- No affiliate programs, reseller schemes, or "white-label SaaS opportunities"
- Clickbait or vague titles removed

**The April 2026 Rule Change (critical):**
The mods tightened self-promotion to once per 60 days. Repeat violations can get your product URL blacklisted in AutoMod. Comment plugs and product mentions in replies also count. This changed the risk profile significantly — what was "risky but worth it" is now "don't push it unless you have a genuinely compelling narrative."

**Unwritten rules / culture:**
- **Story > Spec**: "I did X and here's what happened" always beats "I'm thinking about doing X, what do you think?"
- **MRR worship**: Revenue numbers get attention, but fabricated numbers get destroyed. If you claim MRR, be ready to substantiate.
- **The founder voice**: Write as a founder sharing lessons, not a marketer distributing content. The difference is obvious to regulars.
- **Engagement required**: If you post about your product, you must stick around and answer questions. Drive-bys get flagged.
- **Rejection of polish**: Overly polished, clearly ghostwritten posts get called out. Messy, honest narratives perform better.

**Self-promotion tolerance**: **Low-Medium** (trending lower after April 2026)
- The weekly "Share Your SaaS" feedback thread is the only reliable safe zone
- Main-feed product mentions require a strong narrative (failure story, acquisition story, pricing experiment)
- Cold product links without context are removed immediately
- Comment-plugging your product in other people's threads is not tolerated

**Do:**
- Share a founder narrative with specific numbers (revenue, churn, CAC, conversion)
- Post honest failure/learning posts ("I spent 6 months building X and got 3 users")
- Engage in the weekly feedback thread
- Answer every comment on your post for the first 2-4 hours
- Use specific, descriptive titles ("From $0 to $5K MRR in 90 days: what I'd do differently")

**Don't:**
- Post a "check out my product" link with no story
- Ask for feedback before you have shipped
- Cite vanity metrics (signups without retention)
- Drop a product link in someone else's thread
- Post more than once every 60 days about your own product

**Example framing that works:**
> "After 18 months of building my SaaS, I hit $10K MRR last month. Here's what actually moved the needle on conversion — and what I wasted money on."

---

### r/ClaudeAI

**Focus**: Claude by Anthropic — capabilities, use cases, limitations, prompting, API, Sonnet/Opus/Haiku, societal impact

**Size**: Large (rapidly growing with Claude's popularity)

**Tone**: AI-enthusiast, technical, opinionated, high expectations
- AI-first audience — no need to explain basic AI concepts
- Mix of power users (API, Projects, Artifacts) and casual users (web interface)
- Tends toward critical/debate-heavy — Claude's limitations get discussed as much as strengths
- Keenly aware of prompt engineering, context windows, model comparisons
- Not affiliated with Anthropic — independent community

**Stated rules (summary):**
- Be respectful — no personal attacks
- Stay relevant to Claude and AI topics
- Contribute positively
- Follow Reddit content policy
- Use appropriate flair
- Avoid spam and manipulation
- Acknowledge Claude's limitations
- Be detailed when posting complaints

**Culture signals:**
- Technical deep-dives on prompting strategies perform well
- Comparisons (Claude vs GPT vs Gemini) are a perennial topic
- The community has strong opinions about Claude's safety constraints and "personality"
- Artifact sharing and prompt templates get genuine appreciation
- Low tolerance for obvious promotional content disguised as discussion
- Many members are developers — API-centric content resonates

**Self-promotion tolerance**: **Low** for direct product pitches, **Medium-High** for tools that genuinely enhance Claude usage
- A tool that improves Claude prompting? Yes, if you share the prompt engineering behind it.
- A SaaS product that happens to use Claude? Must be framed as a technical case study.
- An MCP server for Claude? Relevant — share the implementation.

**Do:**
- Share effective prompts with explanations of why they work
- Post technical comparisons with data
- Discuss Claude's limitations honestly (the community appreciates nuance over hype)
- Share tools/scripts that extend Claude's capabilities
- Frame product mentions as solutions to genuine Claude limitations

**Don't:**
- Post generic "AI will change everything" fluff
- Make product pitches without technical substance
- Post content that's just rehashing the Anthropic blog
- Ignore Claude's actual limitations
- Use the subreddit purely as a distribution channel

**Example framing that works:**
> "I've been testing Claude's ability to [specific task] against GPT-4o. Here's my methodology, the failure modes I found, and a template I built to work around them."

---

## 6. Quick-Reference Checklists

### Pre-Post Checklist (Every Subreddit)

```
□ I have read every rule in the sidebar AND wiki
□ I have checked pinned posts for recent rule changes
□ I have searched for similar posts to gauge reception
□ I have the correct flair selected
□ My title follows the subreddit's formatting conventions
□ My account meets the age/karma requirements (incognito check)
□ My post does not violate the 90/10 ratio across my account history
□ I am posting in the correct megathread (if applicable)
□ I have disclosed any affiliation with the product
□ My post has no banned keywords (delve, leverage, etc.)
□ I have included specific, concrete details (not generic claims)
□ My tone matches the community's baseline (checked against Top posts)
```

### Subreddit Research Template

Fill this for every target subreddit before the first post:

```
Subreddit: r/_________
Member count: _________
Topic focus: _________

RULES SUMMARY:
- Self-promotion: [banned / restricted / allowed with guidelines]
- Specific rules relevant to my content:
  1.
  2.
  3.

CULTURE:
- Technical level: [casual / mixed / expert]
- Humor: [dry / playful / none]
- Attitude toward promotion: [hostile / skeptical / welcoming]
- Common post lengths: [short (<200w) / medium / long (1000+w)]
- Recurring hot topics: _________

TONE NOTES:
- Vocabulary/jargon to use: _________
- Vocabulary/jargon to avoid: _________
- Brands/tools mentioned positively: _________
- Brands/tools mentioned negatively: _________

SELF-PROMOTION RULES:
- Allowed in main feed? [yes / no / restricted]
- Megathread? [which one?]
- Frequency limit? _________
- Disclosure required? [yes / no]

FIRST POST PLAN:
- Type: [text / link / image / comment]
- Angle: _________
- Title draft: _________
- Key details to include: _________
```

---

## 7. Testing Your Post — The Pre-Flight Check

### The "Would This Survive?" Diagnostic

Before posting, ask five questions:

1. **Would this get downvoted if someone knew I was promoting something?**
   - If yes -> your post reads as advertising, not participation. Rewrite.

2. **Would this be valuable if I removed the product mention entirely?**
   - If no -> the product is the only point. That's promotion, not contribution.

3. **Does the title sound like a news headline or a person talking?**
   - "New tool for X" = news headline. "I spent 3 months building X and here's what happened" = person talking.

4. **Is there at least one concrete, specific detail per 100 words?**
   - Vague -> generic -> sounds like AI or marketing. Specific -> real -> sounds human.

5. **Would a moderator reading this see it as community contribution or distribution?**
   - Contribution = "This person is one of us."
   - Distribution = "This person is using us."

### The Incognito Visibility Test

After posting:
1. Open incognito/private browser window
2. Navigate to `reddit.com/r/SUBREDDIT/comments/`
3. Sort by New
4. Is your post visible?

If it's not visible within 5 minutes, consider:
- AutoMod removed it (age/karma/format trigger)
- The subreddit gatekeeps posts for manual approval
- Your account is shadowbanned (check via `reddit.com/u/YOURUSERNAME` in incognito)

### If Your Post Gets Removed

| Scenario | Likely Cause | Action |
|----------|-------------|--------|
| Removed instantly (<1 min) | AutoMod rule (age, karma, keyword, format) | Check rules, fix the issue, modmail politely |
| Removed after 5-60 min | Human mod reviewed and rejected | Modmail with respectful explanation |
| Removed after 2+ hours with engagement | Mod caught it later, or report cascade | Harder to appeal — was it borderline? |
| Removed without notification | Subreddit filters without modmail | Check Reveddit, check incognito |

**How to modmail after removal:**
1. Be brief — mods are volunteers
2. Acknowledge the rule you may have violated
3. Explain why you think it should be reinstated
4. Accept the decision gracefully if they say no
5. **Never** argue, demand, or repost the same content

---

## Quick Reference Card

| Step | What | Time |
|------|------|------|
| **1. Read rules** | Sidebar + wiki + about/rules + pinned posts | 5 min |
| **2. Read the room** | Top (month) + New + comment threads | 15 min |
| **3. Search archives** | Similar products, competitor reception, "I built" posts | 10 min |
| **4. Check gates** | Age/karma requirements, flair, title format | 2 min |
| **5. Check your ratio** | 90% contribution / 10% promotion across account | 2 min |
| **6. Draft & review** | Apply subreddit-specific tone, remove AI tells | 10 min |
| **7. Pre-flight check** | Five-question diagnostic | 2 min |
| **8. Post & monitor** | Stay for first 60 min to reply | 60 min |
| **9. Post-mortem** | Note what worked for next time | 5 min |

**Total upfront research time**: ~30-45 min per new subreddit
**Total per-post time**: ~15-20 min

The first post in a new subreddit is reconnaissance. The second is where you start to get traction.

---

*Last updated: May 2026. Subreddit rules and cultures evolve continuously — validate specific policies against current conditions before posting.*
