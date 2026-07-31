# STAS — GitHub Marketplace

> Two listings on GitHub Marketplace:
> 1. **STAS App** — The full GitHub App (install on repos, label issues with `stas:fix`)
> 2. **STAS Eval Action** — CI action for running STAS evaluations in workflows

For the app listing copy and visual asset preparation, see [docs/marketplace-listing.md](docs/marketplace-listing.md).

---

# STAS Eval Pipeline — GitHub Marketplace Action

## Prerequisites

1. **STAS API Key** — Get one by subscribing on the [STAS website](https://stas.aimino.io)
2. **Verified Publisher** — Complete [GitHub Marketplace publisher verification](https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/applying-for-publisher-verification-for-your-organization)

## Marketplace Checklist

- [ ] **Verified Publisher badge**: Apply at https://github.com/marketplace/new
- [ ] **Screenshots required**:
  - [ ] Screenshot of a PR check annotation showing pass rate
  - [ ] Screenshot of the action running in a workflow
  - [ ] Dashboard screenshot (if available)
- [ ] **Files required by Marketplace**:
  - [ ] `LICENSE` — GNU Affero General Public License v3.0 (AGPL-3.0) included
  - [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant
  - [ ] `CONTRIBUTING.md` — Contribution guidelines
- [ ] **Action metadata**: `action.yml` with branding, inputs, outputs

## Quick Start

Add to your workflow:

```yaml
- name: Run STAS Eval
  uses: Aimino-Tech/stas-eval-action@v1
  with:
    api-key: ${{ secrets.STAS_API_KEY }}
    eval-suite: smoke
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | — | STAS API key |
| `eval-suite` | No | `smoke` | `smoke`, `standard`, or `full` |
| `langfuse-public-key` | No | — | LangFuse public key |
| `langfuse-secret-key` | No | — | LangFuse secret key |
| `stas-api-url` | No | `https://api.stas.aimino.io` | STAS API base URL |

## Outputs

| Output | Description |
|---|---|
| `pass-rate` | Overall pass rate percentage |
| `pass-rate-delta` | Change vs baseline (↑/↓/→) |
| `langfuse-trace-url` | LangFuse trace URL |
| `regression-detected` | Whether regression was found |
| `status` | `passed`, `failed`, or `error` |

## Example Workflow

```yaml
name: Eval
on: [pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Aimino-Tech/stas-eval-action@v1
        with:
          api-key: ${{ secrets.STAS_API_KEY }}
          eval-suite: standard
          langfuse-public-key: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
          langfuse-secret-key: ${{ secrets.LANGFUSE_SECRET_KEY }}
```

## Publishing Steps

1. Tag a release:
   ```bash
   git tag marketplace-v1.0.0
   git push origin marketplace-v1.0.0
   ```
2. The `publish-marketplace.yml` workflow builds and publishes automatically
3. Verify the listing on [GitHub Marketplace](https://github.com/marketplace)
