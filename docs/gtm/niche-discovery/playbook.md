# GTM | Niche Discovery Framework — Systematic Validation Methodology

**Ticket:** AIM-4686 · **Date:** 2026-08-06 · **Purpose:** a systematic, repeatable methodology that turns unfiltered demand signals into a shortlist of **validated niches with proven demand and willingness to pay**.

> **What this document is:** the discovery engine that feeds the three GTM strategy pipelines
> (App Marketplace Arbitrage, Feature-to-SaaS, MCP/API-as-Service). It is an **executable reference**:
> a new hire can follow Part 3 in isolation and produce a scored niche list without further interpretation.
>
> **What this document is NOT:** a list of niches. Producing the *method* — not the *results* — is the scope
> of this ticket. Every subsequent niche search is a mechanical execution of this framework, never a new
> brainstorming session.

---

## Deliverable coverage map

| # | Deliverable | Section |
| -- | -- | -- |
| 1 | Signal Hierarchy Document | [Part 1](#part-1--signal-hierarchy) |
| 2 | Source Map — 6 Discovery Channels | [Part 2](#part-2--source-map--6-discovery-channels-ranked-by-signal-purity) |
| 3 | Reddit Research Protocol | [Part 3](#part-3--reddit-research-protocol) |
| 4 | 1–3★ Review Mining Protocol | [Part 4](#part-4--13-review-mining-protocol) |
| 5 | Complete Validation Pass Template (48h, <$100) | [Part 5](#part-5--48h-validation-pass-runbook) |
| 6 | Scoring Matrix — from 200 complaints to 3 niches | [Part 6](#part-6--scoring-matrix--from-200-complaints-to-3-niches) |
| 7 | Shadow Launch Validation Template | [Part 7](#part-7--shadow-launch-validation-template) |
| 8 | Crowded-Market Playbook | [Part 8](#part-8--crowded-market-playbook) |
| 9 | Strategy-to-Source Mapping | [Part 9](#part-9--strategy-to-source-mapping) |
| — | Companion templates | [`validation-pass-checklist.md`](validation-pass-checklist.md) · [`scoring-matrix-template.csv`](scoring-matrix-template.csv) · [`shadow-launch-page-template.html`](shadow-launch-page-template.html) |

**Ground rules that apply to every step in this document**

1. Every threshold is a **number**. If a step has no number attached, it is not finished.
2. Every source has: query templates, platform-specific gotchas, output format, cost, and time budget.
3. Every claim about third-party data is **cited with source and date** (see [Sources](#sources)). Unverifiable stats are labeled *internal heuristic* and never attributed to an external source.
4. **Kill is a valid outcome.** A validation pass that never produces a "kill" is not validating anything.

---

## Part 1 — Signal Hierarchy

A ranked taxonomy of demand signals, strongest to noise. Every post, review, and comment you collect is classified
into exactly one tier before it can enter the scoring matrix. Tier 1–2 signals are *evidence*; Tier 4 signals are
*market-sizing* only; Tier 5 signals are discarded.

### Tier 1 (Strongest) — Workaround behavior & institutional friction

**Definition.** Users have already invested real time, money, or political capital into a substitute — or a
gatekeeper has already reacted to the category. This is *revealed preference*: the strongest form of demand
evidence that exists in public data.

**Detection heuristics.**
- Manual-workaround language: `"I built my own"`, `"I use a spreadsheet to"`, `"I've been doing this manually because"`, `"I cobbled together"`, `"my team hacked together"`.
- Multi-tool stack descriptions where the user is the glue: `"I move it from X to Y to Z every week"`.
- Self-hosted / open-source forks of a commercial tool.
- Institutional friction: IT admins banning a tool org-wide, procurement rejecting a license, compliance blocking adoption (`"our IT blocked it"`, `"legal won't approve"`, `"we got banned from using it"`).
- Quantified substitute cost: hours spent, dollars paid, churn avoided (`"I spent 40 hours trying to export"`, `"we pay $400/mo and want to leave"`).

**Example quotes (real, from the research corpus).**
- *"I spent 40 hours trying to manually export and got nowhere."* — ValidSaaS Method 4 analysis of Lovable-migration threads (2026-03-07).
- *"We're paying $200/seat/month for [tool] and want to switch"* pattern — Linkeddit (2026-03-21).
- *"I've been doing this manually because [tool] doesn't handle [specific case]"* — ReddGrow pain-language corpus (2026-03-26).

**False-positive warnings.**
- A workaround can be a **hobby**, not a market: people who enjoy building spreadsheets/Notion databases will never pay for a tool. Check whether the workaround is *resented* (paid manual time they want back) or *enjoyed* (craft).
- "I built my own using n8n/Zapier" is a Tier-1 signal of the **underlying gap**, but the n8n solution itself is a consulting deliverable, not a SaaS niche (see scoring gate G5, Part 6). The niche is what the user *wants* the n8n flow to be — the automation they wish existed as a product.
- Institutional friction requires the ban to be *about the category's value*, not a rogue admin. One frustrated admin ≠ policy.

### Tier 2 (Strong) — Recurring pain & tool-seeking without consensus

**Definition.** The same complaint recurs across months and multiple independent communities, or users are
actively shopping for a tool and nobody recommends a winner.

**Detection heuristics.**
- **Recurrence:** same pain in **≥4 independent communities** (ValidSaaS convergence test) or **≥6 distinct threads** in the last 6 months in 2+ communities.
- **Tool-seeking language:** `"is there a tool that"`, `"is there an app for"`, `"anyone know a tool for"`, `"recommend a tool for"`, `"how do you all handle"`, `"what do you use for"`.
- **No-consensus:** the thread's comments propose **3+ different tools** and none satisfies everyone (a *solved* thread has one clear answer).

**Example quotes (real, from the research corpus).**
- *"Is there a way to consolidate client feedback from email, Slack, and Figma comments?"* — ReddTrends feedback-inbox example (2026-07-06).
- *"Has anyone tried Z? It is $49/mo but I am not sure it is worth it."* — ValidSaaS (2026-03-07).

**False-positive warnings.**
- **Groupthink within one subreddit:** a viral post creates a feedback loop. This is why the convergence test requires *independent* communities — the threads must not be cross-posts or reference each other (ValidSaaS, 2026-03-08).
- A "solved" thread where the top comment says `"just use X"` is **not** demand. It proves the problem is already well-served.
- Recency matters: complaints older than 12 months may describe a problem that has since been solved. Re-run the search sorted by New.

### Tier 3 (Moderate) — Price comparisons, tier discussions, explicit willingness to pay

**Definition.** Money language. Users compare prices, discuss tiers, or state what they would pay. This proves
*price sensitivity and budget existence*, but not yet that a gap exists.

**Detection heuristics.**
- `"worth the price"`, `"worth paying for"`, `"how much would you pay"`, `"we currently pay"`, `"budget"`, `"too expensive"`, `"cheaper alternative"`, `"X is $49/mo"`, `"cancelled my subscription"`.
- Comparison threads naming 2+ paid tools with price anchors.

**Example quotes (real, from the research corpus).**
- *"We need an alternative to [Competitor]. Budget is $200/seat/month. Need to migrate by end of Q2."* — Linkeddit compound-intent example (2026-03-21).

**False-positive warnings.**
- **"Too expensive" is ambiguous:** it can mean the category has no cheap option (a pricing gap = opportunity) or that the buyer will churn to free forever (weak market). Resolve with Tier 1/2 evidence — is there a *resented workaround*?
- Free-tier comparison shoppers state willingness to pay they will never exercise. Require a named budget or an existing paid subscription.

### Tier 4 (Weak — market sizing only) — "It would be cool if…"

**Definition.** Concept-level enthusiasm with no money, no timeline, and no current pain. Useful only to estimate
*awareness* (how many people know this problem exists), never to justify a build.

**Detection heuristics.**
- `"wouldn't it be cool if"`, `"someone should make"`, `"I wish there was"` without a current-workaround description.
- High upvotes (**≥100 upvotes**) on a concept/idea post whose replies contain no buying-intent language (no budget, no named tool, no current-workaround description).

**False-positive warning (critical).** Upvotes are *applause, not wallets* (ReddTrends, 2026-07-06). Compliment-validation — `"great idea!"`, `"I'd totally use that"` — predicts nothing because it costs nothing to give. The test: *would this comment exist if you had never posted?* If no, discount to near zero.

### Tier 5 (Noise — ignore)

**Definition.** Generic praise, listicle threads with low-effort engagement, vendor marketing, self-promotion.

**Detection heuristics.**
- `"great idea!"`, `"this is awesome"`, one-line agreement with no detail.
- Roundup/listicle threads (`"10 best tools for X"`) with low-effort comments.
- Any post authored by a vendor or affiliate about their own category.

**Action.** Do not enter these into the evidence log. They consume scoring-matrix weight for free.

### Tier ↔ intent-score crosswalk

When scoring individual posts, you can map Tier classes onto the 1–10 buying-intent rubric used by intent-monitoring
tooling (Linkeddit, 2026-03-21): Problem Awareness ≈ Tier 4 (base 2–4), Solution Comparison ≈ Tier 2 (base 5–7),
Budget Discussion ≈ Tier 3 (base 6–8), Competitor Frustration ≈ Tier 1/2 (base 8–10). A single post stacking
multiple signals (frustration + budget + timeline) scores at the top of the band.

---

## Part 2 — Source Map — 6 Discovery Channels, Ranked by Signal Purity

Channels are ranked by signal purity (share of collected items that are Tier 1–2). Every channel below is
documented with: search methodology, query templates, platform-specific gotchas, output format, cost, and time budget.

| # | Source | Best For | Signal Type | Signal purity |
| -- | -- | -- | -- | -- |
| 1 | Reddit (cross-subreddit) | Unfiltered complaint language, workaround discovery | Tier 1–2 | High |
| 2 | G2 / Capterra / Trustpilot 1–3★ reviews | Paying customers' unmet needs, structural product gaps | Tier 1–2 | High |
| 3 | Feature-request forums (HubSpot Ideas, Salesforce IdeaExchange) | Ignored demand with quantified voter base | Tier 2–3 | Medium |
| 4 | Google Trends + keyword tools | Demand trajectory (growing/flat/dying), search-volume proof | Tier 3 | Medium |
| 5 | Workaround observation (n8n, Zapier, self-hosted OSS) | Highest signal: user committed hours to a substitute | Tier 1 | Highest |
| 6 | Crunchbase funding data | Market validation by professional investors | Supporting | Supporting |

### Channel 1 — Reddit (cross-subreddit)

- **Methodology:** full protocol in [Part 3](#part-3--reddit-research-protocol). Discovery first, then the four methods.
- **Query templates:** `"is there a tool that" [problem]` · `"[problem] (frustrated OR "I wish" OR "is there")"` · `"I use a spreadsheet to [problem]"` · `"[ToolName] alternative"` · `"switching from [ToolName]"`. Run each with `site:reddit.com` in Google when Reddit's native index misses matches (ReddGrow, 2026-04-02; Rawneed, 2026-05-31).
- **Gotchas:** Reddit's native search is weak at phrase matching — always run important phrases through Google `site:` search too. Sort by **New** for freshness, then **Top** for resonance. Search *problem* language, never solution language (`"scheduling tool"` = marketing noise; `"I spend hours scheduling"` = signal). Promotional posting to subreddits risks bans — this channel is **read-only** for discovery.
- **Output format:** evidence log, one row per thread: `URL | subreddit | community type (A/B/C/—) | method (A/B/C/D) | date | upvotes | comments | tier (1–5) | buyer-language quote | quantified pain? (y/n)`. The `community type` column records the community's role (Type A/B/C; `—` when found by cross-Reddit Method B/D); the `method` column records which of Methods A–D surfaced it.
- **Cost:** $0 (native search + public pages). Scraping at scale (50 posts/pass) is free via public endpoints; paid Reddit APIs only needed for continuous monitoring.
- **Time budget:** 60–90 min per niche for Methods A–D at 50 posts.

### Channel 2 — G2 / Capterra / Trustpilot 1–3★ reviews

- **Methodology:** [Part 4](#part-4--13-review-mining-protocol). Pick 3–7 competitors (target **5**), scrape **200 reviews** total, filter to 1–2★, cluster complaints, classify product-vs-service.
- **Query templates:** per-competitor review pages filtered to 1–2★; for Trustpilot: `trustpilot.com/review/{domain}` sorted by rating.
- **Gotchas:** B2B tools are often listed under a different legal entity than the product name — check parent company and consumer-facing brand separately (The Mine Works, 2026-07-17). Trustpilot has no public API for review *reading*; scraping is the only route. 1–3★ on G2 includes "fine but missing X" reviews that are as valuable as angry ones.
- **Output format:** per-theme cluster table: `theme | # reviews | competitors hit (n/5) | product-vs-service | 2 verbatim quotes`.
- **Cost:** ~$0.005/review → **$1.00 for 200 reviews** (The Mine Works rates, 2026-07-17).
- **Time budget:** 90 min incl. LLM clustering.

### Channel 3 — Feature-request forums (HubSpot Ideas, Salesforce IdeaExchange)

- **Methodology:** for each target category, pull the IdeaExchange/HubSpot-Ideas board, filter by votes, and record top-50 requests per competitor ecosystem. A request with **≥500 votes and an "open" status for ≥2 years** is *ignored, quantified demand*.
- **Query templates:** `ideaexchange.salesforce.com` board search `"[category]" sort:votes` · `ideas.hubspot.com` board search `"[category]" sort:upvotes`.
- **Gotchas:** votes are cheap to give (same problem as upvotes) — always pair vote count with **years-open** and **API-cloneability** (can a third party build it without the host's cooperation?). Moderators sometimes mark requests "closed" to deflect; record original post date.
- **Output format:** `request | board | votes | opened (date) | status (open/acknowledged/closed) | API access needed | years open`.
- **Cost:** $0.
- **Time budget:** 45 min per board.

### Channel 4 — Google Trends + keyword tools

- **Methodology:** run **2 reports** per category — `today 5-y` and `today 12-m` — for the category keyword and its two closest substitutes. Compare: is the 12-month direction consistent with the 5-year trend? A category growing in 5y but flat in 12m is *mature*; flat in both is *dying*; up in both is *growing*. (The Mine Works prompt pattern, 2026-07-17.)
- **Query templates:** Google Trends, geo = target market, `timeRange: "today 5-y"` then `"today 12-m"`; keywords = `[category]`, `[substitute A]`, `[substitute B]`.
- **Gotchas:** Trends is relative, not absolute — always run the category against a known baseline keyword. Search-intent ≠ purchase-intent; use only for trajectory, never as a demand gate. Google Trends indices are noisy for niche terms (low-volume terms flatten to 0 — treat as "unknown", not "zero demand").
- **Output format:** `keyword | 5y shape | 12m shape | direction (growing/flat/dying/unknown)`.
- **Cost:** ~$0.004/report → **~$0.01 for 2 reports** (The Mine Works rates).
- **Time budget:** 20 min.

### Channel 5 — Workaround observation (n8n, Zapier, self-hosted OSS)

- **Methodology:** search workflow registries and OSS ecosystems for templates solving your target problem:
  - n8n community workflows: `n8n.io/workflows` search `[problem]`; count templates built to solve it and their install counts.
  - Zapier: `zapier.com/apps` integrations + "Zaps" around the problem; count the number of distinct app combinations users have assembled to approximate your category.
  - Self-hosted OSS: GitHub search `"[problem]" language:TypeScript OR language:Python` + `self-hosted`; count stars as a proxy for users committed to a substitute.
- **Query templates:** `site:n8n.io/workflows "[problem]"` · `site:zapier.com "[problem]" zap` · `github.com/search?q=[problem]+self-hosted&type=repositories` sorted by stars.
- **Gotchas:** this channel surfaces the **gap** (what users wish the workflow were), not the product. A huge n8n template library for a problem means the *build-it-yourself* demand exists — which the scoring matrix classifies as a consulting job unless the workflow is high-churn enough to productize. Prefer workflows with **recurring run frequency** (weekly/monthly) over one-off automations. **Numeric bar for workaround evidence:** ≥5 distinct community workflows/templates (n8n + Zapier combined) solving the problem, or ≥100 stars on the top self-hosted OSS repo for it, counts as Tier-1 workaround evidence for that niche.
- **Output format:** `workflow/template | platform | installs/forks | problem solved | recurrence`.
- **Cost:** $0.
- **Time budget:** 30 min.

### Channel 6 — Crunchbase funding data

- **Methodology:** for the category, list companies, total funding, **last round and its date** for each. Funding **recency** matters far more than funding total: a category with a meaningful round in the last 12 months means someone with more diligence budget than you concluded money is here; a category whose last round closed 3+ years ago is one the market already judged (The Mine Works, 2026-07-17).
- **Query templates:** Crunchbase search `[category]`, sort by `last funding date`, record `total funding`, `last round type`, `last round date`, `# investors`.
- **Gotchas:** funding is *supporting* evidence — investors validate markets, not gaps. A heavily-funded but loudly-complained-about category is Part 8's crowded-market case, not a kill. A "meaningful round" is **operationally defined** as a priced round of **≥ $1M closed ≤ 12 months ago from a professional investor** (seed-only and founder/angel rounds do not count — see Part 5 Step 3 gate).
- **Output format:** `company | total funding | last round | last round date | signal (recent capital = market healthy / stale = market judged)`.
- **Cost:** ~$0.0133/company → **~$0.07 for 5 companies** (The Mine Works rates; free tier available).
- **Time budget:** 15 min.

---

## Part 3 — Reddit Research Protocol

Source methodology: the 4-method search protocol developed on a corpus of **8,000+ Reddit threads and 300,000+
comments** (ValidSaaS, Jeffery Robinson — [validsaas.com, 2026-03-07](https://validsaas.com/blog/how-to-find-saas-ideas-people-will-pay-for) and [2026-03-08](https://validsaas.com/blog/reddit-research-method-validate-saas)). Executed per niche in **90 minutes**; produces the raw Tier 1–3 evidence for the scoring matrix.

### Step 0 — Community discovery (15 min)

The starting hypothesis (audience + pain) comes from Part 2 channel discovery or a prior candidate list — the pass **validates** it, it does not invent it. With that hypothesis in hand, pick one Type A, one Type B, one Type C community using **at least two** of these three methods:

1. **Map of Reddit** — free interactive visualization built from ~176M Reddit comments ([mapofreddit.com](https://mapofreddit.com)); every subreddit is a dot, communities sharing users cluster together. Search your Type B, click "Show Related", read first- and second-degree connections (operational how-to: ValidSaaS, 2026-03-08).
2. **AI suggestion** — prompt: *"I am building a SaaS for [audience]. What Reddit communities would this audience be active in? Include niche subreddits between 50K and 500K members."* Treat output as hypotheses; verify each with Map of Reddit.
3. **Reddit native community search** — search your topic and click the **Communities** tab.

Community types:
- **Type A (broad founder hub):** r/SaaS, r/Entrepreneur, r/microsaas. Best for competitor context, noisiest for genuine demand.
- **Type B (target audience):** the community where your actual customer lives (r/sysadmin, r/freelance, r/realtors, r/accounting, r/webdev…).
- **Type C (adjacent):** overlaps your audience but approaches the problem from a different angle (e.g., B = r/freelance → C = r/smallbusiness).

**Convergence rule:** the highest-confidence signals live where **B and C independently surface the same pain** (same problem, different words; same frustration, different context; not cross-posted). *Convergence across B and C = highest confidence* (ValidSaaS, 2026-03-08).

### Method A — Subreddit-based (20 min)

1. Pull the **top-100 posts of the last 30 days** from Type B and Type C (sort=top, time=month).
2. Extract the recurring pain themes; record upvotes and comment-section agreement (**agreement = ≥3 distinct commenters affirming the same pain** in the thread — not just the OP; "same here" replies count as distinct affirmations).
3. Repeat on Type A (broad hub) for context — but discount it for demand.
4. **Output:** 10–15 pain themes, each with a per-community post count (B vs C) and the top-3 themes ranked by combined count.

### Method B — Topic-based (20 min)

1. Take the **top 3–5 themes** by Method-A combined count (B + C) — do not run all 10–15.
2. Cross-Reddit search each theme: `"[theme]" site:reddit.com` (Google) and Reddit native search.
3. Record which **communities** each hit lands in. **Convergence by Method B:** same pain in **≥4 independent communities = real market**; **3 = borderline** (fails the Method-B bar alone — passes only if a Type B and a Type C are both present); **1–2 = niche or one-off** (fail).
4. **Output:** theme × community matrix; a theme fails the convergence test at <2 independent communities, and a 3-community theme passes **only if** it includes a Type B and a Type C (else borderline-fail, per step 3).

### Method C — Problem language (20 min)

Run Boolean/problem-language queries; buyers describe the problem, not the solution:

| Boolean query | What it surfaces |
| -- | -- |
| `"hate" AND "spreadsheet"` | Manual-workaround resentment (Tier 1) |
| `"manual" AND "every week"` | Recurring manual burden (Tier 1/2) |
| `"is there a tool" AND [problem]` | Active shopping (Tier 2) |
| `"I would pay someone to just…"` | Explicit willingness to pay (Tier 3, top band) |
| `"I've been doing this manually because"` | Workaround + gap (Tier 1) |

> **Note on the 71% statistic:** the ticket references a **71% correlation** between the phrase
> `"I would pay someone to just…"` and validated waitlist demand, attributed to the ValidSaaS corpus analysis.
> This figure is **not independently verifiable** from public sources as of 2026-08-06; it is carried here as an
> **internal heuristic** from that corpus, not as an externally-cited fact (see [Sources](#sources)).

1. Run each query; for the money phrase also search `"I'd pay for"` and `"take my money"` — the strongest, rarest signals (ReddTrends, 2026-07-06).
2. Sort by **New** (is the pain current?) then **Top** (which complaints resonated).
3. **Output:** per-query hit list with tier classification.

### Method D — Competitor name (20 min)

The highest-signal method. For every tool named in Methods A–C, run:

| Query | What it surfaces |
| -- | -- |
| `"[ToolName] sucks"` | Direct product gaps (Tier 1/2) |
| `"looking for alternative to [ToolName]"` / `"switching from [ToolName]"` | Active switching intent (Tier 1) |
| `"[ToolName] alternative"` | Ecosystem opportunity mapping (Tier 2) |
| `"[ToolName] too expensive"` | Pricing-gap evidence (Tier 3) |

1. Collect **all** tool names mentioned in collected threads — every mention is a competitor to investigate (ValidSaaS, 2026-03-07).
2. **Output:** competitor complaint matrix — `competitor | top complaints | quantified pain (hours/$/churn) | unserved gap`.

### Evidence log (output of all four methods)

Merge into one deduped table: `quote (buyer language) | tier | subreddit | community type (A/B/C/—) | method (A/B/C/D) | date | upvotes | quantified? | tool named`. At least **50 rows** per niche pass. This table is the input to Part 6.

### Post-protocol quality bar

A niche passes the *Reddit* gate only when: (1) ≥1 Tier-1 signal exists; (2) the pain appears in **≥2 independent communities** (a Type B and a Type C both present), **or ≥4 independent communities by Method B** (a 3-community theme passes only when it includes a B and a C); (3) ≥3 comments quantify the pain (hours, dollars, churn). Failing any of the three → park the niche, do not carry it to Part 5.

---

## Part 4 — 1–3★ Review Mining Protocol

Source methodology: the complete workflow documented by The Mine Works in *"I Validated a Business Idea in 48 Hours
by Mining 1-Star Reviews"* ([themineworks.com, 2026-07-17](https://themineworks.com/blog/validate-business-idea-mining-reviews/)) — 3–7 competitors → 200 reviews scraped → 1–2★ filtered → LLM cluster analysis → ranked themes → the single theme to build against. **Review-mine step cost: $1.00** (200 × $0.005); the ticket's ~$1.25 figure is The Mine Works' full 7-step pass total (all of Part 5), which includes this mine.

### The protocol (executable steps)

1. **Select competitors (10 min).** Take the competitor matrix from Part 3, Method D; pick **3–5 competitors** (target 5; if fewer than 5 have a public review presence, mine all that do — K3 below scores density against the number actually mined). B2B tools are often listed under a different entity than the product name — check parent + consumer-facing brand separately.
2. **Scrape reviews (20 min).** Pull **200 reviews across the 5 competitors** (~40 each; 20/page with pagination). Trustpilot has no public API for reading third-party reviews — scraping is the only route.
3. **Filter to 1–2★ (5 min).** Keep 1- and 2-star reviews only. (For G2, also keep 3★ *"fine but missing X"* reviews — they carry product-gap evidence.)
4. **Cluster with an LLM (15 min).** Prompt: *"Cluster these reviews into recurring complaint themes. For each theme report: how many reviews mention it, which competitors it hits, whether it is a product or a service problem, and quote two reviews verbatim. Rank themes by frequency. At the end name the single theme you would build against and why."*
5. **Classify product vs service (5 min).** Product complaints (the thing structurally cannot do what customers need) = *a moat you can walk into*. Service complaints (slow support, bad billing, hard to cancel) = *fixable by hiring* — a shallow opening, deprioritize (The Mine Works, 2026-07-17). If **4/5 competitors** share a product complaint, you have found a constraint the whole category shares — that is a business.
6. **Output.** Theme table: `theme | # reviews | competitors hit (x/5) | product/service | 2 verbatim quotes`. The **single highest-frequency product complaint spanning ≥3 competitors** is the build candidate (cross-check with Part 6).

### Why 1–2★ reviews beat interviews

A 1-star reviewer already paid, already used the thing, and is angry enough to write unprompted — *revealed
preference plus a specific unmet need in the customer's own words*. An interviewee is polite and speculating
about a future purchase (The Mine Works, 2026-07-17).

### Cost

~$0.005/review × 200 = **$1.00**. (The Mine Works per-result rates, 2026-07-17.)

### Gotchas

- A competitor with **no review presence** is itself a signal — lean harder on the Reddit step for that category; don't over-read a missing Trustpilot page.
- "Too many complaints" is **not** proof the market is bad — complaints require paying customers. A category with angry paying users and a funded incumbent is money in the market *and* a gap (Part 8).
- LLM clustering output must preserve verbatim quotes — the customer's own words are the raw material for the shadow-launch page (Part 7).

---

## Part 5 — 48h Validation Pass Runbook

A full validation pass for one niche candidate. Complete all six steps inside **48 hours** at a total cost of
**<$100** (reference implementation: **~$1.25** using The Mine Works toolchain rates, 2026-07-17). The
[`validation-pass-checklist.md`](validation-pass-checklist.md) is the copy-paste runbook for this pass.

| Step | Tool | Volume | Signal | Cost |
| -- | -- | -- | -- | -- |
| 1. Trend check | Google Trends | 2 reports (5Y + 12M) | Category trajectory (growing/flat/dying) | ~$0.01 |
| 2. Demand clustering | Reddit scrape | 50 posts | Complaint themes, workarounds, convergence | $0 |
| 3. Incumbent map | Crunchbase | 5 companies | Funding recency → market health | ~$0.07 |
| 4. 1★ review mine | Trustpilot / G2 | 200 reviews | Structural product gaps (Part 4) | ~$1.00 |
| 5. Buyer enumeration | Google Maps | 50 businesses | *"Can I name 50 customers?"* | ~$0.08 |
| 6. Outreach test | Email finder + verifier | 50 contacts | Real-world problem confirmation | ~$0.10 |
| **Total** |  |  |  | **~$1.25** |

### Step 1 — Trend check (20 min, ~$0.01)

Run Google Trends twice per category keyword (5Y + 12M), compare. **Direction rule** (complete decision table):

| 5-year | 12-month | Decision |
| -- | -- | -- |
| rising | rising | Proceed (growing) |
| rising | flat | Mature — proceed with caution |
| flat | rising | Emerging — proceed, flag as pre-trend (validate harder via Part 3/4) |
| flat | flat | Kill the pass (dying) |
| dying | any | Kill the pass |
| unknown (low-volume flatten) | unknown | Treat as flat — do **not** claim growth from an unknown; proceed only if other gates pass |

Note: "unknown" (low-volume flattening) ≠ "zero demand".

### Step 2 — Demand clustering (90 min, $0)

Execute Part 3 fully (community discovery + Methods A–D). Output: ≥50-row evidence log. **Gate:** fail the three-item Reddit quality bar (Part 3) → kill the pass here; do not spend the review-mine budget on a niche with no Tier 1–2 evidence.

### Step 3 — Incumbent map (15 min, ~$0.07)

Crunchbase: 5 companies, last round + date. **Gate:** a *meaningful* round (**priced round ≥ $1M, closed ≤ 12 months ago, from a professional investor**; seed-only and founder/angel rounds excluded) = market healthy (proceed); last rounds all ≥3 years old, or only seed rounds, = market already judged (downgrade or kill).

### Step 4 — 1★ review mine (90 min, ~$1.00)

Execute Part 4 on the 5 incumbents. **Gate:** a single product complaint spanning ≥3 competitors = build candidate; service-only complaints = shallow, downgrade.

### Step 5 — Buyer enumeration (15 min, ~$0.08)

Google Maps search the business type that has the problem, in the target market, `maxResults 50`. List name/website/category. **Gate:** if you cannot name 50 real businesses → the niche is too narrow to sell into; downgrade. (Map this to the strategy's addressable store: marketplace app stores, ecosystems, or MCP registry users.)

### Step 6 — Outreach test (30 min, ~$0.10)

Crawl the 50 domains for contact emails (`find_website_contacts`), verify each (`verify_emails` — MX + SMTP, flag role-based/catch-all). Send an <100-word outreach note that opens with the specific complaint theme from Step 4 phrased the way reviewers phrased it, and asks whether it matches their experience — no pitch, no product (The Mine Works, 2026-07-17). **Gate:** ≥3 replies confirming the pain = proceed to shadow launch; 0–2 replies = re-target or kill.

### Pass-level decision

A candidate passes the 48h pass only when **all six step gates pass**. Any kill → park the candidate, never rationalize a weak number. Passing candidates proceed to Part 6 (scoring) and Part 7 (shadow launch).

---

## Part 6 — Scoring Matrix — from 200 Complaints to 3 Niches

A weighted filter applied to every candidate that survives Part 5. Execute it in two stages — **hard gate**, then
**weighted score**. The [`scoring-matrix-template.csv`](scoring-matrix-template.csv) is the reusable spreadsheet.

### Stage 1 — Hard gates (all must pass; one FAIL = discard)

| # | Gate | Numeric threshold | Evidence source |
| -- | -- | -- | -- |
| G1 | Convergence | Pain appears in **≥2 independent communities** (must include a Type B and a Type C), or **≥4 independent communities by Method B**; a 3-community theme passes only with a B and a C present | Part 3 evidence log |
| G2 | Market exists | **≥2 paid tools** already serve the pain | Part 4 competitor matrix |
| G3 | Pain quantified | **≥3 comments** quantify the pain (hours, dollars, churn) | Part 3 evidence log |
| G4 | Unserved wedge | **≥1 clear gap** across ALL competitors (feature, price, or consent/control) | Part 4 theme table |
| G5 | Not a consulting job | Pain cannot be solved with **Zapier/n8n** in a weekend → if yes, reject (it is a consulting job, not a SaaS niche) | Part 2, Channel 5 |
| G6 | 10% rule | Tool can be priced at **≤10% of the financial value it creates** (≥10x ROI for the buyer = no procurement friction) | Buyer-economics estimate |
| G7 | B2B, not B2C | **B2C → reject** unless extraordinary evidence (**≥10 posts with a named budget** + repeat-purchase economics + quantified churn value). **B2B → proceed** | Buyer enumeration, Part 5 Step 5 |

Rationale notes:
- **G2 is counterintuitive by design:** *no competitors is a bad sign, not a good one* — it usually means no market
  (GetAppNiche, 2026-06-17). A clear incumbent proves someone is already paying to solve this (ReddTrends, 2026-07-06).
- **G6 (10% rule):** if the tool costs more than 10% of the value it creates, procurement friction kills adoption.
  This is a framework-internal pricing rule, not an external stat.

### Stage 2 — Weighted score (0–100)

Score candidates that pass all gates. Weights are calibrated for the 48h build pipeline (velocity > depth).

| Criterion | Weight | 0 pts | 5 pts | 10 pts |
| -- | -- | -- | -- | -- |
| K1 Signal strength (highest Tier in log) | 25% | Tier 3 only | Tier 2 | Tier 1 |
| K2 Convergence breadth | 20% | 2 communities | 3–4 | 5+ |
| K3 Complaint density (Part 4) | 20% | <3 competitors hit | 3 | 4–5 (or all mined) |
| K4 Gap buildability in 48h | 15% | 3+ integrations | 1 integration + UI | 1 OAuth / CRUD |
| K5 Buyer concentration | 10% | fragmented, no named 50 | 50–200 reachable | ≥20 named accounts |
| K6 Price anchor gap | 10% | parity | 10–30% below | 30–50% below |

**Weighted score formula (scale 0–100):** `(K1×0.25 + K2×0.20 + K3×0.20 + K4×0.15 + K5×0.10 + K6×0.10) × 10`. Each K is 0–10, weights sum to 100%, so the parenthesized term spans 0–10 — the `×10` rescales it to the 0–100 decision bands below.

Rubric boundary definitions (no interpretation left open):
- **K4 "1 integration + UI":** an integration = a dependency on one external service/API (OAuth to one provider, one webhook, one SDK). 3+ such dependencies = 0 pts.
- **K5 "≥20 named accounts":** named businesses from the Part 5 Step 5 list, in the target market. "Concentrated" = ≥20 of the 50 enumerated are addressable with a named buyer.
- **K6 "price anchor gap":** your target price vs. the incumbent's price for the same core job (Part 4 theme table), not vs. list-price marketing.

### Decision bands

| Score | Decision |
| -- | -- |
| **≥ 70** | Build candidate — carry to shadow launch (Part 7) |
| **55–69** | Watchlist — hold; re-run the 48h pass in 60–90 days or when a signal changes |
| **< 55** | Discard |

### Output

Run the 48h pass on **8–12 candidate niches** per strategy. From a typical pool of **~200 collected complaints**
and 8–12 candidates, the matrix yields **exactly 3 niches** into the build pipeline. "3" is a cap, not a target:
a niche that cannot name a wedge does not get replaced by a weaker one.

---

## Part 7 — Shadow Launch Validation Template

Pre-build validation that costs **<$100** and takes **<72 hours**. A passing shadow launch is the final green light
before the 48h build pipeline starts; a failing one kills the idea.

### The template (executable)

1. **Landing page (day 0–1, ~$0).** Build the [`shadow-launch-page-template.html`](shadow-launch-page-template.html) with the **exact pain statement in the customer's own words** — pulled verbatim from the Part 3 evidence log / Part 4 verbatim quotes. No product, no features, no price — just the problem and a waitlist form.
2. **Ads (day 1, ~$50).** Spend **$50** on hyper-targeted Reddit/Facebook ads aimed at the Type B/C communities. Track traffic source with UTM parameters so **cold** and warm traffic are measured separately.
3. **Measure (day 2–3).** Compute **cold-traffic → waitlist conversion** = waitlist signups ÷ unique cold visitors × 100.

### Decision thresholds (mandatory)

| Metric | Threshold | Action |
| -- | -- | -- |
| Cold-traffic → waitlist conversion | **≥ 15%** | **Green light** — build |
| Cold-traffic → waitlist conversion | **3–15%** | Hold — iterate message match, re-run |
| Cold-traffic → waitlist conversion | **< 3%** | **Kill the idea.** Do not rationalize a weak number |

### Sample-size floor (mandatory)

Do not read the number until you have **≥1,000 unique cold visits** **or ≥100 conversions**, or the rate is noise.
Below ~200 visits treat the result as a *directional* read only (LemonPage, 2026-01-30).

**Sample-floor vs. budget conflict rule:** if the 72h budget elapses with <1,000 unique cold visits, extend the ad spend by up to **$40** (hard cap **$90** total ads) and up to **48h** to reach the sample floor — total shadow-launch cost stays <$100. If the floor is still unreachable after the extension, the result is **indeterminate**: you may **not** green-light a build on an unreadable number, and you may not call it a kill either — re-target the audience or park the niche. Never cite a sub-floor conversion as evidence.

### Independent benchmark cross-check

The 15% green-light and 3% kill thresholds sit inside the published cold-paid → waitlist band for pre-launch pages:
healthy **8–15%**, alarm **<3%** (LemonPage, 2026-01-30). By vertical, LemonPage reports healthy cold-paid ranges of
**B2B SaaS 5–12%**, **fintech 4–10%**, **consumer productivity 10–20%**, **creator tools 12–25%** (2026-01-30).
Adjust expectations by vertical, never below the 3% kill floor.

### Anti-rationalization rules

- Waitlist signups are a **middle signal**, not proof of demand — the strongest signal is a qualified reply to
  follow-up (Dowhatmatter fake-door framework). Email every signup within 48h and book 5 calls before building.
- A high conversion on **warm** traffic proves nothing about strangers (LemonPage, 2026-01-30). Judge on cold traffic.
- Never average warm + cold into one number; never count clicks as signups.

---

## Part 8 — Crowded-Market Playbook

**Thesis:** *too many competitors is a signal OF demand, not AGAINST entry* — provided you enter on a wedge that
the incumbents structurally missed.

### The Granola case study

- **Situation:** AI meeting-note tools were a saturated category with 5+ funded incumbents (Read AI, Fireflies, Quill, and others) when Granola entered. Founded in 2023 by Chris Pedregal and Sam Stephenson (The Next Web, 2026-03-25), it went from ~5,000 weekly users at its October 2024 Series A to a $1.5B valuation in 18 months.
- **The wedge every competitor missed:** *consent and control.* Competitors shipped a visible bot into the call; Granola records locally on the user's computer with no bot in the meeting, and built its enterprise story on consent management, granular access controls (Spaces/Folders), and user control over what is visible, to whom, and when.
- **Outcome:** $125M Series C at a **$1.5B valuation** (up from $250M) led by Index Ventures, with Kleiner Perkins participating — total funding $192M. Customers include Vanta, Gusto, Thumbtack, Asana, Cursor, Lovable, Decagon, Mistral AI.
- **Source and date:** TechCrunch, *"Granola raises $125M, hits $1.5B valuation…"*, **2026-03-25** (also Bloomberg 2026-03-25; Sifted 2026-03-25; The Next Web 2026-03-25 — founding year and Series-A trajectory; granola.ai Series C announcement 2026-03-25).

### The method — find the wedge complaints miss

1. A saturated category + loud recurring complaints (Part 3/4) = **validated market** (money is flowing, G2 passes) **plus an execution gap** (G4).
2. Do **not** chase feature-comparison wins — you will lose the incumbent's table-stakes game on their own battlefield.
3. Mine the complaint clusters for a dimension **every competitor shares and none addresses** — the shared constraint (Part 4 step 5). Granola's was the social/consent dimension of having an AI in the room; the wedge was *control*, not *accuracy*.
4. Verify the wedge passes G5/G6/G7: it must be productizable (not a service), priceable at ≤10% of value created, and B2B-sellable.

### Execution guidance

- Search for the **wedge the complaints miss**, not the most common complaint. The most common complaint is the incumbent's known weakness (they may fix it); the *shared structural constraint* is the moat.
- Use funding recency (Channel 6) to confirm the category is still receiving capital before committing to a wedge play.

---

## Part 9 — Strategy-to-Source Mapping

How the framework feeds the three GTM strategies. Each strategy pulls from a primary source, cross-checks with a
secondary source, and has its own validation gate.

| Strategy | Primary Source | Secondary Source | Validation Gate |
| -- | -- | -- | -- |
| App Marketplace Arbitrage | G2 / Capterra / App Store 1–3★ reviews | Reddit tool-complaint threads | Review cluster frequency + price-anchor gap (G2, G3, G6, K6) |
| Feature-to-SaaS (Gap Filler) | HubSpot Ideas, Salesforce IdeaExchange | Reddit workaround threads | Upvotes + ignored-years + API cloneability (Channel 3 metrics) |
| MCP / API-as-Service | Smithery useCount gaps, Reddit | GitHub issues, Stack Overflow | Registry gap × complaint volume × buildability (G1, G4, K4) |

### Framework → strategy flow

1. **Discover (Part 1 + Part 2):** classify signals by tier; choose channels per strategy from the table above.
2. **Validate (Parts 3–5):** run the Reddit protocol and the 48h pass for every candidate niche.
3. **Score (Part 6):** apply hard gates G1–G7 + weighted score → the 3-niche shortlist.
4. **Confirm (Part 7):** shadow-launch each shortlisted niche before the build pipeline commits.
5. **Position (Part 8):** for crowded categories, find the wedge complaints miss.

The **output of this framework is a scored, evidence-backed niche list** — the direct input to the AIM-4684
(App Marketplace Arbitrage) and AIM-4685 (Feature-to-SaaS) pipelines, and the same procedure applies to the
MCP/API-as-Service strategy.

### Strategy-specific source extensions

Part 2 documents the six core channels. The strategy table above references three sources that sit **outside** the
core six — each is documented here so the strategy lane is executable end-to-end:

**App Store 1–3★ reviews** (App Marketplace Arbitrage primary; extends Channel 2 to iOS/Android).
- Query: App Store/Google Play listing page → Reviews → filter 1–3★; `itunes.apple.com/lookup` (app id) → `customerReviews` page for programmatic pull.
- Gotchas: App Store only exposes ~500 recent reviews via API; older complaints live on the app's page only. Google Play reviews are owner-repliable — count replies as service-context, not product signal.
- Output: same theme table as Part 4. Cost $0 · time 45 min.

**Smithery useCount gaps** (MCP/API-as-Service primary).
- Query: `smithery.ai` server list for your MCP category, sorted by useCount; a **gap = a category with high total demand (useCount) but ≤3 servers** covering it, or a top server with useCount ≫ its nearest 3 competitors (concentration + gap).
- Gotchas: useCount measures installs, not retention — pair with Part 3 complaint volume; MCP registries churn fast, re-pull within the 48h window.
- Output: `server | category | useCount | # servers in category | gap (Y/N)`. Cost $0 · time 20 min.

**GitHub issues + Stack Overflow** (MCP/API-as-Service secondary).
- Query: `github.com/search?q="{problem}"&type=issues` sorted by reactions; `stackoverflow.com/search?q=[problem]+[language]` filtered to unanswered/active.
- Gotchas: issue stars/reactions are dev-applause (Tier 4-adjacent) — require a *specific, repeated* integration ask across ≥3 repos, not "would be cool" issues. SO answered-with-accepted-answer questions are noise; hunt the *unanswered, recently-asked* ones.
- Output: `repo/question | ask | reactions | date | integration needed`. Cost $0 · time 30 min.

These extensions inherit the Part 1 tiering and feed the same Part 6 scoring; they are the only channels beyond the core six used by the strategy map.

---

## Sources

Every third-party claim above is cited with source and date. Items marked *internal heuristic* are framework
standards that could not be independently verified as of 2026-08-06 and are **not** attributed to an external source.

| Claim | Source | Date |
| -- | -- | -- |
| Reddit 4-method protocol; 8,000+ threads / 300,000+ comments corpus; Type A/B/C convergence; 71% correlation phrase (flagged *internal heuristic* in this document) | [ValidSaaS — How to Find SaaS Ideas People Will Actually Pay For](https://validsaas.com/blog/how-to-find-saas-ideas-people-will-pay-for) / [The Reddit Research Method](https://validsaas.com/blog/reddit-research-method-validate-saas) (Jeffery Robinson) | 2026-03-07 / 2026-03-08 |
| Map of Reddit dataset (~176M comments) | [mapofreddit.com](https://mapofreddit.com) (dataset property); operational how-to cited via ValidSaaS | n/a (dataset) |
| 1–3★ review-mining workflow; 200 reviews / 5 competitors / $1.25 pass; per-result rates (Trends $0.004, Crunchbase $0.0133, Trustpilot $0.005, Maps $0.0015, contacts/verify $0.001); product-vs-service classification; funding-recency rule; no-review-presence rule | [The Mine Works — I Validated a Business Idea in 48 Hours by Mining 1-Star Reviews](https://themineworks.com/blog/validate-business-idea-mining-reviews/) | 2026-07-17 |
| Granola case: $125M Series C at $1.5B valuation; consent/control wedge; customers; founding year 2023 & Series-A trajectory | [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/) · [Bloomberg](https://www.bloomberg.com/news/articles/2026-03-25/ai-notetaker-granola-hits-1-5-billion-value-in-125-million-funding) · [Sifted](https://sifted.eu/articles/ai-notetaking-startup-granola-hits-unicorn-status) · [The Next Web](https://thenextweb.com/news/granola-series-c-meeting-ai-enterprise-context) · [granola.ai blog](https://www.granola.ai/blog/series-c) | 2026-03-25 |
| Cold-paid → waitlist benchmarks: healthy 8–15%, alarm <3%; vertical bands (B2B 5–12%, fintech 4–10%, consumer 10–20%, creator 12–25%); ≥1,000 visits / 100 conversions sample floor; warm-traffic inflation warning | [LemonPage — Landing Page Conversion Benchmarks for Pre-Launch](https://lemonpage.ai/blog/landing-page-conversion-benchmarks-pre-launch) | 2026-01-30 |
| "No competitors is a red flag, not a green one"; review-gap validation; strong/weak signal table | [GetAppNiche — How to Validate an App Idea Before You Build](https://getappniche.com/guides/validate-app-idea) | 2026-06-17 |
| Buying-intent signal taxonomy; 1–10 intent scoring; budget/timeline/competitor-frustration signals; compound-intent example | [Linkeddit — How to Find Buying Intent Signals on Reddit](https://linkeddit.com/blog/reddit-buying-intent-signals-guide) | 2026-03-21 |
| Upvotes are applause, not wallets; compliment-validation; incumbent = real market; GO/WAIT/KILL framework | [ReddTrends — How to Validate Startup Ideas on Reddit](https://www.reddtrends.com/blog/validate-startup-ideas-reddit) | 2026-07-06 |
| Pain-language operators; 5-point thread analysis; workaround = PMF signal | [ReddGrow — Reddit Customer Research for SaaS](https://reddgrow.ai/blog/reddit-customer-research-saas/) · [Reddit Product-Market Fit](https://reddgrow.ai/blog/reddit-product-market-fit-saas/) | 2026-03-26 / 2026-04-02 |
| Buying-intent search phrases; budget/tool-anchor phrases; money-phrases ranking | [Rawneed — Reddit Pain-Point Search](https://rawneed.com/guides/reddit-pain-point-search/) | 2026-05-31 |
| Waitlist conversion is a middle signal; layered fake-door metrics; qualified-reply strength | [Dowhatmatter — Fake Door Test Metrics](https://dowhatmatter.com/guides/fake-door-test-metrics) | undated guide — cited as a method reference only (no time-sensitive data) |
| "I would pay someone to just…" **71% correlation** with validated waitlist demand | *internal heuristic* — no independent public source found as of 2026-08-06; carried per ticket scope | — |
| 10% price rule (price ≤10% of value created = no procurement friction) | *internal heuristic* — framework pricing rule | — |
