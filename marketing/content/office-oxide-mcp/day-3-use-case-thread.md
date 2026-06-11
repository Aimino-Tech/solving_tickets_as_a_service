# Day 3 — Use Case Thread (6 tweets)

---

**Tweet 1/6**
Three real-world use cases for office-oxide-mcp that emerged from early users.

No hypotheticals. These are production workflows today. 🧵

**Tweet 2/6**
Use Case 1: Contract Analysis Pipeline

Legal team receives 500+ DOCX contracts per week. Previously: paralegals manually extract clauses → paste into spreadsheet → 40hrs/week.

Now: Claude via MCP reads each contract → extracts key clauses via `query_document` → outputs structured JSON → auto-populates tracker.

Time: 40hrs → 2hrs. Accuracy: higher.

**Tweet 3/6**
Use Case 2: Financial Report Generation

Fintech startup needs weekly XLSX reports from SQL data. Previously: data team exports CSV → opens in Excel → formats → emails → 3hrs.

Now: cron job queries database → JSON → office-oxide-mcp builds styled XLSX → auto-emailed.

All self-hosted. No data leaves the VPC.

**Tweet 4/6**
Use Case 3: PPTX → HTML Migration

Company migrating 2,000 sales decks from PowerPoint to web. Previously: manual export → reformat → 6 months.

Now: AI agent reads each PPTX via `read_document` → extracts slides + notes → generates HTML pages.

Complete in 3 days. Formatting preserved.

**Tweet 5/6**
The common thread across all three:

Every use case was previously solved with SaaS tools costing $50-500/mo each. office-oxide-mcp replaces them with a single self-hosted binary.

The cloud-free approach also means zero data exfiltration risk — critical for legal, finance, and healthcare.

**Tweet 6/6**
What use case should I build for next?

The roadmap is community-driven. Top requests so far:
• PDF output support
• Mail merge from templates
• Real-time collaboration support

What would unlock Office document workflows for you?

⭐ [github.com/Aimino-Tech/office-oxide-mcp](https://github.com/Aimino-Tech/office-oxide-mcp)
