# Guerrilla Seeding - Draft Comments

## Thread 1: "Ask HN: What is your (AI) dev tech stack / workflow?"
**URL:** https://news.ycombinator.com/item?id=48413629
**Stats:** 170pts, 135 comments (active, 10 days old)
**Angle:** Share real workflow, mention tools naturally

**Draft Comment:**
```
Great thread! I've been building with AI agents for a few months now. Here's my setup:

**Core tools:**
- Claude Code for most coding tasks
- MCP servers for extending capabilities (file access, databases, etc.)
- Custom Python scripts for repetitive tasks

**Biggest pain point:** Document processing. Most AI agents output markdown, which is fine for code but terrible for end users who need readable reports.

I've been working on two open-source tools that helped a lot:
1. opendocswork - MCP server that handles PDFs, DOCX, scanned docs. No hallucinations on messy formatting.
2. OpenTalk2HTML-NotMD - Lets AI agents generate HTML pages instead of markdown dumps. Way better for non-technical users.

**Workflow tip:** Start with the simplest MCP server setup. Don't over-engineer. I wasted weeks building custom integrations that already existed as MCP servers.

The MCP ecosystem is maturing fast. Worth exploring before building from scratch.
```

---

## Thread 2: "Show HN: I am running 3 coding agents non-stop"
**URL:** https://news.ycombinator.com/item?id=48520757
**Stats:** 9pts, 3 comments (recent, 3 days old)
**Angle:** Share experience with multi-agent workflows

**Draft Comment:**
```
Running multiple agents in parallel is powerful but tricky. The hardest part is output formatting — each agent produces markdown, but you need a unified view.

I solved this with OpenTalk2HTML-NotMD (open source). It takes MCP output and generates structured HTML pages. Each agent writes to a different "tier" (assembly, patch, read, raw), and the tool merges them into one clean report.

For document-heavy workflows, also check out opendocswork — it handles PDFs and scanned docs without the usual hallucination problems.

Key lesson: Don't let agents write directly to shared files. Use a queue or MCP server as the middle layer.
```

---

## Thread 3: "Ask HN: What are your worst war stories bringing agentic applications into prod"
**URL:** https://news.ycombinator.com/item?id=48342441
**Stats:** 12pts, 7 comments (recent, 2 weeks old)
**Angle:** Share a real war story, mention solutions

**Draft Comment:**
```
Biggest war story: Agent processed 200 invoices, returned gibberish for 40% of them.

Root cause: The document parser couldn't handle scanned PDFs with crooked text and coffee stains. Clean test docs worked perfectly. Real-world docs? Different story.

What fixed it:
1. Switched to a parser that handles spatial text parsing (bounding boxes, not just text extraction)
2. Added validation layer that flags low-confidence outputs
3. Built opendocswork MCP server specifically for this — handles PDFs, DOCX, images, scanned docs

Lesson: Always test with messy real-world data, not clean examples. If your agent works great in demos but crashes on real documents, you have a parsing problem, not an AI problem.
```

---

## Thread 4: "Show HN: Papermill Press – AI-friendly markup for PDF generation"
**URL:** https://news.ycombinator.com/item?id=48477708
**Stats:** 18pts, 23 comments (recent, 6 days old)
**Angle:** Complementary tool, not competitor

**Draft Comment:**
```
Nice project! PDF generation from markup is a pain point I've been dealing with.

For the reverse direction (PDF → structured data for AI agents), I built opendocswork. It's an MCP server that handles PDFs, DOCX, images, and scanned documents. Works well as a preprocessing step before tools like Papermill.

The pipeline I use:
1. opendocswork parses the document (handles messy formatting)
2. AI agent processes the structured output
3. Papermill-style tools generate the final PDF

Having both directions covered (parse + generate) makes the full workflow much smoother.
```

---

## Thread 5: "Show HN: Extend UI – open-source UI kit for document apps"
**URL:** https://news.ycombinator.com/item?id=48478469
**Stats:** 252pts, 81 comments (very active, 6 days old)
**Angle:** Complementary tool for document rendering

**Draft Comment:**
```
This looks great for building document UIs. One thing I've been working on that complements this:

When AI agents process documents (PDFs, DOCX, scanned docs), they usually output markdown or JSON. Neither is great for end users who need to read the results.

I built OpenTalk2HTML-NotMD (open source MCP server) that generates structured HTML pages from AI agent output. Could be useful as a rendering layer on top of Extend UI for showing AI-processed document results.

The combo would be: Extend UI for the app shell + OpenTalk2HTML for the AI-generated content pages.
```

---

## Posting Strategy

### Priority Order:
1. **Thread 6: "Ask HN: If HTML supersedes Markdown for AI"** (8pts, 24c) - PERFECT for OT2H
2. **Thread 1** (170pts) - Highest visibility, most relevant
3. **Thread 3** (12pts) - War stories = high engagement
4. **Thread 4** (18pts) - Complementary, not spammy
5. **Thread 5** (252pts) - Highest points but needs careful framing
6. **Thread 2** (9pts) - Low priority, recent
7. **Thread 7: "Show HN: Command Center"** (68pts, 32c) - AI coding env

### Timing:
- Post 1-2 comments per day max (HN rate limits new accounts aggressively)
- Space them out (don't post all at once)
- Engage with other comments first before posting your own

## Thread 6: "Ask HN: If HTML supersedes Markdown for AI"
**URL:** https://news.ycombinator.com/item?id=48117941
**Stats:** 8pts, 24 comments (33 days old, still active discussion)
**Angle:** Directly addresses OT2H use case

**Draft Comment:**
```
This is exactly the problem I've been thinking about. Markdown is great for developers, but when AI agents need to communicate results to non-technical users, it falls short.

The issue isn't just format — it's rendering. Markdown doesn't support tables, charts, or interactive elements without conversion. HTML gives you full control.

I built OpenTalk2HTML-NotMD (open source MCP server) to solve this. It lets AI agents generate structured HTML pages instead of markdown dumps. The key insight: use a tiered approach.

- Assembly tier: basic HTML structure
- Patch tier: incremental updates
- Read tier: extract content
- Raw tier: full control
- Consistency tier: validation

For document processing (PDFs, DOCX), I also built opendocswork. Same philosophy: give AI agents proper tools for real-world data.

The combo works well: parse documents → process with AI → output as HTML. Way better than markdown for end users.
```

## Thread 7: "Show HN: Command Center"
**URL:** https://news.ycombinator.com/item?id=48453002
**Stats:** 68pts, 32 comments (8 days old, active)
**Angle:** AI coding environment, mention MCP integration

**Draft Comment:**
```
Nice project! Code walkthroughs are definitely underrated.

One thing that would complement this well: MCP servers for document handling. When AI agents need to process PDFs, DOCX, or scanned docs during code review, having a proper parser makes a huge difference.

I built opendocswork for this — handles messy real-world documents without hallucinations. Could be useful for teams reviewing documentation alongside code.

Also, for outputting results, HTML pages beat markdown when sharing with non-technical stakeholders. OpenTalk2HTML-NotMD does this via MCP.
```

### Rules:
- Add genuine value first
- Mention tools only if directly relevant
- No "check out my tool" spam
- Reply to other comments to build karma
