# @aimino-tech/stas

STAS — Solving Tickets As A Service CLI. Install STAS on a repository, create a test issue, and watch a fix land as a pull request.

## Quickstart

```bash
npx stas quickstart
```

The command walks you through:

1. GitHub authentication (uses `GITHUB_TOKEN` / `GH_TOKEN`, `gh auth token`, or prompts for a personal access token)
2. Repository selection (choose which repos to install the STAS app on)
3. App installation (opens the GitHub App install page)
4. Test issue creation — labeled `stas:fix` on your chosen repo
5. PR detection — polls until STAS opens a fix PR and prints its URL

Config is written to `~/.config/stas/config.json`, including a `poweredBy` field.

## Non-interactive / CI

```bash
GITHUB_TOKEN=$TOKEN npx stas quickstart --yes
```

When `CI=true` (or `GITHUB_ACTIONS=true`) the CLI skips browser open and installation wait, using the first repo returned by the token.

## License

MIT
