# Liability Scenario: Preventing and Handling Production Outages Caused by Agent Hallucinations

## Executive Summary

STAS (Solving Tickets As A Service) operates in a high-liability category: AI-generated code is merged into production repositories. When an agent hallucinates — generating code that compiles but is incorrect, referencing phantom APIs, introducing logical errors, or making destructive changes — the downstream impact can range from a broken build to a full production outage.

This document formalizes STAS's liability posture, technical safeguards, incident response playbook, and commercial terms. It is designed to:

1. **Minimize risk** — through sandboxed execution, quality gates, staged rollouts, and PR-only deployment
2. **Define liability** — clear guarantees, SLAs, indemnification, and liability caps for each customer tier
3. **Respond effectively** — a playbook for detection, containment, RCA, customer communication, and compensation
4. **Differentiate in market** — turn liability coverage from a risk into a competitive advantage for enterprise sales

> **Key Finding**: No competitor offers a comprehensive liability framework for AI-generated code. Devin, Copilot, and OpenHands all rely on "as-is" disclaimers or per-incident remediation. STAS can differentiate by offering tiered SLA-backed guarantees with clear liability caps, insurance-backed warranty, and a proven incident response track record.

---

## 1. The Liability Risk

### 1.1 How Agent Hallucinations Cause Production Outages

The STAS agent operates in a deterministic pipeline: issue → plan → code → test → PR. At each stage, hallucination can introduce risk:

| Stage | Hallucination Type | Downstream Impact |
|-------|-------------------|-------------------|
| **Planning** | Misunderstands issue scope, proposes wrong fix | Wasted execution time, no production impact (caught at review) |
| **Code Generation** | Phantom API calls, invented packages, wrong imports | Compilation failure (caught by quality gates) or runtime error (escapes to production) |
| **Test Generation** | Vacuous tests (`expect(true).toBe(true)`), missing edge cases | False confidence in PR approval, bug reaches production |
| **Git Operations** | Force push, branch deletion, destructive rebase | Git history corruption (blocked by GitGuard) |
| **Dependency Changes** | Adds hallucinated npm/PyPI packages | Supply chain vulnerability, runtime failures |
| **Configuration** | Modifies deployment configs, environment variables | Staging/production misconfiguration, outage |

### 1.2 Real-World Scenarios

#### Scenario A: Hallucinated Package Import

```
Issue: "Fix TypeError in user authentication"
Agent: Imports "crypto-utils" (hallucinated npm package that doesn't exist)
Gate 2 (Compile Check): ❌ Fails — "Cannot find module 'crypto-utils'"
Result: PR blocked. No production impact. Agent retries with correct import.
```

#### Scenario B: Wrong Fix Compiles but Breaks Logic

```
Issue: "Rate limiter allowing too many requests"
Agent: Changes threshold from 100 to 1000 instead of fixing the sliding window algorithm
Quality Gates: All 6 pass (code compiles, tests pass, no stubs detected)
Human Review: Misses the logic error
Production: Rate limiter effectively disabled — 10x traffic spike causes DB overload
Outage Duration: 12 minutes until rollback
```

#### Scenario C: Cascading Dependency Change

```
Issue: "Upgrade lodash to v4"
Agent: Updates package.json, runs migration script
Gate 5 (Dead Code): Warns about deprecated _.pluck usage in 3 files
Agent: Auto-fixes the 3 files but introduces off-by-one in array transformation
Production: User profile page renders wrong data for paginated results
Outage Duration: 45 minutes (harder to detect, subtle data corruption)
```

#### Scenario D: Security-Sensitive Configuration Drift

```
Issue: "Fix slow database queries"
Agent: Modifies DB connection pool config, disables query timeout
Production: Connection pool exhaustion, cascading service failure
Outage Duration: 8 minutes (caught by monitoring)
```

### 1.3 Risk Quantification

| Risk Category | Probability (per 1000 fixes) | Impact Severity | Annualized Loss Expectancy (at 10K fixes/mo) |
|--------------|----------------------------|-----------------|----------------------------------------------|
| **Build breakage** (caught pre-merge) | ~50-100 | Low | Negligible |
| **Bug reaches staging** | ~10-20 | Medium | ~$5K-20K (engineer time + delay) |
| **Bug reaches production** | ~2-5 | High | ~$20K-100K (incident response + customer impact) |
| **Production outage (P0)** | ~0.5-2 | Critical | ~$100K-500K (SLA credits + reputational) |
| **Data corruption / loss** | ~0.1-0.5 | Severe | ~$500K-2M (liability + regulatory) |

