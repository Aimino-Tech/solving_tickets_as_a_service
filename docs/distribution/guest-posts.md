# STAS Guest Post Program

Three guest post plans, one per platform, each with a working title, angle, outline, and the target facts to include. All copy leads with evidence and stays honest about STAS's limits, matching the voice used on stas.aimino.io.

UTM convention for every CTA link in every post: `utm_source=devto|hackernoon|infoq&utm_medium=guest-post&utm_campaign=<slug>`.

---

## Platform Comparison

| Platform | Submission Path | Publish Speed | Canonical Support | Notes |
|---|---|---|---|---|
| dev.to | Markdown with YAML frontmatter, publish from the editor | Fast, typically within a day | Yes, `canonical_url` in frontmatter points at the original | Community-driven; tags drive discovery; best for first-person practical posts |
| HackerNoon | Draft at draft.hackernoon.com, goes through editorial review | ~2 to 4 weeks in the editorial queue | Yes, canonical link allowed | Narrative plus data posts do well; readers tolerate long-form |
| InfoQ | Contact editors with a pitch first; no self-serve publishing | Weeks, editor-dependent | Does not accept already-published content | Editor-curated, 2 to 5K word technical articles; needs an adapted, original variant |

Rule of thumb: dev.to and HackerNoon get syndicated copies of the canonical post on stas.aimino.io. InfoQ gets an original, deeper technical article that has never been published anywhere else.

---

## Post Plan 1: dev.to

**Working title:** How I debugged a production race condition in 4 minutes with an open-source bot

**Platform:** dev.to
**Slug:** `race-condition-debug`
**Angle:** First-person practical walkthrough. A developer story with reproducible steps, not a product pitch. The race condition comes first, the tool appears in the middle, and the reader can try it on the public demo repo.

**Outline:**

1. **The 3-hour debug session.** The Promise.all where one rejection got swallowed, the stack trace, the 40 Stack Overflow tabs. Why a known 3-line fix still took an afternoon (context-switch tax, re-reading the module, tracing tests).
2. **The 15-second trigger.** Writing the bug report in two sentences, adding the `stas:fix` label, closing the laptop. No IDE, no terminal session to babysit.
3. **What the bot did.** Triage (gpt-4o-mini classifies the issue, ~$0.10), sandbox boot (E2B), baseline tests, symbol indexing, then the fix agent (claude-sonnet-4). Eight phases, plan before code.
4. **The PR.** Root cause, the 3-line fix, the regression test. Average fix size is +32/-15 lines, so this was a typical one.
5. **The 6 quality gates.** Reality check, compile, test integrity, hallucination scan, dead code, MCI verification. What each one catches, and why the PR did not reach review until all six passed.
6. **Before and after.** Time: 3 hours versus ~4 minutes label to PR. Cost: $450 of developer time at $150/h versus $3.80. Test suite pass rate across real fixes: 97%.
7. **Try it yourself.** Link to the stas-demo repo with seeded bugs, one-paragraph install instructions for the GitHub Action, and the honest limits: architectural decisions and feature design stay human.

**Target facts:** 92% pass rate on real issues, median $3.80 per fix, ~4 minutes label to PR, 6 quality gates, +32/-15 average fix size, 97% test-suite pass rate, model cascade (gpt-4o-mini + claude-sonnet-4).

**CTA:** https://stas.aimino.io?utm_source=devto&utm_medium=guest-post&utm_campaign=race-condition-debug

---

## Post Plan 2: HackerNoon

**Working title:** I let an open-source bot fix my GitHub issues for a month

**Platform:** HackerNoon
**Slug:** `month-of-automated-fixes`
**Angle:** Narrative plus data. A month-long experiment told as a story, with the numbers in tables and the limitations stated up front. HackerNoon readers reward candor about failure modes, so the post includes what STAS filtered out and where it struggled.

**Outline:**

1. **The setup.** What STAS is (open-source GitHub bot, label an issue, get a PR), how the month ran: 15 seconds to label, a draft PR back in minutes, review on my schedule.
2. **The backlog math.** 47 bugs at 2 hours each = 94 hours of senior attention, versus 47 at ~$3.80 = ~$179. Why the backlog existed and what the math changed.
3. **What got fixed well.** Pass rate (92% on real issues), test-suite pass rate (97%), PR acceptance (87%). What a good week looked like.
4. **The cost table.** Triage at ~$0.10 (gpt-4o-mini), fix at ~$3.00 (claude-sonnet-4), sandbox at ~$0.50, total ~$3.50 to $3.80 per fix. Median turnaround 30 seconds, P95 at 62 seconds.
5. **What it filtered.** 61% of labeled issues were not bugs: feature requests, questions, known unknowns. They got a polite response and no wasted agent run.
6. **Honest limitations.** Architectural decisions, new feature design, thin bug reports with no reproduction steps. The "highly capable junior developer" framing, and where human review stays mandatory.
7. **Verdict.** When to let it run unattended (well-defined bugs), when to keep it on a leash, and whether the month converted me.

**Target facts:** 92% pass rate, median $3.80 per fix, 30s median / 62s P95 turnaround, 97% test-suite pass rate, 87% PR acceptance, 61% of issues filtered as non-bug, model cascade costs, honest limitations.

**CTA:** https://stas.aimino.io?utm_source=hackernoon&utm_medium=guest-post&utm_campaign=month-of-automated-fixes

---

## Post Plan 3: InfoQ

