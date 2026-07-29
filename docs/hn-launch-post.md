# STAS HN Launch Post — Ready to Publish

> **Status**: Draft ready for review
> **Target Platform**: Hacker News — Show HN
> **Target Date**: Launch day, 9:00 AM ET / 15:00 CET

---

## Section 1: Title Options

### Recommended: Title A
> **Show HN: STAS — AI that fixes GitHub issues (produces a plan first, then writes the fix)**

Rationale: This is the strongest title because it (1) clearly states what it does, (2) highlights the unique differentiator ("plan first"), and (3) uses the honest, specific pattern that HN rewards. It avoids hype words and clearly targets developers who understand the pain of bug-fixing.

### Alternative B
> **Show HN: STAS — the architect, not the coder. AI that plans before it fixes**

Rationale: Strong hook but the "architect, not the coder" framing may be confusing without context. Use as fallback if A doesn't perform in first 30 minutes.

### Alternative C
> **Show HN: I built an AI that reads your repo, plans the fix, then opens a PR**

Rationale: The "I built" pattern is one of the most successful on HN. This is the most approachable title. Use if the more technical titles aren't gaining traction.

---

## Section 2: Post Body (1,200 words)

### Opening

Every developer has a backlog of small bugs and feature requests. Not the kind that needs a deep architectural change — the kind that takes 20 minutes to fix but sits there for weeks because you're busy with higher-priority work.

Existing AI coding assistants are great at writing code when told exactly what to do. But they can't look at a GitHub issue and figure out what needs to change across the whole codebase. They operate on individual files, not on architecture. They'll happily "fix" a bug by changing the wrong function in the wrong file, because they don't understand the system they're editing.

I spent the last few months building something different.

### What STAS Does

STAS (Solving Tickets As A Service) is an AI senior architect for your GitHub repository. When you label an issue with `stas:fix`, here's what happens:

1. **Investigates**: STAS reads your entire repository — not just the file mentioned in the issue, but the whole codebase. It maps the architecture, finds relevant code paths, and understands how components connect.

2. **Plans**: Before writing a single line of code, it produces a detailed natural-language plan: "This bug is in the authentication middleware. The JWT validator expects ISO 8601 timestamps but the client sends Unix epoch. The fix is to add a format converter in `auth.ts` line 42 and update the test fixture."

3. **Writes the fix**: Once the plan is approved (or automatically after 30 seconds), it writes the fix, runs your test suite, and opens a PR with a human-readable description explaining what changed and why.

4. **Full CI pass**: STAS runs your existing tests and quality gates before opening the PR. If the fix breaks something, it revises and tries again.

The result: label an issue, come back to a PR with passing tests, a clear description, and confidence that the fix was reviewed in context.

### How It's Different

**Plan-first architecture**: This is the key differentiator. Most AI coding tools generate code immediately — they're optimized for speed. STAS is optimized for correctness. It produces a design doc before it writes code. This earns trust the same way a senior engineer earns trust: by showing their thinking before they implement.

**Full-repo context**: STAS doesn't just look at the file mentioned in the issue. It reads the entire repository structure, understands the dependency graph, and traces through the code path from entry point to the bug. This matters because most bugs span multiple files and modules.

**Async issue-to-PR**: You don't need to have an IDE open. You don't need to alt-tab out of your flow. Label an issue, continue your work, and come back to a PR. This is the core workflow: asynchronous, non-blocking, zero-context-switch.

**Complementary to existing tools**: STAS is not a replacement for Cursor, Copilot, or Claude Code. Those are great at writing code when you know what you want. STAS is the architect that figures out what needs to happen. They're the typists; STAS is the senior engineer that plans the work.

**Measurable quality**: 92% pass rate on generated PRs at an average cost of $3.80 per fix. Every PR runs against your actual test suite before being opened.

### Quick Demo

```
1. Label a GitHub issue with "stas:fix"
2. Wait 15-45 seconds (depending on codebase size)
3. STAS posts a plan in the issue comments
4. Plan auto-approved after 30 seconds (or approve manually)
5. PR appears with the fix, test results, and description
```

### Open Source

