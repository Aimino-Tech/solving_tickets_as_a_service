# Quickstart CLI — `npx stas quickstart`

> **Goal**: Get your first STAS-powered fix PR in under 60 seconds using the interactive CLI.

The `npx stas quickstart` command is an interactive walkthrough that authenticates with GitHub, installs the STAS app on a repository, creates a test issue, and waits for the automated fix PR to appear.

## Prerequisites

- **Node.js 18+** (npm ships with Node.js)
- A **GitHub account** with a repository you want to try STAS on
- (Optional) [GitHub CLI (`gh`)](https://cli.github.com/) — enables automatic token detection

## Install

The CLI is published as `@aimino-tech/stas` on npm. You don't need to install it explicitly — `npx` handles that automatically:

```bash
npx stas quickstart
```

To install globally for repeated use:

```bash
npm install -g @aimino-tech/stas
stas quickstart
```

## What Happens

When you run `npx stas quickstart`, the CLI walks through six steps:

| Step | Action | What You See |
|------|--------|-------------|
| 1 | Authenticate with GitHub | Prompt for token (or auto-detected from `GITHUB_TOKEN` env / `gh auth token`) |
| 2 | Select repositories | Pick which repos to install STAS on |
| 3 | Install the STAS GitHub App | Browser opens to the app installation page |
| 4 | Create a test issue | A demo issue is created with the `stas:fix` label |
| 5 | Wait for STAS to respond | CLI polls for up to 180 seconds |
| 6 | Report the result | PR link displayed or troubleshooting guidance shown |

### Step 1 — Authentication

The CLI checks for a GitHub personal access token in this order:

1. `GITHUB_TOKEN` or `GH_TOKEN` environment variable
2. `gh auth token` (from the GitHub CLI)
3. Stored config (`~/.config/stas/config.json`)
4. Interactive prompt (you paste a token)

```bash
# Option A: Set environment variable
export GITHUB_TOKEN=ghp_your_token_here
npx stas quickstart

# Option B: Login with gh CLI first
gh auth login
npx stas quickstart

# Option C: Paste when prompted
npx stas quickstart
# → "Enter your GitHub personal access token:"
```

> **Token requirements**: A [classic personal access token](https://github.com/settings/tokens) with the `repo` scope is required. Fine-grained tokens need `contents: write`, `issues: write`, and `pull requests: write` permissions.

### Step 2 — Select Repositories

After authenticating, the CLI fetches your repositories and prompts you to select which ones STAS should have access to:

```
? Select repositories to install STAS on:
  ◻ your-username/awesome-project
  ◻ your-username/another-repo (private)
  ◻ ...
```

Select at least one repository and press Enter.

### Step 3 — Install the STAS GitHub App

The CLI opens `https://github.com/apps/stas/installations/new` in your browser:

```
STAS app installation required.

1. Open this URL in your browser:
   https://github.com/apps/stas/installations/new

2. Select the repositories you want STAS to access
3. Click 'Install'
4. Return here when done

? Open the installation page now? (Y/n)
```

After installing, return to the terminal and confirm. The CLI waits for you to complete the installation before proceeding.

### Step 4 — Test Issue Created

The CLI creates a demo issue on your selected repository with the `stas:fix` label:

```
STAS Quickstart Demo — Fix Me
-----------------------------------------
This issue was created automatically by `npx stas quickstart`
to demonstrate STAS's capabilities.

Steps:
1. This is a demo issue
2. STAS will analyze it
3. A PR will be created
```

Labeling the issue with `stas:fix` triggers the STAS pipeline.

### Step 5 — Polling for Results

The CLI polls GitHub every 10 seconds, checking for:

- A comment on the test issue containing a PR URL
- A new pull request whose title contains "quickstart" or "fix me"

Progress is shown as dots (`.`) in the terminal. The poll times out after 180 seconds.

### Step 6 — Result

**Success**: The CLI displays the PR URL and saves your config:

```
✓ Quickstart complete!

Your STAS fix PR: https://github.com/your-username/awesome-project/pull/42
Config saved to /home/your-user/.config/stas/config.json

Pro tip: Label any issue with `stas:fix` to trigger a fix automatically.
```

**Timeout**: If no PR appears within 180 seconds:

```
STAS didn't create a PR within the timeout period.

Possible reasons:
  - STAS app may not be installed on the selected repository
  - The STAS backend may be processing a queue
  - Check the issue at https://github.com/... for updates

Run `npx stas quickstart` again after installing the app.
```

## Non-Interactive Mode

Use `--skip-prompts` for CI/CD or automated setups:

```bash
npx stas quickstart --skip-prompts
```

This skips all interactive prompts and:
- Fails immediately if no GitHub token is found (instead of prompting)
- Selects the first repository automatically
- Opens the installation page in the browser
- Waits 15 seconds for installation propagation (instead of asking for confirmation)
- Creates the test issue and polls for results

## Configuration

Config is stored at `~/.config/stas/config.json`:

```json
{
  "githubToken": "ghp_...",
  "installUrl": "https://github.com/apps/stas/installations/12345",
  "poweredBy": "STAS — AI bug fixes for your repo"
}
```

The token is stored for reuse on subsequent runs. If you're using a CI environment, prefer the `GITHUB_TOKEN` environment variable instead.

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| "No GitHub token found" | No token in env, gh CLI, or config | Set `GITHUB_TOKEN` env var or run `gh auth login` |
| "Authentication failed" | Token is invalid or expired | Generate a new token at github.com/settings/tokens |
| "No personal repositories found" | Token lacks `repo` scope, or no accessible repos | Check token permissions, create a test repo |
| STAS app not creating PRs | App not installed on the repo | Run quickstart again and complete the app installation |
| Poll timeout (180s) | STAS backend queue or app not configured | Check the issue page for status, re-run quickstart |

## See Also

- [Getting Started](getting-started.md) — Full installation guide for all deployment options
- [Troubleshooting](troubleshooting.md) — Common issues and fixes
- [GitHub Token Setup](https://github.com/settings/tokens) — Create a personal access token
- [STAS App Installation](https://github.com/apps/stas/installations/new) — Install the GitHub App
