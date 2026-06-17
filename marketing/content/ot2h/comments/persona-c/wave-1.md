# Persona C: Curious Enthusiast — Wave 1 (25 comments)
**Voice:** Self-taught dev exploring the AI ecosystem. Excited, experimental, shares discoveries.
**Target subs:** r/MCP, r/ClaudeAI, r/selfhosted, r/coolgithubprojects, r/LocalLLaMA
**90/10 rule:** 22 pure value + 3 soft-promo

---

## Pure Value Comments (22)

### 1. [r/MCP] Discovering MCP servers
**Context:** Someone new to MCP asking what servers they should try.

I only found out about MCP servers last month and it's been a rabbit hole. Started with web search and file system servers. The coolest thing is how they chain together — search the web, grab content, process it, all through the same protocol. Makes my agent way more useful.

### 2. [r/MCP] Setting up first MCP server
**Context:** Guide or questions about configuring MCP servers.

Getting my first MCP server running was easier than I expected. JSON config file, add to Claude Desktop settings, restart. Felt like magic when the agent just started using it. The npx-based ones are the simplest to try out.

### 3. [r/MCP] Combining multiple MCP servers
**Context:** Using more than one MCP server in the same workflow.

Running 4 MCP servers together now and they don't conflict at all. The agent figures out which tool from which server to use. Had one server for data, one for processing, one for output. Felt like assembling a toolkit.

### 4. [r/MCP] Self-hosted MCP servers
**Context:** Running MCP servers locally vs using cloud services.

I was surprised how many MCP servers run completely locally. No API keys, no cloud dependencies. Just pull a Docker image and point your config at localhost. Self-hosting MCP tools feels like having superpowers without subscriptions.

### 5. [r/ClaudeAI] Claude + tool use patterns
**Context:** Getting Claude to actually use tools effectively.

Getting Claude to use tools well takes some trial and error. I found being specific in the tool descriptions helps a lot. Also naming tools with clear verbs helps Claude pick the right one. "search_docs" works better than "documentationQuery."

### 6. [r/ClaudeAI] Generating HTML with Claude
**Context:** Using Claude to create web pages and formatted content.

Claude is surprisingly good at structuring content. I've been using it to plan page layouts and write copy. Then I pass that structure to a renderer and get a styled page back. Way better than asking Claude to write raw HTML which always has issues.

### 7. [r/ClaudeAI] Reducing token usage
**Context:** Making Claude conversations more efficient.

I noticed my token usage dropped a lot when I stopped having Claude generate raw markup. Letting a tool handle the formatting saves a ton of context. Now my conversations are mostly content decisions and the output tools handle presentation.

### 8. [r/selfhosted] Self-hosted AI tools
**Context:** Building a self-hosted AI stack.

Started building a fully self-hosted AI stack this year. Local LLM for reasoning, local servers for tools, everything on my own hardware. The setup phase is intimidating but once it's running there's something satisfying about zero dependence on external APIs.

### 9. [r/selfhosted] Docker for AI workflows
**Context:** Containerizing AI tools for easy deployment.

Docker makes trying new AI tools so much easier. Pull image, run container, test it. If it doesn't work, delete the container and try something else. No dependency hell, no system pollution. I probably try 3x more tools now just because Docker removes the friction.

### 10. [r/selfhosted] Template engines for static sites
**Context:** Generating static content from templates.

I got into template engines recently and I'm hooked. Write one layout file, then each page is just content. Want to redesign? Change one file, rebuild everything. So much better than copying HTML between pages like I used to do.

### 11. [r/coolgithubprojects] Finding hidden gems
**Context:** Discovering interesting open source projects.

Found an MCP server that generates HTML from templates and it solved a problem I didn't even know I had. That's the thing about the MCP ecosystem — there are tools for things you haven't thought to automate yet. Browsing GitHub for MCP projects is my new hobby.

### 12. [r/coolgithubprojects] Local-first tools
**Context:** Tools that work completely offline.

I'm on a local-first kick right now. Anything that runs without internet gets bonus points. Found a few tools that process data entirely on my machine and I love the privacy aspect. Plus no latency, no API costs, just instant results.

