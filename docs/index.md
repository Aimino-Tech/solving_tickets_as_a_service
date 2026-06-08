---
layout: default
title: Benchmark Dashboard
---

# Benchmark Dashboard

This site shows automated benchmark results for the STAS agent pipeline.

## Latest Results

{% include_relative leaderboard.md %}

## Comparison Table

| Model | Accuracy | F1 Score | Avg Time |
|-------|----------|----------|----------|
| TabICL (this PR) | - | - | - |
| main (baseline) | - | - | - |
| XGBoost | - | - | - |
| LightGBM | - | - | - |
| CatBoost | - | - | - |
| **Delta** | - | - | - |

## Benchmark Reports

- [Detailed Report](/benchmarks/report) - Full comparison with per-benchmark breakdown
- [Benchmark Dashboard](/benchmarks/) - Interactive dashboard with live data
- [Comparison Data](/benchmarks/comparison.json) - Raw comparison data (JSON)

> Last updated: {{ site.time | date: "%Y-%m-%d %H:%M UTC" }}
