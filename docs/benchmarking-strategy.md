# STAS Benchmarking Strategy

> **Policy: Do NOT publish any benchmark results until STAS ranks in the top tier.**
> This document defines what we measure, how we measure it, and when we publish.

## Why Benchmarking Matters

STAS differentiates on **execution quality** and **integrated pipeline**, not model exclusivity. Benchmarks validate:

1. **Plan-first architecture** — we're the architect, not the coder. Benchmarks like PlanBench specifically test this.
2. **Long-context understanding** — STAS reads full repos. RepoBench exercises this.
3. **Real-world issue resolution** — our internal JS/TS benchmark tests what customers actually need.

## Target Benchmarks

### Primary (direct product match)

| Benchmark | Why | Target Metric | Current Status |
|-----------|-----|---------------|----------------|
| **SWE-bench Verified** | Industry standard. Required for internal credibility. | ≥ 40% resolve rate | Not yet run |
| **PlanBench** | Tests planning/reasoning before execution. Matches plan-first differentiator. | ≥ 60% accuracy | Not yet run |
| **RepoBench** | Long-context repository understanding (matches "reads full repo" moat) | ≥ 55% F1 | Not yet run |

### Secondary

| Benchmark | Why | Target Metric | Current Status |
|-----------|-----|---------------|----------------|
| **SWE-bench Multilingual** | Tests multi-language support | TBD | Not yet run |
| **HumanEval / MBPP** | Basic coding benchmarks (expected baseline) | ≥ 85% pass@1 | Not yet run |
| **CRUXEval** | Execution prediction (tests if model understands code flow) | ≥ 70% accuracy | Not yet run |

### STAS-Specific: Internal JS/TS Issue-Resolution Benchmark

An internal benchmark using **real GitHub issues from popular OSS JS/TS repos**. This differentiates from SWE-bench (Python-heavy) and demonstrates real-world value for our target audience.

| Component | Detail |
|-----------|--------|
| **Source repos** | Top 10 starred JS/TS OSS repos with active issue trackers |
| **Issue count** | 50 issues (25 bugs, 15 feature requests, 10 edge cases) |
| **Metrics** | Fix rate, time-to-fix, plan quality score, regression detection |
| **Weighting** | Bug fixes 50%, feature requests 30%, edge cases 20% |

## Approach

### Phase 1: Infrastructure (Week 1)

- [x] Set up eval pipeline (Promptfoo + LangFuse)
- [x] Create baseline test cases (10 smoke tests across Python/JS/Go)
- [ ] Integrate SWE-bench Verified harness
- [ ] Integrate PlanBench harness
- [ ] Integrate RepoBench harness
- [ ] Build internal JS/TS benchmark dataset

### Phase 2: Baseline (Week 2)

- [ ] Run all benchmarks with current STAS agent (claude-sonnet-4, no special tuning)
- [ ] Document raw scores in `eval/benchmarks/results/`
- [ ] Identify weak spots per benchmark

### Phase 3: Iteration (Week 3-4)

- [ ] Improve prompt quality for weak benchmarks (esp. PlanBench)
- [ ] Optimize agent loop for timeout-sensitive benchmarks (RepoBench)
- [ ] Add model cascade routing for cost-sensitive runs (SWE-bench)
- [ ] Re-run and compare improvements

### Phase 4: Quarterly Tracking (Ongoing)

- [ ] Re-run full benchmark suite every quarter
- [ ] Track trend in `eval/benchmarks/results/` with timestamped snapshots
- [ ] Compare against published leaderboards
- [ ] When consistently in top tier → proceed to Phase 5

### Phase 5: Publication (When Ready)

- [ ] Threshold: Top 3 on SWE-bench Verified + top quartile on PlanBench + top 5 on RepoBench
- [ ] Publish blog post with methodology, results, and analysis
- [ ] Submit to HN / Reddit / relevant AI/ML communities
- [ ] Add README badge for benchmark results
- [ ] Update marketing-site with benchmark comparisons

## Governance

### Result Integrity

- All benchmarks run in **isolated sandbox** (E2B or Docker)
- Random seeds fixed for reproducibility
- Each benchmark run **3 times**, median reported
- Configuration frozen per run (commit hash tagged in results)
- Results stored as JSON with full metadata (model, date, commit, config)

### No Publish Gate

**Results are for internal use only until threshold met.** The gate is:

```
READY_TO_PUBLISH = (
    SWE_bench_score >= top_3_on_leaderboard
    AND PlanBench_accuracy >= top_25_percentile
    AND RepoBench_F1 >= top_5
    AND internal_JS_TS_pass_rate >= 80%
)
```

Publishing before this threshold damages credibility. STAS must be a leader, not a participant.

### Benchmark Roster

| Benchmark | Run Cadence | Runner | Est. Cost | Est. Time |
|-----------|-------------|--------|-----------|-----------|
| SWE-bench Verified | Quarterly | `scripts/run-benchmarks.sh --swe-bench` | ~$400 | ~8h |
| PlanBench | Quarterly | `scripts/run-benchmarks.sh --planbench` | ~$50 | ~2h |
| RepoBench | Quarterly | `scripts/run-benchmarks.sh --repobench` | ~$100 | ~4h |
| Internal JS/TS | Monthly | `scripts/run-benchmarks.sh --internal-js-ts` | ~$30 | ~1h |
| HumanEval/MBPP | Quarterly | `scripts/run-benchmarks.sh --humaneval` | ~$20 | ~30m |
| CRUXEval | Quarterly | `scripts/run-benchmarks.sh --cruxeval` | ~$25 | ~1h |

## Quickstart

```bash
# Install dependencies
npm ci

# Run all benchmarks (warning: expensive, can take 15+ hours)
./scripts/run-benchmarks.sh --all

# Run a single benchmark
./scripts/run-benchmarks.sh --swe-bench

# Run internal JS/TS benchmark only (fast, ~1h)
./scripts/run-benchmarks.sh --internal-js-ts

# View results
./scripts/run-benchmarks.sh --report
```

## Result Format

```json
{
  "benchmark": "swe-bench-verified",
  "runId": "2026-Q3-001",
  "timestamp": "2026-07-22T00:00:00Z",
  "commit": "abc123def456",
  "config": {
    "model": "claude-sonnet-4",
    "temperature": 0,
    "maxTokens": 16384,
    "agent": "stas",
    "sandbox": "e2b"
  },
  "results": {
    "total": 500,
    "resolved": 215,
    "failed": 285,
    "resolveRate": 0.43,
    "avgCostPerTask": 3.80,
    "avgTimePerTask": 187
  },
  "metadata": {
    "mode": "plan-first",
    "retryCount": 2,
    "cascadeEnabled": true
  }
}
```

## Directory Layout

```
eval/benchmarks/
├── README.md                    # This file
├── swe-bench/
│   ├── harness.ts               # SWE-bench runner
│   └── test-cases/              # SWE-bench instance definitions
├── planbench/
│   ├── harness.ts               # PlanBench runner
│   └── test-cases/              # Planning task definitions
├── repobench/
│   ├── harness.ts               # RepoBench runner
│   └── test-cases/              # Long-context task definitions
├── js-ts-bench/
│   ├── harness.ts               # Internal JS/TS benchmark runner
│   ├── dataset.json             # 50 curated issues
│   └── repos/                   # Git fixtures for each issue (gitignored)
└── results/
    ├── README.md                # Results index
    ├── 2026-Q3/
    │   ├── swe-bench.json
    │   ├── planbench.json
    │   ├── repobench.json
    │   └── internal-js-ts.json
    └── latest/                  # Symlinks to latest run
```
