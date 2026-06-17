# Persona A: Technical Architect — Warmup Comments (10)
**Purpose:** Account aging phase — pure value, no product mention. Build CQS and karma.
**Target subs:** r/javascript, r/programming, r/webdev, r/LocalLLaMA

---

### 1. [r/javascript] On learning Rust for web tooling
**Context:** Discussion about learning systems languages for web dev tools.

Picked up Rust last year for a CLI tool I was building. The learning curve is real but the result is a single binary with no runtime deps. If you write tools for other developers, it's worth the investment. Your users will thank you for the easy install.

### 2. [r/programming] Code review habits
**Context:** Thread about what makes effective code reviews.

I review code in two passes now. First pass is logic and architecture — does this actually solve the problem. Second pass is implementation details — naming, error handling, edge cases. Separating them made my reviews way more useful. Took the idea from a Google engineering blog.

### 3. [r/webdev] Graceful degradation approach
**Context:** Building for users with JavaScript disabled or slow connections.

I shifted from progressive enhancement to resilient defaults. The page works without JS, then layers on interactivity. Caught 12% of my users who had JS issues from extensions or network problems. Simple approach that makes a real difference.

### 4. [r/LocalLLaMA] VRAM usage patterns
**Context:** Optimizing model memory usage for local inference.

Watching VRAM usage with `nvidia-smi` during inference taught me a lot. Context processing spikes memory, generation settles down. If you're hitting OOM, try reducing context length before switching to a smaller model. Saved me from downgrading my setup.

### 5. [r/javascript] NPM workspaces monorepo setup
**Context:** Questions about organizing monorepos with npm.

Switched from Lerna to npm workspaces last year. Simpler config, one less dependency, works with everything we need. The `--workspace` flag handles most use cases. For basic monorepos you probably don't need a dedicated tool anymore.

### 6. [r/programming] Technical documentation approach
**Context:** How to write docs that developers actually read.

I started writing docs as decision records instead of feature lists. Why we chose X over Y, what tradeoffs we accepted, what failed before. Developers read those way more than API reference pages. Our onboarding time dropped from days to hours.

### 7. [r/webdev] Image optimization pipeline
**Context:** Tools and workflows for optimizing web images.

Set up an automated pipeline that converts images to WebP with AVIF fallback. Saves about 60% bandwidth compared to JPEG. The build step adds 2 seconds to deployment but cuts page weight significantly. Worth automating early.

### 8. [r/LocalLLaMA] Running inference on CPU
**Context:** Making local LLMs work without a GPU.

Got llama.cpp running on an AMD laptop just to see if it's usable. With Q4 quantization and 8 threads I get about 4 tokens per second on a Ryzen 7. Slow but functional for small batch processing. For occasional use it beats paying API costs.

### 9. [r/javascript] Debugging async memory leaks
**Context:** Tracking down memory leaks in Node.js applications.

Spent two weeks debugging a memory leak in a long-running Node process. The culprit was an unresolved promise holding references to closure variables. Using Chrome DevTools heap snapshots finally revealed it. The `--inspect` flag is your best friend for this.

### 10. [r/programming] Terminal productivity
**Context:** Favorite terminal tools and workflows.

My terminal setup evolved a lot over the years. tmux for session management, fzf for fuzzy search everywhere, ripgrep instead of grep. Small tools that compound into huge time savings. Each one took an afternoon to learn and saves hours monthly.