### 13. [r/LocalLLaMA] Getting started with local models
**Context:** First steps with running LLMs locally.

Finally set up Ollama on my machine last week. Running Llama 3.2 3B and it's surprisingly fast on my laptop. Not as smart as Claude but for simple tasks like summarizing or generating template structures it works great. And it's free!

### 14. [r/LocalLLaMA] Open source AI pipeline
**Context:** Building a pipeline using only open source AI tools.

My whole pipeline is open source now. Ollama for the model, various MCP tools for processing, Docker for deployment. The barrier to entry for open source AI has dropped so much in the last year. You can do real work with zero proprietary tools.

### 15. [r/LocalLLaMA] Model comparisons
**Context:** Comparing different local models for specific tasks.

I've been testing local models for generating structured content like HTML. Qwen2.5-Coder 7B is my favorite so far. DeepSeek-Coder is good too but the model size makes it harder to run. Qwen feels like the sweet spot for capability vs resource usage.

### 16. [r/MCP] MCP ecosystem growing fast
**Context:** Discussion about the state of the MCP ecosystem.

The MCP ecosystem is growing so fast I can barely keep up. Every week there are new servers for different use cases. The format/output category is interesting — servers that don't just fetch data but actually create something. Feels like the missing piece.

### 17. [r/ClaudeAI] Prompt engineering for structured output
**Context:** Getting Claude to produce consistent structured output.

I learned that telling Claude "output in this format" and then passing to a tool works better than trying to get perfect output in one shot. The tool handles cleanup. Prompt engineering becomes about content quality instead of format compliance.

### 18. [r/ClaudeAI] Claude Desktop vs API
**Context:** Comparing usage patterns between desktop app and API.

I use both Claude Desktop and the API for different things. Desktop for interactive work, API for automations. The MCP setup works the same in both which is nice. Desktop is better for exploring, API for production.

### 19. [r/selfhosted] Automating weekly tasks
**Context:** Setting up automated recurring tasks on self-hosted infrastructure.

I set up cron jobs to run weekly tasks and it feels like having a personal assistant. One generates a status report, another backs up my databases. They run at 6am on Sunday and I wake up to fresh reports. Took an afternoon to set up, saves hours every week.

### 20. [r/coolgithubprojects] Open source document generation
**Context:** Discovering open source alternatives to paid document/report tools.

Found out you can generate professional looking documents with open source tools and it blew my mind. No more paying per-document fees or dealing with SaaS limits. Self-hosted, customizable templates, runs locally. Why do more people not talk about this?

### 21. [r/MCP] MCP + cron jobs
**Context:** Combining MCP tools with scheduled automation.

Using MCP tools in cron jobs is something I don't see talked about enough. Schedule an agent task that uses MCP tools and get results delivered to you. I have one that generates a weekly roundup as a styled page. Runs fully unattended.

### 22. [r/ClaudeAI] Learning by building
**Context:** How to learn AI tooling effectively.

Best way I've learned this stuff is by building small projects. Pick one thing you want to automate and figure out the tooling for that specific task. Trying to learn everything at once is overwhelming. One small win leads to another.

---

## Soft-Promo Comments (3)

### 23. [r/MCP] PROMO — HTML generation MCP server
**Context:** Someone sharing their MCP server setup and asking what others use.

I found this MCP server that generates styled HTML from templates. The agent describes what it wants, the server builds the page. Handles templates, CSS, everything. Way cleaner than having the agent try to write raw HTML which always ends up messy.

### 24. [r/ClaudeAI] PROMO — Render tool for Claude
**Context:** Discussion about tools that help Claude produce formatted output.

Recently started using a rendering tool with Claude. I just tell Claude what content I want and the tool turns it into a proper HTML page. Makes the output look way better than Claude's raw HTML attempts. Nice for prototyping pages.

### 25. [r/coolgithubprojects] PROMO — Template rendering tool
**Context:** Sharing cool open source projects people should check out.

Came across an interesting npm package that renders HTML from templates via MCP. Self-hosted, works with any MCP client, generates pages in like 200ms. If you're into agent tooling it's worth a look. The template system is doT.js based and easy to customize.