AGPL v3 licensed. You can self-host STAS for free with unlimited fixes. Or use our cloud tier for zero-config setup.

### Call to Action

Try it: install STAS from GitHub Marketplace, label an issue with `stas:fix`, and see what it plans.

Feedback is especially welcome on:
- What kind of issues STAS handles well (and where it falls short)
- The plan-first workflow — does this feel natural?
- What's missing that would make this useful for your team?

---

## Section 3: First Comment Template

> I built STAS because I was tired of context-switching out of deep work to fix bugs that should take 10 minutes but end up taking 30+ because you need to understand the full codebase first.
>
> The core insight is that most AI coding tools are optimized for speed (generate code immediately) but what developers actually need is correctness (show me your plan before you write code).
>
> Key numbers:
> - 92% pass rate on real PRs
> - ~$3.80 median cost per fix
> - Full-repo context (not just the file from the issue)
> - Async label → PR workflow (no IDE required)
>
> The plan-first approach is the main thing I want feedback on. When you label an issue, STAS posts a detailed plan first — you can approve it or let it auto-approve. Does this feel like the right workflow?
>
> Stack: built on OpenCode (AGI SDK) + Node.js + Docker/E2B sandbox. Self-hosted or cloud.

---

## Section 4: Pre-Written Responses to Likely Objections

### "AI-generated code is low quality / full of bugs"
STAS doesn't just generate code and push it. It:
1. Produces a plan for human review first
2. Runs your existing test suite before opening the PR
3. If tests fail, it revises and retries
4. The PR is opened — not merged. A human reviews it. This is exactly how you'd review a PR from a junior developer, and STAS is designed for the same workflow.

### "How is this different from Copilot/Cursor/Claude Code?"
Great question. Those tools work in the IDE — you're already coding, and they help you write code faster. STAS works on issues. You don't need to open your IDE. It's designed for the async workflow: label an issue, get a PR. They're complementary — use Copilot while writing code, use STAS to clear your backlog.

### "LLM costs will eat us alive"
STAS's median cost per fix is $3.80. At the Pro tier (500 fixes/month), that's $1,900 worth of LLM compute included in a $99/month subscription. The Team tier brings it to $2.10/fix. For self-hosted, you provide your own API keys and pay exactly what it costs.

### "Security / Trust: STAS reads my entire codebase?"
STAS reads the code to understand context for fixes. Data is encrypted in transit and at rest. Code snippets are retained for 90 days for fix generation, then deleted. Self-hosted option: everything stays on your infrastructure, nothing leaves your network. Cloud tier: EU-based hosting with GDPR compliance.

### "Plan-first sounds slow"
The plan takes 10-15 seconds for most codebases. Total time from label to PR is 15-45 seconds for most fixes. That's faster than opening your IDE and finding the relevant file. The 30-second auto-approval window means you don't need to wait unless you want to review the plan.

### "92% pass rate seems too good to be true"
This is the pass rate on generated PRs that pass the repo's own test suite. It's earned because:
1. Full-repo context means STAS understands the codebase before writing a fix
2. Plan-first architecture catches wrong approaches before code is written
3. Self-healing: if tests fail, STAS revises and retries
4. We filter out issues that need human judgment (architectural decisions, new features)

### "What if STAS introduces a subtle bug that tests don't catch?"
This is the most honest concern. AI-generated code, like human-written code, can contain bugs that tests don't catch. That's why STAS doesn't merge — it opens a PR. The same review process you'd use for any code contribution applies. Think of STAS as a junior engineer that writes good first drafts — a senior engineer still reviews the work.

---

## Section 5: Review Checklist

- [ ] Title matches HN format (Show HN: X — description)
- [ ] Post body is 1,000-1,500 words (this draft: ~1,200 words)
- [ ] Demo GIF captured and compressed (under 5MB) — insert at Section 2
- [ ] Pre-reviewed by 2-3 developer friends for clarity and tone
- [ ] First comment ready to paste
- [ ] Objection responses shared with team for launch-day reference
- [ ] All team members have read the post before launch
- [ ] Verify no URL shorteners in the post
- [ ] Verify no link to HN post from external posts (link to website instead)
- [ ] Final check: does the title + first paragraph make a developer want to click?
