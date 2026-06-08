"""Model comparison benchmark runner — XGBoost, LightGBM, CatBoost, sklearn on 20+ datasets."""

from __future__ import annotations

import csv
import json
import logging
import os
import subprocess
import time
import warnings
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score

from .datasets import DatasetConfig, load_dataset, get_dataset, get_all_names

warnings.filterwarnings("ignore")
logger = logging.getLogger(__name__)


@dataclass
class ModelResult:
    accuracy: float = 0.0
    f1_weighted: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    roc_auc: float | None = None
    train_time_ms: float = 0.0
    infer_time_ms: float = 0.0
    total_time_ms: float = 0.0
    error: str | None = None


@dataclass
class DatasetResult:
    dataset_name: str
    n_samples: int
    n_features: int
    n_classes: int
    task: str
    xgboost: ModelResult = field(default_factory=ModelResult)
    lightgbm: ModelResult = field(default_factory=ModelResult)
    catboost: ModelResult = field(default_factory=ModelResult)
    sklearn: ModelResult = field(default_factory=ModelResult)


def _train_and_evaluate(
    model_fn: Callable[[np.ndarray, np.ndarray], Any],
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
) -> ModelResult:
    t0 = time.perf_counter()
    try:
        clf = model_fn(X_train, y_train)
        train_ms = (time.perf_counter() - t0) * 1000

        t1 = time.perf_counter()
        y_pred = clf.predict(X_test)
        infer_ms = (time.perf_counter() - t1) * 1000

        total_ms = (time.perf_counter() - t0) * 1000

        result = ModelResult(
            accuracy=float(accuracy_score(y_test, y_pred)),
            f1_weighted=float(f1_score(y_test, y_pred, average="weighted")),
            precision=float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            recall=float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            train_time_ms=round(train_ms, 2),
            infer_time_ms=round(infer_ms, 2),
            total_time_ms=round(total_ms, 2),
        )

        n_classes = len(np.unique(y_test))
        if n_classes == 2:
            try:
                y_prob = clf.predict_proba(X_test)[:, 1]
                result.roc_auc = float(roc_auc_score(y_test, y_prob))
            except Exception:
                pass

        return result
    except Exception as e:
        return ModelResult(error=str(e), total_time_ms=(time.perf_counter() - t0) * 1000)


def _build_xgboost(X_train, y_train):
    from xgboost import XGBClassifier
    return XGBClassifier(n_estimators=100, random_state=42, verbosity=0).fit(X_train, y_train)


def _build_lightgbm(X_train, y_train):
    import lightgbm as lgb
    return lgb.LGBMClassifier(n_estimators=100, random_state=42, verbose=-1).fit(X_train, y_train)


def _build_catboost(X_train, y_train):
    from catboost import CatBoostClassifier
    return CatBoostClassifier(n_estimators=100, random_state=42, verbose=0).fit(X_train, y_train)


def _build_sklearn(X_train, y_train):
    from sklearn.ensemble import RandomForestClassifier
    return RandomForestClassifier(n_estimators=100, random_state=42).fit(X_train, y_train)


MODEL_BUILDERS: dict[str, Callable] = {
    "xgboost": _build_xgboost,
    "lightgbm": _build_lightgbm,
    "catboost": _build_catboost,
    "sklearn": _build_sklearn,
}


