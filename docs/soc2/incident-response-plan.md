# Incident Response Plan — SYNTARO

> Last updated: 2026-06-25

## 1. Incident Classification
| Severity | Response SLA | Example |
|---|---|---|
| CRITICAL | 4 hours | RCE, auth bypass, credential leak |
| HIGH | 24 hours | SQL injection, privilege escalation |
| MEDIUM | 72 hours | XSS, missing rate limiting |
| LOW | 1 week | Missing security headers |

## 2. Response Phases

### 2.1 Detection
- Automated security scan alerts (semgrep, CodeQL, Grype)
- Sentry error threshold breaches
- Anomalous webhook traffic
- GitHub security advisory notifications
- User reports via security@aimino.com

### 2.2 Containment
- CRITICAL: Immediately disable affected service components
- HIGH: Apply rate limiting or feature flags
- Preserve evidence: capture logs, metrics, container state

### 2.3 Eradication
- Apply security patch or config fix
- Rotate affected credentials
- Update SAST rules to detect similar patterns
- Deploy through standard CI/CD pipeline

### 2.4 Recovery
- Restore from verified backups if needed
- Verify fix via automated CI gates
- Monitor for recurrence (24-48h)

### 2.5 Post-Mortem
- Root cause analysis document
- Remediation checklist
- Timeline and communications log
- Lessons learned

## 3. Roles
| Role | Responsibility | Contact |
|---|---|---|
| Security Lead | Incident coordination | tam@aimino.com |
| Engineering Lead | Technical investigation | On-call rotation |
| Communications | Stakeholder updates | security@aimino.com |

## 4. Communication
- GitHub Advisory: Public vulnerability disclosure
- Email (security@): Coordinated disclosure
- Status page: Service availability

## 5. Post-Incident Review
- Schedule within 5 business days
- Document timeline, root cause, corrective actions
- Update IR plan with lessons learned
