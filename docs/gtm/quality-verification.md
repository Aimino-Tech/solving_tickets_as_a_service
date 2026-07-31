# Quality Verification Strategy: Proving Tickets Are Solved Well Under Success-Based Billing

## Executive Summary

A comprehensive strategy for designing, implementing, and communicating quality verification mechanisms that eliminate customer suspicion of manipulation under STAS's success-based billing model. When customers only pay for successfully resolved tickets, the natural question becomes: *"How do I know the ticket was actually solved well?"*

This document defines the quality framework, anti-gaming measures, and transparent verification pipeline that transforms this trust deficit into STAS's strongest competitive advantage.

> **Key Finding**: Success-based billing removes the vendor-side incentive to over-bill, but creates a *new* trust problem: the vendor now has incentive to claim a ticket is "solved" when it isn't. Objective, third-party-verifiable quality gates are the only solution. When implemented correctly, this becomes a differentiator — no competitor offers verifiable quality guarantees.

---

## 1. The Trust Problem — Why Customers Suspect Manipulation Under Success-Based Billing

### The Asymmetric Incentive

Success-based billing ("pay only when we fix the ticket") is designed to align STAS's incentives with the customer's: we only get paid if the problem is solved. But this creates a second-order trust problem:

| Stakeholder | Perceived Incentive | Root Concern |
|-------------|--------------------|--------------|
| **STAS** | Claim resolution as quickly as possible to get paid | "They'll mark anything as solved" |
| **Customer** | Ensure real, verified, complete resolution | "I'm paying for half-baked work" |
| **Both** | Avoid disputes over quality | "Who decides what 'solved' means?" |

### The Manipulation Fear

Customers worry about three specific gaming scenarios:

1. **Shallow fixes**: The agent makes a minimal code change that compiles but doesn't actually resolve the root cause
2. **Test manipulation**: The agent writes tests that pass trivially (e.g., asserting `true === true`) to satisfy CI gates
3. **Definition stretching**: The agent reinterprets the acceptance criteria to match a narrower (easier) scope than intended

### Why This Matters for GTM

In DACH markets specifically, trust and verifiability are prerequisites — not nice-to-haves. German procurement processes require:

- Objectively verifiable deliverables (Leistungsnachweis)
- Clear acceptance criteria (Abnahmekriterien)
- Audit trail for every transaction (Prüfbarkeit)
- Dispute resolution mechanism (Streitschlichtung)

**A quality verification strategy is therefore not optional for DACH enterprise adoption. It is a gating requirement.**

---

## 2. Objective Quality Metrics

### Metric Framework

Every resolved ticket is scored across five dimensions. Each metric is **automatically computed, cryptographically signed, and stored immutably**.

| Metric | Weight | Passing Threshold | Measurement Method |
|--------|--------|-------------------|-------------------|
| **Test Coverage Impact** | 25% | ≥ 80% coverage on changed lines | `nyc`/`c8` diff-coverage or language equivalent |
| **Lint Compliance** | 15% | Zero new lint errors introduced | `biome check --changed` (or eslint/rubocop equivalent) |
| **CI Status** | 20% | Green on all required CI jobs | CI API status check |
| **Code Review Score** | 25% | ≥ 3.0/5.0 from automated review | Automated review (style, best practices, security) |
| **Acceptance Criteria Match** | 15% | ≥ 80% alignment with defined ACs | Semantic matching against ticket description |

### 2.1 Test Coverage Requirements

- **Minimum**: Every changed line must be covered by an existing or new test
- **Diff coverage**: Use language-appropriate tooling (e.g., `nyc` with `--check-coverage`, `pytest --cov`, `jacoco`)
- **Threshold**: 80% line coverage on the diff; 70% branch coverage on the diff
- **Exclusions**: Configuration files, generated code, vendored dependencies (auto-detected)
- **Reporting**: Coverage report attached to the PR as a check run and stored in the quality record

### 2.2 Lint Pass Gates

