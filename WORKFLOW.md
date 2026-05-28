---
hooks:
  timeout_ms: 2592000000
  after_create: |
    if command -v mise >/dev/null 2>&1; then
      if [ -f mise.toml ]; then
        mise trust
        mise exec -- npm install
      elif [ -f package.json ]; then
        npm install
      fi
    elif [ -f package.json ]; then
      npm install
    fi
  after_run: |
    set -eu
    echo "--- Anti-Mockup Scan ---"
    has_violations=0
    scan_file() {
      local f="$1"
      while IFS= read -r line; do
        v=$(printf '%s' | grep -inE '(TODO: implement|FIXME: (add|implement)|@ts-(ignore|expect-error)|as any|throw new Error\("Not implemented|Not implemented yet|// placeholder|// stub|// TODO|\.then\(\(\) => \{\}\)|catch\s*\([^)]*\)\s*\{\s*\}|function\s+\w+\s*\([^)]*\)\s*\{\s*\}[\s\S]*?$)' <<< "$line")
        if [ -n "$v" ]; then
          violations="$violations$v"$'\n'
        fi
      done
      if [ -n "$violations" ]; then
        echo "[MOCKUP] $f"
        echo "$violations" | head -20
        return 1
      fi
      return 0
    }
    export -f scan_file
    find "$(pwd -P)" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' \) \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' \
      -exec bash -c 'scan_file "$0"' {} \; || has_violations=1
    if [ "$has_violations" -eq 1 ]; then
      echo "!!! WARNING: Mockups/stubs detected in workspace. Review required before Human Review !!!"
    else
      echo "Anti-Mockup Scan: PASSED (no violations found)"
    fi
    echo "--- End Anti-Mockup Scan ---"
  before_remove: |
    if grep -q '"clean"' package.json 2>/dev/null; then
      npm run clean
    fi
agent:
  default_effort: medium
  max_turns: 20
---

You are working on a Linear ticket `{{ issue.identifier }}`

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
- Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.
{% endif %}

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
Labels: {{ issue.labels }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets). If blocked, record it in the workpad and move the issue according to workflow.
3. Final message must report completed actions and blockers only. Do not include "next steps for user".

Work only in the provided repository copy. Do not touch any other path.

## Prerequisite: Linear MCP or `linear_graphql` tool is available

The agent should be able to talk to Linear, either via a configured Linear MCP server or injected `linear_graphql` tool. If none are present, stop and ask the user to configure Linear.

## Project overview: STAS — Solving Tickets As A Service

STAS is an open-source GitHub bot that turns labeled issues into pull requests. Backed by OpenCode.

### Core architecture

```
GitHub Issue (labeled "stas:fix")
       │
       ▼
  Webhook Server (Fastify, TypeScript, ESM)
       │
       ├── Verify webhook signature
       ├── Post "working on it" comment
       ├── Build prompt from issue context
       │
       ▼
  OpenCode Serve (:4096)
       │
       ├── Clone repo (shallow)
       ├── Investigate root cause
       ├── Write fix + regression test
       ├── Run existing test suite
       ├── Commit & push branch
       │
       ▼
  GitHub API
       │
       ├── Open draft PR
       └── Post result comment
```

### Tech stack

- **Runtime**: Node.js 22+, TypeScript, ESM
- **Web server**: Fastify 5.x
- **GitHub integration**: `@octokit/webhooks`, GitHub REST API
- **Agent backend**: `opencode serve` (:4096 HTTP API)
- **Config**: environment variables (`.env`)
- **Build**: `npm run build` (`tsc` → `dist/`)
- **Lint**: not yet configured (add Biome when ready)
- **Test**: not yet configured (add Vitest when ready)
- **Package manager**: npm

### Key files

- `src/index.ts` — Fastify server entry point, routes, startup
- `src/webhook.ts` — GitHub webhook handler (`issues.labeled` events)
- `src/github.ts` — GitHub API client (JWT auth, comments, PRs)
- `src/opencode.ts` — OpenCode serve client (agent dispatch)
- `src/config.ts` — env-based configuration with validation
- `WORKFLOW.md` — this file — orchestrator workflow definition
- `README.md` — project docs, architecture, deployment guide
- `.env.example` — environment variable template

