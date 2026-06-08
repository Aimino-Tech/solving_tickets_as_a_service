"""Benchmark runner with timing breakdown, CSV export, and result reporting."""

from __future__ import annotations

import csv
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from .datasets import (
    DatasetConfig,
    DATASET_REGISTRY,
    load_dataset,
    get_dataset,
    get_dataset_names,
)

logger = logging.getLogger(__name__)


@dataclass
class TimingBreakdown:
    preprocessing_ms: float = 0.0
    encoding_ms: float = 0.0
    split_ms: float = 0.0
    api_call_ms: float = 0.0
    routing_ms: float = 0.0
    total_ms: float = 0.0


@dataclass
class DatasetBenchmarkResult:
    dataset_name: str
    n_samples: int
    n_features: int
    n_classes: int | None
    accuracy: float | None = None
    f1_score: float | None = None
    precision: float | None = None
    recall: float | None = None
    roc_auc: float | None = None
    timing: TimingBreakdown = field(default_factory=TimingBreakdown)
    error: str | None = None


@dataclass
class BenchmarkRun:
    timestamp: str = ""
    git_sha: str = ""
    environment: dict[str, Any] = field(default_factory=dict)
    results: list[DatasetBenchmarkResult] = field(default_factory=list)


def run_single_dataset(
    config: DatasetConfig,
    api_predict_fn=None,
    timeout_seconds: int = 120,
) -> DatasetBenchmarkResult:
    """Run a single dataset through the benchmark pipeline.

    Args:
        config: Dataset configuration.
        api_predict_fn: Callable(X_train, y_train, X_test) -> y_pred.
            If None, uses a trivial baseline (predict most-frequent class).
        timeout_seconds: Max time per dataset in seconds.

    Returns:
        DatasetBenchmarkResult with timing breakdown and metrics.
    """
    timings = TimingBreakdown()
    t_start = time.perf_counter()

    df = load_dataset(config)
    timings.preprocessing_ms = (time.perf_counter() - t_start) * 1000

    if config.target_column not in df.columns:
        df.columns = [f"feature_{i}" if c.startswith("feat") else c for i, c in enumerate(df.columns)]
        if config.target_column not in df.columns:
            df.columns = df.columns.str.replace(r"^feat_", "", regex=True)

    t_encode = time.perf_counter()
    X_df = df.drop(columns=[config.target_column], errors="ignore")
    y_raw = df[config.target_column] if config.target_column in df.columns else df.iloc[:, -1]

    # Encode target
    le = LabelEncoder()
    y = le.fit_transform(y_raw.astype(str))
    timings.encoding_ms = (time.perf_counter() - t_encode) * 1000

    t_split = time.perf_counter()
    X_train, X_test, y_train, y_test = train_test_split(
        X_df, y, test_size=0.3, random_state=42, stratify=y if config.n_classes and config.n_classes > 1 and len(y) >= 2 else None,
    )
    timings.split_ms = (time.perf_counter() - t_split) * 1000

    # Handle categorical features
    for col in X_train.select_dtypes(include=["object", "category"]).columns:
        X_train[col] = LabelEncoder().fit_transform(X_train[col].astype(str))
        X_test[col] = LabelEncoder().fit_transform(X_test[col].astype(str))

    # Fill missing
    X_train = X_train.fillna(X_train.median(numeric_only=True))
    X_test = X_test.fillna(X_train.median(numeric_only=True))

    t_api = time.perf_counter()
    try:
        if api_predict_fn is not None:
            y_pred = api_predict_fn(X_train.values, y_train, X_test.values)
        else:
            from sklearn.dummy import DummyClassifier
            clf = DummyClassifier(strategy="most_frequent")
            clf.fit(X_train, y_train)
            y_pred = clf.predict(X_test)
        timings.api_call_ms = (time.perf_counter() - t_api) * 1000
    except Exception as e:
        timings.api_call_ms = (time.perf_counter() - t_api) * 1000
        timings.total_ms = (time.perf_counter() - t_start) * 1000
        return DatasetBenchmarkResult(
            dataset_name=config.name,
            n_samples=len(df),
            n_features=X_df.shape[1],
            n_classes=len(le.classes_),
            timing=timings,
            error=str(e),
        )

    t_routing = time.perf_counter()
    timings.routing_ms = (time.perf_counter() - t_routing) * 1000
    timings.total_ms = (time.perf_counter() - t_start) * 1000

    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

    result = DatasetBenchmarkResult(
        dataset_name=config.name,
        n_samples=len(df),
        n_features=X_df.shape[1],
        n_classes=len(le.classes_),
        accuracy=float(accuracy_score(y_test, y_pred)),
        timing=timings,
    )

    try:
        result.f1_score = float(f1_score(y_test, y_pred, average="weighted"))
    except Exception:
        pass
    try:
        result.precision = float(precision_score(y_test, y_pred, average="weighted", zero_division=0))
    except Exception:
        pass
    try:
        result.recall = float(recall_score(y_test, y_pred, average="weighted", zero_division=0))
    except Exception:
        pass
    try:
        if len(le.classes_) == 2:
            result.roc_auc = float(roc_auc_score(y_test, y_pred))
    except Exception:
        pass

    return result