- **Zero-tolerance**: Any new lint error causes automatic rejection
- **Baseline-aware**: New lint issues are measured against the branch's baseline, not absolute zero
- **Tool-agnostic**: Biomes, ESLint, RuboCop, Pylint, golangci-lint — whatever the repo uses
- **Pre-existing issues**: Flagged but not blocking (the PR must not introduce *new* issues)

### 2.3 CI Green Status

- **Required jobs**: Build, test, lint, type-check, security scan
- **Flaky detection**: A job that passes on retry is flagged; three retries = manual review required
- **Duration regressions**: If a PR doubles CI time vs. baseline, flagged for review
- **External dependencies**: CI must pass with no network-dependent tests skipped

### 2.4 Code Review Score

An automated review produces a composite score from:

| Sub-dimension | Weight | What We Check |
|--------------|--------|--------------|
| **Style & Idiom** | 20% | Follows project conventions, no dead code |
| **Correctness** | 30% | Handles edge cases, no logic bugs found |
| **Security** | 25% | No injection, auth bypass, or data exposure |
| **Maintainability** | 15% | Clear naming, reasonable complexity, comments where needed |
| **Performance** | 10% | No N+1 queries, unbounded loops, or leaks |

### 2.5 Automated Verification Pipeline

```
Ticket Resolved → PR Created
  │
  ├── Stage 1: Acceptance Criteria Check
  │   ├── Parse ticket ACs (structured: Gherkin, DOORS, or free-text w/ LLM extraction)
  │   └── Score: matches per AC fulfilled (0–100%)
  │
  ├── Stage 2: Static Analysis
  │   ├── Lint (delta vs. baseline)
  │   ├── Type check
  │   └── Security scan (Semgrep/CodeQL)
  │
  ├── Stage 3: Test Execution
  │   ├── Full test suite (must pass)
  │   ├── Diff coverage report
  │   └── Mutation score (Stryker/pitest — optional config)
  │
  ├── Stage 4: Automated Code Review
  │   ├── LLM-based review against five dimensions
  │   └── Score output (capped at 5.0)
  │
  ├── Stage 5: Scorecard Assembly
  │   ├── Aggregate weighted score
  │   ├── Cryptographic hash of all artifacts
  │   └── Write to immutable store
  │
  └── Output: Quality Passport (JSON + QR)
```

---

## 3. Handling Edge Cases

### 3.1 No Existing Tests → Auto-Generation Strategy

When a repository has no test suite for the area being modified:

| Scenario | Strategy |
|----------|----------|
| **Repo has no tests at all** | Generate integration-level smoke tests first (canary) |
| **Module has no tests** | Generate unit tests for the changed functions + integration test |
| **Test framework missing** | Auto-detect language, install most common framework, generate tests |
| **Customer declines generated tests** | Escalate to manual verification (see §3.2) |

**Auto-generation guardrails**:

- Generated tests must be valid and compilable
- Generated tests must fail if the implementation is removed (no tautologies)
- Generated tests are reviewed by automated validator before inclusion
- Generated tests are clearly marked as `// STAS-generated` in a comment header

### 3.2 Manual Verification Requirements

Some contexts require human review regardless of automation:

| Trigger | Manual Review Required |
|---------|----------------------|
| Security-critical changes (auth, crypto, PII handling) | Always required |
| Infrastructure/CI/CD changes | Always required |
| Score below 3.0/5.0 | Always required |
| Customer requests it | Always honored |
| First 5 tickets for a new customer | Required (trust establishment) |

**Manual review process**:

1. STAS sends PR + quality scorecard to customer
2. Customer has 48 hours for review (configurable)
3. Customer can approve, request changes, or reject
4. Clock restarts on changes requested
5. After approval, billing trigger fires

### 3.3 Acceptance Criteria Alignment Protocol

When ticket ACs are ambiguous or incomplete:

