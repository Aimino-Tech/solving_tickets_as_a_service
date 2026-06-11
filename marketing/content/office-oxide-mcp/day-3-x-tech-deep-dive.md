# Day 3 — X Technical Deep Dive Thread

---

**Tweet 1/8**
Building an MCP server for Office documents taught me more about binary format parsing than I ever wanted to know.

Here's the architecture behind office-oxide-mcp — the Rust internals and design decisions. 🧵

**Tweet 2/8**
The core challenge: Office formats are ZIP archives containing XML files.
- .docx = ZIP of word/document.xml + styles + media
- .xlsx = ZIP of xl/sharedStrings.xml + worksheets
- .pdf = NOT a ZIP (different beast entirely)

Each format needs its own parser, but the MCP interface stays consistent.

**Tweet 3/8**
The Rust crate stack:
- `zip` crate for archive extraction
- `quick-xml` for XML parsing (fast, zero-copy deserialization)
- `calamine` for Excel reading (battle-tested, handles all .xlsx variants)
- `lopdf` for PDF manipulation
- `tokio` for async MCP transport

Zero JVM, zero JavaScript runtime. Pure native binary.

**Tweet 4/8**
The Excel query engine deserves special mention:
- Sheet enumeration + cell range queries
- Formula evaluation (not just cached values)
- Named range resolution
- Shared string table deduplication
- Streaming reads for large files (100K+ rows)

All exposed as MCP tools with cursor/range parameters.

**Tweet 5/8**
Word document editing via MCP:
- Read: extract text with paragraph structure
- Edit: target specific paragraphs by index or content match
- Insert: add content at position
- Create: build from template (placeholder substitution)

The template engine uses `{{placeholder}}` syntax — define templates once, have your agent fill them on demand.

**Tweet 6/8**
PDF pipeline:
- Text extraction (preserves reading order)
- Page merge/split
- Metadata read/write
- Linearized for fast opening

No Ghostscript, no Poppler, no external dependencies. Pure Rust PDF processing.

**Tweet 7/8**
Every tool follows the same pattern:
```
tool("document_path", params) → structured result
```

Your agent calls the tool, office-oxide-mcp does the heavy lifting, returns clean JSON. No raw XML parsing, no format knowledge needed from the agent.

This is what MCP was designed for: domain expertise behind a unified interface.

**Tweet 8/8**
Performance numbers (Rust binary, cold start):
- Word read (100pg): ~15ms
- Excel query (10K rows): ~8ms
- PDF text extraction (50pg): ~20ms
- Doc creation from template: ~5ms
- Binary size: ~12MB (static)

Compare to spinning up a Java/Node runtime for the same tasks. Rust delivers.

⭐ github.com/Aimino-Tech/office-oxide-mcp
