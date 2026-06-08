# Pre-Release Checklist

Use this checklist to qualify a release before creating a GitHub Release and pushing a version tag.

---

## Preparation

- [ ] Identify the set of changes since the last release:
  ```bash
  git log --oneline v<last-version>..HEAD
  ```
- [ ] Verify CHANGELOG.md has an entry for the new version under the correct date
- [ ] Verify CHANGELOG.md categories are correct (Added, Changed, Fixed, Removed, Security)
- [ ] Verify all ticket references in CHANGELOG entries are accurate
- [ ] Update version in `package.json` to match the intended tag (e.g., `0.11.0`):
  ```bash
  node -e "console.log(require('./package.json').version)"
  ```

---

## Code Review

- [ ] `git status` shows clean working tree (no uncommitted changes)
- [ ] All PRs targeting this release are merged to `main`
- [ ] No mockups, stubs, `TODO: implement`, `as any`, or `@ts-ignore` violations in new code
- [ ] No placeholder implementations, fake data, or hardcoded test values

---

## CI / Build

- [ ] CI pipeline passes on `main` branch:
  - [ ] Lint (Biome)
  - [ ] TypeScript type check (`tsc --noEmit`)
  - [ ] Unit tests with coverage (Vitest)
  - [ ] Build (`npm run build`)
  - [ ] E2E tests (Redis)
  - [ ] Worker E2E tests (Redis + RabbitMQ)
  - [ ] Dockerfile lint (hadolint)
  - [ ] Docker Bench Security
  - [ ] Docker image scan (Grype)
  - [ ] SBOM generation (CycloneDX)
  - [ ] Lockfile integrity verification
  - [ ] npm audit (no high/critical)
  - [ ] pip-audit for Python dependencies
  - [ ] Migration integrity check

---

## Docker Build

- [ ] Docker image builds successfully:
  ```bash
  npm run docker:build
  ```
- [ ] Docker container starts and passes health check:
  ```bash
  docker run -d -p 3000:3000 --name stas-test stas-bot
  sleep 5
  curl -f http://localhost:3000/health
  docker rm -f stas-test
  ```
- [ ] Non-root user is configured in Docker image:
  ```bash
  docker run --rm stas-bot whoami
  # → stas
  ```

---

## Security

- [ ] No secrets, tokens, or credentials committed to the repository
- [ ] Dependencies scanned for known vulnerabilities (npm audit, Grybe, pip-audit)
- [ ] SBOM artifacts generated and attachable to release

---

## Documentation

- [ ] CHANGELOG.md is up-to-date with all changes in this release
- [ ] CONTRIBUTING.md release process section is accurate
- [ ] VERSIONING.md reflects current strategy (update if strategy changed)
- [ ] README.md examples and references match the current version
- [ ] `.env.example` is in sync with `src/config.ts`

---

## Release Dry Run (Recommended)

Run the dry-release script to verify tag-based workflow locally:

```bash
npm run release:dry-run -- --version v0.11.0
```

This will:
1. Check for uncommitted changes
2. Validate CHANGELOG.md contains an entry for the target version
3. Verify the version string in `package.json`
4. Simulate the GitHub release create and Docker build steps
5. Print a summary of what would happen in a real release

---

## Tagging and Release

### 1. Final Git Checks

```bash
git checkout main
git pull origin main
git log --oneline v<last-version>..HEAD
```

### 2. Tag the Release

```bash
git tag -a v<version> -m "v<version> — <short description>"
git push origin v<version>
```

This triggers `.github/workflows/release.yml` which:
1. Builds the Docker image
2. Pushes to GHCR with the version tag
3. Creates a GitHub Release with auto-generated release notes
4. Uploads build artifacts (SBOM, etc.)

### 3. Verify Release

- [ ] GitHub Release created with correct version and notes
- [ ] Docker image pushed to GHCR:
  ```bash
  docker pull ghcr.io/aimino-tech/solving_tickets_as_a_service:v<version>
  ```
- [ ] Release notes accurately reflect CHANGELOG.md content

---

## Post-Release

- [ ] Notify team channels (Slack, Discord) about the release
- [ ] Update deployment environments (staging → production)
- [ ] Update `CHANGELOG.md` [Unreleased] section for next development cycle
- [ ] Update `package.json` version to next development version (e.g., `0.12.0-dev`)

---

## Quick Reference

```bash
# Dry run
npm run release:dry-run -- --version v0.11.0

# Tag and push
git tag -a v0.11.0 -m "v0.11.0"
git push origin v0.11.0

# Verify
gh release view v0.11.0
docker pull ghcr.io/aimino-tech/solving_tickets_as_a_service:v0.11.0
```