1. **LLM extraction**: Parse ticket description + comments for implicit ACs
2. **Backfill request**: If confidence < 80%, STAS asks the customer to clarify
3. **Billing hold**: The ticket is not billed until ACs are confirmed
4. **Scope anchoring**: Both parties agree on what "done" means before work begins

---

## 4. Satisfaction Guarantee

### 4.1 Free Rework Policy

| Condition | Rework Coverage |
|-----------|----------------|
| PR fails quality gate (score < 3.0) | Free rework, no questions asked |
| Customer identifies defect within 7 days | Free rework, no questions asked |
| Quality score was ≥ 3.0 but customer disagrees | Mediated review, free rework if STAS side at fault |
| Customer changes requirements | Quoted separately (not rework) |

**Rework SLA**: Within 24 hours of notification.

### 4.2 Conditional Billing (Pay Only If Verified)

Billing triggers only when ALL of the following are true:

```
- [ ] Quality score ≥ 3.0/5.0
- [ ] All CI checks passing
- [ ] Acceptance criteria matched ≥ 80%
- [ ] No security flags raised
- [ ] Customer approved (unless auto-approve enabled)
- [ ] Immutable quality record written
```

**For auto-approve customers** (opt-in): billing triggers after 24 hours unless customer intervenes.

### 4.3 Escrow Verification Options

For enterprise customers requiring additional trust:

| Option | Description | Premium |
|--------|-------------|---------|
| **Third-party escrow** | Quality records are mirrored to an independent escrow service (e.g.,公证处, notarization) | +5% per ticket |
| **Customer-hosted verifier** | Customer runs the verification pipeline on their own CI to confirm results | Self-hosted |
| **Blockchain anchor** | SHA-256 hash of each quality passport anchored to a public blockchain (e.g., Ethereum, Stellar) | +2% per ticket |
| **Bundesnotar integration** | German electronic notarization (§14a BNotO) — exportable proof for litigation | Custom |

---

## 5. Anti-Gaming Measures

### 5.1 Preventing False Claims from Both Sides

Both parties have incentives to game the system:

| Party | Gaming Risk | Countermeasure |
|-------|-------------|---------------|
| **STAS** | Mark ticket solved with shallow fix | Hard quality gates, test coverage, immutable records |
| **Customer** | Claim ticket was never solved to avoid payment | Signed acceptance, review deadline, escrow |
| **STAS** | Generate tautological tests | Mutation testing, test quality scoring |
| **Customer** | Move goalposts after solution | AC anchored before work begins, scope-locked |
| **STAS** | Selectively run easy tickets | Random sampling of historical tickets for audit |
| **Customer** | Reject valid solutions as "not good enough" | Third-party mediation clause |

**Double-blind sampling**: 5% of tickets are independently evaluated by a separate STAS agent (not the one that solved it) to detect quality degradation over time.

### 5.2 Third-Party Audit Trail

Every ticket resolution produces an immutable audit trail:

```
Ticket: REPO-1234
├── Acceptance Criteria (anchored at T0)     ← signed by both parties
├── Resolution PR                            ← git-signed
├── Test Results (raw, pass/fail per test)   ← CI-signed
├── Coverage Report                          ← CI-signed
├── Lint Delta Report                        ← CI-signed
├── Automated Review Scorecard               ← AI-evaluator-signed
├── Customer Approval / Auto-approve         ← customer-signed or timestamped
├── Quality Passport (composite)             ← STAS-infrastructure-signed
└── Escrow Receipt (if applicable)           ← notary-signed
```

**Signature hierarchy**:
- STAS infrastructure key signs the composite passport
- CI system keys sign individual artifacts
- Customer key signs approval or rejection
- Third-party notary signs escrow receipts

### 5.3 Immutable Quality Records

