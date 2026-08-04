# SYNTARO — GitHub Marketplace

> Two listings on GitHub Marketplace:
> 1. **SYNTARO App** — The full GitHub App (install on repos, label issues with `syntaro:fix`)
> 2. **SYNTARO Fix Action** — Composite GitHub Action that fixes a labeled issue from CI (no webhook server needed)

For the app listing copy and visual asset preparation, see [docs/marketplace-listing.md](docs/marketplace-listing.md).

---

# SYNTARO Fix Action — GitHub Marketplace Action

`syntaro-fix` is the composite action shipped in **this repository** at
[`.github/actions/syntaro-fix`](.github/actions/syntaro-fix). When an issue is labeled
`syntaro:fix`, it posts a "SYNTARO is on it" comment, then runs the fix agent
(`scripts/syntaro-action.ts`) inside the workflow: it investigates the checked-out
codebase, writes a fix with a regression test, runs your test suite, pushes a
branch, and opens a draft PR.

It is the "pure GitHub Action" approach — no webhook server, no SYNTARO account, no
separate infrastructure. The checked-out repository is the sandbox and the
workflow token is the auth.
separate infrastructure. The checked-out repository is the sandbox and the
workflow token is the auth.

## Prerequisites

1. A GitHub token (or GitHub App token) with **`contents: write`**, **`issues: write`**,
   and **`pull-requests: write`** permissions on the target repository.
2. An LLM backend for the fix agent — either:
   - an [OpenCode](https://opencode.ai) server (`opencode-url` + `opencode-api-key`,
     optionally `opencode-model`), or
   - an OpenAI-compatible API key (`openai-api-key`).
   With neither configured the agent reports the missing dependency instead of fixing.

## Quick Start

Add this workflow to your repo at `.github/workflows/syntaro.yml`:

```yaml
name: SYNTARO Auto-Fix
on:
  issues:
    types: [labeled]
jobs:
  fix:
    if: github.event.label.name == 'syntaro:fix'
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: write
      pull-requests: write
    steps:
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.SYNTARO_BOT_APP_ID }}
          private-key: ${{ secrets.SYNTARO_BOT_PRIVATE_KEY }}
      - uses: Aimino-Tech/solving_tickets_as_a_service/.github/actions/syntaro-fix@v1
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          opencode-url: http://localhost:4096
          opencode-api-key: ${{ secrets.OPENCODE_API_KEY }}
```

Inside this repository (or a fork) the action can also be referenced locally as
`uses: ./.github/actions/syntaro-fix`.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | Yes | — | Token with `contents:write`, `issues:write`, `pull_requests:write` permissions |
| `opencode-url` | No | `http://localhost:4096` | OpenCode Serve URL |
| `opencode-api-key` | No | — | OpenCode API key |
| `opencode-model` | No | `anthropic/claude-sonnet-4-20250514` | OpenCode model used by the fix agent |
| `openai-api-key` | No | — | OpenAI API key (fallback if OpenCode is not configured) |
| `bot-name` | No | `SYNTARO` | Bot name used in comments |

## Outputs

None. The action reports progress through issue comments and delivers the result
as a draft pull request.

## Example Workflow

```yaml
name: SYNTARO Auto-Fix
on:
  issues:
    types: [labeled]
jobs:
  fix:
    if: github.event.label.name == 'syntaro:fix'
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: Aimino-Tech/solving_tickets_as_a_service/.github/actions/syntaro-fix@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

## Security & Privacy

- **Token handling** — the action never logs or persists the token; it is passed
  via `inputs.github-token` and only used for issue comments, branch pushes, and PR
  creation on the triggering repository. Use a fine-grained GitHub App token with
  the three permissions above rather than a PAT where possible.
- **Dependencies** — dependencies are installed with `npm ci --ignore-scripts` so
  no install-time scripts from the dependency tree run inside your workflow.
- **AI data flow** — the issue title, body, and repository contents are sent to the
  LLM backend you configure (`opencode-url` or `openai-api-key`) to produce the fix.
  No repository data is sent to Aimino-hosted services. If you require a private
  model, point `opencode-url` at a server you control.
- **Workflow sandbox** — the fix agent runs directly on the workflow runner against
  the checked-out repository, using the token's own permissions. Review the
  permissions you grant the token accordingly.

## Terms of Service

Using this action in a workflow is subject to the [GitHub Actions Terms of
Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
and the [GitHub Marketplace Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-marketplace-terms-of-service).
LLM API usage is billed by your model provider, not by this action. This action is
provided under the AGPL-3.0 license (see [LICENSE](LICENSE)).

## Publishing Steps

1. Tag a release:
   ```bash
   git tag marketplace-v1.0.0
   git push origin marketplace-v1.0.0
   ```
2. The `publish-marketplace.yml` workflow validates `action.yml` and creates a
   GitHub release automatically.
3. Verify the listing on [GitHub Marketplace](https://github.com/marketplace).

## Marketplace Checklist

- [ ] **Verified Publisher badge**: Apply at https://github.com/marketplace/new
- [ ] **Screenshots required**:
  - [ ] Screenshot of the action running in a workflow
  - [ ] Screenshot of a draft PR created by the action
- [ ] **Files required by Marketplace**:
  - [x] `LICENSE` — GNU Affero General Public License v3.0 (AGPL-3.0) included
  - [x] `CODE_OF_CONDUCT.md` — Contributor Covenant
  - [x] `CONTRIBUTING.md` — Contribution guidelines
- [x] **Action metadata**: `action.yml` with branding and inputs
- [x] **Marketplace README**: this document describes the shipped `syntaro-fix` action
      (not `syntaro-eval-action`)
