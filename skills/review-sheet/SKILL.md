---
name: review-sheet
description: Review Google Sheet content quality. Triggered by "/review-sheet <url>" or "/review <url>". Fetches content from a Google Sheet spreadsheet and runs quality evaluation via OpenCode.
metadata:
  version: 1.0.0
---

# Skill: review-sheet

When the user types `/review-sheet <google-sheet-url>` or `/review <url>`, execute the content quality review pipeline:

1. **Fetch** — Read the specified Google Sheet rows (04-guerrilla-content-plan sheet at https://docs.google.com/spreadsheets/d/1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY/edit)
2. **Evaluate** — Pass content to OpenCode for quality evaluation (grammar, clarity, brand voice, persuasiveness, length)
3. **Write results** — Update Approval + Agent's Notes columns back to the sheet
4. **Reply** — Summarize the results to the user

## Usage
- `/review-sheet <sheet-url>` — review all content in that sheet
- `/review-sheet <sheet-url> --limit 10` — review only the first N items
- `/review-sheet` — review the default 04-guerrilla-content-plan sheet

## Implementation
Use the `app/review/content_review.py` module:
- `python3 -m app.review.content_review fetch --limit <n>` to fetch items
- `python3 -m app.review.content_review review --input <json>` to write results back
- `python3 -m app.review.content_review auto --limit <n>` for full pipeline