### Business model

**Open-core**: The entire bot is MIT open-source. What we monetize is the hosted service with our AGI (50% better than GPT-5.5), dashboard, zero-ops, and enterprise features.

Funnel: self-host (free) → hit limits → upgrade to hosted with our AGI ($49/mo)

### Competitive positioning

| Dimension | Plip.io | TaskBounty | KintsugiBot | Open SWE | **STAS** |
|---|---|---|---|---|---|
| Agent quality | Claude | Multiple | Any LLM | Claude/GPT | **Our AGI** |
| Cost/fix | $2-5+ | $2-52 | BYO API | BYO API | **Minimal** |
| Self-hosted | ❌ | ❌ | ✅ | ✅ | **✅** |
| OSS | ❌ | ❌ | ✅ | ✅ | **✅ MIT** |
| OpenCode backend | ❌ | ❌ | ❌ | ❌ | **✅ Native** |

## Zero tolerance for mockups, stubs, and fake data

This is a **hard rule**, not a guideline. Violations block the move to `Human Review`.

- Never produce mock objects, stub functions, placeholder implementations, fake data arrays, or hardcoded test values in place of real implementation.
- Never use `TODO: implement`, `FIXME: add real`, `// placeholder`, or any deferral comment as a substitute for completing the work now.
- Never use type-unsafe escapes (`as any`, `@ts-ignore`, `@ts-expect-error`) to silence real type errors caused by incomplete implementation.
- Never generate lorem ipsum, sample text, or demo content unless the ticket explicitly asks for placeholder content.
- Never leave empty catch blocks, empty promise handlers (`.then(() => {})`), or no-op function bodies.
- Every function you write must have a real body that handles inputs, produces correct outputs, and propagates errors appropriately.
- Every data structure you create must use real field names, real types, and real relationships matching the problem domain — no `MockUser`, `TestData`, or generic `Item` types.
- Before considering any code complete, scan every changed file for these patterns and replace any found with real implementation.

If you catch yourself reaching for a stub, a mock, a `TODO`, or a placeholder — **stop**. Implement the real thing. The ticket is not done until every line is real.

## Default posture

- Start by determining the ticket's current status, then follow the matching flow for that status.
- Start every task by opening the tracking workpad comment and bringing it up to date before doing new implementation work.
- Spend extra effort up front on planning and verification design before implementation.
- Keep ticket metadata current (state, checklist, acceptance criteria, links).
- Treat a single persistent Linear comment as the source of truth for progress.
- Use that single workpad comment for all progress and handoff notes; do not post separate "done"/summary comments.
- Treat any ticket-authored `Validation`, `Test Plan`, or `Testing` section as non-negotiable acceptance input: mirror it in the workpad and execute it before considering the work complete.
- When meaningful out-of-scope improvements are discovered during execution, file a separate Linear issue instead of expanding scope. The follow-up issue must include a clear title, description, and acceptance criteria, be placed in `Backlog`, be assigned to the same project as the current issue, link the current issue as `related`, and use `blockedBy` when the follow-up depends on the current issue.
- Move status only when the matching quality bar is met.
- Operate autonomously end-to-end unless blocked by missing requirements, secrets, or permissions.
- Use the blocked-access escape hatch only for true external blockers (missing required tools/auth) after exhausting documented fallbacks.

## Related skills

- `linear`: interact with Linear.
- `commit`: produce clean, logical commits during implementation.
- `push`: keep remote branch current and publish updates.
- `pull`: keep branch updated with latest `origin/main` before handoff.

## Oh My OpenAgent (oh-my-opencode)

The oh-my-opencode plugin is pre-installed and provides the following built-in slash commands to accelerate common workflows:

- `/ralph-loop` — self-referential development loop; use for complex multi-step tasks.
- `/refactor` — intelligent refactoring with LSP and AST-grep validation.
- `/review-work` — launches 5 parallel review agents (Oracle, code quality, security, QA, context mining).
- `/start-work` — start systematic development from a Prometheus plan.
- `/ulw-loop` — ultrawork version of ralph-loop.
- `/handoff` — create detailed context summary for session continuation.

