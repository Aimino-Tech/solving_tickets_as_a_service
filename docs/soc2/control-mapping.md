# SOC 2 Control Mapping — SYNTARO

## Security Category

### CC1 — Control Environment
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Integrity | OSS with Code of Conduct, CONTRIBUTING.md | CODE_OF_CONDUCT.md |
| Board oversight | Maintainers oversee security posture | AGENTS.md |

### CC2 — Communication
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Quality information | Structured pino logging with request IDs | src/services/logger.ts |
| Incident communication | Security vulnerability disclosure process | SECURITY.md S11 |

### CC3 — Risk Assessment
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Risk identification | semgrep + CodeQL SAST scanning every PR | sast.yml |
| Vendor risk | E2B sandbox provider SOC2 report | docs/soc2/readiness-assessment.md |

### CC4 — Monitoring
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Ongoing monitoring | Sentry error tracking, /health endpoint | src/server.ts |
| Independent evaluations | CI gates (LSP, regression, lint diff) | ci.yml |

### CC5 — Control Activities
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Access control | GitHub App installation tokens, API key auth | src/security/authMiddleware.ts |
| Segregation | Sandbox isolation prevents code-access-to-infra | src/security/sandboxSecurity.ts |
| Encryption | TLS 1.2+ in transit, DATABASE_SSL at rest | SECURITY.md S12 |

### CC6 — Logical and Physical Access
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Logical access | Webhook signature verification (HMAC-SHA256) | src/webhooks/base.ts |
| Authentication | GitHub App JWT + installation tokens | src/github/auth.ts |
| Authorization | Per-repo rate limits, tier-based quotas | src/ratelimit/ |

### CC7 — System Operations
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| System monitoring | Prometheus metrics, structured logging | src/monitoring/ |
| Incident response | Severity-based SLA (4h critical, 24h high) | SECURITY.md S11.3 |

## Availability Category

### A1 — Backup and Recovery
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Data backups | Automated PostgreSQL + Redis backups with verification | scripts/backup-*.sh |
| Recovery | Restore scripts with validation | scripts/restore-*.sh |

### A2 — Disaster Recovery
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| DR plan | Documented in ops/runbook.md | ops/runbook.md |
| Failover | Blue-green deployment via Railway/Fly.io | DEVELOPMENT.md |

## Confidentiality Category

### C1 — Confidential Information Protection
| Control | SYNTARO Implementation | Reference |
|---|---|---|
| Data classification | Customer code/data classified confidential | DPA S2 |
| Access restrictions | Ephemeral sandboxes, no persistent code storage | SECURITY.md S2 |
| Encryption | AES-256 at rest (database), TLS 1.2+ in transit | docs/soc2/encryption-policy.md |
| Data disposal | Sandbox cleanup on completion, log rotation | src/security/sandboxSecurity.ts |
