# Access Control Policy — STAS

> Last updated: 2026-06-25

## 1. Authentication

### 1.1 GitHub App
- JWT signed with RSA private key (PKCS#8)
- Installation tokens expire after 1 hour
- Scoped to specific repositories per installation

### 1.2 API Keys
| Key | Purpose | Storage |
|---|---|---|
| ADMIN_API_KEY | Admin API | Environment variable |
| STRIPE_SECRET_KEY | Stripe API | Environment variable |
| LINEAR_API_KEY | Linear integration | Environment variable |
| E2B_API_KEY | Sandbox provider | Environment variable |

### 1.3 Webhooks
- GitHub: HMAC-SHA256 signature verification
- GitLab/Bitbucket: Token-based verification
- Stripe: SDK built-in verification

## 2. Authorization

### 2.1 Principle of Least Privilege
- All components receive minimum access needed
- GitHub tokens scoped to single installation
- Sandbox: --cap-drop=ALL, --security-opt=no-new-privileges
- Database: role-specific credentials

### 2.2 Rate Limiting
| Layer | Scope | Limit |
|---|---|---|
| HTTP global | All requests | 30 req/min |
| Per installation | Account tier | Tier-dependent |
| Per repository | Fix runs | 30 req/hour |
| Per repository | Concurrent runs | 3 |

## 3. Access Reviews
- Quarterly review of access policies
- Incident-triggered review on security events
- Automated scanning via SAST (semgrep + CodeQL)

## 4. CI/CD Access
- All CI/CD in isolated GitHub Actions runners
- Secrets stored as encrypted GitHub Actions secrets
- No commit access to production without PR review
- Docker images scanned before deployment
