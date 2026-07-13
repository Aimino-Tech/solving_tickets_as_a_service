# STAS Security Threat Model

> **Documented attack vectors, current mitigations, gap analysis, and remediation priorities for the STAS system.**
>
> Last updated: 2026-07-13
> Review cadence: Quarterly, or after any security incident

---

## Table of Contents

- [Scope and Assumptions](#scope-and-assumptions)
- [Threat Landscape Summary](#threat-landscape-summary)
- [Attack Vector 1: Prompt Injection](#attack-vector-1-prompt-injection)
- [Attack Vector 2: Confused Deputy](#attack-vector-2-confused-deputy)
- [Attack Vector 3: Spoofed Git Identity](#attack-vector-3-spoofed-git-identity)
- [Attack Vector 4: Repo Poisoning / AGENTS.md Trap](#attack-vector-4-repo-poisoning--agentsmd-trap)
- [Attack Vector 5: Data Exfiltration](#attack-vector-5-data-exfiltration)
- [Attack Vector 6: Webhook Forgery](#attack-vector-6-webhook-forgery)
- [Attack Vector 7: Sandbox Escape](#attack-vector-7-sandbox-escape)
- [Attack Vector 8: Supply Chain Compromise](#attack-vector-8-supply-chain-compromise)
- [Mitigation Roadmap](#mitigation-roadmap)
- [Security Testing and Validation](#security-testing-and-validation)
- [References](#references)

---

## Scope and Assumptions

### In Scope

- The STAS webhook server (Express, TypeScript)
- The OpenCode agent dispatch pipeline
- Sandbox execution (Docker local, E2B cloud)
- GitHub App authentication and authorization
- The prompt construction and sanitization pipeline
- Repository content processed during fix runs

### Out of Scope

- Physical security of hosting infrastructure
- Security of the LLM provider endpoints (OpenCode model API)
- Third-party dependency CVEs (covered in [dependency security](../SECURITY.md#114-dependency-vulnerability-handling))
- Upstream OpenCode agent security (covered by OpenCode project)

### Trust Boundaries

```
Internet
   |
   v
+---------------------+     +-----------------------+
|  GitHub Webhook     |---->|  STAS Webhook Server  |
|  (HMAC-SHA256)      |     |  (Express)            |
+---------------------+     +----------+-----------+
                                       |
                              +--------v-----------+
                              |  Prompt Builder    |
                              |  (sanitizeUser)    |
                              +--------+-----------+
                                       |
                              +--------v-----------+
                              |  OpenCode Agent    |
                              |  (sandboxed)       |
                              +--------+-----------+
                                       |
                              +--------v-----------+
                              |  GitHub API        |
                              |  (create PR, push) |
                              +--------------------+
```

Trust boundary 1: Internet to STAS server (signature verified).
Trust boundary 2: STAS server to agent (prompt sanitized).
Trust boundary 3: Agent to external APIs (network-isolated sandbox).

---

## Threat Landscape Summary

| ID | Attack Vector | Severity | Likelihood | Impact | Risk Score |
|---|---|---|---|---|---|
| T-001 | Prompt Injection | Critical | Medium | Critical | 16 |
| T-002 | Confused Deputy | High | Medium | High | 12 |
| T-003 | Spoofed Git Identity | Medium | Low | Medium | 6 |
| T-004 | Repo Poisoning / AGENTS.md Trap | High | Low | Critical | 10 |
| T-005 | Data Exfiltration | High | Medium | High | 12 |
| T-006 | Webhook Forgery | Critical | Low | Critical | 12 |
| T-007 | Sandbox Escape | Critical | Low | Critical | 10 |
| T-008 | Supply Chain Compromise | High | Low | High | 8 |

**Risk Score** = Severity x Likelihood (4x4 matrix: Critical=4, High=3, Medium=2, Low=1).

### Severity Matrix

| Likelihood / Impact | Low | Medium | High | Critical |
|---|---|---|---|---|
| **High** | 4 | 8 | 12 | 16 |
| **Medium** | 3 | 6 | 9 | 12 |
| **Low** | 2 | 4 | 6 | 8 |
| **Very Low** | 1 | 2 | 3 | 4 |

---

## Attack Vector 1: Prompt Injection

**ID**: T-001
**Severity**: Critical
**Likelihood**: Medium
**Risk Score**: 16

### Description

An attacker injects malicious instructions into an issue title, body, or comment that override the agent's system prompt. If successful, the agent ignores its original instructions and follows attacker commands, potentially performing unauthorized git operations, leaking data, or modifying the fix in unintended ways.

### Attack Surface

Three injection vectors exist:

1. **Issue body / title** (primary) -- Attacker creates an issue containing prompt override payloads
2. **Issue comments** (secondary) -- Attacker adds comments that get incorporated into the agent context
3. **Repository files** (tertiary) -- Files like `AGENTS.md` or `CONTRIBUTING.md` in the repo influence agent behavior

### Current Mitigations

1. **PromptSanitizer (AIM-2474)**: The `sanitizeUserContent()` function in `src/agent/issueAgent.ts` redacts known injection phrases:
   - `ignore all previous/prior instructions`
   - `you are not`
   - `forget everything`
   - `your new role`
   - `disregard`, `system override`
   - `you must now`, `you are now`

2. **Content truncation**: Issue body truncated to 3000 characters in triage prompt; comments limited to 15 items

3. **Output verification**: The agent's output is validated against a schema (`parseDispatchResponse`, `parseResult`) before any action is taken

4. **Quality gates**: Pull requests pass through verification gates that check for hallucinated files, test integrity, and compilation

5. **Sandbox isolation**: Even if prompt injection occurs, the agent operates within a sandbox with restricted network access

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| Pattern-based sanitizer is a blocklist, not an allowlist | High | New injection techniques bypass pattern matching. Semantic injection (reasoning hijacking) is not detected. |
| No input validation on the prompt structure itself | Medium | The sanitizer does not verify that user content sections stay within expected boundaries |
| Repository files are not sanitized | High | Malicious `AGENTS.md` or `.env.example` files in a forked repo could influence the agent |
| No injection detection in agent output | Medium | The system does not check the agent's response for signs of compromise |
| No rate limiting on prompt variation attempts | Low | An attacker could probe the sanitizer with variants to discover bypasses |

### Recommendations

1. **Implement layered prompt defense** (P0):
   - Add structural separation in the prompt template (delimit user content with clear boundaries)
   - Deploy a secondary classifier to detect adversarial prompts before dispatch

2. **Add repository file sanitization** (P1):
   - Scan `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and `.env*` files for injection patterns
   - Include only vetted content in the agent prompt

3. **Implement output scanning** (P1):
   - Check agent responses for unexpected commands, leaked secrets, or suspicious code patterns
   - Verify that diff output stays within expected scope (only modifies issue-related files)

4. **Add anomaly detection** (P2):
   - Monitor prompt payload characteristics: length, entropy, structural anomalies
   - Flag issues that contain unusually high density of injection-like patterns

---

## Attack Vector 2: Confused Deputy

**ID**: T-002
**Severity**: High
**Likelihood**: Medium
**Risk Score**: 12

### Description

STAS acts as a deputy (the GitHub App) with elevated permissions. An attacker who triggers a fix on a repository can cause STAS to perform actions the attacker could not perform directly. This includes pushing code, creating PRs, and reading repository contents.

### Attack Surface

1. **Public repository triggering**: Anyone can label an issue `stas:fix` on a public repo where the app is installed
2. **Cross-repository access**: If the app is installed on multiple repos, an attacker may attempt to access other repositories
3. **Privilege escalation via sandbox**: The sandbox has access to an installation token for git operations

### Current Mitigations

1. **Installation-scoped tokens**: GitHub App installation tokens are scoped to a single installation, not across organizations
2. **Per-repo rate limits**: Default 30 req/hour per repository limits abuse
3. **Receipt verification gate**: The `verifyAllReceipts()` function ensures all pipeline phases complete before PR creation
4. **Draft PRs for medium confidence**: Low and medium confidence results produce draft PRs that require human review
5. **Quality gates block**: Failed quality gates prevent PR creation entirely (gate 1-5 are blocking)

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| No repository allowlist | High | Any repo where the app is installed can be targeted. A stolen webhook secret could trigger actions on any installed repo. |
| No issue creator verification | Medium | The system does not verify that the person labeling the issue is authorized to request fixes on that repo |
| No action confirmation for destructive operations | High | PR creation, branch push, and merge-ready PRs happen without explicit human confirmation at the system level |
| Token scope is not narrowed per-run | Medium | The sandbox receives a full installation token rather than a minimal scope token for that specific run |

### Recommendations

1. **Add repository allowlist** (P0):
   - Support a `stas-repos.json` or environment variable that lists allowed repositories
   - Block operations on unlisted repos even if the app is installed

2. **Implement per-action confirmation** (P1):
   - Require a confirmation comment on the issue before creating merge-ready (non-draft) PRs
   - This already partially exists via the confidence-based draft PR mechanism

3. **Narrow sandbox token scope** (P2):
   - When possible, generate fine-grained tokens scoped to a single repository and specific actions
   - Explore GitHub's granular token permissions API

4. **Add issue author verification** (P2):
   - Verify the issue labeler has write or admin access to the repository before dispatching
   - Use the GitHub API to check collaborator permissions

---

## Attack Vector 3: Spoofed Git Identity

**ID**: T-003
**Severity**: Medium
**Likelihood**: Low
**Risk Score**: 6

### Description

An attacker could trick STAS into committing code with a spoofed author identity (different committer name, email, or signed-off-by line). While the commit is made with the GitHub App token (authenticated), the commit metadata could attribute changes to another user.

### Attack Surface

1. **Issue content containing git config commands**: An attacker includes `git config user.name` or `git config user.email` in the issue body
2. **Prompt injection targeting git author metadata**: The agent is instructed to set specific author/committer metadata

### Current Mitigations

1. **Sandbox has fixed git config**: The sandbox environment sets git user.name and user.email at container creation, not from issue content
2. **GitHub App token in commit**: The commit is authenticated by the GitHub App installation token. GitHub shows the app as the committer regardless of the author field.
3. **PromptSanitizer redacts git config patterns**: Git configuration commands are partially covered by the sanitizer

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| git config is set by sandbox setup, but agent could override | Medium | The agent could call `git commit --author="..."` or `git -c user.name=...` to override metadata |
| No post-commit verification of author identity | Low | Commits are not inspected for author/committer metadata consistency after creation |
| No signature requirement | Medium | Commits are not GPG-signed, so author identity is not cryptographically verified |

### Recommendations

1. **Enforce git author in sandbox** (P1):
   - Use `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` environment variables (override `user.name`/`user.email`)
   - Block `--author` flag usage in the sandbox shell

2. **Add post-commit validation** (P2):
   - After the agent pushes, verify commit metadata matches expected STAS identity
   - Reject and recreate commits with mismatched identity

3. **Enable GPG signing** (P2):
   - Configure the sandbox to GPG-sign commits with a STAS-specific key
   - GitHub will show "Verified" badge on commits

---

## Attack Vector 4: Repo Poisoning / AGENTS.md Trap

**ID**: T-004
**Severity**: High
**Likelihood**: Low
**Risk Score**: 10

### Description

An attacker creates a repository with malicious content in files that the agent reads or executes. This includes `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, Makefiles, test scripts, and package.json scripts that contain instructions to compromise the agent.

### Attack Surface

1. **AGENTS.md or similar instruction files**: Repositories can contain agent instruction files that override or influence behavior
2. **Build/test scripts**: The agent runs `npm test`, `make`, or other build commands from the repository
3. **Configuration files**: `.env.example`, `Dockerfile`, or CI configuration files that contain malicious content
4. **Source code**: The agent reads source files to understand the codebase, and malicious code could influence the fix

### Current Mitigations

1. **Sandbox read-only root**: The agent cannot modify system files outside the working directory
2. **Read-only root filesystem**: `--read-only` Docker flag prevents persistent system changes
3. **No arbitrary script execution**: The agent runs specific commands (test suite, lint), not arbitrary build chains
4. **Network whitelist**: Sandbox can only reach whitelisted hosts (GitHub, package registries, LLM endpoints)
5. **Quality gates**: Hallucination detection (gate 1), compile check (gate 2), and test integrity (gate 3) catch some malicious outputs

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| AGENTS.md and similar files are read verbatim by the agent | High | The agent's system prompt may instruct it to follow `AGENTS.md` conventions, giving attackers a channel to inject instructions |
| Test scripts run untrusted code | High | `npm test` executes repository test scripts. Malicious `package.json` scripts or test helpers could compromise the sandbox context |
| No content scanning of repository files before agent reads them | Medium | Files are read as-is without scanning for malicious content |
| Build scripts from untrusted sources | Medium | If the agent runs build commands, those could execute arbitrary code |

### Recommendations

1. **Strip agent instruction files before prompt construction** (P0):
   - Exclude `AGENTS.md`, `.opencode/`, `.serena/`, and similar agent config files from the context sent to the agent
   - Only include source code, test files, and configuration files relevant to the fix

2. **Sanitize test and build scripts** (P1):
   - Before executing test commands, scan `package.json` scripts section for suspicious patterns (curl to external hosts, encoded payloads)
   - Use a strict allowlist of test commands (prefer `npm test` without lifecycle hooks)

3. **Add repository content pre-scan** (P1):
   - Scan for embedded instructions, encoded payloads, and suspicious patterns in key files
   - Flag repositories with unusually structured prompt-like content

4. **Use test-suite-only execution** (P2):
   - When possible, run individual test files rather than full test suites with lifecycle hooks
   - Prefer `npx vitest run` over `npm test` to avoid `pretest`/`posttest` scripts

---

## Attack Vector 5: Data Exfiltration

**ID**: T-005
**Severity**: High
**Likelihood**: Medium
**Risk Score**: 12

### Description

A compromised or malicious agent could exfiltrate repository contents, environment variables, or secrets to an external server. This could happen through DNS tunneling, HTTP requests, git push to attacker-controlled remotes, or embedding data in PR descriptions.

### Attack Surface

1. **Network egress from sandbox**: The sandbox has whitelisted network access to GitHub, package registries, and LLM endpoints
2. **PR body / issue comments**: The agent writes PR descriptions and issue comments that could contain encoded data
3. **Git remote manipulation**: The agent could push code to an attacker-controlled remote
4. **LLM API call payload**: The agent's responses to the LLM API could contain data sent to the model provider

### Current Mitigations

1. **Network whitelist in sandbox**: Only whitelisted hosts are reachable (GitHub API, package registries, LLM endpoints)
2. **Private IP range blocking**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` are explicitly denied
3. **Read-only root filesystem**: System files and credentials are not accessible from the sandbox
4. **Environment variable filtering**: Only necessary environment variables are passed into the sandbox
5. **Output verification**: Agent output is validated before posting to GitHub
6. **Installation token scoping**: Tokens are scoped to a single installation, limiting what can be pushed

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| Package registries can be used as exfiltration channels | High | An agent could encode data in package names, versions, or HTTP headers when fetching packages |
| GitHub API has explicit write access | High | The agent can push branches and create PRs with arbitrary content |
| LLM API calls are not inspected for data leakage | Medium | The agent could embed repository secrets in its LLM requests |
| DNS tunneling is not prevented | Medium | DNS queries from the sandbox could encode data in domain lookups |
| No data loss prevention (DLP) on PR content | Medium | PR bodies and commit messages are not scanned for secrets or sensitive data |

### Recommendations

1. **Implement PR content scanning** (P1):
   - Use `gitleaks` or similar secret scanner on the agent's output before creating a PR
   - Block PR creation if secrets or sensitive patterns are detected in the diff or PR body

2. **Add DNS egress filtering** (P1):
   - Use a DNS resolver that blocks queries to non-whitelisted domains
   - Apply the same allowlist to DNS as to HTTP egress

3. **Deploy DLP heuristics on agent output** (P2):
   - Scan for high-entropy strings, API keys, and encoded payloads in PR descriptions and commit messages
   - Flag PRs containing unusually large encoded sections

4. **LLM API content inspection** (P2):
   - If self-hosting the LLM endpoint, audit the content sent to the model for sensitive data
   - Add logging of prompt size and structure characteristics

---

## Attack Vector 6: Webhook Forgery

**ID**: T-006
**Severity**: Critical
**Likelihood**: Low
**Risk Score**: 12

### Description

An attacker sends forged webhook requests to the STAS webhook endpoint, pretending to be GitHub. If successful, the attacker could trigger fix runs on arbitrary repositories, cause denial of service, or exploit parsing vulnerabilities.

### Attack Surface

1. **Public webhook endpoint**: The `/webhook/github` endpoint is publicly accessible
2. **Replay attacks**: A captured valid webhook payload could be replayed
3. **Signature validation bypass**: A vulnerability in signature comparison logic

### Current Mitigations

1. **HMAC-SHA256 verification**: Every webhook is verified using `crypto.timingSafeEqual` before processing
2. **Raw body capture**: Raw body is captured before JSON parsing, preventing parser inconsistency attacks
3. **Secret stripping**: Signature prefix (`sha256=`) is stripped before comparison
4. **Length check**: Length comparison prevents timing-safe-equal bypass on mismatched lengths
5. **IP allowlisting (optional)**: `IP_ALLOWLIST_ENABLED` adds an additional network-level filter

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| No replay protection | High | Webhook delivery GUIDs are not tracked, so a captured valid payload could be replayed |
| No nonce or timestamp check | Medium | The system does not verify webhook timeliness |
| Signature verification can be skipped in dev mode | Medium | `DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true` bypasses the primary defense |
| No payload size anomaly detection | Low | Excessively large webhook payloads are not flagged |

### Recommendations

1. **Add webhook replay protection** (P1):
   - Track `X-GitHub-Delivery` GUIDs for deduplication within a time window
   - Reject webhook deliveries with duplicate or expired GUIDs

2. **Remove dev mode bypass in production** (P1):
   - Add a build-time or deployment check that refuses to start if `DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY` is set in a production environment

3. **Add payload integrity monitoring** (P2):
   - Alert on webhooks with unusually large payloads (above 1MB for standard issue events)
   - Track webhook delivery patterns and flag anomalies

---

## Attack Vector 7: Sandbox Escape

**ID**: T-007
**Severity**: Critical
**Likelihood**: Low
**Risk Score**: 10

### Description

An attacker exploits a vulnerability in the sandbox (Docker or E2B) to break out of the container and access the host system, other containers, or the internal network.

### Attack Surface

1. **Docker container escape**: Kernel exploits, mount escapes, or Docker socket access
2. **E2B sandbox escape**: Vulnerabilities in the E2B sandbox implementation
3. **Resource exhaustion**: Fork bombs, disk fills, or memory exhaustion affecting the host

### Current Mitigations

1. **Docker security options** (`src/security/sandboxSecurity.ts`):
   - `--read-only` root filesystem
   - `--security-opt=no-new-privileges:true`
   - `--cap-drop=ALL`
   - `--memory=512m`, `--cpus=0.5`, `--pids-limit=256`
   - `--network=none` (configurable, with allowlist when enabled)
   - `--memory-swap=0` (disable swap)

2. **Privileged mode hard block**: `validateSandboxConfig()` rejects privileged mode

3. **Ephemeral containers**: Containers are created per-fix and destroyed after each run

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| No seccomp profile applied | Medium | Docker runs with default seccomp profile; a custom restrictive profile would block more syscalls |
| No AppArmor/SELinux profile | Medium | No mandatory access control beyond Docker defaults |
| User namespace remapping not enforced | Medium | `--userns-remap` is recommended but not enforced in code |
| E2B sandbox security is opaque | Medium | The internal security of E2B sandboxes depends on the provider |
| Container host access during network-enabled runs | Low | When network is enabled, the iptables rules are the sole isolation layer |

### Recommendations

1. **Add restrictive seccomp profile** (P1):
   - Apply a custom seccomp profile that blocks unnecessary syscalls (mount, ptrace, perf_event_open, etc.)
   - Block `clone` with `CLONE_NEWNS|CLONE_NEWNET` flags to prevent container escape

2. **Enforce user namespace remapping** (P1):
   - Add `--userns-remap=default` or a dedicated UID mapping to Docker sandbox options

3. **Add runtime security monitoring** (P2):
   - Use Falco or Tracee to monitor sandbox containers for suspicious syscall patterns
   - Alert on container escape attempts

4. **E2B sandbox security review** (P2):
   - Document the shared responsibility model with E2B
   - Review E2B security whitepaper and compliance certifications

---

## Attack Vector 8: Supply Chain Compromise

**ID**: T-008
**Severity**: High
**Likelihood**: Low
**Risk Score**: 8

### Description

A compromised dependency (npm package, pip package, or Docker base image) introduces malicious code into the STAS runtime. This could lead to credential theft, data exfiltration, or backdoor installation.

### Attack Surface

1. **npm dependencies**: More than 1000 packages in `node_modules`
2. **Python dependencies**: Workers use pip packages
3. **Docker base images**: `node:22-alpine`, `python:3.12-slim`
4. **CI/CD dependencies**: GitHub Actions from the marketplace
5. **Developer tooling**: Pre-commit hooks, linting tools

### Current Mitigations

Detailed in [SECURITY.md section 11.4-11.6](../SECURITY.md#114-dependency-vulnerability-handling):

1. **Multiple scanning layers**: npm audit, pip-audit, grype, trivy, sbom generation
2. **Lockfile integrity**: `package-lock.json` with integrity hashes
3. **Dependabot**: Weekly automated dependency update PRs
4. **Pinned base images**: Specific version tags for Docker images
5. **CI supply chain gates**: Every CI run scans dependencies

### Gap Analysis

| Gap | Severity | Notes |
|---|---|---|
| No dependency attestation verification | Medium | Dependencies are not verified against SLSA or Sigstore attestations |
| No runtime integrity monitoring | Low | Running processes are not checked against known-good hashes |
| Developer machines not scanned | Medium | Local `npm install` on developer machines is not scanned |
| No automated dependency review | Medium | Dependabot PRs require manual review, which can be skipped |

### Recommendations

1. **Enable npm audit fix in CI** (P1):
   - Automatically apply non-breaking dependency fixes in CI pipeline
   - Use `npm audit --audit-level=high` to fail CI on high-severity vulnerabilities

2. **Add Sigstore verification** (P2):
   - Verify npm package signatures using Sigstore (npm registry supports it starting from npm 9)
   - Add `--registry https://registry.npmjs.org` with signature verification

3. **Implement developer dependency scanning** (P2):
   - Add a pre-commit hook that runs supply chain checks
   - Include `npm audit` in the developer setup script

---

## Mitigation Roadmap

| Priority | Mitigation | Tracks | Effort | Timeline |
|---|---|---|---|---|
| P0 | Add repository allowlist | T-002 | Small | Q3 2026 |
| P0 | Strip agent instruction files (AGENTS.md) | T-004 | Small | Q3 2026 |
| P0 | Implement layered prompt defense | T-001 | Medium | Q3 2026 |
| P1 | Add restrictive seccomp profile | T-007 | Medium | Q3 2026 |
| P1 | Add webhook replay protection | T-006 | Small | Q3 2026 |
| P1 | Enforce user namespace remapping | T-007 | Small | Q3 2026 |
| P1 | Add repository file sanitization | T-001, T-004 | Medium | Q4 2026 |
| P1 | Implement output scanning | T-001, T-005 | Medium | Q4 2026 |
| P1 | Add DNS egress filtering | T-005 | Medium | Q4 2026 |
| P1 | Remove dev mode bypass in production | T-006 | Small | Q4 2026 |
| P1 | Enforce git author in sandbox | T-003 | Small | Q4 2026 |
| P2 | Add post-commit validation | T-003 | Small | Q1 2027 |
| P2 | Add GPG signing | T-003 | Small | Q1 2027 |
| P2 | Add runtime security monitoring | T-007 | Medium | Q1 2027 |
| P2 | Implement DLP heuristics | T-005 | Medium | Q1 2027 |
| P2 | Per-action confirmation for destructive ops | T-002 | Medium | Q1 2027 |

---

## Security Testing and Validation

### Automated Testing

| Test | Scope | Frequency |
|---|---|---|
| Webhook signature verification tests | Unit tests for HMAC verification | Every PR |
| Sandbox security configuration tests | Validate Docker options, priv mode block | Every PR |
| Prompt sanitizer tests | Verify injection pattern redaction | Every PR |
| Input validation tests | Path traversal, payload size limits | Every PR |
| SAST (CodeQL, Semgrep) | All source code | Every PR |
| Dependency scanning | npm, pip, Docker | Every PR + weekly |
| Container scanning | Docker image vulnerabilities | Every PR + weekly |

### Penetration Testing

- Annual third-party penetration test (planned for Q4 2026)
- Internal red team exercises (quarterly)
- Bug bounty program via GitHub Security Advisories (planned for Q4 2026)

### Security Reviews

| Review Type | Frequency | Responsibility |
|---|---|---|
| Code security review | Every PR | Automated (SAST) + manual for security-sensitive changes |
| Dependency review | Weekly | Dependabot + manual review |
| Threat model refresh | Quarterly | Security team |
| Access control audit | Quarterly | Security team |
| SOC 2 readiness review | Annual | Security team + external auditor |

---

## References

- [STAS Security Model](../SECURITY.md) -- Comprehensive security documentation
- [Security Key Management](../SECURITY_KEY_MANAGEMENT.md) -- GitHub App key management
- [Sandbox Security Implementation](../../src/security/sandboxSecurity.ts) -- Sandbox configuration and validation
- [PromptSanitizer](../../src/agent/issueAgent.ts) -- User content sanitization
- [Webhook Signature Verification](../../src/webhooks/base.ts) -- HMAC-SHA256 implementation
- [Quality Gates](../../STAS-QUALITY-GATES.md) -- Pre-PR verification gates
- [SOC 2 Readiness Assessment](../soc2/readiness-assessment.md) -- SOC 2 control mapping
- [Incident Response Plan](../soc2/incident-response-plan.md) -- Severity-based response procedures
- [GitHub App Permissions](../../.github/APP_PERMISSIONS.md) -- Documented permission model
- [OpenCode Security](https://opencode.ai/docs/security) -- Upstream OpenCode agent security
- [E2B Security](https://e2b.dev/docs/security) -- E2B sandbox security documentation
