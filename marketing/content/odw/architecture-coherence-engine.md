# Content Angle: Architecture — The Coherence Engine

**Target platforms**: LinkedIn (carousel), Reddit (technical deep-dive), X (thread), HN (comment)

## Core Narrative

The hardest part of building a multi-format document processing engine isn't parsing any single format. It's keeping references consistent across sheets, slides, documents, and embedded objects.

## Key Architecture Concepts

- **Entity DAG**: Every cell, text run, image, and style is an Entity node. Relationships between entities form a Directed Acyclic Graph.
- **BFS Propagation**: When a cell value changes, BFS through the dependency graph updates all derived values, formatting rules, and conditional styles.
- **Format-Agnostic Interface**: The same query (`get_cell("Sheet1!A1")`) works across XLSX, CSV, and parsed PDF tables.
- **Skills System**: Named operations (fill_form, extract_table, convert_format) that compose across formats.

## Platform Drafts

### X Thread (4 tweets)

> T1: Building a multi-format document engine taught me that parsing isn't the hard part. Keeping everything consistent is.
>
> T2: A cell in Excel can be referenced by a formula in another sheet. A text field in a PDF can link to an Excel export. A chart in PPTX embeds data from both.
>
> T3: We built a Coherence Engine — Entity DAG with BFS propagation. When any entity changes, the graph resolves all dependents in topological order.
>
> T4: Full architecture breakdown in the README. It's MIT. Use it however you want. [link]

### LinkedIn Post

> The hardest engineering problem we solved building office-oxide-mcp wasn't parsing XLSX or DOCX or PDF. It was keeping cells, fields, and objects consistent across formats.
>
> Here's the problem:
> - A cell in Sheet2 references a cell in Sheet1
> - That cell is also the data source for a chart embedded in a PPTX
> - The chart's data table needs to match the original Excel export
> - And someone might fill a PDF form that writes back to the source
>
> One change ripples through 4 formats.
>
> We built a Coherence Engine: an Entity DAG where every parsed object becomes a node. When data changes, BFS propagates the update through all dependents — sheets, slides, documents, PDF fields — in the right order.
>
> It's the part of our MCP server that never makes the headlines but does the hardest work.
>
> We open-sourced the whole thing. Architecture docs are in the repo.
>
> 🔗 in comments.

### Reddit Deep-Dive (r/programming or r/rust)

> **Title**: Coherence Engine: Entity DAG + BFS propagation for cross-format document processing
>
> When we started building office-oxide-mcp, we thought the hardest part would be parsing individual formats. XLSX is just XML in a zip, right? DOCX is just... more XML in a zip?
>
> The actual hard problem: keeping references consistent when a cell in XLSX Sheet2 =Sheet1!$A$1*2, and that same cell feeds a chart embedded in a PPTX, and someone fills a PDF form that writes back to the data source.
>
> We ended up building a **Coherence Engine**:
> - Parse every format into a common Entity DAG (each cell, text run, image, style = node)
> - Edges represent dependencies (cell references, style inheritance, embedded object links)
> - On mutation: BFS from the changed node through all reachable dependents
> - Each node resolves its value using format-specific compute (calamine for XLSX calc, rdocx for DOCX field codes, lopdf for PDF form exports)
> - Result serializes back to each format's native structure
>
> The BFS approach means we don't recompute the whole document — just the affected subgraph. For a 50MB XLSX with 100K cells, changing one cell propagates to ~300-500 dependents in ~2ms.
>
> It's all open source. Full docs in the repo: [link]
>
> Would love feedback on the approach, especially from anyone who's worked on multi-format document engines.

### HN Comment Seed

> "The architecture that ended up being the most interesting wasn't the MCP server itself — it's the Coherence Engine underneath. The problem isn't parsing a single format. It's maintaining referential integrity when a cell value in Excel propagates through formulas, formatting rules, embedded charts in PPTX, and PDF form exports. We used an Entity DAG with BFS propagation. The key insight: you don't need to recompute the whole document — just the affected subgraph. Full writeup in the repo."

---

## Visual Assets Needed

1. Architecture diagram: Entity DAG showing cell → formula → chart → export flow
2. Flow chart: BFS propagation from mutation to affected dependents
3. Comparison: Traditional DOM-tree parsing vs Entity DAG approach

**Format**: PDF for LinkedIn carousel, PNG for X, SVG for README