| Store | Retention | Access | Technology |
|-------|-----------|--------|------------|
| **Primary** (STAS-hosted) | Duration of contract + 3 years | Customer dashboard, API, export | PostgreSQL + object storage |
| **Escrow** (third-party) | Duration of contract + 5 years | Customer + mediator only | Replicated S3 / GCS |
| **Blockchain anchor** (if opted) | Permanent | Public | Ethereum/Stellar timestamping |
| **Customer export** | Customer's retention policy | Customer-controlled | PDF, JSON, CSV formats |

Records are append-only. Once written, a quality passport cannot be modified — only superseded by a rework record.

---

## 6. Technical Implementation

### 6.1 Quality Gate Architecture

```
                    ┌──────────────────────┐
                    │   Ticket Ingest       │
                    │   (parse ACs, scope)  │
                    └──────┬───────────────┘
                           │
                    ┌──────▼───────────────┐
                    │   Orchestrator       │
                    │   (execution plan)   │
                    └──────┬───────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼────┐ ┌────▼────┐ ┌────▼────┐
       │ Agent     │ │ Agent   │ │ Agent   │
       │ Resolver  │ │ Reviewer│ │ Auditor │
       └──────┬────┘ └────┬────┘ └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────────────┐
                    │   Quality Gate       │
                    │   (automated checks) │
                    └──────┬───────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼────┐ ┌────▼────┐ ┌────▼────┐
       │ Pass      │ │ Fail    │ │ Manual  │
       │ (bill)    │ │ (rework)│ │ Review  │
       └───────────┘ └─────────┘ └─────────┘
```

### 6.2 Automated Scorecard System

The scorecard engine runs as a standalone microservice:

- **Triggers**: On PR creation/update (webhook from GitHub/GitLab)
- **Inputs**: PR diff, CI results, coverage XML, lint output, ticket ACs
- **Processing**: Language-agnostic adapters + LLM-based review
- **Output**: Structured scorecard JSON (schema below)
- **Storage**: Quality record appended to immutable store

**Scorecard Schema**:

```json
{
  "schema_version": "1.0",
  "ticket_id": "REPO-1234",
  "pr_url": "https://github.com/org/repo/pull/42",
  "metrics": {
    "coverage": { "score": 0.85, "pass": true, "details": { "lines": 245, "covered": 208 } },
    "lint": { "score": 1.0, "pass": true, "details": { "new_errors": 0, "baseline_errors": 47 } },
    "ci": { "score": 1.0, "pass": true, "details": { "jobs": 8, "passed": 8 } },
    "review": { "score": 4.2, "pass": true, "details": { "dimensions": { ... } } },
    "ac_match": { "score": 0.92, "pass": true, "details": { "ac_count": 6, "matched": 5, "partial": 1 } }
  },
  "composite_score": 4.12,
  "passed": true,
  "signed_by": "stas-infra-key-v1",
  "signature": "0x7a3b...",
  "timestamp": "2026-07-20T14:30:00Z",
  "blockchain_anchor": "0x8f2e..."
}
```

### 6.3 Customer Dashboard

A dedicated dashboard exposes quality verification data:

**Core views**:

| View | Shows |
|------|-------|
| **Ticket Quality Overview** | All tickets, composite score, pass/fail status |
| **Score Detail** | Full breakdown of five metric dimensions per ticket |
| **Trend Analysis** | Quality scores over time, by repo, by agent, by team |
| **Audit Trail** | Immutable record viewer with signature verification |
| **Escrow Status** | Escrow service status, blockchain anchor verification |

**Customer-facing features**:

- Export quality passport as PDF (signed)
- Verify signature (cryptographic verification widget)
- Compare tickets (side-by-side score comparison)
- Set quality thresholds per repo or per ticket type
- Configure auto-approve rules
- View rework history

**Design principles**:

- No marketing fluff — raw data, clearly labeled
- Every score links to its evidence (which test, which lint rule, which CI log)
- Dashboard must be independently verifiable — customer can run their own checks and compare

---

## 7. Competitive Analysis

### Quality Verification: How STAS Compares

