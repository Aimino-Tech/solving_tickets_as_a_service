# Day 1 — X Launch Thread (8 tweets)

---

**Tweet 1/8**
I built an open-source MCP server in Rust for Office document processing — read, write, and convert DOCX, XLSX, and PPTX files directly through AI agents.

Sub-millisecond parsing. Zero cloud dependencies. Just pure Rust speed. 🧵👇

**Tweet 2/8**
The problem with Office documents in AI workflows today:

1. You need the document content
2. You try python-docx / openpyxl
3. Memory blows up on large files
4. Formatting gets mangled
5. Conversion is slow
6. Repeat for every format

This loop costs minutes per iteration for complex docs.

**Tweet 3/8**
office-oxide-mcp fixes this with a Rust-native MCP server:

📄 Read Tier → parse DOCX/XLSX/PPTX into structured text
✏️ Write Tier → create Office documents from JSON/structured data
🔄 Convert Tier → between formats in milliseconds
🔍 Query Tier → extract specific cells, slides, sections

All through standard MCP tools.

**Tweet 4/8**
Why Rust?

• Sub-millisecond document parsing
• 10-50x faster than Python libraries
• ~5MB binary, minimal memory footprint
• No runtime dependencies
• Thread-safe, async-ready

The same document that takes 2s in python-docx parses in ~40ms.

**Tweet 5/8**
Quick start:
```bash
npx @aimino/office-oxide-mcp
```

Add to your MCP client config and your AI agent can read, edit, and create Office documents directly.

No API keys. No cloud. Just Rust and your local machine.

**Tweet 6/8**
Real use cases we're seeing:

• Legal teams extracting clauses from 100+ page DOCX contracts
• Finance parsing XLSX financial statements into structured data
• Content creators batch-converting PPTX decks to HTML
• Data pipelines transforming Excel exports into JSON

All through AI agents, all self-hosted.

**Tweet 7/8**
The architecture is simple:

```
Agent → MCP Client → office-oxide-mcp → Office file
                          ↓
                 Structured data (JSON/text)
                          ↓
                 Agent processes & responds
```

No intermediate formats. No temp files. No cloud roundtrips.

**Tweet 8/8**
This is open source — Apache 2.0. Written in Rust, built for performance.

If you've ever wished your AI agent could just *read the Excel file* or *create a PowerPoint from data* — this is your project.

⭐ [github.com/Aimino-Tech/office-oxide-mcp](https://github.com/Aimino-Tech/office-oxide-mcp)

Try it. Parse something. Ship it. 🚀
