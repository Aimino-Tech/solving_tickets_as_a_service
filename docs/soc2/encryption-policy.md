# Encryption Policy — SYNTARO

> Last updated: 2026-06-25

## 1. Encryption at Rest

### 1.1 Database (PostgreSQL)
- Algorithm: AES-256 (cloud provider managed)
- Connection Security: TLS 1.2+ via DATABASE_SSL=true
- Backups: AES-256 encrypted

### 1.2 Cache (Redis)
- Authentication: Redis AUTH (required)
- In-Transit: Redis TLS when REDIS_TLS_ENABLED=true

### 1.3 Message Queue (RabbitMQ)
- Encryption: TLS via amqps:// URL scheme
- Authentication: Username/password required

### 1.4 File System
- Container Root: Read-only filesystem in sandbox
- Temp Storage: tmpfs (memory-backed, no disk persistence)
- Secrets: Environment variables only, never written to disk

## 2. Encryption in Transit

### 2.1 TLS Configuration
| Parameter | Value |
|---|---|
| Minimum TLS Version | 1.2 |
| Cipher Suites | ECDHE-ECDSA-AES128-GCM-SHA256, ECDHE-RSA-AES128-GCM-SHA256 |
| HSTS | max-age=31536000; includeSubDomains; preload (prod) |
| Certificates | Let's Encrypt (automated renewal) |

### 2.2 HTTPS Enforcement
- All HTTP redirected to HTTPS in production
- HSTS header forces browser/API client TLS
- upgrade-insecure-requests CSP directive (production)

## 3. Key Management
| Key Type | Generation | Storage | Rotation |
|---|---|---|---|
| TLS Certs | Let's Encrypt | Platform managed | Auto (90 days) |
| GitHub App Key | RSA 2048-bit | Env var or file | Manual |
| Webhook Secret | CSPRNG 64+ chars | Env var | Quarterly |
| API Keys | CSPRNG 32+ chars | Env var | On incident |

## 4. Compliance
- SOC 2 encryption standards alignment
- Industry standard AES-256 and TLS 1.2+
- Quarterly encryption policy review
