# SYNTARO Support Model

SYNTARO offers a **three-tier support model** designed to serve everyone from solo developers to enterprise teams — while keeping the open-source community thriving.

---

## Tier Overview

| Tier | Audience | Cost | Response Time | Channels |
|---|---|---|---|---|
| **Self-Service** | Everyone | Free | Immediate (docs/FAQ) | Documentation, FAQ, GitHub Issues |
| **Community** | Self-hosted & Cloud Free users | Free | Best-effort (hours) | Discord, GitHub Discussions |
| **Paid Support** | Cloud Pro ($49/mo) | Included | 24h (business hours) | Email |
| **Paid Support** | Cloud Business ($199/mo) | Included | 4h | Email, Slack, Priority |
| **Enterprise** | Custom pricing | Custom | Custom SLA | Dedicated Slack, Phone, SSO |

---

## Tier 1: Self-Service

**Available to:** All users (no account required)

The first line of support. Before reaching out, check these resources:

| Resource | Description | Link |
|---|---|---|
| **FAQ** | Answers to 30+ common questions | [`docs/FAQ.md`](./FAQ.md) |
| **Documentation** | Architecture, security, self-hosting, customization | [`docs/`](./) |
| **Troubleshooting Guide** | Common issues and their solutions | [`FAQ.md#troubleshooting`](./FAQ.md#troubleshooting) |
| **GitHub Issues** | Search existing issues before opening a new one | [Issues](https://github.com/tamnguyen08/solving_tickets_as_a_service/issues) |
| **Architecture Docs** | Deep-dive into the SYNTARO pipeline | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |

---

## Tier 2: Community Support

**Available to:** All users (free)

Community support is the heart of SYNTARO. Get help from maintainers and fellow users.

### Discord Server

Join our Discord: [https://discord.gg/aimino](https://discord.gg/aimino)

#### Channel Structure

| Channel | Purpose |
|---|---|
| `#announcements` | Release notes, security advisories, downtime notices |
| `#general` | General discussion about SYNTARO |
| `#help` | Get help with setup, configuration, and troubleshooting |
| `#self-host` | Self-hosting specific discussions (Docker, Railway, Fly.io, K8s) |
| `#showcase` | Share what you've built with SYNTARO |
| `#contributing` | Development discussion, PR reviews, code contributions |
| `#feedback` | Feature ideas, pain points, product feedback |
| `#integrations` | Platform integrations (GitHub, GitLab, Bitbucket, Linear, Jira) |
| `#jobs` | SYNTARO-related job postings and opportunities |

#### Discord Onboarding

New members are greeted with:
1. **Welcome message** with links to FAQ, docs, and code of conduct
2. **Role selection** — opt into `#self-host`, `#contributing`, or `#jobs` channels
3. **Community guidelines** reminder (see [Code of Conduct](../CODE_OF_CONDUCT.md))

### GitHub Discussions

For longer-form questions and feature discussions:
- **Q&A** — Setup and usage questions
- **Ideas** — Feature proposals and feedback
- **Show and tell** — Share your SYNTARO setup

### Best-Effort SLA

Community support is **best-effort** with no guaranteed response time. For faster replies:
- Be specific about your issue (include logs, config, steps)
- Search existing issues and Discord history first
- Tag your message with the relevant category

---

## Tier 3: Paid Support

**Available to:** Cloud Pro ($49/mo) and Cloud Business ($199/mo) subscribers

Paid support is included in every Cloud Paid plan. See [Pricing Model](./pricing-model.md) for full plan details.

### Pro Support ($49/mo)

| Attribute | Detail |
|---|---|
| **Response time** | 24 hours (business hours) |
| **Channel** | Email |
| **Coverage** | Setup, configuration, troubleshooting |
| **Hours** | Mon–Fri, 9am–5pm ET |
| **Escalation** | To Business tier if unresolved after 3 business days |

### Business Support ($199/mo)

| Attribute | Detail |
|---|---|
| **Response time** | 4 hours |
| **Channel** | Email + Slack (dedicated channel) |
| **Coverage** | Setup, configuration, troubleshooting, performance, custom integrations |
| **Hours** | 24/7 |
| **Escalation** | Direct line to engineering team |
| **Account manager** | Named support contact |

---

## Escalation Path

```
Self-Service (FAQ / Docs)
       │
       ▼
  Community (Discord / GitHub)
       │
       ├── Resolved → Done
       │
       ▼
  Paid Support (Email / Slack)
       │
       ├── Resolved → Done
       │
       ▼
  Engineering Team
       │
       ├── Bug fix / Feature request → GitHub Issue
       │
       ▼
  Incident Response (Critical / Production)
       │
       ▼
  Emergency Hotfix
```

### Escalation Rules

| Level | Trigger | Response Target |
|---|---|---|
| **P1 — Critical** | Production system down, data loss | 1 hour (Business) / 4 hours (Pro) |
| **P2 — High** | Major feature broken, no workaround | 4 hours (Business) / 24 hours (Pro) |
| **P3 — Medium** | Non-critical issue, workaround exists | 8 hours (Business) / 48 hours (Pro) |
| **P4 — Low** | Minor issue, cosmetic, documentation | Next release (Business) / Next release (Pro) |

### Reporting a Security Vulnerability

For security issues, **do not** post in public channels. Open a GitHub issue with the `security` label or email the maintainers directly. See [SECURITY.md](./SECURITY.md) for details.

---

## Support Hours

| Tier | Hours | Coverage |
|---|---|---|
| Community | Best-effort | Global (timezone-dependent) |
| Pro ($49/mo) | Mon–Fri, 9am–5pm ET | Business hours |
| Business ($199/mo) | 24/7 | Round-the-clock |
| Enterprise | Custom | Custom |

---

## Related Resources

- [Pricing Model](./pricing-model.md) — Detailed plan breakdown and economics
- [FAQ](./FAQ.md) — Frequently asked questions
- [Self-Hosting Guide](./SELF_HOSTING.md) — Self-hosting setup instructions
- [Architecture Overview](./ARCHITECTURE.md) — Deep-dive into the pipeline
- [Security Model](./SECURITY.md) — Security practices and vulnerability reporting
- [Code of Conduct](../CODE_OF_CONDUCT.md) — Community guidelines
