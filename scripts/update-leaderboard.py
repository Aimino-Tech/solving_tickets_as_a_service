#!/usr/bin/env python3
"""Update benchmark leaderboard data from latest run results.

Generates:
  - docs/leaderboard.json       — Structured leaderboard data
  - docs/leaderboard.md         — Rendered markdown table
  - docs/_data/leaderboard.yml  — Jekyll-friendly data
  - README badge SVG            — Latest accuracy badge
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

LEADERBOARD_DIR = Path("docs")
DATA_DIR = LEADERBOARD_DIR / "_data"


def load_results(results_path: str) -> list[dict]:
    with open(results_path) as f:
        data = json.load(f)
    return data.get("results", data if isinstance(data, list) else [])


def build_leaderboard(results: list[dict]) -> dict:
    entries = []
    for r in results:
        entries.append({
            "dataset": r.get("dataset_name", r.get("dataset", "unknown")),
            "task": "classification" if r.get("n_classes", 0) and r["n_classes"] > 1 else "regression",
            "n_samples": r.get("n_samples", 0),
            "n_features": r.get("n_features", 0),
            "accuracy": r.get("accuracy"),
            "f1_score": r.get("f1_score"),
            "precision": r.get("precision"),
            "recall": r.get("recall"),
            "roc_auc": r.get("roc_auc"),
            "total_ms": r.get("timing", {}).get("total_ms", r.get("total_ms", 0)),
            "api_ms": r.get("timing", {}).get("api_call_ms", r.get("api_call_ms", 0)),
            "preprocessing_ms": r.get("timing", {}).get("preprocessing_ms", r.get("preprocessing_ms", 0)),
            "error": r.get("error"),
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_datasets": len(entries),
        "entries": entries,
        "summary": {
            "mean_accuracy": _safe_mean([e["accuracy"] for e in entries if e["accuracy"] is not None]),
            "mean_f1": _safe_mean([e["f1_score"] for e in entries if e["f1_score"] is not None]),
            "mean_total_ms": _safe_mean([e["total_ms"] for e in entries]),
        },
    }


def _safe_mean(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def write_json(leaderboard: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(leaderboard, f, indent=2)
    print(f"  Wrote {path}")


def write_markdown(leaderboard: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    lines.append("# Benchmark Leaderboard\n")
    lines.append(f"> Generated at {leaderboard['generated_at']}\n")
    lines.append(f"**Total datasets**: {leaderboard['total_datasets']}\n")

    summary = leaderboard["summary"]
    if summary.get("mean_accuracy"):
        lines.append(f"**Mean Accuracy**: {summary['mean_accuracy']:.4f}")
    if summary.get("mean_f1"):
        lines.append(f"**Mean F1 Score**: {summary['mean_f1']:.4f}")
    if summary.get("mean_total_ms"):
        lines.append(f"**Mean Total Time**: {summary['mean_total_ms']:.1f}ms")
    lines.append("")

    # Comparison table header
    lines.append("| Dataset | Task | Samples | Features | Accuracy | F1 | Time (ms) |")
    lines.append("|---------|------|---------|----------|----------|-----|-----------|")

    for e in leaderboard["entries"]:
        acc = f"{e['accuracy']:.4f}" if e["accuracy"] is not None else "-"
        f1 = f"{e['f1_score']:.4f}" if e["f1_score"] is not None else "-"
        time_ms = f"{e['total_ms']:.1f}" if e.get("total_ms") else "-"
        lines.append(
            f"| {e['dataset']} | {e['task']} | {e['n_samples']} | "
            f"{e['n_features']} | {acc} | {f1} | {time_ms} |"
        )

    path.write_text("\n".join(lines) + "\n")
    print(f"  Wrote {path}")


def write_yaml(leaderboard: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    jekyll_data = {
        "last_updated": leaderboard["generated_at"],
        "total_datasets": leaderboard["total_datasets"],
        "summary": leaderboard["summary"],
        "datasets": [],
    }
    for e in leaderboard["entries"]:
        jekyll_data["datasets"].append({
            "name": e["dataset"],
            "task": e["task"],
            "samples": e["n_samples"],
            "features": e["n_features"],
            "accuracy": e["accuracy"],
            "f1": e["f1_score"],
            "time_ms": e["total_ms"],
        })
    with open(path, "w") as f:
        yaml.dump(jekyll_data, f, default_flow_style=False, sort_keys=False)
    print(f"  Wrote {path}")


def write_badge(accuracy: float | None, path: Path) -> None:
    """Generate a simple README badge SVG."""
    if accuracy is None:
        accuracy = 0.0
    pct = accuracy * 100
    color = "#4c1" if pct >= 80 else "#e05d44" if pct < 60 else "#dfb317"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="160" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <rect rx="3" fill="#555" width="110" height="20"/>
  <rect rx="3" fill="{color}" x="110" width="50" height="20"/>
  <rect fill="{color}" x="110" width="4" height="20"/>
  <rect rx="3" fill="url(#b)" width="160" height="20"/>
  <g fill="#fff" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">
    <text x="6" y="14">benchmark accuracy</text>
    <text x="117" y="14">{pct:.1f}%</text>
  </g>
</svg>'''
    path.write_text(svg)
    print(f"  Wrote {path}")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <benchmark-results.json>")
        sys.exit(1)

    results_path = sys.argv[1]
    if not os.path.exists(results_path):
        print(f"Results file not found: {results_path}")
        sys.exit(1)

    results = load_results(results_path)
    leaderboard = build_leaderboard(results)

    print(f"Building leaderboard from {len(results)} dataset results ...")
    write_json(leaderboard, LEADERBOARD_DIR / "leaderboard.json")
    write_markdown(leaderboard, LEADERBOARD_DIR / "leaderboard.md")
    write_yaml(leaderboard, DATA_DIR / "leaderboard.yml")

    mean_acc = leaderboard["summary"].get("mean_accuracy")
    if mean_acc is not None:
        write_badge(mean_acc, LEADERBOARD_DIR / "badge.svg")

    print("Done.")


if __name__ == "__main__":
    main()
