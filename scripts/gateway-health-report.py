"""Generate self-contained HTML monitoring dashboard from gateway runtime state.

Usage:
    python scripts/gateway-health-report.py

Output:
    ~/.hermes/monitoring/dashboard.html
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from gateway.status import read_runtime_status
from cron.jobs import load_jobs
from hermes_constants import get_hermes_home


def _fmt_ago(iso_str: str | None) -> str:
    if not iso_str:
        return "never"
    try:
        dt = datetime.fromisoformat(iso_str)
        now = datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = now - dt
        secs = int(delta.total_seconds())
        if secs < 0:
            return "now"
        if secs < 60:
            return f"{secs}s ago"
        if secs < 3600:
            return f"{secs // 60}m ago"
        if secs < 86400:
            return f"{secs // 3600}h ago"
        return f"{secs // 86400}d ago"
    except (ValueError, TypeError, OSError):
        return iso_str or "unknown"


def _parse_memory_logs(log_path: Path) -> list[dict]:
    """Parse agent.log for [MEMORY] lines and extract RSS readings."""
    readings: list[dict] = []
    if not log_path.exists():
        return readings
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return readings
    pattern = re.compile(
        r"\[MEMORY\]\s*(?:\w+\s+)?rss=(\d+)MB\s+gc=\(([^)]+)\)\s+threads=(\d+)\s+uptime=(\d+)s"
    )
    for line in text.splitlines():
        m = pattern.search(line)
        if m:
            readings.append({
                "rss_mb": int(m.group(1)),
                "gc": m.group(2),
                "threads": int(m.group(3)),
                "uptime_s": int(m.group(4)),
            })
    return readings


def _build_html(
    gw_state: dict | None,
    memory_readings: list[dict],
    cron_jobs: list[dict],
    now_iso: str,
) -> str:
    gateway_state = (gw_state or {}).get("gateway_state", "unknown")
    pid = (gw_state or {}).get("pid")
    start_time = (gw_state or {}).get("start_time")
    active_agents = (gw_state or {}).get("active_agents", 0)
    platforms = (gw_state or {}).get("platforms", {}) or {}
    updated_at = (gw_state or {}).get("updated_at")

    gateway_label = {
        "running": "Running",
        "stopped": "Stopped",
        "starting": "Starting",
        "startup_failed": "Failed",
        "failed": "Failed",
    }.get(gateway_state, gateway_state.capitalize())

    gateway_class = {
        "running": "ok",
        "starting": "warn",
        "stopped": "muted",
        "startup_failed": "err",
        "failed": "err",
    }.get(gateway_state, "muted")

    # Uptime from clock ticks
    uptime_str = ""
    if start_time and pid:
        try:
            stat_path = Path(f"/proc/{pid}/stat")
            if stat_path.exists():
                fields = stat_path.read_text(encoding="utf-8").split()
                boot_ticks = int(fields[21])
                clk_tck = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
                now_ticks = _boot_time_ticks() + int(time_ticks_since_boot())
            uptime_str = _format_uptime(None)
        except (OSError, ValueError, AttributeError, KeyError):
            pass

    # Try to compute uptime from /proc/uptime
    uptime_seconds = 0
    if pid:
        try:
            proc_stat = Path(f"/proc/{pid}/stat")
            if proc_stat.exists():
                fields = proc_stat.read_text(encoding="utf-8").split()
                start_ticks = int(fields[21])
                with open("/proc/uptime", encoding="utf-8") as f:
                    uptime_seconds = int(float(f.read().split()[0]))
                hertz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
                proc_uptime = uptime_seconds - (start_ticks / hertz)
                uptime_str = _format_uptime(int(proc_uptime))
            else:
                uptime_str = "N/A"
        except (OSError, ValueError, IndexError, AttributeError, KeyError):
            uptime_str = "N/A"
    else:
        uptime_str = "N/A"

    # Memory trend
    last12 = memory_readings[-12:] if memory_readings else []
    max_rss = max((r["rss_mb"] for r in last12), default=0)
    min_rss = min((r["rss_mb"] for r in last12), default=0)
    avg_rss = int(sum(r["rss_mb"] for r in last12) / len(last12)) if last12 else 0

    # Cron summary
    total_jobs = len(cron_jobs)
    enabled_jobs = sum(1 for j in cron_jobs if j.get("enabled", True))
    error_jobs = sum(1 for j in cron_jobs if j.get("last_status") == "error")
    last_run_ats = [
        j.get("last_run_at") for j in cron_jobs if j.get("last_run_at")
    ]
    last_cron_run = max(last_run_ats) if last_run_ats else None

    # Platform rows
    platform_rows = ""
    for pname, pinfo in sorted(platforms.items()):
        pstate = pinfo.get("state", "unknown")
        err_count = pinfo.get("error_code", "")
        err_msg = pinfo.get("error_message", "")
        pupdated = pinfo.get("updated_at")
        pecount = 1 if err_count else 0
        platform_rows += f"""\
          <tr>
            <td>{pname}</td>
            <td class="state-{pstate}">{pstate}</td>
            <td>{pecount}</td>
            <td>{_fmt_ago(pupdated)}</td>
          </tr>
        """
    if not platform_rows:
        platform_rows = '<tr><td colspan="4" class="muted">No platform data</td></tr>'

    # Memory bar segments
    bar_segments = ""
    if last12:
        max_bar = max_rss if max_rss > 0 else 1
        for i, r in enumerate(last12):
            pct = (r["rss_mb"] / max_bar) * 100
            label = f"{r['rss_mb']}MB"
            bar_segments += f"""\
          <div class="bar-seg" style="height:{pct}%" title="{label}">
            <span class="bar-label">{label}</span>
          </div>
        """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Hermes Gateway Health</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,sans-serif;
    background:#0d1117; color:#c9d1d9; padding:24px; line-height:1.5;
  }}
  h1 {{ font-size:1.6rem; margin-bottom:20px; color:#f0f6fc; }}
  h2 {{ font-size:1.1rem; margin:20px 0 10px; color:#8b949e; text-transform:uppercase; letter-spacing:0.5px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }}
  .card {{
    background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px;
    position:relative;
  }}
  .card .label {{ font-size:0.75rem; color:#8b949e; text-transform:uppercase; }}
  .card .value {{ font-size:1.4rem; font-weight:600; margin-top:4px; }}
  .ok {{ color:#3fb950; }}
  .warn {{ color:#d29922; }}
  .err {{ color:#f85149; }}
  .muted {{ color:#8b949e; }}
  table {{ width:100%; border-collapse:collapse; margin-top:8px; }}
  th,td {{ text-align:left; padding:8px 10px; border-bottom:1px solid #21262d; font-size:0.9rem; }}
  th {{ color:#8b949e; font-weight:500; text-transform:uppercase; font-size:0.75rem; }}
  .state-connected {{ color:#3fb950; }}
  .state-disconnected {{ color:#8b949e; }}
  .state-error {{ color:#f85149; }}
  .bar-chart {{
    display:flex; align-items:flex-end; gap:3px; height:120px; margin-top:8px;
    padding:4px 0;
  }}
  .bar-seg {{
    flex:1; background:#1f6feb; border-radius:2px 2px 0 0; position:relative;
    min-height:4px; transition:background 0.2s;
  }}
  .bar-seg:hover {{ background:#58a6ff; }}
  .bar-label {{
    position:absolute; bottom:-18px; left:50%; transform:translateX(-50%);
    font-size:0.6rem; color:#8b949e; white-space:nowrap;
  }}
  .stats-row {{ display:flex; gap:20px; margin-top:10px; font-size:0.85rem; color:#8b949e; }}
  .stats-row span {{ background:#21262d; padding:2px 8px; border-radius:4px; }}
  .updated {{ margin-top:24px; font-size:0.8rem; color:#484f58; text-align:right; }}
  .no-data {{ font-style:italic; color:#484f58; padding:16px 0; }}
</style>
</head>
<body>
<h1>Hermes Gateway Health</h1>

<div class="grid">
  <div class="card">
    <div class="label">Gateway State</div>
    <div class="value {gateway_class}">{gateway_label}</div>
    <div style="margin-top:6px;font-size:0.85rem;color:#8b949e;">
      PID: {pid or 'N/A'} &middot; Uptime: {uptime_str}
    </div>
  </div>
  <div class="card">
    <div class="label">Active Agents</div>
    <div class="value">{active_agents}</div>
  </div>
  <div class="card">
    <div class="label">Active Cron Jobs</div>
    <div class="value">{enabled_jobs}<span style="font-size:0.9rem;color:#8b949e;">/{total_jobs}</span></div>
    <div style="margin-top:6px;font-size:0.85rem;">
      <span class="err">{error_jobs} error</span>
      &middot; Last run: {_fmt_ago(last_cron_run)}
    </div>
  </div>
  <div class="card">
    <div class="label">Last Updated</div>
    <div class="value" style="font-size:1rem;">{_fmt_ago(updated_at)}</div>
    <div style="margin-top:6px;font-size:0.75rem;color:#484f58;">{updated_at or ''}</div>
  </div>
</div>

<h2>Platform Health</h2>
<table>
  <thead><tr><th>Platform</th><th>State</th><th>Errors</th><th>Last Updated</th></tr></thead>
  <tbody>{platform_rows}</tbody>
</table>

<h2>Memory RSS Trend (last 12 readings)</h2>
<div class="bar-chart">
  {bar_segments or '<div class="no-data">No [MEMORY] readings in agent.log</div>'}
</div>
<div class="stats-row">
  <span>Max: <strong>{max_rss}MB</strong></span>
  <span>Min: <strong>{min_rss}MB</strong></span>
  <span>Avg: <strong>{avg_rss}MB</strong></span>
  <span>Samples: <strong>{len(last12)}</strong></span>
</div>

<div class="updated">Generated at {now_iso}</div>
</body>
</html>"""
    return html


