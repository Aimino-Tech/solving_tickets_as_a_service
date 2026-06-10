"""Marketing action trackers.

Tracks every marketing action to:
  - Local file system (always active)
  - Google Sheets spreadsheet (if GOOGLE_SHEETS_CREDENTIALS is set)

Usage:
    from app.tracking import tracker
    tracker.track_engagement("devto", "post", target_url="...")
"""

from app.tracking.fast_html_mcp_tracker import FastHtmlMCPTracker
from app.tracking.office_oxide_mcp_tracker import OfficeOxideMCPTracker

tracker = FastHtmlMCPTracker()
office_oxide_tracker = OfficeOxideMCPTracker()

__all__ = ["tracker", "office_oxide_tracker", "FastHtmlMCPTracker", "OfficeOxideMCPTracker"]