| Feature | Devin | OpenHands | GitHub Copilot | Sweep | **STAS (target)** |
|---------|-------|-----------|---------------|-------|-----------------|
| **Success-based billing** | ❌ (credit-based) | ❌ (free) | ❌ (per-seat) | ❌ (free OSS) | ✅ **Core model** |
| **Quality scorecard** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Per-ticket score** |
| **Test coverage gate** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **≥80% diff coverage** |
| **Lint enforcement** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Zero new errors** |
| **Immutable audit trail** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Signed + escrow** |
| **Free rework guarantee** | ❌ (charged) | N/A (free) | N/A (tool) | N/A (free) | ✅ **7-day unconditional** |
| **Third-party escrow** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Optional** |
| **Dashboard for customers** | ✅ (logs) | ❌ (CLI) | ❌ (no) | ❌ (no) | ✅ **Quality-first** |
| **Blockchain anchoring** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Optional** |
| **Bundesnotar compliance** | ❌ (no) | ❌ (no) | ❌ (no) | ❌ (no) | ✅ **Planned** |

**Key Insight**: No competitor offers objective, verifiable quality gates on ticket resolution. Devin has observability (logs/screenshots) but not automated quality scoring. OpenHands lets you inspect the agent's work but provides no quality guarantees. **STAS's quality verification system is a unique competitive moat.**

### Market Positioning

```
Current market belief:
  "You get what you pay for" → High price = high quality

STAS positioning:
  "Prove it" → Every ticket comes with a verifiable quality guarantee
                  → Success-based billing removes the guesswork
```

### What This Unlocks

| Market Segment | Without Quality Verification | With Quality Verification |
|---------------|---------------------------|--------------------------|
| **SMB / startups** | "Is this worth $50/mo?" | "I can see exactly what I'm getting" |
| **Mid-market** | "We need a trial period" | "The quality passport replaces the trial" |
| **Enterprise DACH** | "We need proof of work" | "Everything is documented, signed, and verifiable" |
| **Regulated** | "We can't use AI without audit trail" | "Full audit trail + escrow + notarization" |

---

## 8. Anti-Gaming Comparison

### How STAS's Measures Compare to Industry Standards

| Anti-Gaming Mechanism | STAS | Devin | OpenHands | GitHub Copilot | Typical SaaS Contract |
|-----------------------|------|-------|-----------|---------------|----------------------|
| **Automated quality gates** | ✅ Hard, measurable, automated | ❌ Observability only | ❌ None | ❌ None | ❌ No equivalent |
| **Immutable records** | ✅ Cryptographically signed | ❌ Logs are mutable | ❌ None | ❌ None | ❌ No equivalent |
| **Third-party escrow** | ✅ Optional, configurable | ❌ Not available | ❌ Not applicable | ❌ Not available | ❌ Rarely available |
| **Free rework** | ✅ 7-day unconditional | ❌ Consumes credits | N/A (free) | N/A (tool) | ⚠️ Support-dependent |
| **Customer-hosted verification** | ✅ Pipeline is open-source | ❌ Closed | ✅ Self-hosted | ❌ Closed | ❌ Not applicable |
| **Double-blind audit sampling** | ✅ 5% random sample | ❌ Not available | ❌ Not available | ❌ Not available | ❌ Not available |

**Bottom line**: STAS's quality verification is more rigorous than any competitor and more transparent than typical SaaS contracts. For DACH enterprises with procurement departments that demand verifiability, this is a decisive advantage.

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Weeks 1–4)

- [ ] **Quality gate architecture**: Design and implement the quality gate orchestrator microservice
- [ ] **Scorecard schema**: Define and publish the scorecard JSON schema v1.0
- [ ] **Coverage adapter**: Build language-agnostic coverage parser (LCOV, Cobertura, JaCoCo)
- [ ] **Lint adapter**: Parse output from Biome, ESLint, RuboCop, golangci-lint, Pylint
- [ ] **CI adapter**: Integrate with GitHub Checks API and GitLab CI
- [ ] **Immutable store**: Set up append-only quality record storage

