# Day 1 — X Launch Announcement Thread

---

**Tweet 1/8**
I built an open-source MCP server for Office documents — Word, Excel, PDF, all from your AI agent's toolbelt.

No cloud APIs. No monthly subscriptions. Just your files, your machine, and an agent that can read and write documents. 🧵👇

**Tweet 2/8**
The problem with document automation today:
1. You need a SaaS for every format (Word? $30/mo. Excel? Another tool. PDF? Third one.)
2. Your data leaves your network
3. Each tool has its own API, auth, rate limits

office-oxide-mcp fixes this with one MCP server for all Office formats.

**Tweet 3/8**
What office-oxide-mcp can do:
📄 Read and extract text from Word docs, PDFs
📊 Query Excel spreadsheets by cell, range, sheet
✏️ Edit Word documents, update cells, merge PDFs
🔍 Search across documents
📝 Create new documents from templates

All via MCP tools your agent can discover and use.

**Tweet 4/8**
Built with Rust (for performance) + published on cargo/npm/PyPI:
```bash
npx office-oxide-mcp
```

Add to your MCP config and your AI agent can work with Office documents directly. No API keys. No cloud dependency.

**Tweet 5/8**
Why Rust?
- Sub-millisecond document parsing
- Memory-safe by default
- Single binary deploy (no JVM, no Node runtime needed)
- Cross-platform from day one

The cold start to first document read is ~50ms. Try that with a cloud API.

**Tweet 6/8**
Why self-hosted document processing matters:
- Your contracts, spreadsheets, and reports never leave your network
- No per-document costs (great for high-volume workflows)
- Offline-capable — your agent works without internet
- Full control over formats, versions, and dependencies

**Tweet 7/8**
Supported formats:
- Word (.docx) — read, edit, create
- Excel (.xlsx) — query cells, ranges, sheets
- PDF — extract text, merge, split
- CSV/TSV — native support
- Markdown → Office conversion

More formats coming based on community requests.

**Tweet 8/8**
office-oxide-mcp is open source (MIT). If you've ever wanted your AI agent to draft reports, query spreadsheets, or process invoices — this is your tool.

⭐ github.com/Aimino-Tech/office-oxide-mcp
📦 `npx office-oxide-mcp`

Try it. Break it. Automate something. 🚀
