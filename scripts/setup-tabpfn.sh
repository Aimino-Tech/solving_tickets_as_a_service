#!/usr/bin/env bash
# Setup TabPFN Python environment for benchmark comparisons.
set -euo pipefail

echo "=== TabPFN Environment Setup ==="
echo ""

VENV_DIR="${1:-venv-tabpfn}"

# Check Python
PYTHON="python3"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON="python"
fi
if ! command -v "$PYTHON" &>/dev/null; then
  echo "ERROR: Python 3 not found. Install Python 3.10+ first."
  exit 1
fi

echo "Using: $($PYTHON --version)"

# Create venv
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at $VENV_DIR ..."
  $PYTHON -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

echo "Installing TabPFN and dependencies ..."

# Core ML
pip install --upgrade pip
pip install numpy pandas scikit-learn scipy

# TabPFN
pip install tabpfn

# Comparison models
pip install xgboost lightgbm catboost

# OpenML integration
pip install openml

# Utilities
pip install psutil

# PyTorch (CPU version — TabPFN requires PyTorch)
pip install torch --index-url https://download.pytorch.org/whl/cpu

echo ""
echo "=== Setup complete ==="
echo "Activate with: source $VENV_DIR/bin/activate"
echo "Run benchmark: python workers/benchmark/tabpfn_comparison.py"
