"""Model comparison benchmark — XGBoost, LightGBM, CatBoost, scikit-learn models.

Runs multiple ML models on the same benchmark datasets (from datasets.py)
and produces side-by-side comparison tables with accuracy, F1, training time,
and inference time per model per dataset.

Usage:
    python -m workers.benchmark.model_comparison
    # or directly:
    python workers/benchmark/model_comparison.py
"""

from __future__ import annotations

import csv
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

from .datasets import DatasetConfig, DATASET_REGISTRY, get_dataset, get_dataset_names, load_dataset

logger = logging.getLogger(__name__)

# Optional model imports — each section is guarded so missing packages
# produce a clear error at registration time rather than at import time.

_MODEL_REGISTRY: dict[str, dict[str, Any]] = {}


def _register_model(
    name: str,
    priority: int = 100,
) -> Callable:
    """Decorator to register a model builder in the model registry."""
    def wrapper(builder: Callable[[], Any]) -> Callable[[], Any]:
        _MODEL_REGISTRY[name] = {"builder": builder, "priority": priority}
        return builder
    return wrapper


# ── Model builders ──────────────────────────────────────────────────────────
# Each builder returns a fresh model instance and is wrapped with _register_model.


@_register_model("LogisticRegression", priority=10)
def _build_lr():
    from sklearn.linear_model import LogisticRegression
    return LogisticRegression(max_iter=1000, random_state=42)


@_register_model("RandomForest", priority=20)
def _build_rf():
    from sklearn.ensemble import RandomForestClassifier
    return RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)


@_register_model("XGBoost", priority=30)
def _build_xgb():
    try:
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=100, random_state=42, n_jobs=-1, verbosity=0)
    except ImportError:
        raise ImportError("xgboost is required. Install with: pip install xgboost")


@_register_model("LightGBM", priority=40)
def _build_lgbm():
    try:
        import lightgbm as lgbm
        return lgbm.LGBMClassifier(n_estimators=100, random_state=42, n_jobs=-1, verbose=-1)
    except ImportError:
        raise ImportError("lightgbm is required. Install with: pip install lightgbm")


@_register_model("CatBoost", priority=50)
def _build_cat():
    try:
        from catboost import CatBoostClassifier
        return CatBoostClassifier(
            iterations=100,
            random_seed=42,
            verbose=0,
            allow_writing_files=False,
        )
    except ImportError:
        raise ImportError("catboost is required. Install with: pip install catboost")


# ── Data structures ──────────────────────────────────────────────────────────


@dataclass
class ModelBenchmarkResult:
    """Results for a single (dataset, model) pair."""
    dataset_name: str
    model_name: str
    n_samples: int
    n_features: int
    n_classes: int | None
    accuracy: float | None = None
    f1_score: float | None = None
    precision: float | None = None
    recall: float | None = None
    roc_auc: float | None = None
    train_time_ms: float = 0.0
    infer_time_ms: float = 0.0
    total_time_ms: float = 0.0
    error: str | None = None