### Phase 2: Core Metrics (Weeks 5–8)

- [ ] **Test coverage gate**: Implement diff-coverage check with 80% threshold
- [ ] **Lint pass gate**: Zero-new-errors enforcement
- [ ] **CI green check**: Required job pass/fail aggregation
- [ ] **Automated code review**: LLM-based multi-dimension review agent
- [ ] **AC matching**: LLM-based acceptance criteria extraction and scoring
- [ ] **Composite scoring**: Weighted aggregate with configurable thresholds

### Phase 3: Customer Experience (Weeks 9–12)

- [ ] **Customer dashboard**: Quality overview, score detail, trend analysis
- [ ] **Quality passport export**: Signed PDF with QR code for verification
- [ ] **Auto-approve configuration**: Customer-configurable approval rules
- [ ] **Rework workflow**: Automated rework request handling
- [ ] **Email notifications**: Scorecard delivery + rework alerts

### Phase 4: Anti-Gaming & Trust (Weeks 13–16)

- [ ] **Cryptographic signing**: Infrastructure key management, artifact signing pipeline
- [ ] **Blockchain anchoring**: Integration with Ethereum/Stellar timestamping
- [ ] **Escrow integration**: Third-party escrow service (customer-selectable)
- [ ] **Double-blind audit**: Random 5% re-evaluation by independent agent
- [ ] **Dashboard signature verification**: Customer-side verification widget

### Phase 5: DACH Enterprise (Weeks 17–20)

- [ ] **Bundesnotar integration**: German electronic notarization (§14a BNotO)
- [ ] **BavG custom scoring**: Bavarian state-specific compliance scoring
- [ ] **German-language dashboard**: Full UI localization
- [ ] **Audit log export**: Compliance-ready CSV/JSON with signature chain
- [ ] **SLA integration**: Rework SLA tracking and penalty automation

### Phase 6: Optimization (Ongoing)

- [ ] **Score threshold tuning**: Adjust weights and thresholds based on production data
- [ ] **False positive reduction**: Improve AC matching and code review accuracy
- [ ] **Flaky test detection**: Identify and exclude unreliable tests from scoring
- [ ] **Customer feedback loop**: Quarterly calibration with customer satisfaction scores
- [ ] **Benchmarking**: Publish STAS quality benchmarks vs. human developers

---

## Appendix A: Key Performance Indicators

| KPI | Target | Measurement |
|-----|--------|-------------|
| Average quality score | ≥ 4.0/5.0 | Rolling 30-day average |
| Quality gate pass rate | ≥ 85% first attempt | Pass at first gate, no rework |
| Rework rate | ≤ 10% | PRs requiring rework within 7 days |
| Customer satisfaction with quality | ≥ 4.5/5.0 | Quarterly survey |
| Dispute rate | ≤ 1% | Tickets escalated to mediation |
| Escrow adoption (enterprise) | ≥ 50% | Enterprise customers using escrow |

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Quality Passport** | The signed, immutable composite record of all quality checks for a single ticket resolution |
| **Quality Gate** | An automated checkpoint that verifies a specific quality dimension (coverage, lint, CI, review, AC match) |
| **Diff Coverage** | Test coverage measured on only the changed lines in a PR (vs. overall repo coverage) |
| **Escrow** | A third-party service that holds and verifies quality records independently of STAS |
| **Double-Blind Audit** | A random selection of tickets independently re-evaluated by a separate agent to detect quality drift |

## Appendix C: Related Documents

- [Competitor Research](docs/gtm/competitor-research.md) — Competitive landscape for AI ticket-solving tools
- [Germany/EU TaaS Market Analysis](docs/gtm/germany-eu-taas-market-analysis.md) — DACH market dynamics and GTM best practices
- [STAS Quality Gates](STAS-QUALITY-GATES.md) — Technical implementation of the quality gate system
- [Pricing Model](docs/pricing-model.md) — Success-based billing structure and workspace pricing
