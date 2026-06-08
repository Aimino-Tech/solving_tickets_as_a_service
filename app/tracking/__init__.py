"""Fast HTML MCP Marketing Action Tracker.

Tracks every Openclaw marketing action to:
  - Local file system at ./fast-html-mcp-server-marketing/ (always active)
  - Google Sheets spreadsheet (if GOOGLE_SHEETS_CREDENTIALS is set)

Usage:
    from app.tracking import tracker
    tracker.track_engagement("devto", "post", target_url="...")
"""

from app.tracking.fast_html_mcp_tracker import FastHtmlMCPTracker

tracker = FastHtmlMCPTracker()

__all__ = ["tracker", "FastHtmlMCPTracker"]