def run_single_dataset(config: DatasetConfig) -> DatasetResult:
    logger.info("  Loading %s ...", config.name)
    df = load_dataset(config)
    target_col = "target"
    if target_col not in df.columns:
        df = df.rename(columns={df.columns[-1]: target_col})

    y_raw = df[target_col]
    X_df = df.drop(columns=[target_col])

    for col in X_df.select_dtypes(include=["object", "category"]).columns:
        X_df[col] = LabelEncoder().fit_transform(X_df[col].astype(str))
    X_df = X_df.fillna(X_df.median(numeric_only=True)).astype(np.float32)

    le = LabelEncoder()
    y = le.fit_transform(y_raw.astype(str))

    X_train, X_test, y_train, y_test = train_test_split(
        X_df.values, y, test_size=0.3, random_state=42,
        stratify=y if len(np.unique(y)) > 1 and len(y) >= 10 else None,
    )

    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test = scaler.transform(X_test)

    result = DatasetResult(
        dataset_name=config.name,
        n_samples=len(df),
        n_features=X_df.shape[1],
        n_classes=len(le.classes_),
        task=config.task,
    )

    for model_key, builder in MODEL_BUILDERS.items():
        logger.info("    Running %s ...", model_key)
        model_result = _train_and_evaluate(builder, X_train, y_train, X_test, y_test)
        setattr(result, model_key, model_result)
        status = model_result.error or f"acc={model_result.accuracy:.4f}"
        logger.info("      %s: %s", model_key, status)

    return result


def run_benchmark(
    dataset_names: list[str] | None = None,
    max_datasets: int | None = None,
    export_csv: str | None = None,
    export_json: str | None = None,
) -> list[DatasetResult]:
    names = dataset_names or get_all_names()
    if max_datasets:
        names = names[:max_datasets]

    git_sha = "unknown"
    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        pass

    results: list[DatasetResult] = []
    t_start = time.perf_counter()

    for name in names:
        config = get_dataset(name)
        if config is None:
            logger.warning("Unknown dataset: %s", name)
            continue
        t0 = time.perf_counter()
        dr = run_single_dataset(config)
        elapsed = time.perf_counter() - t0
        logger.info("  %s done in %.1fs\n", name, elapsed)
        results.append(dr)

    total_elapsed = time.perf_counter() - t_start
    logger.info("Benchmark completed in %.1fs (%.1f min)", total_elapsed, total_elapsed / 60)

    if export_csv:
        _export_csv(results, export_csv, git_sha)
    if export_json:
        _export_json(results, export_json, git_sha)

    return results


def _export_csv(results: list[DatasetResult], path: str, git_sha: str) -> None:
    rows = []
    for r in results:
        for model_key in ["xgboost", "lightgbm", "catboost", "sklearn"]:
            m = getattr(r, model_key)
            rows.append({
                "dataset": r.dataset_name,
                "model": model_key,
                "n_samples": r.n_samples,
                "n_features": r.n_features,
                "n_classes": r.n_classes,
                "accuracy": m.accuracy if m.accuracy else "",
                "f1_weighted": m.f1_weighted if m.f1_weighted else "",
                "precision": m.precision if m.precision else "",
                "recall": m.recall if m.recall else "",
                "roc_auc": m.roc_auc if m.roc_auc else "",
                "train_time_ms": m.train_time_ms,
                "infer_time_ms": m.infer_time_ms,
                "total_time_ms": m.total_time_ms,
                "error": m.error or "",
            })
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        if rows:
            w = csv.DictWriter(f, fieldnames=rows[0].keys())
            w.writeheader()
            w.writerows(rows)
    logger.info("CSV exported: %s", path)


def _export_json(results: list[DatasetResult], path: str, git_sha: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "git_sha": git_sha,
        "total_datasets": len(results),
        "results": [asdict(r) for r in results],
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    logger.info("JSON exported: %s", path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    results = run_benchmark(
        export_csv="benchmark-results.csv",
        export_json="benchmark-results.json",
    )
    print("\n=== Summary ===")
    for model_key in ["xgboost", "lightgbm", "catboost", "sklearn"]:
        accs = [getattr(r, model_key).accuracy for r in results if getattr(r, model_key).accuracy]
        times = [getattr(r, model_key).total_time_ms for r in results if getattr(r, model_key).total_time_ms]
        if accs:
            print(f"{model_key:>10}: acc={np.mean(accs):.4f} ± {np.std(accs):.4f}, avg_time={np.mean(times):.1f}ms")
