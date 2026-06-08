# Versioning Strategy

This document defines how STAS (Solving Tickets As A Service) is versioned. The project follows **Semantic Versioning 2.0.0** with a pre-release convention.

---

## Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE[.BUILD]]
```

Example: `0.11.0`, `0.11.0-rc.1`, `1.0.0`

### Increment Rules

| Component | When to Increment | Examples |
|-----------|-------------------|----------|
| **MAJOR** | Breaking API changes, breaking database migrations, removal of public features, significant architecture changes | `1.0.0`, `2.0.0` |
| **MINOR** | New features, new API endpoints, new integration platforms, significant internal improvements | `0.11.0` → `0.12.0` |
| **PATCH** | Bug fixes, security patches, performance improvements, documentation updates | `0.11.0` → `0.11.1` |
| **PRERELEASE** | Pre-release builds (`-alpha`, `-beta`, `-rc`) during active development | `0.11.0-rc.1` |

### Current Version

The current project version is `0.11.0` (pre-1.0 development phase). While in `0.x` phase, breaking changes may occur with MINOR version bumps per SemVer convention.

---

## What Constitutes a Breaking Change (MAJOR bump)

- Removal or renaming of public API endpoints
- Changes to request/response schemas that break existing clients
- Database schema changes that require manual migration
- Dropping support for a webhook platform (GitHub, GitLab, Bitbucket)
- Changes to environment variable names or format
- Changes to webhook payload format expected by external systems

### What Does NOT Constitute a Breaking Change

- Adding new API endpoints
- Adding optional fields to responses
- Internal refactoring that doesn't change public interfaces
- Changes to documentation, CI workflows, or build configuration
- Adding new environment variables (without removing existing ones)
- Dependency updates that don't change public interfaces

---

## Versioning in Practice

### Pre-1.0 (Current)

While the project is in `0.x` phase:

- **MINOR** bumps may include breaking changes
- **PATCH** bumps are always backward-compatible
- Pre-release tags (`-alpha`, `-beta`, `-rc`) are used for feature branches and testing

### Post-1.0

After reaching `1.0.0`:

- Strict SemVer compliance
- MAJOR bumps require migration guides
- Public API is stable within MAJOR version

---

## Pre-release Naming

| Suffix | Meaning | Example |
|--------|---------|---------|
| `-alpha.N` | Early development, unstable | `0.12.0-alpha.1` |
| `-beta.N` | Feature-complete, testing | `0.12.0-beta.1` |
| `-rc.N` | Release candidate, final testing | `0.12.0-rc.1` |

---

## Docker Image Tagging

Docker images follow the same version scheme:

```text
ghcr.io/aimino-tech/solving_tickets_as_a_service:v0.11.0     # Semver tag
ghcr.io/aimino-tech/solving_tickets_as_a_service:latest        # Latest stable
ghcr.io/aimino-tech/solving_tickets_as_a_service:main          # Latest main build
ghcr.io/aimino-tech/solving_tickets_as_a_service:abc1234       # Commit SHA
```

### Tag Promotion Workflow

1. **`main` branch build** → tagged with `main` + commit SHA (pre-release quality)
2. **Release candidate** → tagged with `v<version>-rc.N` (staging testing)
3. **Stable release** → tagged with `v<version>` + `latest` (production)

---

## Release Cadence

| Type | Cadence | Trigger |
|------|---------|---------|
| Development builds | Per commit to `main` | Push to `main` |
| Release candidates | As needed | Manual tag `v*-rc.*` |
| Stable releases | Every 1-2 sprints | Manual tag `v*.*.*` |
| Hotfix/security | As needed | Manual tag `v*.*.N+1` |

---

## Git Tag Convention

```bash
# Stable release
git tag -a v0.11.0 -m "v0.11.0 — Production runbooks, migration testing, rate limit audit"

# Release candidate
git tag -a v0.11.0-rc.1 -m "v0.11.0-rc.1 — Release candidate 1"

# Hotfix
git tag -a v0.11.1 -m "v0.11.1 — Security patch for XSS in webhook handler"
```

Tags must be pushed to trigger the automated release workflow:

```bash
git push origin v0.11.0
```

---

## Changelog Maintenance

The `CHANGELOG.md` at the project root follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:

- **[Unreleased]** — changes merged to `main` but not yet released
- **[MAJOR.MINOR.PATCH]** — released versions with dated entries
- Categories: Added, Changed, Fixed, Removed, Security

Entries are grouped by logical feature/ticket, not by individual commits. Each entry should reference the ticket identifier.

---

## Related Documents

- [CONTRIBUTING.md](./CONTRIBUTING.md) — Release process and checklist
- [PRE_RELEASE_CHECKLIST.md](./PRE_RELEASE_CHECKLIST.md) — Pre-release qualification steps
- [CHANGELOG.md](./CHANGELOG.md) — Complete release history
