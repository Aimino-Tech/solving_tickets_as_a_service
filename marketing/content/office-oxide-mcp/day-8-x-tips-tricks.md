# Day 8 — X Tips & Tricks Thread

---

**Tweet 1/7**
You've installed office-oxide-mcp. Now what?

Here are 7 tips to get the most out of it — from someone who's been using it daily for document automation. 🧵

**Tweet 2/7**
Tip 1: Use Excel named ranges for stable queries
Instead of "Sheet1!A1:B10", define named ranges in your spreadsheets. Your agent can query by name, and the range auto-updates when you add rows. Office-oxide-mcp resolves named ranges natively.

**Tweet 3/7**
Tip 2: Template documents are your secret weapon
Create a Word template with `{{variable}}` placeholders. Your agent calls office-oxide-mcp's create-from-template tool with JSON data. Output: a complete document in ~5ms.

Template once, generate infinitely. Great for reports, invoices, and form letters.

**Tweet 4/7**
Tip 3: Combine with other MCP servers
- web_scrape for data collection
- office-oxide-mcp for document creation
- filesystem for delivery

Your agent can scrape a webpage → extract table → create Excel report → save to shared drive. All in one automated workflow.

**Tweet 5/7**
Tip 4: Use the search tool, not full reads
Need to find "invoice #1234" across 100 documents? Don't read each one. Use the search tool — it indexes document content and returns matches with context. Way faster, way fewer tokens.

**Tweet 6/7**
Tip 5: Schedule document tasks with cron
```bash
# Every Monday at 9 AM
0 9 * * 1 cd /path && your-agent "Generate weekly report using office-oxide-mcp"
```

Office-oxide-mcp + cron = fully automated document pipeline. Set it and forget it.

**Tweet 7/7**
Tip 6: PDF merge is surprisingly useful
Collect multiple generated documents → merge into one PDF → deliver as a single file. Great for:
- Client report packages
- Batch invoice generation
- Proposal document assembly

One tool call. One output file.

⭐ github.com/Aimino-Tech/office-oxide-mcp
