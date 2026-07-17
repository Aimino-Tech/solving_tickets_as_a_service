# Failure Mode Catalog

What STAS can and cannot fix, and why.

## ✅ What STAS Can Fix

| Type | Example | Success Rate |
|------|---------|-------------|
| **Single-file bugs** | Off-by-one error, null pointer, logic error in one function | High |
| **Typing errors** | Wrong type annotation, missing type import | High |
| **Logic errors** | Wrong comparison operator, incorrect condition | High |
| **Test failures** | Test expects wrong value, test fixture mismatch | High |
| **Linter/formatting fixes** | Unused imports, formatting issues | High |
| **Simple refactors** | Rename function, extract constant | Medium |
| **README/docs fixes** | Typo in documentation, outdated example | High |
| **Dependency version bumps** | Update package.json version, run migration script | Medium |

### Characteristics of Fixable Issues

- **Single-file change**: The fix can be implemented in one file
- **Clear reproduction**: The issue includes error message, stack trace, or reproduction steps
- **No external dependencies**: The fix doesn't require changes to external services or databases
- **Well-scoped**: The issue describes a specific problem, not a feature request

## ❌ What STAS Cannot Fix

| Type | Example | Why |
|------|---------|-----|
| **Multi-file refactors** | "Restructure the authentication module" | Requires architectural understanding and coordinated changes across many files |
| **Database migrations** | "Add a new users table" | Requires schema changes, data migration, and rollback planning |
| **Dependency upgrades** | "Upgrade React 17 to 18" | Requires compatibility analysis, breaking change migration, and regression testing |
| **Configuration changes** | "Set up CI/CD pipeline" | Requires understanding of deployment infrastructure |
| **Feature requests** | "Add dark mode support" | Requires design decisions, new components, and UX considerations |
| **Cross-cutting concerns** | "Improve performance" | Vague scope, requires profiling and benchmarking |
| **Security vulnerabilities** | "Fix SQL injection in login" | Deliberately limited — security fixes need human review |
| **API design changes** | "Redesign the REST API" | Requires breaking change management and client coordination |

### Issues That STAS Will Skip Automatically

1. **Questions** — Issues asking "how do I..." or "what is..."
2. **Feature requests** — Issues describing new functionality, not bugs
3. **Vague descriptions** — Issues without enough context to understand the problem
4. **Already fixed** — Issues where the bug has already been addressed in a newer commit

## Why STAS Fails on Certain Issues

### Technical Limitations

| Limitation | Impact |
|-----------|--------|
| **Single-turn fix** | Agent gets one chance to fix — no iterative debugging |
| **No runtime access** | Cannot run the application to observe behavior |
| **Limited context window** | Only sees files relevant to the issue, not the entire codebase |
| **No human feedback** | Cannot ask clarifying questions |

### Environmental Limitations

| Limitation | Impact |
|-----------|--------|
| **Sandbox timeout** | Large repos or complex fixes may time out |
| **Missing dependencies** | If install fails, the agent can't run tests |
| **Network restrictions** | Agent can't access external APIs during fix |
| **GitGuard protections** | Destructive operations (force push, branch delete) are blocked |

## What to Do Instead

| If STAS Can't Fix | Alternative |
|-------------------|-------------|
| **Multi-file refactor** | Break it into single-file sub-tasks |
| **Database migration** | Write the migration SQL manually, then label the code changes |
| **Feature request** | Implement the feature yourself, or create a bounty |
| **Vague issue** | Add error messages, stack traces, and reproduction steps |
| **Security fix** | Review and apply the fix manually for safety |
| **Dependency upgrade** | Run upgrade commands manually, use STAS for test fixes |

## Reporting a Failure

If STAS attempted a fix but produced a bad result:

1. Check the quality report in the PR body for gate failures
2. See if the PR was marked as draft (low confidence) or full (high confidence)
3. Review the diff — was it the right approach but wrong implementation?
4. [File an issue](https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues/new?template=bug_report.yml) with the PR URL
