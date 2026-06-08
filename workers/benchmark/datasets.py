"""OpenML/Kaggle dataset downloader and registry for the benchmark suite."""

from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
import requests

logger = logging.getLogger(__name__)

OPENML_API_BASE = "https://www.openml.org/api/v1"


@dataclass
class DatasetConfig:
    """Configuration for a benchmark dataset."""

    name: str
    task: str  # "classification" | "regression"
    source: str  # "openml" | "kaggle" | "builtin"
    openml_id: int | None = None
    kaggle_id: str | None = None
    target_column: str = "target"
    n_classes: int | None = None
    n_samples: int | None = None
    n_features: int | None = None
    description: str = ""
    url: str = ""


DATASET_REGISTRY: list[DatasetConfig] = [
    # ── Builtin sklearn datasets ──────────────────────────────────
    DatasetConfig(
        name="iris",
        task="classification",
        source="builtin",
        n_classes=3,
        n_samples=150,
        n_features=4,
        description="Iris flower species classification",
    ),
    DatasetConfig(
        name="wine",
        task="classification",
        source="builtin",
        n_classes=3,
        n_samples=178,
        n_features=13,
        description="Wine cultivar classification",
    ),
    DatasetConfig(
        name="breast_cancer",
        task="classification",
        source="builtin",
        n_classes=2,
        n_samples=569,
        n_features=30,
        description="Breast cancer (Wisconsin diagnostic)",
    ),
    DatasetConfig(
        name="diabetes",
        task="classification",
        source="builtin",
        n_classes=2,
        n_samples=442,
        n_features=10,
        description="Diabetes progression",
    ),
    DatasetConfig(
        name="digits",
        task="classification",
        source="builtin",
        n_classes=10,
        n_samples=1797,
        n_features=64,
        description="Handwritten digit recognition",
    ),
    # ── OpenML datasets ───────────────────────────────────────────
    DatasetConfig(
        name="australian",
        task="classification",
        source="openml",
        openml_id=40981,
        n_classes=2,
        n_samples=690,
        n_features=14,
        description="Australian Credit Approval",
    ),
    DatasetConfig(
        name="blood_transfusion",
        task="classification",
        source="openml",
        openml_id=1464,
        n_classes=2,
        n_samples=748,
        n_features=4,
        description="Blood Transfusion Service Center",
    ),
    DatasetConfig(
        name="car",
        task="classification",
        source="openml",
        openml_id=40981,
        n_classes=4,
        n_samples=1728,
        n_features=6,
        description="Car Evaluation",
    ),
    DatasetConfig(
        name="credit_g",
        task="classification",
        source="openml",
        openml_id=31,
        n_classes=2,
        n_samples=1000,
        n_features=20,
        description="German Credit Data",
    ),
    DatasetConfig(
        name="phoneme",
        task="classification",
        source="openml",
        openml_id=1489,
        n_classes=2,
        n_samples=5404,
        n_features=5,
        description="Phoneme speech recognition",
    ),
    DatasetConfig(
        name="kc1",
        task="classification",
        source="openml",
        openml_id=1067,
        n_classes=2,
        n_samples=2109,
        n_features=21,
        description="NASA KC1 defect prediction",
    ),
    DatasetConfig(
        name="vehicle",
        task="classification",
        source="openml",
        openml_id=54,
        n_classes=4,
        n_samples=846,
        n_features=18,
        description="Vehicle Silhouettes",
    ),
    DatasetConfig(
        name="segment",
        task="classification",
        source="openml",
        openml_id=36,
        n_classes=7,
        n_samples=2310,
        n_features=19,
        description="Image Segmentation",
    ),
    DatasetConfig(
        name="satimage",
        task="classification",
        source="openml",
        openml_id=182,
        n_classes=6,
        n_samples=6430,
        n_features=36,
        description="Satellite Image (Statlog)",
    ),
    DatasetConfig(
        name="mfeat_factors",
        task="classification",
        source="openml",
        openml_id=12,
        n_classes=10,
        n_samples=2000,
        n_features=216,
        description="Multiple Features — Factor Descriptors",
    ),
    # ── Kaggle datasets ────────────────────────────────────────────
    DatasetConfig(
        name="titanic",
        task="classification",
        source="kaggle",
        kaggle_id="c/titanic",
        n_classes=2,
        n_samples=891,
        n_features=11,
        description="Titanic: Machine Learning from Disaster",
    ),
    DatasetConfig(
        name="house_prices",
        task="regression",
        source="kaggle",
        kaggle_id="c/house-prices-advanced-regression-techniques",
        n_samples=1460,
        n_features=79,
        description="House Prices: Advanced Regression Techniques",
    ),
    DatasetConfig(
        name="spaceship_titanic",
        task="classification",
        source="kaggle",
        kaggle_id="c/spaceship-titanic",
        n_classes=2,
        n_samples=8709,
        n_features=12,
        description="Spaceship Titanic",
    ),
]