Use these commands at the appropriate lifecycle points during execution.

## Status map

- `Backlog` -> out of scope for this workflow; do not modify.
- `Todo` -> queued; immediately transition to `In Progress` before active work.
  - Special case: if a PR is already attached, treat as feedback/rework loop (run full PR feedback sweep, address or explicitly push back, revalidate, return to `Human Review`).
- `In Progress` -> implementation actively underway.
- `Human Review` -> PR is attached and validated; waiting on human approval.
- `Merging` -> approved by human; merge the PR.
- `Rework` -> reviewer requested changes; planning + implementation required.
- `Done` -> terminal state; no further action required.

## Step 0: Determine current ticket state and route

1. Fetch the issue by explicit ticket ID.
2. Read the current state.
3. Route to the matching flow:
   - `Backlog` -> do not modify issue content/state; stop and wait for human to move it to `Todo`.
   - `Todo` -> immediately move to `In Progress`, then ensure bootstrap workpad comment exists (create if missing), then start execution flow.
     - If PR is already attached, start by reviewing all open PR comments and deciding required changes vs explicit pushback responses.
   - `In Progress` -> continue execution flow from current workpad comment.
   - `Human Review` -> wait and poll for decision/review updates.
   - `Merging` -> merge the PR and move to `Done`.
   - `Rework` -> run rework flow.
   - `Done` -> do nothing and shut down.
4. Check whether a PR already exists for the current branch and whether it is closed.
   - If a branch PR exists and is `CLOSED` or `MERGED`, treat prior branch work as non-reusable for this run.
   - Create a fresh branch from `origin/main` and restart execution flow as a new attempt.
5. For `Todo` tickets, do startup sequencing in this exact order:
   - `update_issue(..., state: "In Progress")`
   - find/create `## Symphony Workpad` bootstrap comment
   - only then begin analysis/planning/implementation work.
6. Add a short comment if state and issue content are inconsistent, then proceed with the safest flow.

## Step 1: Start/continue execution (Todo or In Progress)

1.  Find or create a single persistent scratchpad comment for the issue:
    - Search existing comments for a marker header: `## Symphony Workpad`.
    - Ignore resolved comments while searching; only active/unresolved comments are eligible to be reused as the live workpad.
    - If found, reuse that comment; do not create a new workpad comment.
    - If not found, create one workpad comment and use it for all updates.
    - Persist the workpad comment ID and only write progress updates to that ID.
2.  If arriving from `Todo`, do not delay on additional status transitions: the issue should already be `In Progress` before this step begins.
3.  Immediately reconcile the workpad before new edits:
    - Check off items that are already done.
    - Expand/fix the plan so it is comprehensive for current scope.
    - Ensure `Acceptance Criteria` and `Validation` are current and still make sense for the task.
4.  Start work by writing/updating a hierarchical plan in the workpad comment.
5.  Ensure the workpad includes a compact environment stamp at the top as a code fence line:
    - Format: `<host>:<abs-workdir>@<short-sha>`
    - Example: `devbox-01:/home/dev-user/repos/stas@7bdde33`
    - Do not include metadata already inferable from Linear issue fields (`issue ID`, `status`, `branch`, `PR link`).
6.  Add explicit acceptance criteria and TODOs in checklist form in the same comment.
    - If the ticket description/comment context includes `Validation`, `Test Plan`, or `Testing` sections, copy those requirements into the workpad `Acceptance Criteria` and `Validation` sections as required checkboxes (no optional downgrade).
7.  Run a principal-style self-review of the plan and refine it in the comment. Use `/refactor` for any planned code restructuring to ensure safety via LSP and AST-grep validation.
8.  Run the `pull` skill to sync with latest `origin/main` before any code edits, then record the pull/sync result in the workpad `Notes`.
    - Include a `pull skill evidence` note with:
      - merge source(s),
      - result (`clean` or `conflicts resolved`),
      - resulting `HEAD` short SHA.
9.  Compact context and proceed to execution.

## PR feedback sweep protocol (required)

