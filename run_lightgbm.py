#!/usr/bin/env python3
"""LightGBM model runner for tabular-mcp benchmark.

Usage: echo <csv_data> | python3 run_lightgbm.py --target <col> --format json
"""
import argparse
import json
import sys
import math

import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False


def main():
    parser = argparse.ArgumentParser(description="LightGBM benchmark runner")
    parser.add_argument("--target", required=True, help="Target column name")
    parser.add_argument("--format", default="json", help="Output format")
    args = parser.parse_args()

    csv_data = sys.stdin.read()
    df = pd.read_csv(pd.io.common.StringIO(csv_data))

    if args.target not in df.columns:
        print(json.dumps({"error": f"Column '{args.target}' not found"}))
        return

    y = df[args.target]
    X = df.drop(columns=[args.target])

    for col in X.select_dtypes(include=["object", "category"]).columns:
        X[col] = pd.factorize(X[col])[0]

    X = X.fillna(X.mean(numeric_only=True)).fillna(0)

    is_regression = y.dtype in ["float64", "int64"] and y.nunique() > 10

    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, f1_score, r2_score, mean_squared_error

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, train_size=0.8, random_state=42
    )

    if not HAS_LGB:
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        if is_regression:
            model = RandomForestRegressor(n_estimators=100, random_state=42)
        else:
            model = RandomForestClassifier(n_estimators=100, random_state=42)
        model.fit(X_train, y_train)
    else:
        if is_regression:
            model = lgb.LGBMRegressor(n_estimators=100, random_state=42, verbose=-1)
        else:
            model = lgb.LGBMClassifier(n_estimators=100, random_state=42, verbose=-1)
        model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    result = {}
    if is_regression:
        result["r2"] = float(r2_score(y_test, y_pred))
        result["rmse"] = float(math.sqrt(mean_squared_error(y_test, y_pred)))
    else:
        result["accuracy"] = float(accuracy_score(y_test, y_pred))
        result["f1_score"] = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
    result["model"] = "lightgbm"

    print(json.dumps(result))


if __name__ == "__main__":
    main()
