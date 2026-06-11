# office-oxide-mcp Content Kit — Index

**Intended workspace path**: `marketing/content/odw/`
**Campaign**: Multi-platform organic launch (30 days)
**Product**: office-oxide-mcp (Rust-native MCP server for Office documents)

## Content Files

| File | Angles Covered | Primary Platforms | Status |
|------|---------------|-------------------|--------|
| `benchmark-rust-vs-python.md` | Performance, speed comparison | X, LinkedIn, Reddit, HN | Ready |
| `architecture-coherence-engine.md` | Architecture, Entity DAG, BFS | LinkedIn, Reddit, X, HN | Ready |
| `pdf-form-filling-deep-dive.md` | PDF, AcroForm, XFA, scanned | Reddit, X, HN | Ready |
| `mcp-ecosystem-positioning.md` | MCP ecosystem, AI toolchains | X, LinkedIn, HN | Ready |
| `engineering-story-borrow-checker.md` | Rust, borrow checker, design | X, LinkedIn, Reddit | Ready |

## Content Angles Map

| Angle | Has Content? | Priority | Notes |
|-------|-------------|----------|-------|
| PDF form filling | ✅ Existing (odw-pdf-filling-comments.md) + new deep-dive | High | Extend existing Reddit pipeline |
| Performance benchmark | ✅ New | High | Core differentiator, visual content needed |
| Architecture (Coherence Engine) | ✅ New | High | Technical credibility signal |
| MCP ecosystem | ✅ New | Medium | Industry positioning |
| Engineering story (Rust) | ✅ New | Medium | Developer relatability |
| Open source contribution | ❌ Not drafted | Medium | Drive GitHub stars |
| Multi-format (XLSX+DOCX+PPTX+PDF) | ❌ Not drafted | Low | Feature showcase |
| Rust vs Python hot take | Covered by benchmark | Low | X-only content |

## Visual Assets Needed

- Benchmark bar chart: Rust vs Python parsing speed (1200×627px PNG)
- Architecture diagram: Entity DAG with BFS propagation flow
- MCP protocol flow diagram: Agent → MCP Server → Document
- Code evolution diagram: wrong → Rc<RefCell> → ID-based DAG
- PDF form tech comparison: AcroForm vs XFA vs Scanned overlay
- Rust vs Python cold start comparison (bar chart)

## Existing Content (not migrated to this kit)

From `marketing/content/opentalk2html-notmd/`: 9 content files for sibling product — useful as structural reference.
From `marketing/content/odw-pdf-filling-comments.md`: 1 content file + v2 — extend with multi-angle content.

## Cross-Platform Mapping

| Content | X Format | LinkedIn Format | HN Format | Reddit Format |
|---------|---------|----------------|-----------|---------------|
| Benchmark | Thread (5 tweets) + screenshot | Carousel (PDF) | Show HN / technical comment | Text post with data |
| Architecture | Thread (4 tweets) | Long-form post | Deep comment | Technical deep-dive |
| PDF forms | Thread (6 tweets) | Long-form post | Comment | Extended comment |
| MCP ecosystem | Thread (3 tweets) hot take | Industry commentary | Discussion | r/MCP post |
| Rust story | Thread (6 tweets) | Long-form post | Comment | r/rust post |

## Integration with Google Sheet

Google Sheet ID: `1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY`
Tab: "04-guerrilla-content-plan" (61 Approved + 522 Draft)
Add new rows for each office-oxide-mcp content piece with:
- Content ID (linked to file in this kit)
- Platform
- Scheduled date/time
- Angle
- Status (Draft / Approved / Posted / Engaged)

## Key Rules

- 90/10 ratio on ALL platforms
- No LLM-generated text on HN (dang's 2026 rule)
- Links in LinkedIn post body = penalty (use first comment)
- All posts from personal LinkedIn profile, not company page
- Cross-platform spacing: 48+ hours minimum for same topic