def run_benchmark(
    dataset_names: list[str] | None = None,
    api_predict_fn=None,
    timeout_seconds: int = 120,
    export_csv: str | None = None,
    export_json: str | None = None,
) -> BenchmarkRun:
    """Run benchmark on specified datasets (or all if None).

    Args:
        dataset_names: List of dataset names to run. If None, runs all.
        api_predict_fn: Callable(X_train, y_train, X_test) -> y_pred.
        timeout_seconds: Max seconds per dataset.
        export_csv: Optional path to export CSV results.
        export_json: Optional path to export JSON results.

    Returns:
        BenchmarkRun with all results.
    """
    import subprocess

    git_sha = "unknown"
    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        pass

    run = BenchmarkRun(
        timestamp=datetime.now(timezone.utc).isoformat(),
        git_sha=git_sha,
        environment={
            "python_version": __import__("sys").version,
            "platform": __import__("sys").platform,
        },
    )

    if dataset_names is None:
        dataset_names = get_dataset_names()

    for name in dataset_names:
        config = get_dataset(name)
        if config is None:
            logger.warning("Unknown dataset: %s — skipping", name)
            continue
        logger.info("Benchmarking %s ...", name)
        t0 = time.perf_counter()
        result = run_single_dataset(config, api_predict_fn, timeout_seconds)
        elapsed = time.perf_counter() - t0
        status = "OK" if result.error is None else "ERROR"
        logger.info(
            "  %s: accuracy=%.4f, timing=%.1fms, elapsed=%.1fs",
            name, result.accuracy or 0.0, result.timing.total_ms, elapsed,
        )
        run.results.append(result)

    if export_csv:
        _export_csv(run, export_csv)
        logger.info("Results exported to CSV: %s", export_csv)

    if export_json:
        _export_json(run, export_json)
        logger.info("Results exported to JSON: %s", export_json)

    return run


def _export_csv(run: BenchmarkRun, path: str) -> None:
    """Export benchmark results as CSV with timing breakdown."""
    rows = []
    for r in run.results:
        row = {
            "dataset": r.dataset_name,
            "n_samples": r.n_samples,
            "n_features": r.n_features,
            "n_classes": r.n_classes,
            "accuracy": r.accuracy,
            "f1_score": r.f1_score,
            "precision": r.precision,
            "recall": r.recall,
            "roc_auc": r.roc_auc,
            "preprocessing_ms": round(r.timing.preprocessing_ms, 2),
            "encoding_ms": round(r.timing.encoding_ms, 2),
            "split_ms": round(r.timing.split_ms, 2),
            "api_call_ms": round(r.timing.api_call_ms, 2),
            "routing_ms": round(r.timing.routing_ms, 2),
            "total_ms": round(r.timing.total_ms, 2),
            "error": r.error or "",
        }
        rows.append(row)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def _export_json(run: BenchmarkRun, path: str) -> None:
    """Export benchmark results as JSON."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    data = {
        "timestamp": run.timestamp,
        "git_sha": run.git_sha,
        "environment": run.environment,
        "results": [asdict(r) for r in run.results],
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    run = run_benchmark(
        export_csv="benchmark-results.csv",
        export_json="benchmark-results.json",
    )
    df = pd.DataFrame([asdict(r) for r in run.results])
    print("\nSummary:")
    print(df[["dataset_name", "accuracy", "total_ms"]].to_string(index=False))
