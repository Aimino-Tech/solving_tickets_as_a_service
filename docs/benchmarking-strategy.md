# Benchmarking Strategy

> **Policy**: Run STAS against relevant AI coding benchmarks internally. Iterate on performance until we rank among the top. Publish only once we can position as a leader.

## Why This Strategy

STAS is an async issue-to-PR tool that reads full codebases, produces a plan first (architect-mode), then fixes bugs. Our differentiator is the **plan-first architecture** — we're the architect, not the coder. Benchmarks must reflect this: not just raw fix rate, but plan quality, context understanding, and big-picture reasoning.

Every competitor wraps Claude/GPT. STAS differentiates on execution quality and integrated pipeline — our benchmark story must prove that.

## Selected Benchmarks

### Primary (Direct Product Match)

| Benchmark | Why | Target Metric |
|---|---|---|
| **SWE-bench Verified** | Industry standard for issue-to-fix agent evaluation. 500+ real-world GitHub issues across Python. Required for internal credibility. | % Pass rate (current: ~92%) |
| **PlanBench** | Tests planning/reasoning before execution. Perfect match for our plan-first differentiator. | Plan quality score, execution accuracy |
| **RepoBench** | Long-context repository understanding (1K-10K+ token contexts). Matches our "reads full repo" moat. | Context precision, retrieval accuracy |

### Secondary

| Benchmark | Why | Target Metric |
|---|---|---|
| **SWE-bench Multilingual** | If available — demonstrates multi-language capability beyond Python | % Pass rate |
| **HumanEval / MBPP** | Basic coding benchmarks — expected baseline to validate model coding ability | % Pass@1 |
| **CRUXEval** | Execution prediction — tests if model understands code flow without running it | Prediction accuracy |

### STAS-Specific Benchmark (Proposed)

An internal **JS/TS-focused issue-resolution benchmark** using real GitHub issues from popular OSS repos (Vite, Next.js, TypeScript, ESLint, Biome). This differentiates from SWE-bench (Python-heavy) and demonstrates real-world value for our target audience.

**Rationale**: SWE-bench is Python-dominated. Our target users work in JS/TS (TypeScript, React, Node.js ecosystems). We must prove STAS works in their stack.

## Methodology

### Scoring Framework

Each benchmark run produces a structured scorecard:

```
Run ID: bench-2026-07-22-001
Date: 2026-07-22
Model: claude-sonnet-4
Results:
  swe-bench:         { pass_rate: 0.92, total: 500, passed: 460 }
  planbench:         { plan_quality: 0.85, execution: 0.88 }
  repobench:         { context_precision: 0.79, retrieval: 0.91 }
  js-ts-benchmark:   { pass_rate: 0.89, total: 100, passed: 89 }
  humaneval:         { pass@1: 0.82 }
```

### Weak Spot Analysis

For each failed test case, we categorize the failure:

| Category | Description | Action |
|---|---|---|
| **Context miss** | Agent failed to find the relevant code | Improve repo scanning, add search hints |
| **Plan error** | Agent chose wrong approach | Improve architect-mode prompts |
| **Execution bug** | Agent generated incorrect code | Improve code generation, add verification |
| **Test gap** | Test suite had false negatives | Improve test generation |
| **Timeout** | Agent ran out of time | Optimize pipeline, increase limits |

### Iteration Loop

```
Run benchmarks → Analyze failures → Identify patterns → Fix prompts/agent → Re-run → Track delta
```

## Publishing Policy

### DO NOT PUBLISH Until Top Tier

**Hard rule**: No blog posts, README badges, HN/Reddit posts, or comparison pages until STAS ranks in the top tier of every published benchmark.

**Top tier definition**:
- **SWE-bench Verified**: Pass rate ≥ published top-5 result
- **PlanBench**: Plan quality score ≥ published leader median
- **RepoBench**: Context precision ≥ published top-3
- **JS/TS benchmark**: ≥85% pass rate on our internal set

### What to Publish

When ready, publish:

1. **Blog post** — Technical breakdown of STAS architecture and benchmark results
2. **README badge** — Live badge showing current pass rate
3. **Comparison page** — `/benchmarks` landing page on the marketing site
4. **HN/Reddit post** — "We built an open-source alternative to [competitor] that beats it on [benchmark]"
5. **Benchmark leaderboard** — Auto-generated from `docs/leaderboard.md`

### What NEVER to Publish

- Cherry-picked results (only report full benchmark suites)
- Scores below top tier (wait until we improve)
- Internal failure analysis (keep in `eval/results/`)

## Quarterly Cadence

### Full Benchmark Run (Quarterly)

- Run all benchmarks
- Generate full report
- Archive results with date stamp
- Update trend tracking

### Targeted Runs (As Needed)

- Run specific benchmarks after prompt/agent changes
- Focus on benchmarks where we're weakest
- Run JS/TS benchmark after any code-understanding changes

### Pre-Publishing Run

Before publishing ANY results:
1. Run all benchmarks 3 times
2. Take median scores (not best)
3. Verify results are reproducible
4. Only publish if all benchmarks meet top-tier threshold

## Infrastructure

### Runner

The benchmark runner lives in `eval/benchmarks/core.ts` and is invoked via:

```bash
# Full suite
npx tsx eval/benchmarks/core.ts --suite full

# Single benchmark
npx tsx eval/benchmarks/core.ts --suite swe-bench

# With output
npx tsx eval/benchmarks/core.ts --suite full --output eval/results/bench-$(date +%Y-%m-%d).json
```

### Tracking

Scores are tracked in `eval/results/tracking.json` — a historical log of all benchmark runs with timestamps and agent configuration.

### Reports

After each full run:
1. `eval/results/full-report.json` — structured data
2. `eval/results/full-report.md` — human-readable summary
3. `eval/badges/pass-rate.svg` — updated badge

## Success Criteria

| Criterion | Measurement | Target |
|---|---|---|
| Measurable scores | Structured benchmark results | Tracked quarterly |
| Improvement over time | Score delta per quarter | Positive trend |
| Top-tier positioning | All benchmarks ≥ top-tier threshold | Before publishing |
| Automated runs | CI/CD pipeline runs benchmarks | Quarterly + pre-release |
| Weak spot identification | Failure categorization per run | Every run |

## Appendices

### A. Benchmark Descriptions

**SWE-bench Verified**: 500+ real GitHub issues from 12 popular Python repos. Agents must produce a patch that passes the project's existing tests. Industry standard for code agent evaluation.

**PlanBench**: Tests whether an agent can produce a correct plan before executing. Evaluates plan correctness, completeness, and efficiency. Maps directly to STAS's architect-mode.

**RepoBench**: Tests long-context understanding across repository structures. Agents must find relevant code, understand dependencies, and produce correct fixes requiring cross-file changes.

**HumanEval / MBPP**: Standard function-level coding benchmarks. Tests basic code generation capability.

**CRUXEval**: Tests whether models can predict code execution output without running it. Probes deeper code understanding.

### B. Publishing Checklist

- [ ] SWE-bench Verified pass rate ≥ top-5 published result
- [ ] PlanBench score ≥ median
- [ ] RepoBench score ≥ top-3
- [ ] JS/TS internal benchmark ≥ 85%
- [ ] Results stable across 3 runs (≤2% variance)
- [ ] All competitor comparisons fact-checked
- [ ] Benchmark methodology published alongside results
- [ ] Cost per fix data included
- [ ] PR created with automated benchmark badge update