When a ticket has an attached PR, run this protocol before moving to `Human Review`:

1. Identify the PR number from issue links/attachments.
2. Gather feedback from all channels:
   - Top-level PR comments (`gh pr view --comments`).
   - Inline review comments (`gh api repos/<owner>/<repo>/pulls/<pr>/comments`).
   - Review summaries/states (`gh pr view --json reviews`).
3. Treat every actionable reviewer comment (human or bot), including inline review comments, as blocking until one of these is true:
   - code/test/docs updated to address it, or
   - explicit, justified pushback reply is posted on that thread.
4. Update the workpad plan/checklist to include each feedback item and its resolution status.
5. Re-run validation after feedback-driven changes and push updates.
6. Repeat this sweep until there are no outstanding actionable comments.

## Blocked-access escape hatch (required behavior)

Use this only when completion is blocked by missing required tools or missing auth/permissions that cannot be resolved in-session.

- GitHub is **not** a valid blocker by default. Always try fallback strategies first (alternate remote/auth mode, then continue publish/review flow).
- Do not move to `Human Review` for GitHub access/auth until all fallback strategies have been attempted and documented in the workpad.
- If a non-GitHub required tool is missing, or required non-GitHub auth is unavailable, move the ticket to `Human Review` with a short blocker brief in the workpad that includes:
  - what is missing,
  - why it blocks required acceptance/validation,
  - exact human action needed to unblock.
- Keep the brief concise and action-oriented; do not add extra top-level comments outside the workpad.

## Step 2: Execution phase (Todo -> In Progress -> Human Review)

1.  Determine current repo state (`branch`, `git status`, `HEAD`) and verify the kickoff `pull` sync result is already recorded in the workpad before implementation continues.
2.  If current issue state is `Todo`, move it to `In Progress`; otherwise leave the current state unchanged.
3.  Load the existing workpad comment and treat it as the active execution checklist.
    - Edit it liberally whenever reality changes (scope, risks, validation approach, discovered tasks).
4.  Implement against the hierarchical TODOs and keep the comment current:
    - Check off completed items.
    - Add newly discovered items in the appropriate section.
    - Keep parent/child structure intact as scope evolves.
    - Update the workpad immediately after each meaningful milestone.
    - Never leave completed work unchecked in the plan.
    - For tickets that started as `Todo` with an attached PR, run the full PR feedback sweep protocol immediately after kickoff and before new feature work.
5.  Run validation/tests required for the scope:
    - STAS-specific validation commands:
      - `npm run build` — TypeScript compilation must succeed (no errors)
    - When tests are added: `npm test` — Vitest must pass
    - When lint is configured: `npm run lint` — Biome must pass
    - Mandatory gate: execute all ticket-provided `Validation`/`Test Plan`/`Testing` requirements when present; treat unmet items as incomplete work.
6.  **Mandatory mockup/stub scan** — Before re-checking criteria:
    - Scan every file you changed or created for mockup/stub patterns.
    - For **every** match found: **replace with real implementation before proceeding.**
    - Document the scan in the workpad `Anti-Mockup Verification` section with file-by-file results.
    - Do not skip this step. Do not defer replacements.
7.  Re-check all acceptance criteria and close any gaps.
8.  Before every `git push` attempt, run the required validation for your scope and confirm it passes.
9.  Attach PR URL to the issue (prefer attachment; use the workpad comment only if attachment is unavailable).
10. Merge latest `origin/main` into branch, resolve conflicts, and rerun checks.
11. Update the workpad comment with final checklist status and validation notes.
    - Mark completed items as checked.
    - Add final handoff notes (commit + validation summary) in the same workpad comment.
    - Do not include PR URL in the workpad comment; keep PR linkage on the issue via attachment/link fields.
    - Add a short `### Confusions` section at the bottom when any part of task execution was unclear/confusing, with concise bullets.
    - Do not post any additional completion summary comment.
