# Encryption Standards — STAS

> Last updated: 2026-06-25

## 1. Encryption at Rest

### 1.1 Database (PostgreSQL)
- Algorithm: AES-256 (cloud provider managed)
- Connection: TLS 1.2+ via DATABASE_SSL=true
- Key Management: Cloud provider managed
- Backup Encryption: AES-256

### 1.2 Cache (Redis)
- Authentication: Redis AUTH required
- TLS: Redis TLS when REDIS_TLS_ENABLED=true
- Memory: In-memory only, no disk persistence

### 1.3 Message Queue (RabbitMQ)
- Authentication: Username/password required
- Encryption: TLS via amqps:// connection URL

### 1.4 File System
- Container Root: Read-only in sandbox
- Temp Storage: tmpfs (memory-backed)
- Secrets: Environment variables only

## 2. Encryption in Transit

### 2.1 TLS Configuration
| Parameter | Value |
|---|---|
| Min TLS Version | 1.2 |
| Preferred Ciphers | ECDHE-ECDSA-AES128-GCM-SHA256, ECDHE-RSA-AES128-GCM-SHA256 |
| HSTS | max-age=31536000; includeSubDomains; preload (prod) |
| Certificate Type | Let's Encrypt (auto-renewal) |

### 2.2 HTTPS Enforcement
- All HTTP redirected to HTTPS in production
- CSP upgrade-insecure-requests directive (prod)

### 2.3 API Security Headers
| Header | Value | Purpose |
|---|---|---|
| Strict-Transport-Security | max-age=31536000 | Enforce HTTPS |
| X-Content-Type-Options | nosniff | Anti-MIME sniffing |
| Content-Security-Policy | Per SECURITY.md S12.1 | XSS prevention |
| Permissions-Policy | All disabled | API-only context |

## 3. Key Management
| Key Type | Generation | Storage | Rotation |
|---|---|---|---|
| TLS Certs | Let's Encrypt | Platform | Auto (90 days) |
| GitHub App Key | RSA 2048-bit | Env var | Manual |
| Webhook Secret | CSPRNG 64+ chars | Env var | Quarterly |
| DB Credentials | CSPRNG 32+ chars | Env var | Quarterly |
| API Keys | CSPRNG 32+ chars | Env var | On incident |

## 4. Compliance
- SOC 2: Encryption maps to CC6 (Logical and Physical Access)
- GDPR: Article 32 (Security of Processing)
- Industry: AES-256 and TLS 1.2+ per NIST SP 800-57
