# LLM Routing Strategy

Difficulty-tiered model routing: every fix is routed to a **difficulty tier
(1-4)** which maps to a **variant** (`low` / `medium` / `high` / `max`) and a
model. Cheap tiers use cheap models for the majority of routine fixes; frontier
models are reserved for genuinely hard work. Routing is **on by default** and
can be disabled.

> Source of truth for the tier/variant model is the OpenSymphony
> **DifficultyRouter** (in the OpenSymphony repo). This document describes the
> SYNTARO-side contract: how SYNTARO computes the tier it requests, how it
> reports which variant was used, and how the eval/regression harness enforces
> quality per tier.

## 1. Tier and variant model

| Difficulty tier | Variant  | Typical task                       | Example model                        |
|-----------------|----------|------------------------------------|--------------------------------------|
| 1               | `low`    | Simple, well-scoped fixes          | `deepseek-v4-flash` (cheap)          |
| 2               | `medium` | Standard fixes with some context   | `gpt-4o-mini` (cheap)                |
| 3               | `high`   | Complex, cross-file fixes          | `anthropic/claude-sonnet-4-20250514` |
| 4               | `max`    | Frontier / deep reasoning          | `anthropic/claude-opus`              |

SYNTARO's model router (`src/proxy/modelRouter.ts`) maps a task to a tier via
`difficultyForTask(complexity, accountTier)`:

- `triage` → tier 1
- `review` → tier 3
- `fix` → tier 3 (enterprise), 2 (pro), 1 (free)

The caller may override the tier explicitly. The variant is derived from the
tier with `variantForDifficulty(tier)`.

## 2. How routing flows

```
GitHub issue → github webhook
  └ resolveRoutingSelection(accountTier)  # computes model + tier + variant
       ├ persisted on the pending run (run_history.difficulty_tier/variant)
       └ POST /api/v1/dispatch { model, difficulty_tier, variant }  → OpenSymphony
```

OpenSymphony's own DifficultyRouter remains authoritative server-side; SYNTARO
reports the tier/variant it requested and persisted. Run status and audit
surfaces expose the routed variant:

- `GET /api/v1/runs` (dashboard runs list) — `modelUsed`, `difficultyTier`, `variant`
- public run page `/runs/:id` — **Routed Variant** card (`variant (Tier N)`)
- MCP `check_status` / `syntaro://runs/{run_id}` — `model`, `variant`, `difficulty_tier`
- Dashboard run detail — **Routed Variant** row in the Cost & Model card

## 3. Self-host configuration

### 3.1 Routing on/off

Routing is **on by default**. Disable it:

```bash
PROXY_MODEL_ROUTER_ENABLED=false
```

When routing is disabled, no model is auto-selected; the dispatch carries the
explicit `model` only.

### 3.2 Bring-your-own model

Tier → model mapping is configurable per deployment. The default registry lives
in `src/proxy/modelRouter.ts` (`DEFAULT_MODEL_REGISTRY`), keyed by
`(complexity, accountTier)`. Override it at runtime through the proxy admin API:

```bash
# Read the current registry
GET  /api/proxy/registry

# Replace the model list for a (complexity, tier) pair
PUT  /api/proxy/registry
{ "complexity": "fix", "tier": "free", "models": [
    { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "available": true,
      "costMultiplier": 0.1, "capabilities": ["code"] }
] }
```

### 3.3 Environment reference

| Variable | Default | Description |
|---|---|---|
| `PROXY_MODEL_ROUTER_ENABLED` | `true` | Master switch for model routing |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Fallback model when routing/registry fails |
| `FALLBACK_MODELS` | `gpt-4o,claude-haiku` | Availability fallback chain |
| `OS_INCIDENTS_URL` | (derived from `OSY_DISPATCH_URL`) | OpenSymphony observability origin for the incidents API |
| `OS_INCIDENTS_TIMEOUT_MS` | `10000` | Timeout for the incidents queue proxy |
| `INCIDENT_RESOLVE_NOTIFICATIONS` | `true` | Emit in-app notifications on incident resolution |

## 4. Quality gates apply to every tier

The 6 deterministic quality gates (see `SYNTARO-QUALITY-GATES.md`) apply to
**cheap-tier fixes exactly as they do to frontier-tier fixes**. Two mechanisms:

1. **Per-fix gating** — `scripts/quality-gates.sh --fix-diff <patch>` applies a
   fix diff to an isolated clone and runs the diff-level gates (Reality, Test
   Integrity, Hallucination/Stub) against exactly the files the patch touches.
2. **Regression driver** — `npm run eval:gates` runs `eval/scripts/regression-gates.mjs`
   over eval results and **blocks** if any Tier 1-2 fix failed a blocking gate.

## 5. Evaluation: pass rate + cost per tier

Eval test cases can declare the tier/variant they exercise:

```yaml
issueTitle: Fix broken login redirect
issueDescription: "..."
repo: my-org/my-repo
expectedOutcome: "..."
expectedFiles: ["src/login.ts"]
tier: 2
variant: medium
```

Results carry `tier`, `variant`, and `costCents` back into the promptfoo output.
Two reporting paths:

```bash
# Per-tier pass rate + avg cost, with regression check vs baseline
npm run eval:tiers              # fails (exit 1) if a tier drops >0.05 vs baseline

# Nightly full report now includes total + avg cost
node eval/scripts/full-report.mjs --input-dir eval/results --output eval/results/full-report.json
```

Per-tier baselines live in `eval/baselines/tiers.json`:
| Tier | Baseline pass rate |
|---|---|
| 1 (low)   | 0.90 |
| 2 (medium)| 0.85 |
| 3 (high)  | 0.80 |
| 4 (max)   | 0.75 |

The baselines encode the expectation that cheap tiers clear the same gates at
only a fraction of the cost; if a cheap tier's pass rate falls below its
baseline, the regression check fails so the routing change cannot land silently.
