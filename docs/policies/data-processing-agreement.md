# Data Processing Agreement (DPA)

> Template version: 1.0 | Last updated: 2026-06-25

## 1. Parties
- Data Controller: Customer/organization using STAS
- Data Processor: Aimino, provider of STAS

## 2. Scope
This DPA governs processing of personal data by the Processor for the Controller in connection with STAS.

## 3. Data Categories
| Category | Description | Purpose |
|---|---|---|
| GitHub account data | Username, avatar, public profile | Auth, attribution |
| Issue content | Title, body, comments, labels | Fix investigation |
| Repository code | Source code, diffs, files | Fix generation |
| Metadata | Repo names, issue numbers, timestamps | Operations, audit |
| Logs | Execution logs, errors | Debugging, improvement |

## 4. Processing Purposes
1. Investigating and fixing GitHub issues
2. Creating pull requests with fixes
3. Posting status updates to issues
4. Service operation and monitoring
5. Legal compliance

## 5. Data Subject Rights
- Access, rectification, erasure, portability, objection
- Response: 30 days from verified request

## 6. Sub-Processors
| Sub-Processor | Service | Location |
|---|---|---|
| GitHub, Inc. | Source code hosting, API | United States |
| E2B, Inc. | Sandbox execution | United States |
| Railway Corp./Fly.io | Cloud infrastructure | Varies |
| Stripe, Inc. | Payment processing | United States |
| Sentry, Inc. | Error monitoring | United States |

Notification of new sub-processors: 30 days prior.

## 7. Security Measures
1. Encryption at rest: AES-256 for databases and backups
2. Encryption in transit: TLS 1.2+ for all communications
3. Access controls: GitHub App auth, API keys, least privilege
4. Sandbox isolation: Ephemeral, network-restricted environments
5. SAST scanning: semgrep + CodeQL on every change
6. Audit logging: Structured logs of security events
7. Incident response: Defined severity levels with SLA

Full details: docs/SECURITY.md, docs/soc2/

## 8. Breach Notification
- CRITICAL: 4 hours
- HIGH: 24 hours
- MEDIUM: 72 hours

## 9. Data Retention
| Data Type | Retention | Deletion |
|---|---|---|
| Issue data | Fix run duration | Auto on sandbox destroy |
| Audit logs | 90 days | Automated rotation |
| Error logs | 30 days | Automated rotation |
| Account data | Subscription + 90 days | On request |
| Backups | 30 days | Automated rotation |

## 10. Governing Law
Jurisdiction specified in Controller's subscription agreement.

## 11. Acceptance
By using STAS, the Controller accepts this DPA. Signed copies available on request to security@aimino.com.
