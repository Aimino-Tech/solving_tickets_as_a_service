# Data Retention and Deletion Policy — STAS

> Last updated: 2026-06-25

## 1. Retention Schedule
| Data Category | Retention | Deletion Method |
|---|---|---|
| Fix run data | Duration of run (5-30 min) | Sandbox destroy |
| Audit logs | 90 days | Automated rotation |
| Error logs | 30 days | Automated rotation |
| Account data | Subscription + 90 days | Manual on request |
| PR artifacts | 90 days (GitHub default) | GitHub-managed |
| Backups | 30 days | Automated rotation |
| Security scans | 90 days | CI artifact retention |
| Analytics | 24 months | Automated purging |

## 2. Deletion Procedures

### 2.1 Automated
- Sandbox cleanup: Immediate on run completion
- Log rotation: Daily cron job
- Backup rotation: Weekly full, daily incremental
- CI artifacts: GitHub Actions 90-day default

### 2.2 Manual (Customer Request)
- Email to security@aimino.com
- Response within 30 days
- Covers all data for customer's installation
- Confirmation sent after deletion

## 3. Data Disposal
| Storage | Method |
|---|---|
| PostgreSQL | Row deletion + VACUUM FULL |
| Redis | Key deletion + FLUSHDB |
| Log files | File deletion |
| Docker/E2B | Container destroy |
| Backups | File deletion |

## 4. Backup Retention
- Full backups: Weekly, retained 30 days
- Incremental: Daily, retained 30 days
- Verification: Automated restore testing weekly
- Encryption: All backups encrypted at rest

## 5. Deletion Request Flow
1. Customer submits request to security@aimino.com
2. Identity verification (2 business days)
3. Data identification and scope
4. Deletion execution (within 30 days)
5. Verification and confirmation
6. Deletion record retained for audit
