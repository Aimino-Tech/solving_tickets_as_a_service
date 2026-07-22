# STAS Eval Pipeline

Measure agent fix success rate, detect regressions, and drive the OSS→paid conversion funnel.

## Quickstart

```bash
# Run the eval suite
npx promptfoo eval

# View results in the promptfoo web UI
npx promptfoo view
```

## Adding Tests

Create test case YAML files in `eval/test-cases/`. Each file defines input issues and expected outcomes:

```yaml
# eval/test-cases/example-test.yaml
description: "Simple bug fix"
prompts:
  - "Fix the bug in src/utils/validate.ts where email validation rejects valid addresses"
tests:
  - description: "Agent produces a valid fix"
    assert:
      - type: contains-json
        value:
          fixReady: true
      - type: contains-text
        value: "validate.ts"
```

## Directory Structure

```
eval/
├── promptfooconfig.yaml              # Promptfoo configuration
├── tsconfig.json                     # TypeScript config (extends root)
├── langfuse-config.ts                # LangFuse client initialization
├── providers/
│   └── stas-agent.ts                 # Custom provider for STAS agent (to be implemented)
├── test-cases/                       # Test case YAML files
├── results/                          # Eval output (gitignored)
├── benchmarks/                       # Benchmark orchestration system
│   ├── core.ts                       # Benchmark runner — orchestrates all suites
│   ├── tracker.ts                    # Historical score tracking and trend analysis
│   ├── types.ts                      # Shared types for benchmark results
│   ├── utils.ts                      # Utility functions for result aggregation
│   └── js-ts-benchmark/              # STAS-specific JS/TS issue-resolution benchmark
│       ├── runner.ts                 # JS/TS benchmark runner
│       └── cases.ts                  # 15 real-world bug scenarios (React, TS, Next.js, Express, Node.js)
├── swe-bench/                        # SWE-bench Verified integration
│   ├── runner.ts                     # SWE-bench runner (20 sample cases)
│   └── .gitkeep
├── planbench/                        # PlanBench integration
│   ├── runner.ts                     # PlanBench runner (10 plan quality cases)
│   └── .gitkeep
├── repobench/                        # RepoBench integration
│   ├── runner.ts                     # RepoBench runner (12 cross-file context cases)
│   └── .gitkeep
└── README.md                         # This file
```

## Benchmark System

STAS includes a comprehensive benchmark system for measuring agent performance against industry-standard AI coding competitions. See `docs/benchmarking-strategy.md` for the full strategy.

### Quickstart

```bash
# Run the full benchmark suite
./scripts/run-benchmarks.sh

# Run a single benchmark
./scripts/run-benchmarks.sh --suite swe-bench

# Run with specific model
./scripts/run-benchmarks.sh --model claude-sonnet-4 --verbose

# Check if ready to publish
./scripts/run-benchmarks.sh --check-publish

# View historical trends
./scripts/run-benchmarks.sh --trends

# Dry run (simulate without executing)
./scripts/run-benchmarks.sh --dry-run
```

### Available Benchmarks

| Benchmark | Category | Tests | Top-Tier Threshold |
|---|---|---|---|
| **SWE-bench Verified** | Industry standard (Python) | 20 sample cases | ≥85% pass rate |
| **PlanBench** | Planning/reasoning quality | 10 plan quality cases | ≥80% |
| **RepoBench** | Long-context repo understanding | 12 cross-file cases | ≥80% |
| **JS/TS Benchmark** | STAS-specific (React, TS, Next.js) | 15 real-world issues | ≥85% |

### Benchmark Policy

**Results are never published until STAS ranks in the top tier** of all published benchmarks. See `docs/benchmarking-strategy.md` for publishing criteria.

### Score Tracking

Scores are tracked historically in `eval/results/tracking.json`. Each run records:
- Pass rate per benchmark suite
- Model and agent version
- Commit SHA
- Timestamp

Use `./scripts/run-benchmarks.sh --trends` to view score trends over time.

## Interpreting Results

After running benchmarks:

1. Open the promptfoo web UI: `npx promptfoo view`
2. Review pass/fail rates across test cases
3. Check LangFuse traces for detailed agent behavior (if configured)
4. Run `./scripts/run-benchmarks.sh --trends` for historical comparison
5. Results are stored in `eval/results/` as JSON

## Configuration

Tracing is configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `LANGFUSE_HOST` | `http://localhost:3000` | LangFuse server URL |
| `LANGFUSE_PUBLIC_KEY` | — | LangFuse public key |
| `LANGFUSE_SECRET_KEY` | — | LangFuse secret key |
