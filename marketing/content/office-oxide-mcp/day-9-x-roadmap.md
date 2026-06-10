# Day 9 — X Roadmap & Future Plans Thread

---

**Tweet 1/7**
You've been asking what's next for office-oxide-mcp. Here's the honest roadmap — including what's shipping this month and what's further out. 🧵

**Tweet 2/7**
Shipping this month:
- Google Sheets bridge (read/write via API)
- Image extraction from Word/PDF docs
- Batch processing API (process 100s of docs in one call)
- Template library (10+ pre-built report templates)

Google Sheets is the #1 request by far. Working on it now.

**Tweet 3/7**
Next quarter:
- PowerPoint (.pptx) read/create
- Database-backed document storage (SQLite)
- Watch mode (auto-process documents in a directory)
- Web UI for template management

PowerPoint support keeps coming up — agents creating slide decks autonomously.

**Tweet 4/7**
Future experiments:
- Document diff (compare two docx files, show changes as MCP tool output)
- OCR pipeline (scan PDF → extract text → process)
- Natural language query for Excel ("what was Q3 revenue?")
- Plugin system for custom format handlers

These are ideas, not commitments. Community interest determines priority.

**Tweet 5/7**
The north star: make office-oxide-mcp the standard document layer for AI agents.

Every agent should be able to read, write, and understand Office documents. Not through fragile prompt engineering — through purpose-built MCP tools.

That's the vision. Office formats aren't going away. Agents need to talk to them.

**Tweet 6/7**
How you can shape the roadmap:
- Open a GitHub issue with your use case
- Upvote existing feature requests
- Share what you're building in Discussions
- Contribute a PR (Rust welcome, but docs/CI/community also help)

Open source means the community decides what matters.

**Tweet 7/7**
The immediate priority: make the current feature set rock-solid before adding more.

Stable, fast, well-documented tools beat a bloated feature set every time. office-oxide-mcp does 8 things well today. I'd rather keep it tight than add 20 things that work okay.

⭐ github.com/Aimino-Tech/office-oxide-mcp
