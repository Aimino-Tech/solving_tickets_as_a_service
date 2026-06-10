# Day 2 — X SaaS vs Self-Hosted Thread

---

**Tweet 1/7**
"Just use Google Docs API" — said everyone. Until you hit the pricing wall at 10K documents/month.

Let's talk about why self-hosted document processing (office-oxide-mcp) beats SaaS for agent workflows. 🧵

**Tweet 2/7**
The SaaS math for document processing:
- Google Docs API: $0.006/request → $60/10K docs
- Adobe PDF Services: $0.05/page → $500/10K pages
- DocuGen: $0.10/doc → $1K/10K docs
- Formstack: $99/mo for 500 docs

For an agent handling documents daily, these add up fast.

**Tweet 3/7**
Office-oxide-mcp costs: $0/marginal cost.
- Runs on your existing server (or same machine as your agent)
- Zero per-document fees
- Unlimited documents
- No rate limits

The only cost is the Rust binary sitting on your filesystem.

**Tweet 4/7**
But cost isn't the only factor. Latency:
- Google Docs API: 200-800ms per call
- Adobe PDF: 1-3s per operation
- Office-oxide-mcp: 5-50ms local

For an agent that needs to process 50 documents per task: SaaS = 10-40s waiting. Self-hosted = 250ms-2.5s.

**Tweet 5/7**
Data privacy matters more:
- Cloud APIs see every document
- Some train on your data (read the ToS)
- Compliance (SOC2, HIPAA, GDPR) becomes a contract negotiation

Self-hosted office-oxide-mcp: your data never touches a network socket. Period.

**Tweet 6/7**
Where SaaS still wins:
- Collaboration (multi-user real-time editing)
- Zero ops (no server management)
- Built-in auth and access control

Use SaaS for collaborative editing. Use office-oxide-mcp when your *agent* needs to process documents programmatically. Different tools for different jobs.

**Tweet 7/7**
The optimal stack:
- Google/Office 365 for humans editing docs
- office-oxide-mcp for agents processing docs

They complement each other. Your agent drafts a report with office-oxide-mcp, humans review in Google Docs. Best of both worlds.

Try it: github.com/Aimino-Tech/office-oxide-mcp
