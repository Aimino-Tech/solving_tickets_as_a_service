#!/usr/bin/env python3
"""
Deploy Marketing Dashboard to Google Apps Script

Prerequisites:
1. Enable Apps Script API in Google Cloud Console:
   https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=339055984573

2. Run this script:
   python3 deploy_dashboard.py

The script will:
- Create a new Apps Script project
- Upload Code.gs and Index.html
- Deploy as web app
- Print the dashboard URL
"""

import os
import sys
import json
import time
import requests
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request

SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))

def main():
    print("🚀 Aimino Tech — Marketing Dashboard Deployer")
    print("=" * 50)
    
    # Check prerequisites
    if not os.path.exists(SA_PATH):
        print("❌ Service account key not found at:", SA_PATH)
        sys.exit(1)
    
    # Load credentials
    creds = Credentials.from_service_account_file(SA_PATH, scopes=[
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.deployments",
    ])
    
    try:
        creds.refresh(Request())
    except Exception as e:
        print(f"❌ Failed to authenticate: {e}")
        print("   Make sure the service account has the right permissions.")
        sys.exit(1)
    
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json"
    }
    
    # Read source files
    print("\n📂 Reading source files...")
    with open(os.path.join(DASHBOARD_DIR, "Code.gs"), "r") as f:
        code_gs = f.read()
    with open(os.path.join(DASHBOARD_DIR, "Index.html"), "r") as f:
        index_html = f.read()
    print(f"   Code.gs: {len(code_gs)} bytes")
    print(f"   Index.html: {len(index_html)} bytes")
    
    # Step 1: Create Apps Script project
    print("\n📝 Step 1: Creating Apps Script project...")
    url = "https://script.googleapis.com/v1/projects"
    body = {"title": "Aimino Tech — Marketing Dashboard"}
    
    r = requests.post(url, headers=headers, json=body, timeout=30)
    if r.status_code == 403:
        print("\n❌ Apps Script API is not enabled!")
        print("   Please enable it first:")
        print("   https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=339055984573")
        print("\n   Then run this script again.")
        sys.exit(1)
    
    if r.status_code != 200:
        print(f"❌ Failed to create project: {r.status_code}")
        print(r.text[:300])
        sys.exit(1)
    
    project = r.json()
    script_id = project["scriptId"]
    print(f"   ✅ Project created: {script_id}")
    print(f"   📎 Editor: https://script.google.com/d/{script_id}/edit")
    
    # Step 2: Update content
    print("\n📝 Step 2: Uploading source code...")
    content_url = f"https://script.googleapis.com/v1/projects/{script_id}/content"
    content_body = {
        "files": [
            {
                "name": "Code",
                "type": "SERVER_JS",
                "source": code_gs
            },
            {
                "name": "Index",
                "type": "HTML",
                "source": index_html
            }
        ]
    }
    
    r2 = requests.put(content_url, headers=headers, json=content_body, timeout=60)
    if r2.status_code != 200:
        print(f"❌ Failed to upload code: {r2.status_code}")
        print(r2.text[:300])
        sys.exit(1)
    
    print("   ✅ Code uploaded successfully")
    
    # Step 3: Deploy as web app
    print("\n🚀 Step 3: Deploying as web app...")
    deploy_url = f"https://script.googleapis.com/v1/projects/{script_id}/deployments"
    deploy_body = {
        "versionNumber": 1,
        "deploymentConfig": {
            "description": "Aimino Tech Marketing Dashboard — Live data from Google Sheet",
            "manifestFileName": "appsscript.json",
            "useEmojiAccess": True
        }
    }
    
    r3 = requests.post(deploy_url, headers=headers, json=deploy_body, timeout=60)
    if r3.status_code != 200:
        print(f"❌ Failed to deploy: {r3.status_code}")
        print(r3.text[:300])
        sys.exit(1)
    
    deploy_data = r3.json()
    web_url = ""
    for entry in deploy_data.get("entryPoints", []):
        if entry.get("entryPointType") == "WEB_APP":
            web_url = entry.get("webApp", {}).get("url", "")
            break
    
    print("   ✅ Deployed successfully!")
    
    # Print results
    print("\n" + "=" * 50)
    print("🎉 DEPLOYMENT COMPLETE!")
    print("=" * 50)
    print(f"\n📊 Dashboard URL:")
    print(f"   {web_url}")
    print(f"\n📎 Script Editor:")
    print(f"   https://script.google.com/d/{script_id}/edit")
    print(f"\n📋 Next steps:")
    print(f"   1. Open the dashboard URL above")
    print(f"   2. Authorize when prompted (first time)")
    print(f"   3. The dashboard will load with live data from your Google Sheet")
    print(f"\n🔄 To update after code changes:")
    print(f"   python3 deploy_dashboard.py")
    
    return web_url

if __name__ == "__main__":
    main()