---

## 2. Legal Liability Framework

### 2.1 Tiered Guarantees and SLAs

STAS offers three tiers of guarantees aligned with the existing support model and pricing:

#### Cloud Free — No Guarantee

| Attribute | Detail |
|-----------|--------|
| **Service guarantee** | None (best-effort) |
| **Fix quality guarantee** | None ("as-is") |
| **Liability cap** | $0 (no consideration exchanged) |
| **SLA credit** | None |
| **Indemnification** | None |
| **Governing law** | Terms of service only |

#### Cloud Solo ($49/mo) / Cloud Team ($149/mo) — Standard Guarantee

| Attribute | Detail |
|-----------|--------|
| **Uptime SLA** | 99.5% availability (monthly) |
| **Fix quality guarantee** | STAS will re-attempt any fix that fails quality gates 2-3x at no cost |
| **Production bug guarantee** | If a STAS-generated fix causes a production incident, STAS provides 5x the monthly fee as service credit |
| **Liability cap** | Total fees paid in the 12 months preceding the incident |
| **Indemnification** | STAS indemnifies against IP infringement claims in generated code |
| **SLA credits** | 5% per 0.5% below 99.5% uptime, max 25% of monthly fee |

#### Enterprise — Custom Guarantee

| Attribute | Detail |
|-----------|--------|
| **Uptime SLA** | 99.9% (monthly) or 99.95% (annual) |
| **Fix quality guarantee** | Guaranteed pass rate across 6 quality gates (≥95% first-pass) |
| **Production bug guarantee** | Full incident response included. 10x monthly fee credit for P0 incidents. |
| **Liability cap** | 1-3x annual contract value (negotiable) |
| **Indemnification** | Full IP indemnification + mutual indemnification for security breaches |
| **SLA credits** | Custom schedule (typically 10% per 0.5% below target) |
| **Cyber liability insurance** | STAS carries $2M+ coverage; named as additional insured available |

### 2.2 Indemnification Clauses

STAS's approach to indemnification is calibrated to the risk profile of AI-generated code:

**What STAS indemnifies against:**

| Type | Covered? | Details |
|------|----------|---------|
| **IP infringement** (code output contains copyrighted material) | ✅ Solo/Team/Enterprise | STAS warrants generated code does not infringe third-party IP. Capped at liability limit. |
| **Security breach** (STAS infrastructure compromised) | ✅ Enterprise only | Mutual indemnification for breaches caused by negligence. |
| **Data loss** (STAS agent deletes customer data) | ❌ Not covered | Excluded because STAS operates on git repos — data loss is preventable via git history. |
| **Third-party claims** (customer sued over STAS output) | ✅ Enterprise only | Conditional on customer using latest version and maintaining quality gates. |
| **Customer modifications** (changes to generated code) | ❌ Not covered | Once customer modifies the PR output, STAS indemnification is void. |

**Indemnification conditions (Enterprise):**
1. Customer must use the latest available STAS version (or have a documented exception)
2. Customer must run all 6 quality gates before merging any STAS-generated PR
3. Customer must maintain the PR-only deployment model (no direct merge to production)
4. Customer must notify STAS within 5 business days of any claim
5. STAS controls defense and settlement of any indemnified claim

### 2.3 Liability Caps

STAS uses a **three-tier liability cap structure** that reflects the risk distribution between STAS and the customer:

| Tier | Cap Basis | Cap Amount | Rationale |
|------|-----------|------------|-----------|
| **Free** | Zero consideration | $0 | No paid service → no liability |
| **Solo ($49/mo)** | 12 months of fees | ~$588 | Appropriate for individual developer risk |
| **Team ($149/mo)** | 12 months of fees | ~$1,788 | Team-level risk, limited blast radius |
| **Enterprise (custom)** | 1-3x ACV | $50K-500K+ | Proportionate to customer revenue impact |

**Exclusions from liability cap (uncapped):**
- Gross negligence or willful misconduct by STAS
- Breach of confidentiality obligations
- IP infringement claims (covered under separate indemnification)
- Statutory liability that cannot be limited by law (e.g., GDPR fines, product liability under EU Directive 85/374)

### 2.4 Warranty Disclaimers

STAS uses the following warranty structure:

