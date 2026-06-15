#!/bin/bash
# One-click deploy for Aimino Tech Marketing Dashboard
# Run: bash deploy.sh

echo "🚀 Aimino Tech — Marketing Dashboard Deployer"
echo "================================================"

# Check if python3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 not found"
    exit 1
fi

# Check if google-auth is installed
if ! python3 -c "import google.oauth2" 2>/dev/null; then
    echo "📦 Installing google-auth..."
    pip3 install google-auth google-auth-oauthlib requests
fi

# Run the deployment script
echo ""
echo "🚀 Deploying dashboard..."
python3 deploy_dashboard.py

echo ""
echo "Done! Check the URL above to access your dashboard."
