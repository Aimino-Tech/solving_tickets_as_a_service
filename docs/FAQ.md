# Frequently Asked Questions

## How is this different from Plip/KintsugiBot/Open SWE?

| Feature | STAS | Plip.io | KintsugiBot | Open SWE |
|---------|------|---------|-------------|----------|
| Open Source | ✅ MIT | ❌ | ✅ MIT | ✅ MIT |
| Self-Host | ✅ | ❌ | ✅ | ✅ |
| Sandbox Isolation | ✅ (E2B + Docker) | ❌ | ❌ | ❌ |
| Two-Phase Triage | ✅ | ❌ | ❌ | ❌ |
| Test Verification | ✅ | ❌ | ❌ | ❌ |
| Real-Time Progress | ✅ | ✅ | ❌ | ❌ |
| Multi-Platform | GitHub+\ | GitHub | GitHub | GitHub |
| Model Choice | Any OpenCode model | Anthropic only | Any LLM | Claude/GPT |

STAS is the most complete open-source solution with sandbox isolation, two-phase triage for cost savings, and mandatory test verification before PR creation.

## Does it work with private repos?

Yes. The GitHub App installation grants access to selected repositories. All operations (clone, branch, commit, PR) work on private repositories. Your code is never stored externally.

## What models can I use?

Any model supported by OpenCode. Default: `anthropic/claude-sonnet-4-20250514`. Configure via `OPENCODE_MODEL` env var.

Common options:
- `anthropic/claude-sonnet-4-20250514` (default)
- `anthropic/claude-haiku-3-5-20241022` (cheaper, faster)
- `gpt-4o` (OpenAI)
- `gpt-4o-mini` (cheap triage model)
- Any OpenCode-compatible model

## How much does it cost to run?

Cost depends on your model choice and usage:
- **Self-hosted**: Your API key costs. ~$2-5 per fix with Claude Sonnet, ~$0.50 per fix with Claude Haiku
- **Infrastructure**: Node.js + Redis (can run on a $5/mo VPS)
- **Cloud (coming soon)**: $49/mo flat, no infrastructure management

The two-phase triage saves ~30% costs by skipping expensive model runs on clearly infeasible issues.

## Can I contribute?

Absolutely! See [CONTRIBUTING.md](https://github.com/tamnguyen08/solving_tickets_as_a_service/blob/main/CONTRIBUTING.md) for:
- Development setup
- Test requirements
- PR process
- Code style (Biome)

## What label triggers the bot?

Default: `stas:fix`. Configure via `STAS_LABEL` env var.

## Can I run it on my own server?

Yes. See [SELF_HOSTING.md](SELF_HOSTING.md) for step-by-step guides for Docker, Kubernetes, Railway, and Fly.io deployments.

## Does it support GitLab/Bitbucket?

Yes. STAS supports webhooks from GitHub, GitLab, Bitbucket, Linear, and Jira.

## How does sandboxing work?

Each fix runs in an isolated environment:
- **E2B** (cloud): Fresh sandbox per fix, network-restricted
- **Docker** (local): Container with read-only root, network allowlist, resource limits

Your code is never stored after the sandbox terminates.

## What permissions does the GitHub App need?

- Contents: Read & write (create branches, push commits)
- Issues: Read & write (post comments)
- Pull requests: Read & write (create PRs)
- Metadata: Read (read repository metadata)

## How are secrets handled?

Secrets are loaded from environment variables only. The private key can be provided directly or via a file path. No secrets are ever logged or stored in the database.
