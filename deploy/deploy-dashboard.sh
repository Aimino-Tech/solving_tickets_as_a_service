#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_DIR="${DASHBOARD_DIR:-$HOME/syntaro/dashboard}"
PM2_APP_NAME="${PM2_APP_NAME:-syntaro}"

echo "=== Deploying SYNTARO Dashboard ==="

cd "$(dirname "$DASHBOARD_DIR")"
echo "[1/4] Pulling latest code..."
git pull origin main

echo "[2/4] Installing dependencies..."
cd "$DASHBOARD_DIR"
npm ci

echo "[3/4] Building dashboard..."
npm run build

if [ ! -f "$DASHBOARD_DIR/dist/index.html" ]; then
  echo "ERROR: Build failed - dist/index.html not found"
  exit 1
fi
echo "  ✓ Build successful"

echo "[4/4] Restarting Express server..."
if command -v pm2 &> /dev/null; then
  pm2 restart "$PM2_APP_NAME"
elif command -v systemctl &> /dev/null; then
  sudo systemctl restart syntaro
else
  echo "  ⚠ Restart manually"
fi

echo "=== Done. Verify: https://syntaro.io/dashboard/ ==="
