# LLM Routing Strategy (SYNTARO / STAS)

> Reference document for AIM-4622 — "Qualitäts-Gates je Tier, Eval Pass-Rate+Kosten je Tier, Variante im Status-Flow, Self-Host-Doku".
> Product direction: 2026-08-04. Applies to the `solving_tickets_as_a_service` (STAS) pipeline, the `dashboard/` webapp, and the OpenSymphony dispatch backend.

## 1. Problem

Historically the SYNTARO fix pipeline used one frontier model (e.g. `claude-sonnet-4`) for **every** fix — "pauschal". That is expensive for the 70–80% of tasks that are routine (formatting, small edits, RAG summaries) and wastes quality budget that should be reserved for deep reasoning, complex logic, and advanced coding.

Routing (OS: **Difficulty Tier 1–4 → low / medium / high / max variants**, already merged in the OpenSymphony backend) changes the cost/quality structure of the pipeline. This document defines how STAS participates:

1. **Quality gates apply per tier** — the same deterministic gates run for cheap-routed fixes (Tier 1–2, small model) as for frontier fixes (Tier 3–4).
2. **Eval reports per tier** — pass-rate AND cost are measured per tier, so easy-cheap and hard-expensive are visible and comparable.
3. **Status / MCP flow shows the routed variant** — `syntaro_check_status` and the Run-Detail page show which model/tier was used.
4. **Self-host: routing is configurable** — tier→model mapping is overridable (BYO model), and routing is on by default but can be disabled (force a single model).

## 2. Tier model

| Difficulty Tier | Routing variant | Model class | Typical workload |
|---|---|---|---|
| 1 | `low` | Cheap (e.g. `gpt-4o-mini`, `deepseek-v4-flash`) | Formatting, small scope, mechanical edits |
| 2 | `medium` | Cheap-to-mid | Routine fixes with clear repro steps |
| 3 | `high` | Frontier (e.g. `claude-sonnet-4`) | Moderate complexity, cross-file changes |
| 4 | `max` | Frontier (best available) | Deep reasoning, multi-repo batches, hard tickets |

Routing maps the **triage difficulty** (`easy | medium | hard`, see `src/types/agent-types.ts` `TriageResult.difficulty`) onto a tier:

| Triage difficulty | Tier |
|---|---|
| `easy` | 1 |
| `medium` | 2 |
| `hard` | 3 |
| `unknown` | 4 (conservative: escalate) |

The OS dispatch layer performs the actual difficulty classification and variant selection. STAS records the **resulting variant** (tier + model) on every run so the decision is transparent and auditable, and re-derives the model mapping locally via the Model Router for self-hosted deployments where OS dispatch is not in the loop.

## 3. Quality gates per tier

The **6 deterministic gates** (AIM-1848 / AIM-1895) are **model-agnostic**: they validate the *produced fix*, not the model that produced it. Therefore the same gates run for every tier. No gate may be skipped or weakened because a cheap model was routed.

Gates (run via `npm run quality-gates` / `scripts/quality-gates.sh`):

1. **Reality check** — every referenced file actually exists
2. **Compile check** — `tsc --noEmit` passes
3. **Test integrity** — tests have real assertions (not vacuous)
4. **Hallucination / stub check** — no placeholder patterns, fake imports
5. **Dead code** — knip + ts-prune
6. **External AI tool scan** — ghostcheck + trace-core + anti-hallucination + vibecop

Runtime pipeline gates (see `src/pipeline/quality-gates.ts`, `runAllGates`) additionally enforce build, test, lint, security, and sandbox isolation for **every** fix attempt, regardless of routed variant.

**Regression set** (`scripts/gates-per-tier.mjs`): runs the 6 deterministic gates against a fixture set containing both easy and hard tickets for each tier variant (Tier 1 cheap + Tier 4 frontier). Output documents both green, or an evidence-backed gap.

## 4. Eval per tier (pass-rate + cost)

The eval system (base: AIM-4497) lives in `eval/`. Existing grouping (`group-1/2/3`) is by language; tier reporting is added on top:

- Each eval result is tagged with a `tier` (1–4).
- `eval/scripts/full-report.mjs` reports **pass-rate AND cost per tier** in addition to overall + per-group numbers.
- A per-tier provider config (`eval/promptfooconfig.tier1.yaml`, `...tier4.yaml`) runs the same test cases through cheap vs frontier providers so the benchmark curve is honest.

Example report shape:

```
| Tier | Variant | Tests | Passed | Pass rate | Cost (total) |
|------|---------|-------|--------|-----------|--------------|
| 1    | low     | 10    | 9      | 90.0%     | $0.14        |
| 2    | medium  | 10    | 8      | 80.0%     | $0.42        |
| 3    | high    | 10    | 9      | 90.0%     | $1.30        |
| 4    | max     | 10    | 10     | 100.0%    | $3.10        |
```

## 5. Status / MCP flow — routed variant

The routed variant (tier + model) is surfaced at every transparency point:

- **MCP** `syntaro_check_status` → `McpJobStatus.routingVariant` (`{ tier, model, variant }`)
- **Run API** `GET /api/runs/:id` → `routingVariant` alongside `modelUsed`
- **Run history** (`run_history`) → new `routing_tier` column
- **Dashboard Run-Detail** → "Routing variant" row in the Cost & Model card

## 6. Self-host configuration

Routing is **on by default** and can be **disabled** (force a single model).

| Env var | Default | Meaning |
|---|---|---|
| `ROUTING_ENABLED` | `true` | Master switch. `false` forces the default model for all tiers. |
| `ROUTING_TIER1_MODEL` | `gpt-4o-mini` | Model for tier 1 (cheap) |
| `ROUTING_TIER2_MODEL` | `gpt-4o-mini` | Model for tier 2 (cheap-to-mid) |
| `ROUTING_TIER3_MODEL` | `anthropic/claude-sonnet-4-20250514` | Model for tier 3 (frontier) |
| `ROUTING_TIER4_MODEL` | `anthropic/claude-sonnet-4-20250514` | Model for tier 4 (frontier, max) |
| `ROUTING_TIER_MODEL_OVERRIDE` | — | `tier=model,tier=model` — bypass the four vars (BYO model, single source) |

BYO model: set the tier vars (or `ROUTING_TIER_MODEL_OVERRIDE`) to your own model ids. The Model Router registry can additionally be tuned at runtime via the proxy admin endpoint (`src/routes/proxy.ts`).

**Disable routing** (force one model):

```bash
ROUTING_ENABLED=false OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514 npm run start
```

## 7. Config wiring (STAS)

New env vars (see `src/config.ts`):

```ts
ROUTING_ENABLED: z.enum(['true','false']).default('true'),
ROUTING_TIER1_MODEL: z.string().default('gpt-4o-mini'),
ROUTING_TIER2_MODEL: z.string().default('gpt-4o-mini'),
ROUTING_TIER3_MODEL: z.string().default('anthropic/claude-sonnet-4-20250514'),
ROUTING_TIER4_MODEL: z.string().default('anthropic/claude-sonnet-4-20250514'),
ROUTING_TIER_MODEL_OVERRIDE: z.string().default(''),
```

`config.routing` exposes:

```ts
{
  enabled: boolean,
  tierModels: Record<1|2|3|4, string>,
}
```

`ModelRouter` (see `src/proxy/modelRouter.ts`) accepts a `routingTier` on `selectModel()`; when `ROUTING_ENABLED=false` the router short-circuits to the default model.

## 8. Acceptance criteria

- [ ] Gates run with Tier-1 (cheap) + Tier-4 (frontier) variants — both green, or a gap documented with evidence
- [ ] Eval scripts report pass-rate + cost per tier (example run in PR)
- [ ] Run-Detail / audit contains the routed variant (model/tier)
- [ ] Self-host docs cover routing config + BYO model + routing off-switch
- [ ] Tests green; PR with evidence; not pushed directly to main
