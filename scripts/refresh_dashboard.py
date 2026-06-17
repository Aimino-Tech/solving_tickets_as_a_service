#!/home/agent/Documents/hermes-agent/venv/bin/python3
"""Refresh campaign dashboard data from Google Sheets."""
import gspread
import json
from collections import defaultdict
from google.oauth2.service_account import Credentials
from datetime import datetime

SPREADSHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SERVICE_ACCOUNT = "/home/agent/Documents/hermes-agent/service-account-key.json"
DASHBOARD_PATH = "/home/agent/Documents/hermes-agent/dashboard.html"

PLATFORM_SHEETS = [
    "reddit-campaign", "linkedin-campaign", "twitter-campaign",
    "discord-campaign", "instagram-campaign", "threads-campaign", "hacker-news-campaign"
]

PROJECT_META = {
    "odw": {"name": "OpenDocsWork MCP", "desc": "MCP server for document workflows", "icon": "🔧"},
    "OT2H": {"name": "OpenTalk2HTML", "desc": "Convert conversations to HTML", "icon": "💬"},
}


def load_data():
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT,
        scopes=["https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"]
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(SPREADSHEET_ID)

    product_stats = defaultdict(lambda: {
        "total": 0,
        "by_platform": defaultdict(int),
        "by_status": defaultdict(int),
    })

    for sheet_name in PLATFORM_SHEETS:
        ws = sh.worksheet(sheet_name)
        headers = ws.row_values(1)
        rows = ws.get_all_values()[1:]

        pid_idx = headers.index("ProductID") if "ProductID" in headers else None
        status_idx = headers.index("Status") if "Status" in headers else None
        platform = sheet_name.replace("-campaign", "")

        for row in rows:
            pid = row[pid_idx].strip() if pid_idx is not None and pid_idx < len(row) else ""
            if not pid:
                pid = "odw"
            status = row[status_idx].strip() if status_idx is not None and status_idx < len(row) else ""

            product_stats[pid]["total"] += 1
            product_stats[pid]["by_platform"][platform] += 1
            product_stats[pid]["by_status"][status] += 1

    return {pid: {
        "total": stats["total"],
        "by_platform": dict(stats["by_platform"]),
        "by_status": dict(stats["by_status"])
    } for pid, stats in product_stats.items()}


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aimino Campaign Dashboard</title>
<style>
  :root {
    --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a;
    --text: #e4e4e7; --muted: #71717a; --accent: #6366f1;
    --green: #22c55e; --yellow: #eab308; --red: #ef4444;
    --blue: #3b82f6; --purple: #a855f7; --orange: #f97316; --cyan: #06b6d4;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 24px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .header .updated { color: var(--muted); font-size: 13px; }
  .summary-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
  .summary-card .value { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
  .summary-card .label { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .project-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 16px; transition: border-color 0.2s; }
  .project-card:hover { border-color: var(--accent); }
  .project-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .project-name { font-size: 20px; font-weight: 600; }
  .project-total { font-size: 28px; font-weight: 700; color: var(--accent); }
  .project-total small { font-size: 14px; color: var(--muted); font-weight: 400; }
  .platform-bars { display: flex; flex-direction: column; gap: 10px; }
  .bar-row { display: grid; grid-template-columns: 100px 1fr 50px; align-items: center; gap: 12px; }
  .bar-label { font-size: 13px; color: var(--muted); text-transform: capitalize; }
  .bar-track { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
  .bar-count { font-size: 13px; font-weight: 600; text-align: right; }
  .p-reddit .bar-fill { background: var(--orange); }
  .p-linkedin .bar-fill { background: var(--blue); }
  .p-twitter .bar-fill { background: var(--cyan); }
  .p-discord .bar-fill { background: var(--purple); }
  .p-hacker-news .bar-fill { background: var(--yellow); }
  .p-threads .bar-fill { background: var(--green); }
  .p-instagram .bar-fill { background: var(--red); }
  .status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
  .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .status-count { margin-left: auto; font-weight: 600; color: var(--muted); }
  .breakdown-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .breakdown-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .breakdown-card h3 { font-size: 14px; text-transform: capitalize; margin-bottom: 12px; }
  .breakdown-item { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
  .breakdown-item:last-child { border-bottom: none; }
  @media (max-width: 640px) { body { padding: 12px; } .summary-row { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="header">
  <h1>📊 Aimino Campaign Dashboard</h1>
  <div class="updated">Last updated: <span id="lastUpdate"></span></div>
</div>
<div class="summary-row" id="summary"></div>
<div style="margin-bottom:32px">
  <div class="section-title">🚀 Projects</div>
  <div id="projects"></div>
</div>
<div>
  <div class="section-title">📱 Platform Overview</div>
  <div class="breakdown-grid" id="platformBreakdown"></div>
</div>
<script>
const DATA = __DATA_JSON__;
const META = __META_JSON__;

const PC = {reddit:"var(--orange)",linkedin:"var(--blue)",twitter:"var(--cyan)",discord:"var(--purple)","hacker-news":"var(--yellow)",threads:"var(--green)",instagram:"var(--red)"};

function sc(s) {
  if (s.startsWith("\u2705")) return "var(--green)";
  if (s.startsWith("\uD83D\uDCCB")) return "var(--blue)";
  if (s.startsWith("\u274C")) return "var(--red)";
  if (s.startsWith("\u23ED")) return "var(--muted)";
  return "var(--accent)";
}

const tA = Object.values(DATA).reduce((s,p) => s+p.total, 0);
const tP = new Set(Object.values(DATA).flatMap(p => Object.keys(p.by_platform))).size;
const tPr = Object.keys(DATA).length;
const comp = Object.values(DATA).reduce((s,p) => s+(p.by_status["\u2705 Replied"]||0)+(p.by_status["\u2705 Posted"]||0)+(p.by_status["\u2705 Repled"]||0)+(p.by_status["commented"]||0)+(p.by_status["Commented"]||0)+(p.by_status["Posted"]||0), 0);

document.getElementById("summary").innerHTML =
  '<div class="summary-card"><div class="value">'+tPr+'</div><div class="label">Projects</div></div>' +
  '<div class="summary-card"><div class="value">'+tP+'</div><div class="label">Platforms</div></div>' +
  '<div class="summary-card"><div class="value" style="color:var(--accent)">'+tA.toLocaleString()+'</div><div class="label">Total Actions</div></div>' +
  '<div class="summary-card"><div class="value" style="color:var(--green)">'+comp+'</div><div class="label">Completed</div></div>';

document.getElementById("projects").innerHTML = Object.entries(DATA).map(([pid,stats]) => {
  const m = META[pid] || {name:pid, desc:"", icon:"\uD83D\uDCE6"};
  const mx = Math.max(...Object.values(stats.by_platform));
  const bars = Object.entries(stats.by_platform).sort((a,b) => b[1]-a[1]).map(([p,c]) =>
    '<div class="bar-row p-'+p+'"><div class="bar-label">'+p+'</div><div class="bar-track"><div class="bar-fill" style="width:'+(mx>0?c/mx*100:0)+'%"></div></div><div class="bar-count">'+c+'</div></div>'
  ).join("");
  const sts = Object.entries(stats.by_status).filter(([_,c])=>c>0).sort((a,b)=>b[1]-a[1]).map(([s,c]) =>
    '<div class="status-item"><div class="status-dot" style="background:'+sc(s)+'"></div><span>'+(s||"(empty)")+'</span><span class="status-count">'+c+'</span></div>'
  ).join("");
  return '<div class="project-card"><div class="project-header"><div><div class="project-name">'+m.icon+' '+m.name+'</div><div style="color:var(--muted);font-size:13px;margin-top:2px">'+m.desc+'</div></div><div class="project-total">'+stats.total.toLocaleString()+' <small>actions</small></div></div><div class="platform-bars">'+bars+'</div><div class="status-grid">'+sts+'</div></div>';
}).join("");

const pa = {};
Object.entries(DATA).forEach(([pid,s]) => Object.entries(s.by_platform).forEach(([p,c]) => { if(!pa[p])pa[p]={}; pa[p][pid]=c; }));
document.getElementById("platformBreakdown").innerHTML = Object.entries(pa).sort((a,b) => Object.values(b[1]).reduce((s,v)=>s+v,0)-Object.values(a[1]).reduce((s,v)=>s+v,0)).map(([p,pr]) =>
  '<div class="breakdown-card"><h3 style="color:'+(PC[p]||'var(--text)')+'">'+p+' ('+Object.values(pr).reduce((s,v)=>s+v,0)+')</h3>'+
  Object.entries(pr).sort((a,b)=>b[1]-a[1]).map(([pid,c]) =>
    '<div class="breakdown-item"><span>'+(META[pid]?.name||pid)+'</span><span style="font-weight:600">'+c+'</span></div>'
  ).join("")+'</div>'
).join("");

document.getElementById("lastUpdate").textContent = new Date().toLocaleString();
</script>
</body>
</html>"""


def generate_html(data):
    data_json = json.dumps(data, indent=2)
    meta_json = json.dumps(PROJECT_META, indent=2)
    html = HTML_TEMPLATE.replace("__DATA_JSON__", data_json).replace("__META_JSON__", meta_json)
    return html


if __name__ == "__main__":
    print("Fetching data from Google Sheets...")
    data = load_data()

    for pid, stats in data.items():
        print(f"  {pid}: {stats['total']} actions across {len(stats['by_platform'])} platforms")

    print("Generating dashboard...")
    html = generate_html(data)

    with open(DASHBOARD_PATH, "w") as f:
        f.write(html)

    print(f"Dashboard saved to {DASHBOARD_PATH}")
    print(f"Updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
