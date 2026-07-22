# Benchmark Results

> **⚠️ INTERNAL USE ONLY — Do NOT publish raw results.**
> Results must not be shared externally until the publication gate criteria are met (see [Benchmarking Strategy](../../docs/benchmarking-strategy.md)).

## Latest Results

| Benchmark | Score | Date | Model | Run ID |
|-----------|-------|------|-------|--------|
| SWE-bench Verified | — | — | — | — |
| PlanBench | — | — | — | — |
| RepoBench | — | — | — | — |
| Internal JS/TS | — | — | — | — |

*Run `./scripts/run-benchmarks.sh --report` to update this table.*

## Result Directory Structure

```
results/
├── README.md                 # This file
├── YYYY-Q{1-4}/             # Quarterly result snapshots
│   ├── swe-bench.json
│   ├── planbench.json
│   ├── repobench.json
│   └── internal-js-ts.json
└── latest/                   # Symlinks to the latest run directory
```

## Tracking Progress Over Time

To compare results across runs:

```bash
# Compare two quarterly results
diff eval/benchmarks/results/2026-Q3/swe-bench.json eval/benchmarks/results/2026-Q4/swe-bench.json

# Generate trend report
./scripts/run-benchmarks.sh --report
```

## Publication Gate Checklist

Before any results can be published:

- [ ] SWE-bench Verified: Top 3 on leaderboard
- [ ] PlanBench: Top quartile accuracy
- [ ] RepoBench: Top 5 F1 score
- [ ] Internal JS/TS: ≥ 80% pass rate
- [ ] At least 2 consecutive quarterly runs showing consistent scores
- [ ] Publication content drafted and reviewed