def run_model_on_dataset(
    config: DatasetConfig,
    model_builder: Callable[[], Any],
    model_name: str,
    *,
    test_size: float = 0.3,
    random_state: int = 42,
    scale_features: bool = True,
) -> ModelBenchmarkResult:
    """Run a single model on a single dataset.

    Args:
        config: Dataset configuration from the registry.
        model_builder: Zero-argument callable that returns a fresh model.
        model_name: Human-readable name for the model.
        test_size: Fraction of data to hold out for testing.
        random_state: Random seed for reproducibility.
        scale_features: Whether to apply StandardScaler (recommended for
                        LogisticRegression, but not tree-based models).

    Returns:
        ModelBenchmarkResult with metrics and timing.
    """
    t_start = time.perf_counter()

    # Load dataset
    try:
        df = load_dataset(config)
    except Exception as e:
        logger.error("Failed to load dataset '%s': %s", config.name, e)
        return ModelBenchmarkResult(
            dataset_name=config.name,
            model_name=model_name,
            n_samples=0,
            n_features=0,
            n_classes=None,
            error=f"Dataset load error: {e}",
        )

    # Resolve target column
    target_col = config.target_column
    if target_col not in df.columns:
        # Try the last column as a fallback
        target_col = df.columns[-1]

    X_df = df.drop(columns=[target_col], errors="ignore")
    y_raw = df[target_col] if target_col in df.columns else df.iloc[:, -1]

    # Encode target labels
    le = LabelEncoder()
    y = le.fit_transform(y_raw.astype(str))

    n_classes = len(le.classes_)

    # Train/test split
    try:
        stratify = y if n_classes > 1 and len(y) >= 2 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X_df, y, test_size=test_size, random_state=random_state,
            stratify=stratify,
        )
    except Exception as e:
        return ModelBenchmarkResult(
            dataset_name=config.name,
            model_name=model_name,
            n_samples=len(df),
            n_features=X_df.shape[1],
            n_classes=n_classes,
            error=f"Split error: {e}",
        )

    # Handle categorical features
    for col in X_train.select_dtypes(include=["object", "category"]).columns:
        X_train[col] = LabelEncoder().fit_transform(X_train[col].astype(str))
        X_test[col] = LabelEncoder().fit_transform(X_test[col].astype(str))

    # Fill missing values
    X_train = X_train.fillna(X_train.median(numeric_only=True))
    X_test = X_test.fillna(X_train.median(numeric_only=True))

    # Optionally scale features (important for LogisticRegression, not for trees)
    if scale_features:
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
    else:
        X_train_scaled = X_train.values
        X_test_scaled = X_test.values

    # Build model
    try:
        model = model_builder()
    except Exception as e:
        return ModelBenchmarkResult(
            dataset_name=config.name,
            model_name=model_name,
            n_samples=len(df),
            n_features=X_df.shape[1],
            n_classes=n_classes,
            error=f"Model build error: {e}",
        )

    # Train
    t_train = time.perf_counter()
    try:
        model.fit(X_train_scaled, y_train)
    except Exception as e:
        return ModelBenchmarkResult(
            dataset_name=config.name,
            model_name=model_name,
            n_samples=len(df),
            n_features=X_df.shape[1],
            n_classes=n_classes,
            error=f"Training error: {e}",
        )
    train_time_ms = (time.perf_counter() - t_train) * 1000

    # Predict
    t_infer = time.perf_counter()
    try:
        y_pred = model.predict(X_test_scaled)
    except Exception as e:
        return ModelBenchmarkResult(
            dataset_name=config.name,
            model_name=model_name,
            n_samples=len(df),
            n_features=X_df.shape[1],
            n_classes=n_classes,
            error=f"Inference error: {e}",
            train_time_ms=round(train_time_ms, 2),
        )
    infer_time_ms = (time.perf_counter() - t_infer) * 1000

    total_time_ms = (time.perf_counter() - t_start) * 1000

    # Calculate metrics
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

    result = ModelBenchmarkResult(
        dataset_name=config.name,
        model_name=model_name,
        n_samples=len(df),
        n_features=X_df.shape[1],
        n_classes=n_classes,
        accuracy=float(accuracy_score(y_test, y_pred)),
        train_time_ms=round(train_time_ms, 2),
        infer_time_ms=round(infer_time_ms, 2),
        total_time_ms=round(total_time_ms, 2),
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
        if n_classes == 2:
            result.roc_auc = float(roc_auc_score(y_test, y_pred))
    except Exception:
        pass

    return result


def run_model_comparison(
    dataset_names: list[str] | None = None,
    model_names: list[str] | None = None,
    *,
    export_csv: str | None = None,
    export_json: str | None = None,
) -> tuple[list[ModelBenchmarkResult], pd.DataFrame]:
    """Run all registered models on the specified datasets.

    Args:
        dataset_names: Names of datasets to benchmark (all if None).
        model_names: Names of models to run (all registered if None).
        export_csv: Path to export CSV results (side-by-side format).
        export_json: Path to export JSON results.

    Returns:
        Tuple of (results_list, summary_dataframe).
    """
    if dataset_names is None:
        dataset_names = get_dataset_names()

    # Determine which models to run
    if model_names is None:
        model_names = sorted(_MODEL_REGISTRY.keys(), key=lambda n: _MODEL_REGISTRY[n]["priority"])

    # Filter to only actually registered models
    available_models = {n: _MODEL_REGISTRY[n] for n in model_names if n in _MODEL_REGISTRY}
    missing = [n for n in model_names if n not in _MODEL_REGISTRY]
    if missing:
        logger.warning("Unknown models (skipping): %s", missing)

    # Ordered list
    model_configs = sorted(available_models.items(), key=lambda kv: kv[1]["priority"])

    all_results: list[ModelBenchmarkResult] = []

    for dset_name in dataset_names:
        config = get_dataset(dset_name)
        if config is None:
            logger.warning("Unknown dataset: %s — skipping", dset_name)
            continue

        logger.info("Benchmarking dataset: %s", dset_name)

        for model_name, model_entry in model_configs:
            builder = model_entry["builder"]

            # Tree-based models generally don't need scaling; linear ones do.
            needs_scaling = model_name in ("LogisticRegression",)

            logger.info("  Model: %s ...", model_name)
            result = run_model_on_dataset(
                config,
                builder,
                model_name,
                scale_features=needs_scaling,
            )
            status = "OK" if result.error is None else f"ERROR: {result.error}"
            logger.info("    accuracy=%.4f | F1=%.4f | train=%.1fms | infer=%.1fms | %s",
                        result.accuracy or 0.0,
                        result.f1_score or 0.0,
                        result.train_time_ms,
                        result.infer_time_ms,
                        status)
            all_results.append(result)

    # Build summary DataFrame
    records = []
    for r in all_results:
        records.append({
            "dataset": r.dataset_name,
            "model": r.model_name,
            "n_samples": r.n_samples,
            "n_features": r.n_features,
            "n_classes": r.n_classes,
            "accuracy": r.accuracy,
            "f1_score": r.f1_score,
            "precision": r.precision,
            "recall": r.recall,
            "roc_auc": r.roc_auc,
            "train_time_ms": r.train_time_ms,
            "infer_time_ms": r.infer_time_ms,
            "total_time_ms": r.total_time_ms,
            "error": r.error or "",
        })

    summary_df = pd.DataFrame(records)

    if export_csv:
        _export_comparison_csv(all_results, export_csv)
        logger.info("Results exported to CSV: %s", export_csv)

    if export_json:
        _export_comparison_json(all_results, export_json)
        logger.info("Results exported to JSON: %s", export_json)

    return all_results, summary_df


def _export_comparison_csv(results: list[ModelBenchmarkResult], path: str) -> None:
    """Export results as CSV with one row per (dataset, model) pair."""
    if not results:
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "dataset", "model", "n_samples", "n_features", "n_classes",
        "accuracy", "f1_score", "precision", "recall", "roc_auc",
        "train_time_ms", "infer_time_ms", "total_time_ms", "error",
    ]
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({
                "dataset": r.dataset_name,
                "model": r.model_name,
                "n_samples": r.n_samples,
                "n_features": r.n_features,
                "n_classes": r.n_classes,
                "accuracy": r.accuracy,
                "f1_score": r.f1_score,
                "precision": r.precision,
                "recall": r.recall,
                "roc_auc": r.roc_auc,
                "train_time_ms": r.train_time_ms,
                "infer_time_ms": r.infer_time_ms,
                "total_time_ms": r.total_time_ms,
                "error": r.error or "",
            })


