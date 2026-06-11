# Content Angle: Engineering Story — What the Borrow Checker Taught Me

**Target platforms**: X (thread), LinkedIn (long-form), HN (comment), Reddit (r/rust)

## Core Narrative

Building a parser for Office documents in Rust forced specific architectural decisions that made the code better. The borrow checker didn't fight us — it revealed design issues we would have missed until runtime in other languages.

## Platform Drafts

### X Thread (5 tweets)

> T1: The borrow checker forced me to redesign our document parser 3 times. Each time, the code got faster and safer.
>
> T2: First attempt: shared references everywhere. A cell references a style references a font. The borrow checker said no — circular deps from conditional formatting rules.
>
> T3: Second attempt: Rc<RefCell<>> for everything. It compiled. It was slow. Too much runtime borrow-checking.
>
> T4: Third attempt: Entity DAG with IDs instead of references. The borrow checker loved it. No runtime overhead. The graph structure made cross-format propagation trivial.
>
> T5: The lesson: if the borrow checker rejects your design, it's not a borrow checker problem — it's a design problem. The compiler showed us a better architecture.
>
> T6: We open-sourced the final design. Full MCP server for Office docs in Rust. [link]

### LinkedIn Post (long-form)

> 3 weeks of building a Rust parser taught me more about architecture than 5 years of Python.
>
> We started building office-oxide-mcp with the obvious approach: parse the XML, build a DOM tree, reference styles and data shared across nodes. Standard stuff.
>
> The borrow checker rejected it. Circular references in conditional formatting rules made safe shared ownership impossible without runtime overhead.
>
> We tried Rc<RefCell<>> everywhere. It compiled. But now we had runtime borrow-checking that could panic. And the performance overhead was real — every access went through a dynamic borrow check.
>
> The breakthrough came when we redesigned around an Entity DAG with integer IDs instead of references. Every cell, style, font, and format rule gets a unique ID. Relationships are stored as ID tuples in a graph adjacency list.
>
> The result:
> - No runtime borrow checking
> - Zero-cost access (just array indexing by ID)
> - Natural cross-format reference propagation (BFS over the ID graph)
> - Thread-safe by construction (IDs are Copy, not references)
>
> The borrow checker didn't block us. It revealed that our initial design was wrong. The ID-based DAG was objectively better — and we only found it because Rust refused to compile the wrong solution.
>
> Full architecture in our repo. Open source, MIT. Link in comments.

### Reddit r/rust Post

> **Title**: The borrow checker rejected our parser architecture 3 times. Each time the result was better.
>
> We're building office-oxide-mcp — a Rust-native MCP server for Office documents. The first architecture was straightforward: parse XML into a tree, reference styles and data by pointer.
>
> The borrow checker said no. Office documents have circular dependencies in conditional formatting rules (cell A depends on cell B's format, which depends on cell A's value).
>
> We switched to Rc<RefCell<>>. It compiled. It was slow. Every access went through dynamic borrow checks. We knew it was wrong.
>
> The solution: Entity DAG with integer IDs. No references, no Rc, no RefCell. Just a flat graph where every entity has a typed ID and relationships are adjacency lists.
>
> Benefits: zero-cost access, thread-safety by construction, O(1) entity lookup, and the graph structure made cross-format propagation (XLSX → PPTX → PDF) trivial to implement.
>
> The borrow checker didn't block us — it revealed that our design was fundamentally wrong. The ID-based DAG is the right architecture for this problem, and we only found it because Rust refused to compile the wrong one.
>
> Full code + architecture docs: [link]

---

## Visual Assets Needed

1. Code evolution: Rust code showing rejected pattern → Rc<RefCell> → ID-based DAG
2. Architecture diagram: How the ID graph resolves cross-format references
3. Meme: "The borrow checker is my architecture review board"
