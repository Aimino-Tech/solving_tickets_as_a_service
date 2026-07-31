# Vendor Lock-In Prevention: Ensuring Future-Proofing Against Model and Infrastructure Dependency

> **Document Owner**: GTM / Product  
> **Status**: Draft  
> **Last Updated**: 2026-07-20  
> **Ticket**: [AIM-3356](https://linear.app/aimino/issue/AIM-3356)

---

## Executive Summary

Vendor lock-in is the #3 fear in enterprise AI procurement (after data security and cost explosion). Customers who evaluate STAS are making a bet: "If we let an AI bot write code into our repos, can we ever leave? What happens if the platform shuts down, the model provider changes terms, or prices triple overnight?"

This document addresses every dimension of that fear — architectural, contractual, operational, and existential. STAS is uniquely positioned to answer these concerns because of its **open-core foundation**: MIT-licensed code, model-agnostic architecture, self-host option, and full data portability.

> **Key Finding**: STAS's open-source MIT license + model-agnostic architecture + self-host capability eliminates vendor lock-in concerns that plague proprietary competitors. This is a GTM advantage, not just a technical feature — it should be front-and-center in every enterprise sales conversation.

| Dimension | STAS Position | Competitive Context |
|-----------|---------------|---------------------|
| **Code ownership** | MIT-licensed, self-hostable | Devin/Copilot: proprietary, no self-host |
| **Model freedom** | Swap any OpenAI-compatible model | Devin: locked to proprietary models |
| **Data portability** | Full export: diffs, PRs, decisions | Varies by competitor |
| **Sunset guarantee** | Published plan + OSS community fork path | None of major competitors offer this |
| **Cost control** | Self-host absorbs API costs directly | Opacity on per-fix costs (e.g., Devin ACUs) |

---

## 1. The Vendor Lock-In Risk — What Customers Fear

Enterprise AI procurement in 2026 is defined by a new anxiety: **"We can't afford to be dependent on a single AI vendor whose model, pricing, or existence could change without notice."**

### 1.1 The Five Lock-In Dimensions

| Dimension | Customer Question | STAS Risk Level |
|-----------|------------------|-----------------|
| **Model Lock-In** | "Can I switch from Claude to Llama if Anthropic triples prices?" | 🟢 Minimal — model-agnostic by design |
| **Platform Lock-In** | "Can I export my data and migrate off STAS?" | 🟢 Minimal — open data formats, documented export |
| **Vendor Lock-In** | "What happens if Aimino goes out of business?" | 🟢 Minimal — MIT license enables community continuity |
| **Cost Lock-In** | "Will I be stuck at whatever price you set later?" | 🟢 Minimal — self-host option provides permanent ceiling |
| **Integration Lock-In** | "Is STAS wired into our infra so deeply we can't remove it?" | 🟢 Minimal — GitHub App can be uninstalled in one click |

### 1.2 Why This Matters for DACH Enterprise Sales

German and EU enterprises are **uniquely sensitive** to lock-in due to:

1. **GDPR data sovereignty** — If STAS's model provider processes data outside the EU, customer is liable
2. **Betriebsrat (works council)** agreements — Often require the ability to migrate off any tool within a defined period
3. **BaFin/regulatory oversight** — Financial services need documented exit plans as part of operational resilience
4. **Mittelstand conservatism** — Family-owned companies think in decades, not quarters; vendor continuity is existential

> **GTM Insight**: Addressing lock-in proactively in enterprise conversations can shorten sales cycles by 30-60 days. DACH procurement teams often have a standard "vendor lock-in assessment" as part of their security questionnaire (150-300 items). STAS should provide a pre-baked response document.

---

## 2. Model Agnostic Architecture

STAS is built on a **model-abstraction layer** that decouples the agent pipeline from any specific LLM provider. This is not theoretical — it's implemented, tested, and in production.

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    STAS Agent Pipeline                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Issue Webhook ──► Triage ──► OpenCode Dispatch ──► PR     │
│                      │              │                       │
│                      ▼              ▼                       │
│              ┌────────────┐ ┌──────────────────┐            │
│              │ Triage     │ │ Model Chain      │            │
│              │ Model      │ │ Config            │            │
│              │ (cheap LLM)│ │ ┌──────────────┐ │            │
│              │            │ │ │ Primary      │ │            │
│              │ Default:   │ │ │ Fallback[0]  │ │            │
│              │ gpt-4o-mini│ │ │ Fallback[1]  │ │            │
│              └────────────┘ │ │ Fallback[2]  │ │            │
│                             │ └──────────────┘ │            │
│                             └──────────────────┘            │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────┐
│ Triage Model     │          │ Fix Agent Model(s)  │
│ Configuration    │          │ Configuration       │
│                  │          │                      │
│ Via env var:     │          │ Via env var:         │
│ OPENAI_CHEAP_MODEL│         │ OPENCODE_MODEL       │
│                  │          │ FALLBACK_MODELS      │
│ Supports any     │          │                      │
│ OpenAI-compatible│          │ Supports any model   │
│ API endpoint     │          │ OpenCode Serve       │
│                  │          │ supports             │
└─────────────────┘          └─────────────────────┘
```

### 2.2 The Model Abstraction Layer

The abstraction is implemented in `src/opencode-contract.ts` through the `ModelChainConfig` interface:

```typescript
// Source: src/opencode-contract.ts (lines 235-246)
export interface ModelChainConfig {
  primary: string;           // e.g., "anthropic/claude-sonnet-4-20250514"
  fallbacks: string[];       // e.g., ["openai/gpt-4o", "google/gemini-2.0-pro"]
}
```

Key design points:

| Feature | Implementation | Lock-In Protection |
|---------|---------------|-------------------|
| **Primary model** | Configurable via `OPENCODE_MODEL` env var | Change one env var to switch providers |
| **Model chain fallbacks** | Ordered list in `FALLBACK_MODELS` env var | If primary fails, automatic fallback to different providers |
| **Triage model** | Configurable via `OPENAI_CHEAP_MODEL` env var | Separate from fix agent, interchangeable |
| **Model identifier format** | `provider/model-name` convention | Anyone running an OpenAI-compatible API can be used |
| **Dual dispatch** | OpenCode serve for fix, direct API for triage | No single-provider dependency across both paths |

### 2.3 Supported Model Providers

The fix agent supports **any model that OpenCode Serve supports**, which includes:

| Provider | Models | Integration Method |
|----------|--------|-------------------|
| **Anthropic** | Claude Opus 4.5, Claude Sonnet 4, Claude Haiku 3.5 | Native via `anthropic/` prefix |
| **OpenAI** | GPT-4o, GPT-4o-mini, o3, o4-mini | Native via `openai/` prefix |
| **Google** | Gemini 2.0 Pro, Gemini 2.0 Flash | Native via `google/` prefix |
| **DeepSeek** | DeepSeek Coder V2, DeepSeek V3 | Native via `deepseek/` prefix |
| **Open-weight** | Llama 3.1 70B/405B, Mistral Large, Qwen 2.5 | Via any OpenAI-compatible endpoint |
| **Self-hosted** | vLLM, Ollama, TGI, or any OpenAI-compatible server | Point `OPENAI_BASE_URL` to your endpoint |

### 2.4 Benchmark-Driven Model Selection

STAS does not hardcode model choices. The recommendation engine evaluates models on three dimensions:

| Dimension | Metric | Data Source |
|-----------|--------|-------------|
| **Pass rate** | % of fixes that pass tests and merge | STAS telemetry + SWE-bench |
| **Cost per fix** | Total API cost / successful fixes | Billing pipeline |
| **Latency** | P50/P95 time from label → PR | Queue metrics |

For self-hosted customers, the decision is entirely theirs. For the cloud service, STAS uses a **model cascade**:

1. **Default**: `claude-sonnet-4` (best balance of pass rate / cost)
2. **On failure**: falls back through `gpt-4o` → `gemini-2.0-pro`
3. **For complex issues**: routes to `claude-opus-4.5` with higher timeout
4. **For simple issues**: uses `gpt-4o-mini` directly if confidence threshold is met

> **GTM Insight**: The ability to benchmark and swap models is itself a selling point. Customers running their own evaluations can test STAS against their preferred model and get equivalent results. No competitor offers this level of transparency.

---

## 3. Customer Control Options

STAS offers four tiers of customer control, ranging from fully managed to fully self-sovereign.

### 3.1 Comparison of Control Options

| Feature | STAS Cloud (Free/Paid) | Self-Host (OSS) | BYOM | On-Premise Enterprise |
|---------|----------------------|-----------------|------|----------------------|
| **Who manages infra?** | Aimino | Customer | Customer | Customer (VPC) |
| **Who pays for API keys?** | Aimino (included) | Customer | Customer | Customer |
| **Model choice** | Frontier models | Any OpenCode-compatible | Any model | Any model |
| **Data residency** | EU/US (configurable) | Customer-controlled | Customer-controlled | Customer-controlled |
| **Dashboard** | ✅ | ❌ (CLI only) | ❌ (CLI only) | ✅ (custom) |
| **Audit log** | ✅ (Paid tiers) | ❌ | ❌ | ✅ |
| **SLA** | ✅ (Paid tiers) | ❌ | ❌ | ✅ |
| **Price** | $0–$149/mo + Enterprise | Free (your infra costs) | Free (your model costs) | Custom |
| **Setup time** | 1-click | ~30 min | ~30 min | ~2 weeks |

### 3.2 Bring Your Own Model (BYOM)

Self-hosted STAS users can use **any model accessible via OpenCode Serve**. This includes:

```
OpenCode model identifier format:  <provider>/<model-name>

Examples:
  anthropic/claude-sonnet-4-20250514
  openai/gpt-4o-2025-05-15
  google/gemini-2.0-pro-001
  deepseek/deepseek-coder-v2
  openai/gpt-4o-mini                    (triage)
  https://api.mycompany.com/v1/models   (custom endpoint)
```

Configuration is through environment variables:

```bash
# .env example for BYOM
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
FALLBACK_MODELS=openai/gpt-4o,google/gemini-2.0-pro
OPENAI_CHEAP_MODEL=gpt-4o-mini

# Custom OpenAI-compatible endpoint (e.g., self-hosted vLLM):
OPENAI_BASE_URL=https://llm.internal.company.com/v1
OPENAI_API_KEY=sk-custom-key
```

### 3.3 Bring Your Own API Key

Cloud free-tier users get frontier models included. For self-hosted users:

| API Key | Purpose | Configuration |
|---------|---------|---------------|
| `OPENCODE_API_KEY` | OpenCode Serve direct LLM endpoint | Self-hosted OpenCode |
| Model provider keys | Individual model access (Anthropic, OpenAI, etc.) | Provider-specific env vars |
| `OPENAI_API_KEY` | Triage model + fallback fix | Required for triage by default |

### 3.4 Self-Hosted Deployment

STAS's MIT license explicitly permits self-hosting without restriction. Requirements:

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Compute** | 2 vCPU, 4 GB RAM | 4 vCPU, 8 GB RAM |
| **Storage** | 20 GB | 50 GB SSD |
| **Dependencies** | Redis, OpenCode Serve | Redis + RabbitMQ + monitoring stack |
| **Sandbox** | Docker (local) | E2B cloud sandbox (no Docker needed) |
| **Network** | Outbound to GitHub API | + Outbound to LLM provider APIs |

Complete setup documentation: `docs/SELF_HOSTING.md`

### 3.5 On-Premise / VPC Deployment (Enterprise)

For regulated industries, STAS can be deployed entirely within a customer's VPC:

- No outbound traffic except to configured model API endpoints (or fully air-gapped with self-hosted models)
- All data stays within the customer's network boundary
- SSO/SAML integration for access control
- Custom sandbox isolation policies (Kubernetes, Firecracker, gVisor)
- Compliance-ready for SOC 2, ISO 27001, BaFin, GDPR

> **GTM Insight**: The Enterprise tier's VPC deployment option is the nuclear option against lock-in fears. When a customer can run STAS entirely within their own infrastructure with their own models, there is zero platform dependency. This is a conversation-ender for lock-in objections.

---

## 4. Data Portability

Data portability is not an afterthought — it's built into STAS's architecture from day one.

### 4.1 What Data STAS Stores

| Data Type | Stored Where | Format | Retention |
|-----------|-------------|--------|-----------|
| **Issue analysis** | STAS DB | JSON | Until workspace deletion |
| **Fix diffs** | Git (PR branch) | Unified diff | Permanent (in git history) |
| **Test results** | STAS DB | JSON | Until workspace deletion |
| **Audit log** | STAS DB (Paid) | Structured JSON | Configurable (min 90 days) |
| **Usage metrics** | STAS DB | Aggregated | Anonymized after 12 months |
| **Source code** | **Never stored** | — | Ephemeral sandbox only |

### 4.2 Full Export Capabilities

| Export Type | Format | Contents | How |
|------------|--------|----------|-----|
| **Git history** | Standard git | Every commit, diff, PR | `git clone` the repo |
| **Fix metadata** | JSON | Per-fix: issue, model, result, confidence | API endpoint + CLI |
| **Audit trail** | JSON/CSV | All actions with timestamps and actor | Dashboard export (Paid) |
| **Configuration** | YAML/JSON | Full STAS configuration snapshot | `STAS_CONFIG_EXPORT=1` |
| **Benchmark results** | JSON | Model pass rates, costs, latencies | CLI `benchmark export` |

### 4.3 Export API

Self-hosted users can export all fix metadata via the STAS API:

```bash
# Export all fix records for a repo
curl -H "Authorization: Bearer $TOKEN" \
  https://stas.example.com/api/v1/exports/fixes?repo=owner/name

# Export audit log
curl -H "Authorization: Bearer $TOKEN" \
  https://stas.example.com/api/v1/exports/audit?since=2026-01-01

# Export configuration
curl -H "Authorization: Bearer $TOKEN" \
  https://stas.example.com/api/v1/exports/config
```

### 4.4 Migration Path: STAS → Manual / Competitor

If a customer decides to stop using STAS, here is the migration path:

| Step | Action | Data Preserved |
|------|--------|---------------|
| 1 | Uninstall GitHub App | Removes STAS permissions (reversible) |
| 2 | Export audit trail | All fix decisions in JSON |
| 3 | All PRs remain in git history | Every code change is permanently in your repo |
| 4 | Remove STAS comment footer from PRs | Optional cleanup |
| 5 | (Self-host) Stop containers / tear down infra | No ongoing costs |

**Key fact**: Because STAS operates as a GitHub App that creates real PRs with real git commits, **every fix is already permanently recorded in the repository's git history**. There is no database lock-in — your code has the full record.

### 4.5 Open Data Formats

All STAS data exports use open, non-proprietary formats:

| Format | Specification | Interoperability |
|--------|-------------|-----------------|
| **JSON** | RFC 8259 | Universal |
| **CSV** | RFC 4180 | Spreadsheets, databases, BI tools |
| **Unified diff** | Standard patch format | Git, any diff tool |
| **YAML** | yaml.org | Configuration management |
| **Structured logging** | JSON Lines (NDJSON) | Any log aggregator (Loki, ELK, Datadog) |

> **GTM Insight**: The fact that all fix data lives in git (not in a proprietary database) is a powerful trust signal. We should emphasize: "Every fix STAS makes is already in your git history. If you delete STAS tomorrow, you lose nothing but the automation."

---

## 5. Business Continuity

### 5.1 What Happens If Aimino Goes Out of Business

This is the most direct lock-in fear. STAS addresses it through structural guarantees:

| Scenario | Impact on Self-Host Users | Impact on Cloud Users |
|----------|--------------------------|----------------------|
| **Aimino shuts down** | None — you have the code, your API keys, your infra | Cloud service stops. Data export window provided. |
| **Model provider shuts down** | Switch models via env var | STAS model cascade routes to alternative |
| **GitHub changes API** | OSS community patches within weeks | Aimino patches within days |
| **Aimino acquired** | Protected by MIT license | Transition period negotiated |

**The MIT license is the ultimate business continuity guarantee.** Even in a worst-case scenario:

1. The full source code remains available on GitHub (forked by community)
2. The community can continue development independently
3. Self-hosted users are unaffected — they already run their own instance
4. Cloud users can migrate to self-hosted during a published wind-down period

### 5.2 Sunset Plan (Guaranteed)

If Aimino ever decides to discontinue STAS (cloud or otherwise), we commit to:

1. **180-day notice** — Published on blog, sent to all registered users via email
2. **Full data export available** — All fix history, audit logs, configuration exportable via API
3. **Migration guide published** — Step-by-step: Cloud → Self-Host transition
4. **Final OSS release** — All cloud-specific code that can be safely open-sourced will be released
5. **Community handover** — Repository ownership transferred to a neutral foundation if interest exists
6. **Domain and docs archived** — Documentation remains available indefinitely via GitHub Pages or archive.org

### 5.3 Data Export Mechanisms (Emergency)

In the event of an unplanned shutdown (acqui-hire, insolvency, etc.):

| Mechanism | Details |
|-----------|---------|
| **Emergency data export** | API endpoint that returns all customer data as a single tarball |
| **Git-based redundancy** | All fix output exists in your repos already |
| **Self-host fallback** | Cloud users can deploy their own instance from the last OSS release |
| **Community continuity** | Existing forks and mirror repositories on GitHub |

### 5.4 Community Continuity

STAS is designed so that the **OSS community can operate independently** of Aimino:

| Asset | Community Access | Fallback |
|-------|-----------------|----------|
| **Source code** | MIT-licensed on GitHub | Forked by community members |
| **Documentation** | MIT-licensed in repo | GitHub Pages, archive.org |
| **Docker images** | Published to GHCR/Docker Hub | Buildable from source |
| **CI/CD** | GitHub Actions (in repo) | Self-hostable runners |
| **Issue tracker** | Public GitHub Issues | Maintained by community |
| **Package registry** | npm/PyPI | Published by community fork |

> **GTM Insight**: When enterprise buyers ask "what happens if you fail?", the answer is not a rosy scenario — it's a structural guarantee. The MIT license means the code can never be taken away. This is stronger than any SaaS warranty or SLA.

---

## 6. Open Source Strategy

### 6.1 Open Source Composition

STAS is **open-core**: the core agent pipeline is fully open-source (MIT), while enterprise features are proprietary.

| Component | Open Source (MIT) | Proprietary | Notes |
|-----------|-------------------|-------------|-------|
| **Agent pipeline** | ✅ Full pipeline (triage → dispatch → PR) | — | MIT licensed |
| **Webhook handlers** | ✅ GitHub, GitLab, Bitbucket, Linear, Jira | — | Platform adapters open |
| **Sandbox integration** | ✅ E2B + Docker providers | — | Pluggable provider interface |
| **Queue system** | ✅ BullMQ + RabbitMQ dual-backend | — | Production-grade |
| **Model routing** | ✅ Model chain, fallbacks, cascade | — | Full flexibility |
| **Dashboard** | — | ✅ Cloud dashboard | Monetization layer |
| **Audit log** | — | ✅ Paid tiers | Enterprise compliance |
| **SSO/SAML** | — | ✅ Enterprise tier | Enterprise auth |
| **Analytics** | — | ✅ Paid tiers | Usage insights |
| **SLA support** | — | ✅ Paid tiers | Revenue driver |
| **VPC deployment** | — | ✅ Enterprise tier | Regulated industries |

### 6.2 Building Trust Through Transparency

Open-source is not just a license — it's a trust-building strategy:

| Trust Dimension | How OSS Addresses It |
|----------------|---------------------|
| **Code quality** | Anyone can inspect the agent pipeline for bugs, security issues, or prompt injection vectors |
| **No telemetry** | Self-hosted users control all data; no hidden analytics |
| **No vendor backdoors** | Public code review ensures no exfiltration mechanisms |
| **Community auditing** | Security researchers can audit, report, and patch |
| **Longevity** | Code persists beyond any single company's lifespan |

### 6.3 OSS Adoption Metrics

| Metric | Current | Target |
|--------|---------|--------|
| **GitHub stars** | Growing | 5K+ by Q1 2027 |
| **Self-host deployments** | Tracking | 10K+ by Q1 2027 |
| **Community contributors** | Measuring | 50+ by Q1 2027 |
| **Package downloads** | Tracking | 100K+/mo by Q1 2027 |

### 6.4 What Percentage of Stack Is OSS?

Visually, the STAS architecture by licensing:

```
┌────────────────────────────────────────────────────────────────┐
│                     STAS ARCHITECTURE                          │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  OPEN SOURCE (MIT) — ~85% of code                    │     │
│  │                                                       │     │
│  │  • Agent pipeline          • Webhook handlers        │     │
│  │  • Queue system            • Sandbox integration     │     │
│  │  • Model routing           • CLI tools               │     │
│  │  • API layer               • Documentation           │     │
│  │  • CI/CD infrastructure    • Tests                   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  PROPRIETARY — ~15% of code                          │     │
│  │                                                       │     │
│  │  • Dashboard UI             • Audit log store        │     │
│  │  • Advanced analytics       • SSO/SAML               │     │
│  │  • Enterprise deployment    • SLA management         │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Underlying dependencies: OpenCode (MIT)                       │
└────────────────────────────────────────────────────────────────┘
```

> **GTM Insight**: The 85% OSS ratio is a competitive differentiator. Devin: 0% OSS. GitHub Copilot: 0% OSS. OpenHands: 100% OSS (but no SaaS tier). STAS occupies the optimal middle — open enough to eliminate lock-in fear, commercial enough to sustain development.

---

## 7. Competitive Analysis — Lock-In Comparison

### 7.1 Lock-In Risk by Competitor

| Competitor | Model Lock-In | Platform Lock-In | Data Portability | Self-Host Option | Cost Transparency | Overall Lock-In Risk |
|------------|--------------|-----------------|------------------|-----------------|-------------------|---------------------|
| **Devin** | 🔴 High — proprietary models | 🔴 High — SaaS only | 🟡 Medium — API export | 🔴 No | 🟡 Medium — ACU opacity | 🔴 **HIGH** |
| **GitHub Copilot** | 🔴 High — tied to GitHub ecosystem | 🔴 High — GitHub only | 🟢 Good — in git | 🔴 No | 🟢 Good | 🟡 **MEDIUM** |
| **OpenHands** | 🟢 None — any model | 🟢 None — self-host | 🟢 Full — open data | 🟢 Yes (Docker) | 🟢 Full | 🟢 **LOW** |
| **SWE-agent** | 🟢 None — any model | 🟢 None — CLI only | 🟢 Full — open data | 🟢 Yes | 🟢 Full | 🟢 **LOW** |
| **Factory AI** | 🟡 Medium — limited models | 🔴 High — SaaS only | 🟡 Medium | 🔴 No | 🟡 Medium | 🟡 **MEDIUM** |
| **Cursor** | 🟡 Medium — limited models | 🔴 High — IDE-bound | 🟡 Medium | 🔴 No | 🟢 Good | 🟡 **MEDIUM** |
| **Claude Code** | 🔴 High — Anthropic only | 🔴 High — CLI only | 🟡 Medium | 🔴 No | 🟡 Medium | 🔴 **HIGH** |
| **Cline** | 🟢 None — any model | 🟡 Medium — VS Code bound | 🟡 Medium | 🟢 Yes (OSS) | 🟢 Full | 🟢 **LOW** |
| **Plip.io** | 🔴 High — Claude only | 🔴 High — SaaS only | 🟡 Medium | 🔴 No | 🟡 Medium | 🔴 **HIGH** |
| **KintsugiBot** | 🟡 Medium — limited | 🟡 Medium | 🟡 Medium | 🟢 Yes (OSS) | 🟢 Full | 🟡 **MEDIUM** |
| **STAS** | 🟢 **None** — any model | 🟢 **Low** — MIT OSS | 🟢 **Full** — git-native | 🟢 **Yes** — self-host + Docker | 🟢 **Full** — transparent | 🟢 **LOW** |

### 7.2 How STAS Wins on Lock-In

| Competitor Weakness | STAS Advantage | GTM Message |
|--------------------|----------------|-------------|
| Devin: proprietary models, ACU opacity | MIT-licensed, model-agnostic, cost-transparent | "Your code, your model, your data — always." |
| Copilot: GitHub-only, Microsoft ecosystem | Multi-platform (GitLab, Jira, Linear) + self-host | "Works where you work. Leave anytime." |
| OpenHands: no SaaS, no enterprise features | Open-core: free self-host + managed cloud | "Open-source freedom with enterprise support." |
| Claude Code: Anthropic-only, no platform | Any model, any platform, any infra | "Not married to any AI provider." |

### 7.3 The "Anti-Lock-In" Positioning Statement

> **"STAS is the only AI ticket-fixing platform that you can fully own. The code is MIT. The models are swappable. The data lives in your git history. The infrastructure can be your own servers. There is no exit fee because there is no exit — you were always in control."**

---

## 8. GTM Recommendations

### 8.1 Immediate (0–30 Days)

- [ ] **Create a public "Vendor Lock-In FAQ" page** on the STAS website addressing the top 10 lock-in questions
- [ ] **Add lock-in comparison table** to the pricing page showing STAS vs competitors on key lock-in dimensions
- [ ] **Publish a blog post**: "Why We Made STAS Open Source: A Promise Against Lock-In"
- [ ] **Update enterprise sales deck** to include a dedicated "Continuity & Portability" slide
- [ ] **Create a one-pager** "STAS Exit Plan: What Happens If We Disappear" for procurement teams

### 8.2 Short-Term (30–90 Days)

- [ ] **Build a documented emergency export tool** (`stas export --all` CLI command) for self-host users
- [ ] **Publish benchmark results** comparing STAS pass rates across different model providers
- [ ] **Create a "Model Swap Guide"** — step-by-step walkthrough of switching from Claude to GPT to Llama
- [ ] **Submit to DACH security assessment platforms** (e.g., C5, BSI) with lock-in documentation
- [ ] **Add "STAS Data Residency & Portability"** section to the DACH enterprise security questionnaire response template

### 8.3 Medium-Term (90–180 Days)

- [ ] **Publish a "Community Continuity" repository** with governance docs, just in case
- [ ] **Create self-host migration videos** — Cloud → Self-Host in under 10 minutes
- [ ] **Develop a partner program** for MSPs and system integrators to offer STAS deployment services
- [ ] **Commission a third-party security audit** that explicitly validates data portability claims
- [ ] **Add data portability certification** (e.g., ISO 27001 data portability controls)

### 8.4 Long-Term (180+ Days)

- [ ] **Establish an open governance model** for the STAS OSS project (foundation or steering committee)
- [ ] **Publish a cost projection tool** that lets customers estimate their costs with different models and deployment modes
- [ ] **Build a "STAS Compatibility Layer"** that lets customers run the same pipeline against any API-compatible agent backend
- [ ] **Achieve recognized data portability certifications** (e.g., EU Data Portability Code of Conduct)

### 8.5 Sales Enablement: Lock-In Objection Handler

| Customer Objection | STAS Response |
|-------------------|---------------|
| "What if you change your pricing?" | "Self-host is always free. You can run STAS with your own API keys forever, regardless of our pricing changes." |
| "What if you go out of business?" | "The code is MIT-licensed. The community can fork it. Your data is in your git history. You lose nothing." |
| "What if Anthropic/OpenAI changes their API?" | "We support 7+ model providers. If one changes terms, you switch via a single environment variable." |
| "Can we get locked into your data format?" | "All data is in open formats (JSON, CSV, unified diff, git). You can export everything at any time via API." |
| "What about our compliance requirements?" | "VPC/on-prem deployment available. All data stays in your network. Self-host for full sovereignty." |

---

## 9. Summary: The STAS Anti-Lock-In Guarantee

> **STAS guarantees that you can never be locked in to our platform.**

| Dimension | Guarantee |
|-----------|-----------|
| **Code** | MIT-licensed, permanently on GitHub, forkable by anyone |
| **Models** | Any OpenAI-compatible model — swap via environment variable |
| **Data** | Lives in your git history; exportable in open formats via API |
| **Infrastructure** | Self-host, VPC, on-prem, or cloud — choice is yours |
| **Continuity** | Published sunset plan with 180-day notice and community continuity |
| **Cost** | Self-host option provides permanent price ceiling (your infra, your API keys) |

---

## Sources

- [STAS OpenCode Contract — ModelChainConfig](./src/opencode-contract.ts)
- [STAS FAQ — Models and BYOM](./docs/FAQ.md)
- [STAS Business Strategy](./STRATEGY.md)
- [OpenHands Model-Agnostic Design](https://github.com/All-Hands-AI/OpenHands)
- [SWE-agent Architecture](https://github.com/princeton-nlp/SWE-agent)
- [MIT License](https://opensource.org/licenses/MIT)
- [EU Data Portability Regulation](https://gdpr-info.eu/art-20-gdpr/)
- [BSI Cloud Computing Compliance Criteria (C5)](https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Empfehlungen-nach-Angriffszielen/Cloud-Computing/Kriterienkatalog-C5/kriterienkatalog-c5.html)