def _export_comparison_json(results: list[ModelBenchmarkResult], path: str) -> None:
    """Export results as JSON with structured comparison."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    # Build model-centric view: per model, list of per-dataset results
    models: dict[str, list[dict]] = {}
    for r in results:
        d = asdict(r)
        d.pop("model_name", None)
        models.setdefault(r.model_name, []).append(d)

    # Build dataset-centric view: per dataset, side-by-side comparison
    datasets: dict[str, dict[str, dict]] = {}
    for r in results:
        datasets.setdefault(r.dataset_name, {})[r.model_name] = {
            "accuracy": r.accuracy,
            "f1_score": r.f1_score,
            "precision": r.precision,
            "recall": r.recall,
            "roc_auc": r.roc_auc,
            "train_time_ms": r.train_time_ms,
            "infer_time_ms": r.infer_time_ms,
            "total_time_ms": r.total_time_ms,
            "error": r.error,
        }

    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "n_datasets": len(datasets),
            "n_models": len(models),
            "n_results": len(results),
        },
        "by_model": models,
        "by_dataset": datasets,
        "results": [asdict(r) for r in results],
    }

    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def print_summary_table(summary_df: pd.DataFrame) -> None:
    """Print a human-readable comparison table."""
    if summary_df.empty:
        print("No results to display.")
        return

    # Pivot table: datasets x models, values = accuracy
    try:
        pivot_acc = summary_df.pivot_table(
            index="dataset", columns="model", values="accuracy", aggfunc="first",
        )
        pivot_f1 = summary_df.pivot_table(
            index="dataset", columns="model", values="f1_score", aggfunc="first",
        )
        pivot_train = summary_df.pivot_table(
            index="dataset", columns="model", values="train_time_ms", aggfunc="first",
        )
        pivot_infer = summary_df.pivot_table(
            index="dataset", columns="model", values="infer_time_ms", aggfunc="first",
        )
    except Exception:
        print(summary_df.to_string(index=False))
        return

    print("\n" + "=" * 80)
    print("MODEL COMPARISON — ACCURACY")
    print("=" * 80)
    print(pivot_acc.to_string(float_format=lambda x: f"{x:.4f}" if pd.notna(x) else "N/A"))
    print()

    if not pivot_f1.dropna(how="all").empty:
        print("=" * 80)
        print("MODEL COMPARISON — F1 SCORE (weighted)")
        print("=" * 80)
        print(pivot_f1.to_string(float_format=lambda x: f"{x:.4f}" if pd.notna(x) else "N/A"))
        print()

    print("=" * 80)
    print("MODEL COMPARISON — TRAINING TIME (ms)")
    print("=" * 80)
    print(pivot_train.to_string(float_format=lambda x: f"{x:.1f}" if pd.notna(x) else "N/A"))
    print()

    print("=" * 80)
    print("MODEL COMPARISON — INFERENCE TIME (ms)")
    print("=" * 80)
    print(pivot_infer.to_string(float_format=lambda x: f"{x:.1f}" if pd.notna(x) else "N/A"))
    print()

    # Per-model averages
    print("=" * 80)
    print("PER-MODEL AVERAGES")
    print("=" * 80)
    avg_df = summary_df.groupby("model").agg(
        avg_accuracy=("accuracy", "mean"),
        avg_f1=("f1_score", "mean"),
        avg_train_time_ms=("train_time_ms", "mean"),
        avg_infer_time_ms=("infer_time_ms", "mean"),
        total_datasets=("dataset", "count"),
        errors=("error", lambda x: sum(1 for e in x if e)),
    ).reset_index()
    print(avg_df.to_string(index=False, float_format=lambda x: f"{x:.4f}" if isinstance(x, float) else str(x)))


# ── Main entry point ─────────────────────────────────────────────────────────


def main():
    """Entry point: run model comparison on all datasets and all models."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    output_dir = Path(__file__).resolve().parent / ".." / ".." / "benchmark_output"
    output_dir.mkdir(parents=True, exist_ok=True)

    csv_path = str(output_dir / "model_comparison.csv")
    json_path = str(output_dir / "model_comparison.json")

    logger.info("=" * 60)
    logger.info("Starting model comparison benchmark")
    logger.info("Datasets: %d", len(get_dataset_names()))
    logger.info("Models: %s", ", ".join(_MODEL_REGISTRY.keys()))
    logger.info("=" * 60)

    results, summary_df = run_model_comparison(
        export_csv=csv_path,
        export_json=json_path,
    )

    print_summary_table(summary_df)

    logger.info("Results exported to:")
    logger.info("  CSV: %s", csv_path)
    logger.info("  JSON: %s", json_path)
    logger.info("Done — %d (dataset, model) pairs evaluated.", len(results))


if __name__ == "__main__":
    main()
