# @aimino-tech/syntaro

SYNTARO CLI. Install SYNTARO on a repository, create a test issue, and watch a fix land as a pull request.

## Quickstart

```bash
npx syntaro quickstart
```

The command walks you through:

1. GitHub authentication (uses `GITHUB_TOKEN` / `GH_TOKEN`, `gh auth token`, or prompts for a personal access token)
2. Repository selection (choose which repos to install the SYNTARO app on)
3. App installation (opens the GitHub App install page)
4. Test issue creation — labeled `syntaro:fix` on your chosen repo
5. PR detection — polls until SYNTARO opens a fix PR and prints its URL

Config is written to `~/.config/syntaro/config.json`, including a `poweredBy` field.

## Non-interactive / CI

```bash
GITHUB_TOKEN=$TOKEN npx syntaro quickstart --yes
```

When `CI=true` (or `GITHUB_ACTIONS=true`) the CLI skips browser open and installation wait, using the first repo returned by the token.

## License

MIT
