# Day 9 — X Roadmap & Future Plans Thread

---

**Tweet 1/7**
What's coming next for office-oxide-mcp? Here's the roadmap I'm sharing publicly — planned features, estimated timelines, and how you can influence the优先级. 🧵

**Tweet 2/7**
v0.2 — PDF Power (shipping this week)
- PDF write/create from structured data
- PDF form filling (fill in PDF forms programmatically)
- PDF image extraction
- Improved text extraction with layout preservation

The most requested feature by a wide margin. PDF is becoming the primary format for agent document workflows.

**Tweet 3/7**
v0.3 — Template Engine (2 weeks)
- Create DOCX/XLSX templates with `{{variable}}` syntax
- Template library with reusable components (headers, footers, cover pages)
- Conditional sections (if/else in templates)
- Template preview before generation

Goal: let non-technical team members create templates that agents fill automatically.

**Tweet 4/7**
v0.4 — Streaming & Scale (3 weeks)
- Streaming reads for XLSX files >100MB
- Memory-mapped PDF parsing for large documents
- Batch processing API (process 100 files in one call)
- Parallel document operations

Target: handle enterprise-scale document workloads without breaking a sweat.

**Tweet 5/7**
v0.5 — Format Expansion (4 weeks)
- Google Docs ↔ Office format bridge
- Markdown → DOCX/PDF conversion pipeline
- HTML → Office format (for web-to-document workflows)
- Image → PDF (scan-to-document)

Covering the full document lifecycle, from web content to final deliverable.

**Tweet 6/7**
Beyond v0.5:
- MCP directory auto-submit integration
- Usage analytics dashboard (self-hosted, privacy-first)
- Plugin system for custom format handlers
- WebAssembly build for browser-based document processing

The goal is to make office-oxide-mcp the standard agent interface for all document operations.

**Tweet 7/7**
This roadmap is driven by community feedback. Every GitHub issue, Discussion post, and PR shapes what gets built next.

If there's a feature you need, open an issue or upvote an existing one. The features with the most community demand get prioritized.

Next stop: v0.2 with PDF write support. Shipping this week.

⭐ github.com/Aimino-Tech/office-oxide-mcp/discussions
