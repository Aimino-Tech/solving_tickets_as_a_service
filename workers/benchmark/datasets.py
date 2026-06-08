"""Dataset registry with OpenML/Kaggle integration — 20+ datasets for benchmark suite."""

from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

OPENML_API_BASE = "https://www.openml.org/api/v1"


@dataclass
class DatasetConfig:
    name: str
    task: str  # "classification" | "regression"
    source: str  # "openml" | "kaggle" | "builtin"
    openml_id: int | None = None
    kaggle_id: str | None = None
    n_classes: int | None = None
    n_samples: int | None = None
    n_features: int | None = None
    description: str = ""


DATASET_REGISTRY: list[DatasetConfig] = [
    # Builtin
    DatasetConfig(name="iris", task="classification", source="builtin", n_classes=3, n_samples=150, n_features=4),
    DatasetConfig(name="wine", task="classification", source="builtin", n_classes=3, n_samples=178, n_features=13),
    DatasetConfig(name="breast_cancer", task="classification", source="builtin", n_classes=2, n_samples=569, n_features=30),
    DatasetConfig(name="diabetes", task="classification", source="builtin", n_classes=2, n_samples=442, n_features=10),
    DatasetConfig(name="digits", task="classification", source="builtin", n_classes=10, n_samples=1797, n_features=64),
    # OpenML
    DatasetConfig(name="australian", task="classification", source="openml", openml_id=40981, n_classes=2, n_samples=690, n_features=14),
    DatasetConfig(name="blood_transfusion", task="classification", source="openml", openml_id=1464, n_classes=2, n_samples=748, n_features=4),
    DatasetConfig(name="credit_g", task="classification", source="openml", openml_id=31, n_classes=2, n_samples=1000, n_features=20),
    DatasetConfig(name="phoneme", task="classification", source="openml", openml_id=1489, n_classes=2, n_samples=5404, n_features=5),
    DatasetConfig(name="kc1", task="classification", source="openml", openml_id=1067, n_classes=2, n_samples=2109, n_features=21),
    DatasetConfig(name="vehicle", task="classification", source="openml", openml_id=54, n_classes=4, n_samples=846, n_features=18),
    DatasetConfig(name="segment", task="classification", source="openml", openml_id=36, n_classes=7, n_samples=2310, n_features=19),
    DatasetConfig(name="satimage", task="classification", source="openml", openml_id=182, n_classes=6, n_samples=6430, n_features=36),
    DatasetConfig(name="spambase", task="classification", source="openml", openml_id=44, n_classes=2, n_samples=4601, n_features=57),
    DatasetConfig(name="pendigits", task="classification", source="openml", openml_id=32, n_classes=10, n_samples=10992, n_features=16),
    DatasetConfig(name="ecoli", task="classification", source="openml", openml_id=62, n_classes=8, n_samples=336, n_features=7),
    DatasetConfig(name="glass", task="classification", source="openml", openml_id=72, n_classes=7, n_samples=214, n_features=9),
    DatasetConfig(name="waveform", task="classification", source="openml", openml_id=60, n_classes=3, n_samples=5000, n_features=21),
    DatasetConfig(name="mfeat_factors", task="classification", source="openml", openml_id=12, n_classes=10, n_samples=2000, n_features=216),
    # Kaggle
    DatasetConfig(name="titanic", task="classification", source="kaggle", kaggle_id="c/titanic", n_classes=2, n_samples=891, n_features=11),
    DatasetConfig(name="house_prices", task="regression", source="kaggle", kaggle_id="c/house-prices-advanced-regression-techniques", n_samples=1460, n_features=79),
    DatasetConfig(name="spaceship_titanic", task="classification", source="kaggle", kaggle_id="c/spaceship-titanic", n_classes=2, n_samples=8709, n_features=12),
]


def get_dataset(name: str) -> DatasetConfig | None:
    for d in DATASET_REGISTRY:
        if d.name == name:
            return d
    return None


def get_all_names() -> list[str]:
    return [d.name for d in DATASET_REGISTRY]


def load_dataset(config: DatasetConfig) -> pd.DataFrame:
    loader: dict[str, Callable[[DatasetConfig], pd.DataFrame]] = {
        "builtin": _load_builtin,
        "openml": _load_openml,
        "kaggle": _load_kaggle,
    }
    fn = loader.get(config.source)
    if fn is None:
        raise ValueError(f"Unknown source: {config.source}")
    return fn(config)


def _load_builtin(config: DatasetConfig) -> pd.DataFrame:
    from sklearn import datasets as sk
    builtins: dict[str, Any] = {
        "iris": sk.load_iris, "wine": sk.load_wine,
        "breast_cancer": sk.load_breast_cancer, "diabetes": sk.load_diabetes,
        "digits": sk.load_digits,
    }
    data = builtins[config.name](as_frame=True)
    df = data.frame.copy()
    if "target" not in df.columns:
        df["target"] = data.target
    return df


def _load_openml(config: DatasetConfig) -> pd.DataFrame:
    resp = requests.get(f"{OPENML_API_BASE}/data/{config.openml_id}", timeout=30)
    resp.raise_for_status()
    file_id = resp.json().get("data_set_description", {}).get("file_id")
    arff = requests.get(f"{OPENML_API_BASE}/data/download/{file_id}", timeout=60)
    arff.raise_for_status()
    try:
        from scipy.io import arff as arff_parser
        data, _ = arff_parser.loadarff(io.BytesIO(arff.content))
        df = pd.DataFrame(data)
        for col in df.select_dtypes(include=[object]):
            try:
                df[col] = df[col].str.decode("utf-8")
            except Exception:
                pass
        return df
    except ImportError:
        lines = arff.text.strip().split("\n")
        data_lines, in_data = [], False
        for line in lines:
            s = line.strip()
            if s.upper().startswith("@DATA"):
                in_data = True
            elif in_data and s and not s.startswith("%"):
                data_lines.append(s)
        import csv
        return pd.DataFrame(list(csv.reader(data_lines)))


def _load_kaggle(config: DatasetConfig) -> pd.DataFrame:
    try:
        import kagglehub
    except ImportError:
        raise RuntimeError("pip install kagglehub")
    path = kagglehub.competition_download(config.kaggle_id)
    import glob
    csvs = glob.glob(os.path.join(path, "*.csv"))
    if not csvs:
        raise FileNotFoundError(f"No CSVs in {path}")
    return pd.read_csv(csvs[0])