**Express warranties:**
- STAS will perform fixes with reasonable skill and care
- STAS will run all 6 quality gates before PR creation
- STAS will maintain SOC 2 Type II / ISO 27001 certification
- STAS will notify customers of any security incidents within 24 hours

**Implied warranties (disclaimed):**
- ANY IMPLIED WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED TO THE MAXIMUM EXTENT PERMITTED BY LAW
- STAS DOES NOT WARRANT THAT GENERATED CODE WILL BE ERROR-FREE, UNINTERRUPTED, OR MEET CUSTOMER REQUIREMENTS
- CUSTOMER ACKNOWLEDGES THAT AI-GENERATED CODE INHERENTLY CARRIES RISK AND AGREES TO MAINTAIN HUMAN REVIEW PROCESSES

> **Legal note for DACH/EU**: German law (§§ 434 ff. BGB) and EU consumer protection directives impose mandatory warranty rights that cannot be excluded. The above disclaimers apply to B2B customers only. Consumer-facing warranties must follow local statutory requirements.

---

## 3. Technical Safeguards

STAS has multiple layers of technical protection that reduce liability risk before code ever reaches production. These are not just defensive — they are the primary evidence in any liability claim showing STAS exercised reasonable care.

### 3.1 Sandboxed Execution Environment

Every agent execution runs inside a hardened Docker sandbox. Full details in [`docs/ops/sandbox-hardening.md`](../ops/sandbox-hardening.md).

| Layer | Mechanism | What It Prevents |
|-------|-----------|-----------------|
| Syscall filtering | Seccomp profile (default-ALLOW, block dangerous syscalls) | Kernel module loading, namespace escape, ptrace abuse |
| Mandatory access control | AppArmor profile (default-DENY) | Unauthorized file access, network abuse |
| Read-only rootfs | `--read-only` | Cannot modify system files or write outside workspace |
| Capability dropping | `--cap-drop ALL` + allowlist | No privilege escalation |
| Network isolation | `--network none` (default) | No outbound data exfiltration |
| Resource limits | `--memory 2g --cpus 1.0` | Prevents resource exhaustion DoS |
| Init process reaper | `--init` (tini) | Proper signal handling, no zombie processes |

**Liability relevance**: The sandbox demonstrates that STAS takes reasonable precautions to prevent agent actions from affecting systems beyond the designated workspace. This is a key factor in any negligence analysis.

### 3.2 Automatic Test Generation and Validation (6 Quality Gates)

Every STAS-generated PR passes through 6 deterministic quality gates before creation. Full details in [`STAS-QUALITY-GATES.md`](../../STAS-QUALITY-GATES.md).