**Working title:** Plan-first architecture for autonomous bug fixing: lessons from STAS

**Platform:** InfoQ
**Slug:** `plan-first-architecture`
**Angle:** Technical and editor-curated. This is the original, never-published article for InfoQ: architecture, engineering tradeoffs, and measured results. Written for senior engineers evaluating the approach, not a product announcement.

**Outline:**

1. **Why reactive code generation fails.** The four dominant failure modes: wrong-file fixes, cosmetic patches, regression generators, hallucinated APIs. Why they are unsolvable by better models alone.
2. **The plan-first pipeline.** The 8 phases: triage, context building, sandbox boot, baseline tests, code intelligence, agent fix, verification, dispatch. Understanding phases before generation phases.
3. **Model cascade economics.** gpt-4o-mini for triage (~$0.10, pre-filtering the ~60% non-bug issues), claude-sonnet-4 for fixes (~$3.00), sandbox compute (~$0.50), total ~$3.50 to $3.80 per fix. Why a single frontier model for everything is economically impossible.
4. **Context window strategy.** Issue context capped at 8K tokens, codebase context as a symbol graph rather than a repo dump, file-level context for the fix. Average fix under 15K tokens.
5. **Graph-based code understanding.** Symbol definitions, import graph, export graph, type dependencies. How the graph powers impact analysis: changing auth.ts surfaces every importer.
6. **Sandbox isolation and security.** E2B sandboxes, ephemeral storage, per-run isolation, anti-injection guards on issue bodies and code comments.
7. **Verification gates.** The 6 deterministic gates, the measured results (92% pass rate, 97% test-suite pass rate, 87% PR acceptance), and the honest limits that keep architectural decisions human.

**Target facts:** 8-phase pipeline, model cascade (gpt-4o-mini ~$0.10 + claude-sonnet-4 ~$3.00, ~$3.50-3.80 total), 8K context cap / 15K average fix, symbol graph and impact analysis, E2B sandboxing, anti-injection, 6 gates, 92% pass rate, 97% test-suite pass rate, 87% PR acceptance.

**CTA:** https://stas.aimino.io?utm_source=infoq&utm_medium=guest-post&utm_campaign=plan-first-architecture

---

## Republishing Policy

The canonical version of every post lives on stas.aimino.io (see the blog posts at /blog, for example the architecture deep dive). Syndicated copies on dev.to and HackerNoon are republished versions of that canonical post, and must link back to it:

- **dev.to:** set `canonical_url` in the YAML frontmatter to the stas.aimino.io URL of the post.
- **HackerNoon:** add the canonical link to the original in the editor; HackerNoon applies `rel=canonical` to the syndicated copy.
- **InfoQ:** never publish a syndicated copy. The InfoQ article is original content written for InfoQ, and the canonical relationship is that InfoQ hosts the primary published version of that particular article. If the same material later appears on stas.aimino.io, point the site version at the InfoQ original.

Order of operations: publish the canonical post on stas.aimino.io first, wait at least 2 weeks, then publish the syndicated copies with canonical links. Update the original only, never the syndicated copies, when facts change.

## Submission Checklist

**dev.to:**
- [ ] Create an account (GitHub sign-in) and complete the profile with the STAS/AImino identity.
- [ ] Draft the post in markdown with YAML frontmatter: `title`, `description`, `published: true`, `canonical_url`, `tags`.
- [ ] Use tags: `opensource`, `ai`, `github`, `productivity`, `devops`.
- [ ] Add the UTM-tagged CTA link and the demo repo link.
- [ ] Publish and check the canonical URL renders; verify the CTA link works.

**HackerNoon:**
- [ ] Create an account and start a draft at draft.hackernoon.com.
- [ ] Upload the markdown, add the canonical link to the original, and pick tags (suggested: `artificial-intelligence`, `programming`, `open-source`).
- [ ] Submit for editorial review and expect a queue of ~2 to 4 weeks.
- [ ] Respond to editor feedback within 48 hours to keep the draft moving.

**InfoQ:**
- [ ] Send the pitch email (template below) to the InfoQ editorial team before writing the full draft.
- [ ] On interest, write the 2 to 5K word original article with code examples and architecture diagrams; it must not have been published anywhere else.
- [ ] Confirm the UTM-tagged CTA is acceptable, and provide an author bio for the byline.

**InfoQ pitch email (ready to send):**

Subject: Article pitch: Plan-first architecture for autonomous bug fixing

Hello InfoQ editorial team,

I am writing from AImino, the team behind STAS, an open-source GitHub bot that turns labeled issues into tested pull requests. I would like to propose a technical article for InfoQ: "Plan-first architecture for autonomous bug fixing: lessons from STAS."

The article examines why reactive AI code generation fails (wrong-file fixes, cosmetic patches, regressions, hallucinated APIs) and presents a plan-first 8-phase pipeline as an alternative: triage with a cheap model, sandbox execution, baseline testing, graph-based code understanding, agent fix, and 6 deterministic verification gates. It includes measured results from real-world usage: a 92% pass rate on real issues, a 97% test-suite pass rate, and a median cost of $3.80 per fix through a gpt-4o-mini and claude-sonnet-4 model cascade.

The article is 2 to 5K words, original, and has not been published anywhere. I can provide code examples, architecture diagrams, and the full outline on request. Please let me know if this fits InfoQ's current editorial calendar and who I should send the full draft to.

Best regards,
The STAS team at AImino