def get_datasets_by_source(source: str) -> list[DatasetConfig]:
    return [d for d in DATASET_REGISTRY if d.source == source]


def get_dataset_names() -> list[str]:
    return [d.name for d in DATASET_REGISTRY]


def get_dataset(name: str) -> DatasetConfig | None:
    for d in DATASET_REGISTRY:
        if d.name == name:
            return d
    return None


def download_openml_dataset(config: DatasetConfig) -> pd.DataFrame:
    """Download a dataset from OpenML by ID using the REST API."""
    assert config.openml_id is not None
    data_id_url = f"{OPENML_API_BASE}/data/{config.openml_id}"
    resp = requests.get(data_id_url, timeout=30)
    resp.raise_for_status()
    data_meta = resp.json().get("data_set_description", {})
    file_id = data_meta.get("file_id")
    if not file_id:
        raise RuntimeError(f"No file_id for OpenML dataset {config.openml_id}")
    arff_url = f"{OPENML_API_BASE}/data/download/{file_id}"
    arff_resp = requests.get(arff_url, timeout=60)
    arff_resp.raise_for_status()
    try:
        from scipy.io import arff
        data, meta = arff.loadarff(io.BytesIO(arff_resp.content))
        df = pd.DataFrame(data)
        for col in df.select_dtypes(include=[object]):
            try:
                df[col] = df[col].str.decode("utf-8")
            except Exception:
                pass
        return df
    except ImportError:
        logger.warning("scipy not available, falling back to CSV-ARFF heuristic")
        return _parse_arff_as_csv(arff_resp.text)


def _parse_arff_as_csv(content: str) -> pd.DataFrame:
    """Basic ARFF-to-DataFrame parser when scipy is unavailable."""
    lines = content.strip().split("\n")
    data_lines: list[str] = []
    in_data = False
    for line in lines:
        stripped = line.strip()
        if stripped.upper().startswith("@DATA"):
            in_data = True
        elif in_data and stripped and not stripped.startswith("%"):
            data_lines.append(stripped)
    import csv
    reader = csv.reader(data_lines)
    rows = [row for row in reader]
    return pd.DataFrame(rows)


def download_kaggle_dataset(config: DatasetConfig) -> pd.DataFrame:
    """Download a dataset from Kaggle.

    Requires the kagglehub library:
        pip install kagglehub
    """
    try:
        import kagglehub
    except ImportError:
        raise RuntimeError(
            "kagglehub is required to download Kaggle datasets. "
            "Install it with: pip install kagglehub"
        )
    path = kagglehub.competition_download(config.kaggle_id)
    import glob
    csv_files = glob.glob(os.path.join(path, "*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in Kaggle download {path}")
    df = pd.read_csv(csv_files[0])
    return df


def load_dataset(config: DatasetConfig) -> pd.DataFrame:
    """Load a dataset by its config, returning (X_df, y_series)."""
    if config.source == "builtin":
        return _load_builtin(config)
    elif config.source == "openml":
        return download_openml_dataset(config)
    elif config.source == "kaggle":
        return download_kaggle_dataset(config)
    else:
        raise ValueError(f"Unknown source: {config.source}")


def _load_builtin(config: DatasetConfig) -> pd.DataFrame:
    """Load a built-in sklearn dataset."""
    from sklearn import datasets as sk_datasets
    loader_map: dict[str, Any] = {
        "iris": sk_datasets.load_iris,
        "wine": sk_datasets.load_wine,
        "breast_cancer": sk_datasets.load_breast_cancer,
        "diabetes": sk_datasets.load_diabetes,
        "digits": sk_datasets.load_digits,
    }
    loader = loader_map.get(config.name)
    if loader is None:
        raise ValueError(f"Unknown builtin dataset: {config.name}")
    data = loader(as_frame=True)
    df = data.frame.copy()
    if config.name == "diabetes":
        df.columns = [f"feature_{i}" if c.startswith("feat") else c for i, c in enumerate(df.columns)]
        df.rename(columns={"target": "target"}, inplace=True)
    return df
