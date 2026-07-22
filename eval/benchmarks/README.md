# STAS Benchmark Suites

This directory contains the benchmark suite harnesses for evaluating STAS against industry-standard AI coding benchmarks.

## Directory Structure

```
swe-bench/           SWE-bench Verified harness (Python fix resolution)
planbench/           PlanBench harness (planning/reasoning evaluation)
repobench/           RepoBench harness (long-context understanding)
js-ts-bench/         Internal JS/TS issue-resolution benchmark (proprietary)
results/             Benchmark result snapshots (gitignored except README)
```

## Running Benchmarks

```bash
# Run all benchmarks
./scripts/run-benchmarks.sh --all

# Run specific benchmark
./scripts/run-benchmarks.sh --swe-bench

# Generate report from latest results
./scripts/run-benchmarks.sh --report

# List available benchmarks
./scripts/run-benchmarks.sh --list
```

## Policy

**Results are internal-only.** Do not publish benchmark results until the publication gate criteria are met (see [Benchmarking Strategy](../../docs/benchmarking-strategy.md)).