12. Run `/review-work` to launch parallel review sub-agents. Address any issues they report and re-run until all sub-agents pass.
13. Confirm PR checks are green, the branch is pushed, and PR is linked on the issue.
14. Re-open and refresh the workpad so `Plan`, `Acceptance Criteria`, and `Validation` exactly match completed work.
15. Only then move issue to `Human Review`.
    - Exception: if blocked by missing required non-GitHub tools/auth per the blocked-access escape hatch, move to `Human Review` with the blocker brief and explicit unblock actions.
16. For `Todo` tickets that already had a PR attached at kickoff:
    - Ensure all existing PR feedback was reviewed and resolved.
    - Ensure branch was pushed with any required updates.
    - Then move to `Human Review`.

## Step 3: Human Review and merge handling

1. When the issue is in `Human Review`, do not code or change ticket content.
2. Poll for updates as needed, including GitHub PR review comments from humans and bots.
3. If review feedback requires changes, move the issue to `Rework` and follow the rework flow.
4. If approved, human moves the issue to `Merging`.
5. When the issue is in `Merging`, merge the PR (squash merge preferred), delete the branch.
6. After merge is complete, move the issue to `Done`.

## Step 4: Rework handling

1. Treat `Rework` as a full approach reset, not incremental patching.
2. Re-read the full issue body and all human comments; explicitly identify what will be done differently this attempt.
3. Close the existing PR tied to the issue.
4. Remove the existing `## Symphony Workpad` comment from the issue.
5. Create a fresh branch from `origin/main`.
6. Start over from the normal kickoff flow.

## Completion bar before Human Review

- Step 1/2 checklist is fully complete and accurately reflected in the single workpad comment.
- Acceptance criteria and required ticket-provided validation items are complete.
- Validation/tests are green for the latest commit:
  - `npm run build` — tsc compiles clean.
  - `npm test` — Vitest passes (when configured).
  - `npm run lint` — Biome passes (when configured).
- **Anti-Mockup Verification: zero mockups, stubs, placeholder code, or fake data remain in changed files (scan results documented in workpad).**
- `/review-work` sub-agents pass (goal, quality, security, QA, context).
- PR checks are green, branch is pushed, and PR is linked on the issue.

## Guardrails

- **Zero tolerance for mockups/stubs is a hard requirement.** Every mockup scan violation must be fixed with real implementation before proceeding. No exceptions.
- If the branch PR is already closed/merged, do not reuse that branch or prior implementation state for continuation.
- For closed/merged branch PRs, create a new branch from `origin/main` and restart from scratch.
- If issue state is `Backlog`, do not modify it; wait for human to move to `Todo`.
- Do not edit the issue body/description for planning or progress tracking.
- Use exactly one persistent workpad comment (`## Symphony Workpad`) per issue.
- If comment editing is unavailable in-session, use the update script. Only report blocked if both MCP editing and script-based editing are unavailable.
- If out-of-scope improvements are found, create a separate Backlog issue rather than expanding current scope.
- Do not move to `Human Review` unless the `Completion bar before Human Review` is satisfied.
- In `Human Review`, do not make changes; wait and poll.
- If state is terminal (`Done`), do nothing and shut down.
- Keep issue text concise, specific, and reviewer-oriented.
- STAS-specific: config changes (`.env` shape) must keep `.env.example` in sync. Do not commit real tokens. Do not modify `opencode serve` externally — STAS only talks to it via HTTP API on `:4096`.

## Workpad template

Use this exact structure for the persistent workpad comment and keep it updated in place throughout execution:

````md
## Symphony Workpad

```text
<hostname>:<abs-path>@<short-sha>
```

### Plan

- [ ] 1\. Parent task
  - [ ] 1.1 Child task
  - [ ] 1.2 Child task
- [ ] 2\. Parent task

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Validation

- [ ] type-check: `npm run build`
- [ ] targeted tests: `npm test` (when configured)
- [ ] lint: `npm run lint` (when configured)

### Anti-Mockup Verification

- [ ] Scanned all changed files — zero TODO stubs, placeholders, fake data, as any, @ts-ignore, empty bodies
- [ ] Every function has a real implementation body
- [ ] Every type/data structure uses domain-specific names (no MockUser/TestData/Item generics)

### Notes

- <short progress note with timestamp>

### Confusions

- <only include when something was confusing during execution>
````