| # | Gate | What It Detects | Blocks PR? |
|---|------|-----------------|------------|
| 1 | **Reality Check** | Phantom file references (importing files that don't exist) | Yes |
| 2 | **Compile Check** | TypeScript compilation errors | Yes |
| 3 | **Test Integrity** | Vacuous tests, assertionless tests, placeholder test names | Yes |
| 4 | **Hallucination/Stub** | TODO stubs, empty catch blocks, `return null` placeholders, `as any` | Yes |
| 5 | **Dead Code** | Orphaned files, unused exports | Yes |
| 6 | **External AI Tool Scan** | Hallucinated packages, phantom APIs, over-mocking, missing error tests | Warn |

Additional tools integrated:
- **ghostcheck** — detects hallucinated npm packages, phantom APIs, insecure patterns
- **trace-core** — detects hallucinated imports from nonexistent packages
- **anti-hallucination-mcp** — AST fuzzy matching against symbol registry
- **vibecop** — AI code quality linter (over-mocking, missing error paths)

**Liability relevance**: The quality gates create a documented audit trail showing that STAS exercised reasonable care before every PR. If a gate was skipped or bypassed, liability shifts toward the party that bypassed it.

### 3.3 Staged Rollouts (Canary → Staging → Production)

STAS enforces a multi-stage deployment pipeline for the platform itself, and recommends the same for customer repositories:

```
                 ┌─────────────┐
    Canary       │  5% of fixes │ ← New model versions, tool updates
    (1 hour)     │  monitored   │
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
    Staging      │  All fixes   │ ← Full quality gate suite, integration tests
    (4 hours)    │  monitored   │
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
    Production   │  All fixes   │ ← PR-only, human review required
                 │  with human  │
                 │  review gate │
                 └─────────────┘
```

For customer repos, STAS recommends and documents:
1. **Canary repo** — A fork of the target repo where STAS first applies fixes
2. **Staging branch** — Auto-merged PRs from canary, integration tests run
3. **Production branch** — Human-approved merges only, with full audit trail

**Liability relevance**: A customer who bypasses the recommended staged rollout (e.g., directly merges STAS PRs to production without review) assumes increased liability. STAS documents this recommendation in every PR body.

### 3.4 PR-Only Deployment Model

STAS **never touches the production branch directly**. Every code change:

1. Originates from a branch named `stas/fix/<issue-number>-<slug>`
2. Passes all 6 quality gates
3. Is submitted as a GitHub PR (or GitLab MR)
4. Contains a detailed PR body with:
   - The original issue description
   - Summary of changes made
   - Quality gate results (pass/fail for each gate)
   - Confidence score (high/low)
   - Recommendation: human review required
5. Is never merged automatically (for paid tiers, auto-merge is opt-in with liability waiver)

```yaml
# PR body template (auto-generated)
---
## 🔧 STAS Fix: Issue #1234

**Issue**: Rate limiter allowing too many requests (#1234)
**Confidence**: HIGH (6/6 quality gates passed)

### Changes
- `src/middleware/rate-limit.ts`: Fixed sliding window algorithm
- `src/middleware/rate-limit.test.ts`: Added edge case tests

### Quality Gate Results
| Gate | Status | Evidence |
|------|--------|----------|
| 1. Reality Check | ✅ PASS | All imports verified |
| 2. Compile Check | ✅ PASS | tsc --noEmit clean |
| 3. Test Integrity | ✅ PASS | 12 tests, all non-vacuous |
| 4. Hallucination/Stub | ✅ PASS | No stubs detected |
| 5. Dead Code | ✅ PASS | No orphans |
| 6. AI Tool Scan | ✅ PASS | ghostcheck clean |

### ⚠️ Human Review Required
This PR has NOT been merged. A human must review before merging.
---
```

**Liability relevance**: The PR-only model creates a clear separation of responsibility. STAS is responsible for the quality of the fix proposal. The customer is responsible for the decision to merge it.

---

## 4. Incident Response Playbook

This playbook extends the existing SOC 2 incident response framework ([`docs/soc2/incident-response-plan.md`](../soc2/incident-response-plan.md)) with STAS-specific scenarios for AI-generated code incidents.

### 4.1 Incident Classification (STAS-Specific)

| Severity | Definition | Response SLA | Example |
|----------|-----------|--------------|---------|
| **P0 — Critical** | Production outage caused by STAS-generated code | 30 min response, 2 hr containment | Scenario B/C from §1.2 |
| **P1 — High** | Major feature broken, staging outage, data integrity concern | 1 hr response, 4 hr containment | Scenario C (caught in staging) |
| **P2 — Medium** | Non-critical bug, workaround exists, build broken | 4 hr response, 24 hr fix | Scenario A (build breakage) |
| **P3 — Low** | Cosmetic, documentation, minor logic error with no production impact | 24 hr response, next release | Typo in generated code comments |

### 4.2 Detection

**Automated detection signals:**
- **Sentry error threshold breach** — spike in errors after STAS PR merge
- **Monitoring alert** — latency spike, error rate increase, throughput drop
- **Customer report** — user reports incorrect behavior after STAS fix
- **Quality gate regression** — previously passing tests now fail on related code
- **Anomaly detection** — unusual git activity patterns (force push, large deletions)

**Customer reporting channels:**

| Channel | Target Response |
|---------|----------------|
| `security@aimino.com` | P0/P1: 30 min |
| Slack (Enterprise customers) | P0/P1: 15 min |
| GitHub Issue with `incident` label | P0/P1: 1 hr |
| Discord `#incident` channel | Best-effort |

### 4.3 Containment

**Immediate actions (first 15 minutes):**

```yaml
P0 Response Checklist:
1. Acknowledge incident in customer channel
2. Identify the STAS-generated PR that caused the outage
3. Determine if rollback or hotfix is faster
   → Rollback: `git revert <stas-commit>` and deploy
   → Hotfix: Apply manual fix, bypass STAS
4. Block STAS from running on the affected repo (feature flag)
5. Label the incident in the tracking system
6. Escalate to engineering on-call
```

**Containment strategies by scenario:**

| Scenario | Containment Action | Timeline |
|----------|--------------------|----------|
| **Bad code merged** | Revert the STAS PR commit | 5-10 min |
| **Configuration change** | Restore from backup config | 10-20 min |
| **Dependency change** | Revert package.json + lockfile | 5-10 min |
| **Data corruption** | Restore from backup (git reflog + DB backup) | 30-60 min |
| **Supply chain issue** | Revoke package publish, audit dependencies | 1-4 hours |

### 4.4 Root Cause Analysis

**RCA process (within 5 business days):**

1. **Identify the fix** — which STAS run produced the problematic code
2. **Trace the pipeline** — examine agent logs, LLM prompts, tool calls at each stage
3. **Determine gate failure** — which quality gate should have caught this (or why it didn't)
4. **Classify the hallucination type**:
   - *API hallucination* — agent invented an API that doesn't exist
   - *Logic error* — agent chose the wrong algorithm/approach
   - *Context loss* — agent lost track of codebase constraints
   - *Test blindness* — agent passed its own tests but missed real-world edge cases
5. **Identify process gap** — was the failure in:
   - 🔲 Quality gate coverage
   - 🔲 Human review
   - 🔲 Test suite adequacy
   - 🔲 Monitoring/observability
6. **Document findings** in the RCA template

**RCA template:**

```markdown
## Incident RCA: [TITLE]

**Date**: YYYY-MM-DD
**Severity**: P0/P1/P2/P3
**Duration**: X hours Y minutes

### Timeline
| Time | Event |
|------|-------|
| HH:MM | STAS PR merged by [user] |
| HH:MM | Monitoring alert triggered |
| HH:MM | Incident declared |
| HH:MM | Rollback executed |
| HH:MM | Service restored |
| HH:MM | RCA initiated |

### Root Cause
[Description of what the agent did wrong and why]

### Quality Gate Analysis
| Gate | Result | Should Have Caught? | Why/Why Not |
|------|--------|---------------------|-------------|
| 1. Reality Check | ✅ | ❌ | Issue was real file, wrong logic |
| 2. Compile Check | ✅ | ❌ | Code compiles fine |
| 3. Test Integrity | ✅ | ❌ | Tests pass (but are wrong) |
| 4. Hallucination/Stub | ✅ | ❌ | No stubs detected |
| 5. Dead Code | ✅ | ❌ | No dead code |
| 6. AI Tool Scan | ⚠️ Warn | ❌ | Pattern not in tool DB |

### Mitigation
[What fix was applied]

### Preventative Measures
1. [Gate improvement needed]
2. [Process change]
3. [Monitoring addition]

### Action Items
- [ ] [Owner] [Action] [Due date]
```

### 4.5 Customer Communication

**Communication templates by severity:**

#### P0 Immediate Notification (within 30 min)

```
Subject: [STAS] Incident Detected — Repo: [owner/repo]
Priority: CRITICAL

We've detected an incident potentially related to a STAS-generated fix
in your repository. Our team is actively investigating.

Current status:
- Incident ID: STAS-INC-2026-XXXX
- Impact: [brief description]
- Action taken: [rollback/investigation in progress]

Next update: within 60 minutes.

If you need immediate assistance, reply to this email or contact us
via [Slack/phone].
```

#### P0 Resolution Notification

```
Subject: [STAS] Incident Resolved — Repo: [owner/repo]

The incident has been contained and service has been restored.

Summary:
- Root cause: [brief]
- Duration: X hours Y minutes
- Fix applied: [rollback/hotfix/...]
- Service credits: [amount if applicable]

A full RCA will be provided within 5 business days.

We apologize for the disruption. Our team has identified the following
preventative measures: [2-3 bullet points].
```

**Status Page Updates:**

For customer-facing status page (Enterprise tier):
- **Active incident**: Updates every 30 minutes
- **Post-incident**: Summary within 1 hour of resolution
- **RCA published**: Within 5 business days

### 4.6 Compensation Model

**Service credit schedule:**

| Severity | Cloud Solo ($49/mo) | Cloud Team ($149/mo) | Enterprise |
|----------|--------------------|----------------------|------------|
| **P0 outage** (production, >15 min) | 5x monthly fee credit | 10x monthly fee credit | Tier 1: 100% of monthly fee. Tier 2: 200% of monthly fee. |
| **P1 outage** (major feature, >1 hr) | 2x monthly fee credit | 5x monthly fee credit | 50% of monthly fee |
| **P2 bug** (fix available, >24 hr) | 1x monthly fee credit | 2x monthly fee credit | 25% of monthly fee |
| **P3 issue** (cosmetic) | No credit | 0.5x monthly fee credit | 10% of monthly fee |

**Compensation cap:**
- Cloud Solo/Team: Max credit per incident = 10x monthly fee. Max per year = 3 months free.
- Enterprise: As defined in contract (typically 1-3 months free per rolling 12-month period).

**Compensation exclusions:**
- Incidents caused by customer modifications to STAS-generated code
- Incidents caused by bypassing recommended deployment workflow (e.g., direct merge without review)
- Incidents caused by third-party dependencies that STAS did not introduce
- Force majeure or events outside STAS's reasonable control

---

## 5. Competitive Analysis

### 5.1 Competitor Liability Approaches

| Product | Liability Stance | Guarantee | Insurance | Key Difference |
|---------|-----------------|-----------|-----------|----------------|
| **Devin (Cognition)** | Standard ToS — "as-is", no liability for generated code | Nothing beyond uptime SLA | Not disclosed | Relies on sandbox + observability as risk mitigation |
| **GitHub Copilot** | Microsoft standard — IP indemnification for generated code (limited) | Copilot IP indemnification (covers copyright claims only) | Microsoft corporate insurance | Strongest IP indemnification, but only for copyright, not bugs |
| **OpenHands** | MIT license — no warranty, no liability | None | None (self-hosted) | User assumes all risk |
| **Cursor** | Standard ToS — "as-is" | Nothing beyond subscription refund | Not disclosed | No code-generation liability |
| **Claude Code (Anthropic)** | API ToS — no liability for generated output | Nothing beyond API uptime | Anthropic corporate | No code-specific guarantees |
| **SWE-agent** | MIT license — no warranty | None | None | Academic project, no commercial terms |
| **Factory AI** | Standard ToS — "as-is" | Nothing disclosed | Not disclosed | Early stage, no liability framework |
| **STAS (target)** | **Tiered guarantees** | **SLA + fix quality guarantee** | **$2M+ cyber liability** | **Only tool with structured liability framework** |

### 5.2 Competitive Gap Analysis

| Liability Feature | Devin | Copilot | OpenHands | Cursor | STAS (target) |
|------------------|-------|---------|-----------|--------|---------------|
| IP indemnification for generated code | ❌ | ✅ (limited) | ❌ | ❌ | ✅ Solo/Team/Enterprise |
| Bug-caused outage compensation | ❌ | ❌ | ❌ | ❌ | ✅ Tiered SLA credits |
| Guaranteed quality gates | ❌ | ❌ | ❌ | ❌ | ✅ 6-gate pipeline |
| Stage rollout recommendation | ❌ | ❌ | ❌ | ❌ | ✅ Documented |
| Incident response SLA | ✅ (Enterprise) | ✅ (Azure SLA) | ❌ | ❌ | ✅ All paid tiers |
| Published RCAs | ❌ | ❌ | ❌ | ❌ | ✅ Within 5 business days |
| Cyber liability insurance | ❌ Not disclosed | ✅ (Microsoft) | ❌ | ❌ | ✅ $2M+ |
| Liability cap tied to fees | ❌ | ✅ (Microsoft std) | ❌ | ❌ | ✅ 12 months fees (Solo/Team) |

### 5.3 DACH-Specific Liability Considerations

German and EU law imposes stricter liability requirements than US law:

| Requirement | US Standard | German/EU Standard | STAS Compliance |
|-------------|-------------|--------------------|----------------|
| **Product liability** | Limited to express warranties | Producer liability for defective products (ProdHaftG) | STAS-generated code is a service, not a product — different legal basis |
| **GDPR liability** | Data processor liability capped | Joint controller liability possible (Art. 82 GDPR) | DPA terms define clear data processing roles |
| **Implied warranties** | Can disclaim | Cannot disclaim fitness for B2B (§ 434 BGB) | STAS provides express warranties that exceed implied minimum |
| **Liability cap validity** | Generally enforceable | Limited to gross negligence + intent (AGB control under § 307 BGB) | STAS caps at 12 months fees — aligned with BGH precedent |
| **Statute of limitations** | 2-4 years typical | 2 years (B2B) / 3 years (consumer) | ToS will specify applicable limitation period |
| **Contract language** | English sufficient | German required for enforceability against consumers | Enterprise contracts available in German |

**Action for DACH GTM**: STAS's tiered liability framework is a **competitive advantage** in the DACH market. German enterprises are conditioned to expect liability caps, indemnification, and insurance from their SaaS vendors. STAS's framework meets or exceeds typical DACH enterprise requirements.

---

## 6. Enterprise vs SMB Terms Comparison

| Dimension | SMB (Solo/Team) | Enterprise |
|-----------|----------------|------------|
| **Uptime SLA** | 99.5% | 99.9% (monthly) / 99.95% (annual) |
| **Fix quality guarantee** | Re-attempt on failure | ≥95% first-pass guarantee |
| **Production bug credit** | 5-10x monthly fee | 10x monthly fee + full incident response |
| **Liability cap** | 12 months of fees | 1-3x ACV (negotiated) |
| **IP indemnification** | Yes (capped) | Yes (full) |
| **Mutual indemnification** | No | Yes |
| **Insurance requirement** | STAS carries $2M | STAS carries $5M+, named insured option |
| **Audit rights** | None | Annual SOC 2 reports, on-site audit with notice |
| **Data processing agreement** | Standard DPA | Custom DPA with EU representatives |
| **Governing law** | Delaware, USA | German law option (for EU customers) |
| **Dispute resolution** | Courts of Delaware | German courts or arbitration (ICC) |
| **Confidentiality** | Standard NDA | Bilateral NDA with 5-year term |
| **Warranty period** | 30 days post-fix | 90 days post-fix |
| **Modification of generated code** | Void's warranty | Permitted with written notice |

---

## 7. Insurance and Warranty Options

### 7.1 STAS's Insurance Coverage

STAS carries the following insurance policies (as of 2026):

| Policy Type | Coverage Amount | Carrier | What It Covers |
|-------------|----------------|---------|----------------|
| **Cyber Liability** | $2M (SMB) / $5M+ (Enterprise) | [Carrier TBD] | Data breaches, security incidents, incident response costs |
| **Errors & Omissions (E&O)** | $2M per claim / $4M aggregate | [Carrier TBD] | Professional negligence, failure to perform, coding errors |
| **General Liability** | $2M aggregate | [Carrier TBD] | Bodily injury, property damage, personal injury |
| **Directors & Officers (D&O)** | $5M | [Carrier TBD] | Management liability |

**Insurance as competitive differentiator:**
- Devin: $500/mo team plan, no disclosed insurance
- OpenHands: Free self-hosted, no insurance
- GitHub Copilot: $10-39/mo, Microsoft corporate insurance
- **STAS**: $49-149/mo + carries $2M+ cyber/E&O insurance

### 7.2 Warranty Options

**Standard warranty (included in all paid plans):**

STAS warrants that:
1. The platform will operate in substantial conformity with the documentation
2. The quality gates will perform as described
3. Generated code will not infringe third-party IP (Solo/Team/Enterprise)
4. Security patches for known vulnerabilities will be applied within SLAs

**Extended warranty (Enterprise add-on):**

| Option | Coverage | Additional Cost |
|--------|----------|----------------|
| **Fix success guarantee** | 95%+ first-pass fix rate | Included in Enterprise |
| **Zero-downtime warranty** | Guaranteed no P0 from STAS-generated code | Negotiated (typically 15-25% uplift) |
| **Code audit warranty** | Full line-by-line audit of generated code by human engineers | $500-2,000 per fix (custom pricing) |
| **Supply chain warranty** | Guaranteed no hallucinated dependencies in generated code | Included in quality gates |

### 7.3 Customer Insurance Requirements

STAS may require the following from Enterprise customers:

| Customer Size | Cyber Insurance Required | Minimum Coverage |
|--------------|-------------------------|-----------------|
| < 50 employees | Recommended | $1M |
| 50-500 employees | Required | $2M |
| > 500 employees | Required | $5M |
| Regulated (finance, healthcare) | Required + regulatory | $10M+ |

---

## 8. Actionable Recommendations and Implementation Roadmap

### 8.1 Immediate (0-30 days)

- [ ] **Finalize ToS updates** — Incorporate the tiered liability framework into STAS terms of service. Legal review needed for DACH compliance.
- [ ] **PR body template** — Update the auto-generated PR body to include quality gate evidence and human review warning (§3.4).
- [ ] **Incident response playbook** — Merge the STAS-specific incident response playbook (§4) into the existing SOC 2 incident response plan.
- [ ] **RCA template** — Create and commit the RCA template for STAS-generated code incidents.
- [ ] **Status page** — Set up a customer-facing status page with incident notifications (Enterprise tier).
- [ ] **Documentation** — Publish this liability scenario document to `docs/gtm/liability-scenario.md`.

### 8.2 Short-term (30-90 days)

- [ ] **Cyber liability insurance** — Secure $2M+ cyber liability and E&O insurance policies. Add as named insured option for Enterprise.
- [ ] **SLA monitoring** — Implement uptime and quality gate SLA monitoring. Automate SLA credit calculation.
- [ ] **Customer communication templates** — Create incident notification templates for all severity levels.
- [ ] **Enterprise contract templates** — Draft German-language contracts with German law option for DACH customers.
- [ ] **Quality gate enhancement** — Add gates for detecting logic-level errors (beyond compilation/stub detection):
  - [ ] Semantic diff analysis against test coverage
  - [ ] Runtime verification in sandbox (run the actual code with test inputs)
  - [ ] Cross-file impact analysis

### 8.3 Medium-term (90-180 days)

- [ ] **Automated rollback** — Implement one-click rollback of STAS-generated PRs from the dashboard.
- [ ] **Canary deployment** — Build automated canary → staging → production pipeline for customer repos.
- [ ] **Insurance portal** — Allow Enterprise customers to download STAS insurance certificates on demand.
- [ ] **SLA credit automation** — Automate SLA credit issuance through the billing system when thresholds are breached.
- [ ] **Supply chain auditing** — Add automated supply chain auditing for all dependencies in generated code.

### 8.4 Long-term (180-365 days)

- [ ] **Zero-downtime warranty** — If quality gate pass rate exceeds 99.5% over 6 months, introduce a zero-downtime warranty for Enterprise customers.
- [ ] **Liability management MCP** — Build an MCP server that provides real-time liability exposure metrics: current fix quality scores, open incidents, SLA compliance, insurance coverage status.
- [ ] **Industry-specific liability frameworks** — Develop tailored liability terms for regulated industries (automotive ISO 26262, medical IEC 62304, finance PCI-DSS).
- [ ] **Self-insurance pool** — For high-volume Enterprise customers, explore a self-insurance pool where credits are pooled and payouts are capped annually.
- [ ] **Contractual liability cap escalation** — As STAS's quality track record grows, negotiate higher liability caps. Target: 5x ACV by year 2, 10x ACV by year 3.

### 8.5 Key Metrics to Track

| Metric | Target | Measurement |
|--------|--------|-------------|
| Quality gate pass rate | ≥95% first-pass | % of PRs passing all 6 gates on first attempt |
| Production escape rate | <0.1% of merged PRs | % of merged STAS PRs causing production incidents |
| Incident response SLA compliance | 100% within published SLAs | % of incidents meeting response time targets |
| Mean time to contain (MTTC) | <30 min for P0 | Average time from detection to containment |
| Mean time to resolve (MTTR) | <2 hr for P0 | Average time from detection to resolution |
| Customer compensation ratio | <5% of revenue | Total SLA credits / monthly recurring revenue |
| Insurance claims frequency | <1 per 10,000 fixes | Number of insurance claims / total fixes |

---

## Sources

- [STAS Quality Gates](../../STAS-QUALITY-GATES.md) — 6-gate pipeline for hallucination/stub detection
- [STAS Failure Mode Catalog](../failure-modes.md) — What STAS can and cannot fix
- [SOC 2 Incident Response Plan](../soc2/incident-response-plan.md) — Existing IR framework
- [Docker Sandbox Hardening](../ops/sandbox-hardening.md) — Sandbox isolation layers
- [Runaway Agent Protection](../ops/runaway-protection.md) — Timeout/turn/cost limits
- [Support Model](../support-model.md) — Tiered support SLAs
- [Pricing Model](../pricing-model.md) — Plan tiers and economics
- [DACH / EU Market Analysis](./germany-eu-taas-market-analysis.md) — Regional liability considerations
- [Competitor Research](./competitor-research.md) — Competitive liability landscape
- § 434 ff. BGB — German implied warranty provisions
- ProdHaftG — German Product Liability Act
- Art. 82 GDPR — Right to compensation and liability
- § 307 BGB — Unfair contract terms (AGB control)
