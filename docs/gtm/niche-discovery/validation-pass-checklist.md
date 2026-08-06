# Niche Validation Pass — Checklist (copy-paste per niche)

**Niche candidate:** `________` · **Pain hypothesis (one sentence):** `________`
**Start:** `________` (T-0) · **Deadline:** T+48h · **Budget cap:** $100 · **Operator:** `________`

> Run every step in order. A step with a ❌-gate that fails **kills the pass** — park the candidate, do not
> continue to the next step. Do not rationalize a weak number.
> Full methodology: [`playbook.md`](playbook.md). Artifacts: [`scoring-matrix-template.csv`](scoring-matrix-template.csv),
> [`shadow-launch-page-template.html`](shadow-launch-page-template.html).

---

## Step 1 — Trend check (Google Trends) · ~20 min · ~$0.01

- [ ] Ran `today 5-y` and `today 12-m` reports for `[category]` + 2 substitutes
- [ ] Recorded direction (5y/12m): rising+rising / rising+flat / flat+rising / flat+flat / dying / unknown (`________`)
- [ ] ❌-GATE: rising+rising → proceed; rising+flat → proceed with caution; flat+rising → emerging, proceed; flat+flat or dying → **kill**; unknown → treat as flat (proceed only if other gates pass)
- [ ] Evidence → evidence log URL / notes: `________`

## Step 2 — Demand clustering (Reddit) · ~90 min · $0

- [ ] Starting hypothesis recorded (audience + pain — from Part 2 discovery, not invented here)
- [ ] Community discovery done (Map of Reddit + AI + native search; ≥2 methods combined)
- [ ] Type A: `________` · Type B: `________` · Type C: `________`
- [ ] Method A run (top-100 posts, Type B + Type C; agreement = ≥3 distinct commenters affirming): `________`
- [ ] Method B run (top 3–5 themes cross-Reddit; theme × community matrix): `________`
- [ ] Method C run (problem-language boolean queries incl. money phrase): `________`
- [ ] Method D run (competitor-name queries for every tool named): `________`
- [ ] Evidence log ≥ 50 rows: `URL | subreddit | community type (A/B/C/—) | method (A/B/C/D) | date | upvotes | tier | quote | quantified?`
- [ ] ❌-GATE (all three):
  - [ ] ≥ 1 Tier-1 signal (workaround / institutional friction)
  - [ ] pain in ≥ 2 independent communities (must include a B and a C), or ≥ 4 via Method B (3 communities passes only with a B + C present)
  - [ ] ≥ 3 comments quantify the pain (hours / dollars / churn)
- [ ] FAIL → **kill**. PASS → next

## Step 3 — Incumbent map (Crunchbase) · ~15 min · ~$0.07

- [ ] 5 companies recorded: `________`
- [ ] Funding recency: meaningful round (≥ $1M, ≤ 12 months ago, professional investor; seed-only excluded) in last 12 months? yes / no
- [ ] ❌-GATE: yes → proceed; all rounds ≥ 3y old or seed-only → **downgrade or kill**

## Step 4 — 1★ review mine (Trustpilot / G2 / Capterra) · ~90 min · ~$1.00

- [ ] 200 reviews scraped across 3–5 competitors (target 5; mine all with review presence if fewer)
- [ ] Filtered to 1–2★ (keep G2 3★ "fine but missing X")
- [ ] LLM cluster run — themes ranked by frequency, competitor coverage, product-vs-service, verbatim quotes
- [ ] Theme table: `theme | # reviews | competitors hit (out of mined) | product/service | 2 quotes`
- [ ] ❌-GATE: single product complaint spanning ≥ 3 competitors (or all mined if <5) = build candidate
- [ ] Service-only complaints → **downgrade**

## Step 5 — Buyer enumeration (Google Maps) · ~15 min · ~$0.08

- [ ] 50 businesses listed (name / website / category): `________`
- [ ] ❌-GATE: can name 50 real buyers? yes → proceed; no → **downgrade**

## Step 6 — Outreach test (email finder + verifier) · ~30 min · ~$0.10

- [ ] 50 contacts found + verified (MX + SMTP; role-based/catch-all flagged)
- [ ] <100-word outreach sent, opening with the Step-4 complaint theme in reviewers' words (no pitch)
- [ ] Replies confirming the pain: `____` (need ≥ 3)
- [ ] ❌-GATE: ≥ 3 confirming replies → proceed; 0–2 → **re-target or kill**

---

## Pass result (all six gates)

- [ ] PASS — proceed to Scoring Matrix (Step 7)
- [ ] KILL — parked at `________` (revisit after 60–90 days if a signal changes)

## Step 7 — Scoring Matrix (`scoring-matrix-template.csv`)

**Hard gates (all must pass):**

- [ ] G1 — pain in ≥ 2 independent communities (must include a B + C), or ≥ 4 via Method B
- [ ] G2 — ≥ 2 paid tools already exist
- [ ] G3 — pain quantified in ≥ 3 comments
- [ ] G4 — ≥ 1 clear unserved gap across all competitors
- [ ] G5 — NOT solvable with Zapier/n8n in a weekend (else: consulting job → reject)
- [ ] G6 — 10% rule: price ≤ 10% of value created (≥ 10x buyer ROI)
- [ ] G7 — B2B (B2C rejected unless extraordinary evidence: ≥ 10 posts with a named budget + repeat-purchase economics)

**Weighted score:** `____` / 100. Formula: `(K1×0.25 + K2×0.20 + K3×0.20 + K4×0.15 + K5×0.10 + K6×0.10) × 10` (each K is 0–10; the ×10 rescales to the 0–100 bands). Rubric: K1 signal 25% · K2 convergence 20% · K3 complaint density 20% · K4 buildability 15% · K5 buyer concentration 10% · K6 price-anchor gap 10%.

- [ ] Score ≥ 70 → **build candidate** → Step 8 (shadow launch)
- [ ] 55–69 → watchlist (re-run in 60–90 days)
- [ ] < 55 → discard

## Step 8 — Shadow Launch (<$100, <72h)

- [ ] Landing page live with exact pain statement in customers' own words (`shadow-launch-page-template.html`)
- [ ] $50 hyper-targeted Reddit/Facebook ads (UTM-tracked; cold traffic separated from warm)
- [ ] Cold-traffic → waitlist conversion measured at ≥ 1,000 unique cold visits (or ≥ 100 conversions)
- [ ] If 72h elapses with < 1,000 visits: extended ads by ≤ $40 (cap $90 total) and ≤ 48h; if still below floor → **indeterminate** (no green-light, no kill — re-target or park)
- [ ] Conversion: `____%`
  - [ ] ≥ 15% → **green light — build**
  - [ ] 3–15% → hold, iterate message match
  - [ ] < 3% → **kill the idea** (do not rationalize)

---

## Evidence index

| Artifact | Link |
| -- | -- |
| Part 3 evidence log (≥ 50 rows) | `________` |
| Part 4 theme table (200 reviews) | `________` |
| Step 5 buyer list (50) | `________` |
| Step 6 outreach + replies | `________` |
| Shadow launch analytics | `________` |
