#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Deploy STAS Dashboard to Production
# Usage: ./deploy-dashboard.sh [server] [app-dir]
#
# Deploys the built dashboard SPA to the production server at syntaro.io.
# The dashboard is served by the Express server from dashboard/dist/.
# =============================================================================

SERVER="${1:-syntaro.io}"
APP_DIR="${2:-/opt/stas}"

echo "=== Deploying STAS Dashboard to $SERVER ==="

# Build the dashboard
echo "[1/4] Building dashboard..."
cd "$(dirname "$0")"
cd dashboard
npm ci --ignore-scripts
npm run build
cd ..

# Verify build output
if [ ! -f "dashboard/dist/index.html" ]; then
  echo "ERROR: Build failed - dashboard/dist/index.html not found"
  exit 1
fi

# Sync to production server
echo "[2/4] Syncing to production server..."
rsync -avz --delete dashboard/dist/ "$SERVER:$APP_DIR/dashboard/dist/"

# Restart Express server
echo "[3/4] Restarting Express server..."
ssh "$SERVER" "cd $APP_DIR && pm2 restart stas --update-env" || {
  ssh "$SERVER" "cd $APP_DIR && pm2 start dist/src/index.js --name stas && pm2 save"
}

# Verify
echo "[4/4] Verifying deployment..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$SERVER/dashboard/")
if [ "$HTTP_CODE" != "000" ]; then
  echo "Dashboard serving at https://$SERVER/dashboard/ (HTTP $HTTP_CODE)"
else
  echo "WARNING: Could not verify dashboard at https://$SERVER/dashboard/"
fi

echo "=== Deployment complete ==="
