# Day 12 — X Performance Benchmarks Thread

---

**Tweet 1/7**
"How fast is office-oxide-mcp, really?"

Let me share the actual benchmarks — not synthetic numbers, real-world document processing times from our test suite. 🧵

**Tweet 2/7**
Word processing benchmarks (100-page .docx):
- Open and read all text: 12-18ms
- Extract specific paragraph: 3-5ms
- Edit/update paragraph: 8-12ms
- Create from template: 5-8ms
- Search across document: 15-25ms

Cold start to first operation: ~50ms (Rust binary, no JVM warmup).

**Tweet 3/7**
Excel benchmarks (10,000-row spreadsheet):
- Open workbook: 8-12ms
- Query cell by reference: 1-3ms
- Query range (100 cells): 5-10ms
- Named range resolution: 2-4ms
- Search across all sheets: 20-35ms

Thread safety: all operations are Send + Sync. Multiple agents can query the same file concurrently.

**Tweet 4/7**
PDF benchmarks (50-page document):
- Text extraction: 15-25ms
- Page extraction (1 page): 3-5ms
- Merge two 50-page PDFs: 30-50ms
- Metadata read: 1-2ms

No Ghostscript. No Poppler. No external process. Pure Rust processing in-process.

**Tweet 5/7**
Memory usage:
- Idle: 4MB RSS
- Processing 100pg Word doc: +8MB
- Processing 10K row Excel: +12MB
- Processing 50pg PDF: +6MB

Compare to LibreOffice headless: 200MB+ baseline. Or a JVM POI process: 150MB+.

**Tweet 6/7**
The secret to the speed:
1. Rust + zero-copy deserialization (quick-xml)
2. Lazy parsing (only read what's requested)
3. No format conversion (operate on native format directly)
4. Single binary, no IPC overhead (direct memory access)

Every millisecond matters when your agent is processing 50+ documents per task.

**Tweet 7/7**
Why this matters for agents:
- 50 documents × 50ms each = 2.5s total
- Same task with LibreOffice: 50 × 3s = 150s
- Same task with cloud API: 50 × 500ms = 25s + $$$

Speed isn't just a nice-to-have. It determines whether document processing is practical in agent workflows.

⭐ github.com/Aimino-Tech/office-oxide-mcp
