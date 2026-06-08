---
name: review-status
description: Check the status of content review and publishing pipelines. Triggered by "/review-status", "/status", or "what's pending". Shows what's in-progress, needs attention, or completed.
metadata:
  version: 1.0.0
---

# Skill: review-status

When the user types `/review-status` or asks about pending items, check and report:

## What to report
1. **Content review pipeline** — How many items in the 04-guerrilla-content-plan sheet are pending review / approved / rejected
2. **Pending publishing** — Which MCP servers have unreleased versions
3. **Any stalled items** — Tasks that need user input to proceed

## Implementation
- Check the Google Sheet for pending items (where Approval column is empty)
- Check git tags vs last published version for user's MCP repos
- Summarize everything in one clear message
