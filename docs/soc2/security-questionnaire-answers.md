---
title: Security Questionnaire Answers — Top 50
status: draft
last-updated: 2026-07-28
---

# Security Questionnaire Answers — Top 50

> **Answer bank for the most common security, compliance, and vendor risk assessment questions.**
> These answers reflect SYNTARO's current security posture as of July 2026.

---

## General

### Q1: What does SYNTARO do?

SYNTARO (Solving Tickets As A Service) is an open-source GitHub bot that automatically investigates, fixes, and opens pull requests for labeled issues. It uses AI agents (OpenCode) to understand bug reports, generate fixes, verify them, and submit PRs — all without human intervention.

### Q2: What type of data does SYNTARO process?

See the [Architecture Data Flow Document](architecture-data-flow.md#2-data-classification) for the full data classification. Summary: source code (ephemeral, processed in memory), issue metadata (stored temporarily), GitHub user IDs and usernames (log context), and credentials (environment variables only).

### Q3: Where is data processed and stored?

- **Cloud-hosted SYNTARO**: Data processed in US regions (AWS us-east-1 / us-west-2). PostgreSQL, Redis, and RabbitMQ in the same region. Logs retained for 90 days.
- **Self-hosted SYNTARO**: Data remains entirely within the customer's infrastructure. No data leaves the customer's network except AI inference API calls (configurable).

### Q4: Do you offer data residency options?

Yes. Self-hosted deployment (Docker Compose or Kubernetes) allows customers to run SYNTARO entirely within their own infrastructure, including air-gapped environments. AI provider endpoints can be configured to use region-specific APIs where supported.

### Q5: What compliance certifications do you hold?

SYNTARO is currently in the readiness phase for SOC 2 Type I (target: Q4 2026). We have not yet obtained formal certification. All security controls are documented and implemented in line with SOC 2 criteria, and a third-party readiness assessment has been completed. See the [Compliance Roadmap](../compliance-roadmap.md) for the certification timeline.

---

## Data Security

### Q6: How is data encrypted in transit?

All external communications use TLS 1.3 (preferred) with a minimum of TLS 1.2. Cipher suites: ECDHE-ECDSA-AES128-GCM-SHA256, ECDHE-RSA-AES128-GCM-SHA256, TLS_AES_128_GCM_SHA256, TLS_AES_256_GCM_SHA384. HSTS enabled with `preload`. Internal service communication uses mutual TLS (mTLS) in Kubernetes deployments.

### Q7: How is data encrypted at rest?

PostgreSQL: AES-256 (cloud provider managed). Redis: optional TLS + AUTH. RabbitMQ: AES-256 at rest via queue persistence + TLS for transport. Logs: AES-256 at rest. Backups: AES-256 encrypted. Sandbox tmpfs: no disk persistence. See [Encryption Policy](encryption-policy.md).

### Q8: How are encryption keys managed?

Database encryption keys are managed by the cloud provider (AWS KMS / Fly.io platform) with automatic 90-day rotation. GitHub App private keys (RSA 2048-bit) are generated per installation and stored as environment variables. API keys are UUIDv4 with 128-bit entropy. No customer-managed KMS integration is currently available, but is on the roadmap for enterprise self-hosted deployments.

### Q9: Is data segregated between customers?

Yes. Each GitHub App installation has its own set of credentials (installation token, webhook secret). Repository clones are isolated per run in ephemeral sandboxes. The database stores metadata keyed by GitHub installation ID and repository ID, ensuring logical segregation. No cross-customer data access is possible through the application.

### Q10: Do you use customer data for model training?

**No.** SYNTARO never uses customer code, issues, or any other data for model training. The AI provider (OpenCode / Anthropic / OpenAI) is contractually prohibited from training on customer data. Customer code is sent to the AI provider only for the purpose of generating a fix and is not stored.

---

## Access Control

### Q11: How is access to the production environment controlled?

- No direct SSH access to production instances
- All changes deployed via CI/CD pipeline (blue-green deployment)
- Production secrets stored as environment variables (never in code or config files)
- Database accessed only from within the private VPC
- Break-glass procedure requires two-person approval

### Q12: What authentication mechanisms are used?

| Interface | Mechanism | Strength |
|-----------|-----------|----------|
| GitHub App | RSA 2048-bit JWT + 1-hour installation tokens | Strong |
| Incoming webhooks | HMAC-SHA256 constant-time verification | Strong |
| Admin API | Pre-shared API key (UUIDv4, 128-bit entropy) | Strong |
| Internal services | Network-level ACL + optional mTLS | Strong |

### Q13: What is the principle of least privilege?

Every component receives the minimum permissions required for its function:
- GitHub tokens: `Contents: write`, `Pull Requests: write`, `Issues: read`, `Metadata: read`. No admin, no org-level access.
- Sandbox containers: `--cap-drop=ALL`, `--security-opt=no-new-privileges`, read-only root.
- Database roles: separate credentials per service with table-level permissions.
- Workers: no network access except whitelisted AI provider and GitHub API endpoints.

### Q14: How are employee access and permissions managed?

As an early-stage open-source project, there are currently no full-time employees with production access. Key-holder access (maintainer team) follows these principles:
- GitHub repository access: least-privilege teams, branch protection on main
- No direct database access; all schema changes via migrations in CI
- Secrets never shared; each maintainer uses individual credentials
- Background checks are not currently performed (team size < 5)

### Q15: Do you support SSO / SAML / SCIM?

Not currently. SSO/SAML is on the roadmap for enterprise self-hosted deployments. The admin API uses pre-shared keys. GitHub App authentication is managed through GitHub's OAuth flow, which supports GitHub-native SSO for organizations using GitHub Enterprise.

### Q16: How are API keys managed?

- Generated using cryptographically secure random (UUIDv4 or equivalent)
- Stored in environment variables only (never in code, config files, or version control)
- Rotated on employee offboarding or suspected compromise
- No hardcoded secrets in the codebase
- `.env.example` documents required variables without values

---

## Network Security

### Q17: Describe the network architecture.

See the [Security Overview](../security/security-overview.md#network-security) for a full network diagram. Summary: public-facing load balancer terminates TLS; API server, queue, database, and cache reside in a private VPC with no public IPs; sandbox workers run in isolated environments with network egress restricted to whitelisted endpoints only.

### Q18: What firewall rules are in place?

- All inbound: restricted to load balancer IP ranges only
- All outbound: blocked except whitelisted endpoints (AI provider API, GitHub API)
- Inter-service: allowed within private subnet only
- Sandbox: egress restricted to AI provider and GitHub API; all other traffic denied

### Q19: Is intrusion detection/prevention (IDS/IPS) in place?

Network-level IDS/IPS is provided by the cloud provider (AWS Shield / WAF for AWS deployments). Application-level detection is handled by Sentry (anomaly detection, error rate thresholds) and rate limiting (HTTP 30 req/min global, per-installation tiers). Semantic detection of malicious inputs is handled by prompt injection guards and input sanitization.

### Q20: Do you perform vulnerability scanning?

Yes. Multiple automated scanning layers:
- **Dependency scanning**: Dependabot (GitHub-native), `npm audit` in CI, Trivy in container builds
- **SAST**: semgrep + CodeQL run on every PR and commit to main
- **Container scanning**: Docker image scanning with Grype/Trivy in CI
- **Secret scanning**: TruffleHog in CI, GitHub secret scanning for the repository
- **Infrastructure scanning**: Hadolint for Dockerfile linting

---

## Application Security

### Q21: How do you handle input validation and sanitization?

All webhook payloads are validated against schemas (TypeScript types + runtime checks). GitHub webhooks are verified with HMAC-SHA256. Issue labels are checked against an allowlist. Prompt injection guardrails are applied to issue descriptions before they reach the AI agent. Repository contents are treated as untrusted input, and the agent operates in an isolated sandbox with no access to the host system.

### Q22: How do you prevent prompt injection?

See the [Prompt Injection Guard](../quality/prompt-injection-guard.md) document. Controls include: input sanitization, sandbox boundary enforcement (agent cannot access host), output validation, and rate limiting on fix attempts. The agent operates with restricted tool access and cannot execute arbitrary commands outside the sandbox.

### Q23: How are software dependencies managed?

- `package.json` / `pnpm-lock.yaml` version-locked with exact versions
- Dependabot configured for automated PRs on vulnerable dependencies
- `npm audit` runs in CI on every commit; pipeline blocks on critical vulnerabilities
- Trivy scans container images for OS-level CVEs
- Monthly dependency review and cleanup
- Only necessary dependencies included; attack surface minimized

### Q24: Describe the software development lifecycle (SDLC).

1. **Planning**: Issue filed, assigned, and triaged via Linear
2. **Development**: Feature branch from main, all changes in PRs
3. **Code review**: Required for every PR (branch protection)
4. **Automated CI gates**: TypeScript typecheck, lint (Biome), test (Vitest), SAST (semgrep + CodeQL), container scan (Trivy), dependency audit (npm audit), format check
5. **Staging**: Deployed to staging environment (Railway/Fly.io preview)
6. **Production**: Blue-green deployment via CI/CD pipeline; manual approval gate for production
7. **Monitoring**: Sentry error tracking, pino structured logging, /health endpoint

### Q25: How are code changes reviewed?

All changes require:
- Pull request with descriptive title and body
- At least one maintainer approval (branch protection rule)
- Passing CI gates (typecheck, lint, test, SAST, container scan, dependency audit)
- No direct pushes to main (branch protection enforced)
- PR template includes security implications section

### Q26: Do you conduct penetration testing?

Not yet. Third-party penetration testing is scheduled for Q3 2026 as part of the SOC 2 readiness program. Currently, security is validated through automated scanning (SAST, dependency scanning, container scanning) and manual code review. Bug bounty program is under consideration but not yet implemented.

### Q27: How do you handle security vulnerabilities discovered internally?

| Severity | Response SLA | Process |
|----------|-------------|---------|
| CRITICAL | 4 hours | Patch deployed immediately, incident response activated |
| HIGH | 24 hours | Hotfix release, affected customers notified |
| MEDIUM | 72 hours | Scheduled patch in next release cycle |
| LOW | 1 week | Included in next regular release |

### Q28: How do you handle security vulnerabilities reported externally?

SYNTARO follows coordinated disclosure practices:
1. Reporter submits to security@aimino.com (or via GitHub Security Advisory)
2. Acknowledgment within 24 hours
3. Triage and severity assessment within 72 hours
4. Fix developed and deployed based on severity SLA
5. Public disclosure after fix is deployed (minimum 30 days for critical issues)
6. CVE assignment where applicable

---

## Incident Response

### Q29: Do you have an incident response plan?

Yes. See the [Incident Response Plan](incident-response-plan.md) for full details. The plan covers detection, containment, eradication, recovery, and post-mortem phases. Incident severity is classified as CRITICAL (4h SLA), HIGH (24h), MEDIUM (72h), or LOW (1 week).

### Q30: How are security incidents detected?

- Automated security scan alerts (semgrep, CodeQL, Grype)
- Sentry error threshold breaches (anomaly detection)
- Anomalous webhook traffic patterns (rate limit violations)
- GitHub security advisory notifications
- User reports via security@aimino.com
- Log analysis for suspicious patterns

### Q31: What is your incident response SLA?

| Severity | Response Time | Resolution Target | Notification |
|----------|--------------|-------------------|--------------|
| CRITICAL | 4 hours | 24 hours | Within 1 hour |
| HIGH | 24 hours | 72 hours | Within 24 hours |
| MEDIUM | 72 hours | 7 days | Within 72 hours |
| LOW | 1 week | 30 days | Next release |

### Q32: Do you notify customers of security incidents?

Yes. For incidents affecting customer data or service availability:
- CRITICAL: Notified within 1 hour of confirmation
- HIGH: Notified within 24 hours
- MEDIUM/LOW: Included in next security advisory

Notification channels: email (registered account), service status page (planned), GitHub Security Advisory (for public incidents affecting multiple installations).

### Q33: Who is responsible for incident response?

The maintainer team handles incident response. Currently:
- **Primary contact**: security@aimino.com
- **Response team**: All maintainers with on-call rotation
- **Escalation**: Maintainer with security expertise leads technical response
- **Communication**: One maintainer handles external notifications

---

## Backup and Disaster Recovery

### Q34: What backup procedures are in place?

| Data Store | Backup Frequency | Retention | Verification |
|------------|-----------------|-----------|--------------|
| PostgreSQL | Daily (automated) | 30 days | Weekly restore test |
| Redis | Not backed up (ephemeral) | N/A | N/A (rebuilt from DB if needed) |
| RabbitMQ | Persistent queues (disk) | Until acknowledged | N/A |
| Configuration | Version-controlled (Git) | Full history | N/A |

### Q35: What is the disaster recovery plan?

**Cloud-hosted service:**
- **Recovery Point Objective (RPO)**: 24 hours (daily backups)
- **Recovery Time Objective (RTO)**: 4 hours (single-region)
- **Procedure**: Provision new infrastructure from Terraform, restore latest PostgreSQL backup, reconfigure Redis/RabbitMQ
- **Multi-region**: Not currently configured; planned for Q4 2026

**Self-hosted:**
- RPO/RTO defined by the customer's infrastructure
- SYNTARO provides Docker Compose and Kubernetes manifests for rapid redeployment
- Configuration is fully codified (environment variables, docker-compose.yml, k8s manifests)

### Q36: How do you ensure high availability?

| Component | HA Strategy |
|-----------|-------------|
| API server | Multiple replicas behind load balancer; stateless |
| PostgreSQL | Cloud provider managed (automated failover) |
| Redis | Redis Sentinel (configurable) |
| RabbitMQ | Clustered deployment (configurable) |
| Workers | Pool-based; multiple workers process queue in parallel |
| Sandbox | Dual provider (Docker local + E2B cloud) with fallback |

### Q37: What is your business continuity plan?

For extended outages (beyond DR recovery):
1. **Degraded mode**: SYNTARO continues to accept webhooks but queues jobs; processing resumes when service is restored
2. **Manual fallback**: Maintainers can manually trigger fix runs via CLI
3. **Self-hosted option**: Critical customers can self-host during cloud outage
4. **Communication**: Status page updated; affected customers notified via email

---

## Personnel Security

### Q38: Do you perform background checks on employees?

As an early-stage open-source project with fewer than 5 maintainers, formal background checks are not currently performed. This will be addressed as the team grows and formal employment relationships are established (target: Q4 2026 with SOC 2 readiness).

### Q39: What security training do employees receive?

Security awareness is documented in the project's [AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md). Key practices:
- Mandatory code review for all contributions
- No secrets in code or config files
- Responsible disclosure for found vulnerabilities
- Quarterly security review of dependencies and controls
- Formal security training will be implemented as the team grows

### Q40: How is access revoked when an employee leaves?

- GitHub repository access: removed immediately via organization settings
- API keys: rotated on offboarding (no individual keys currently)
- Production access: only via environment variables, which are reset
- Notification: team notified of access change
- Audit: access logs reviewed for any anomalous activity after offboarding

---

## Vendor and Third-Party Risk

### Q41: Who are your subprocessors?

See the [Architecture Data Flow Document](architecture-data-flow.md#51-subprocessor-table) for the complete list. Current subprocessors: GitHub (Microsoft), OpenCode / Anthropic / OpenAI, RabbitMQ (CloudAMQP or self-hosted), E2B, Sentry, Stripe, Supabase (optional), Vercel (marketing site only).

### Q42: How do you assess vendor security?

Before engaging a new subprocessor:
1. SOC 2 report or equivalent certification obtained and reviewed
2. Data processing agreement (DPA) signed with standard contractual clauses
3. Penetration testing results reviewed (where available)
4. Data classification mapping for shared data
5. Customer notification (30-day notice where contractually required)

### Q43: Do you have DPAs with your subprocessors?

Yes. DPAs are in place with all subprocessors that process customer data. These include standard contractual clauses (SCCs) for EU data transfers. Existing DPAs are available for customer review upon request.

### Q44: Can customers request a copy of your SOC 2 report?

SOC 2 certification is not yet complete (target: Q4 2026 for Type I). Once certified, reports will be made available to customers under NDA. In the interim, we provide this security questionnaire, our [Security Overview](../security/security-overview.md), and the [readiness assessment](readiness-assessment.md).

---

## Logging and Monitoring

### Q45: What is logged and for how long?

All actions across the platform are logged as structured JSON (pino). See [Security Overview > Audit Trail](../security/security-overview.md#audit-trail) for the full details. Summary: 90-day hot retention (accessible for analysis), 1-year cold archive (immutable). Audit logs include timestamps, actor IDs, action types, and correlation IDs.

### Q46: Are logs immutable?

Yes. Audit logs are append-only. No deletion capability exists for audit log entries. Integrity is maintained via SHA-256 hash chaining for critical events. Log storage is configured with write-once-read-many (WORM) policies where supported by the storage provider.

### Q47: How do you detect and respond to anomalies?

- **Error rate thresholds**: Sentry alerts on error spike detection
- **Rate limit violations**: Automated rate limiting with configurable thresholds
- **Webhook pattern analysis**: Unexpected payload sizes, frequencies, or sources
- **Failed authentication attempts**: Logged and monitored; multiple failures trigger temporary IP block
- **GitHub API anomalies**: Unexpected response codes or rate limiting from GitHub

---

## Business and Legal

### Q48: What is your business continuity and disaster recovery plan?

See Q34–Q37 for the detailed DR plan. Summary: daily PostgreSQL backups (30-day retention, weekly restore test), 24-hour RPO, 4-hour RTO (single-region), fully codified infrastructure via Docker Compose and Kubernetes manifests. Multi-region DR is planned for Q4 2026.

### Q49: Do you have a data retention and deletion policy?

Yes. See the [Data Retention and Deletion Policy](../policies/data-retention-deletion.md):
- **Source code**: Ephemeral — deleted immediately after fix run
- **Job metadata**: 90 days (PostgreSQL)
- **Logs**: 90 days hot, 1 year cold archive
- **Error telemetry**: 90 days (Sentry)
- **Customer deletion requests**: Honored within 30 days; data scrubbed from all systems
- **Backups**: 30-day retention with automated deletion

### Q50: What is your approach to compliance and what certifications are you pursuing?

SYNTARO is pursuing SOC 2 Type I (target: Q4 2026), followed by SOC 2 Type II (target: Q2 2027), and ISO 27001 (target: Q2 2027). All security controls are already implemented and documented in line with SOC 2 criteria. A third-party readiness assessment has been completed. See the [Compliance Roadmap](../compliance-roadmap.md) for the full timeline and estimated costs.

---

## References

- [Security Overview](../security/security-overview.md) — Architecture, encryption, access control, network security
- [Architecture Data Flow](architecture-data-flow.md) — System boundaries, data classification, data flows
- [Incident Response Plan](incident-response-plan.md) — Incident classification and procedures
- [Encryption Policy](encryption-policy.md) — Encryption standards and key management
- [Access Control Policy](access-control-policy.md) — Authentication and authorization
- [Data Retention and Deletion Policy](../policies/data-retention-deletion.md) — Retention schedules
- [Data Processing Agreement](../policies/data-processing-agreement.md) — Customer DPA
- [Control Mapping](control-mapping.md) — SOC 2 control-to-implementation mapping
- [Compliance Roadmap](../compliance-roadmap.md) — Certification timeline and costs