def _format_uptime(seconds: int | None) -> str:
    if seconds is None:
        return "N/A"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    if seconds < 86400:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        return f"{h}h {m}m"
    d = seconds // 86400
    h = (seconds % 86400) // 3600
    return f"{d}d {h}h"


def _boot_time_ticks() -> int:
    try:
        with open("/proc/stat", encoding="utf-8") as f:
            for line in f:
                if line.startswith("btime "):
                    return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return 0


def time_ticks_since_boot() -> int:
    try:
        with open("/proc/uptime", encoding="utf-8") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError, IndexError):
        return 0


def main() -> None:
    hermes_home = get_hermes_home()
    monitoring_dir = hermes_home / "monitoring"
    monitoring_dir.mkdir(parents=True, exist_ok=True)
    output_path = monitoring_dir / "dashboard.html"

    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Gateway runtime status
    gw_state = read_runtime_status()

    # 2. Memory readings from agent.log
    agent_log = hermes_home / "logs" / "agent.log"
    memory_readings = _parse_memory_logs(agent_log)

    # 3. Cron jobs
    try:
        cron_jobs = load_jobs()
    except Exception:
        cron_jobs = []

    # 4. Build HTML
    html = _build_html(gw_state, memory_readings, cron_jobs, now_iso)

    # 5. Write output
    output_path.write_text(html, encoding="utf-8")

    result = {
        "output": str(output_path),
        "wakeAgent": False,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
