---
title: Privacy Policy
last-updated: 2026-07-28
version: 1.0.0
status: active
---

# Privacy Policy

**STAS (Solving Tickets As A Service)**
**Version 1.0.0**
**Last Updated: July 28, 2026**

---

## 1. Introduction

Aimino Technologies GmbH ("Aimino," "we," "us," or "our") operates STAS ("Solving Tickets As A Service"), an AI-powered GitHub issue resolution service. This Privacy Policy explains how we collect, use, process, store, and protect your personal data when you use our Service.

We are committed to protecting your privacy and complying with the **General Data Protection Regulation (GDPR)** (Regulation (EU) 2016/679), the **German Federal Data Protection Act (BDSG)**, and the **German Telemedia Act (TMG)**.

**Controller Contact Information:**

```
Aimino Technologies GmbH
[Registered Address]
[City, Postal Code]
Germany
Email: privacy@stas.ai
```

Our Data Protection Officer can be reached at dpo@stas.ai.

## 2. Data We Collect

We collect and process the following categories of personal data:

### 2.1 Account Data

When you register for an Account, we collect:

| Data | Purpose | Source |
|------|---------|--------|
| GitHub username | Account identification, display | GitHub OAuth |
| Email address | Account communication, billing | GitHub OAuth / User input |
| GitHub avatar URL | Profile display | GitHub OAuth |
| Full name (optional) | Personalization | User input |
| Company/Organization | Business context | User input |

### 2.2 GitHub Repository Data

When you install and configure the Service on your GitHub repositories, we access:

| Data | Purpose |
|------|---------|
| Repository names and descriptions | Issue triage and display |
| Issue content (titles, descriptions, comments) | Fix generation context |
| Pull request content | Fix validation and status tracking |
| Code snippets (files, diffs, patches) | Fix generation input |
| Labels, milestones, assignees | Issue prioritization and triage |
| Repository metadata (visibility, language, topics) | Service configuration |

### 2.3 Usage Data

We automatically collect:

| Data | Purpose |
|------|---------|
| Fix request timestamps | Usage metering, billing |
| Fix generation metrics (duration, outcome) | Service improvement |
| Feature interactions | Product analytics |
| API request logs | Security monitoring, debugging |
| Error reports and stack traces | Issue diagnosis |
| Page views and navigation (dashboard) | UX improvement |

### 2.4 Communication Data

When you contact our support team or interact on Discord:

| Data | Purpose |
|------|---------|
| Email correspondence | Support resolution |
| Discord messages | Community support, Q&A |
| Feature requests and feedback | Product development |

## 3. Legal Basis for Processing

We process your personal data based on the following legal grounds under GDPR:

| Purpose | Legal Basis (GDPR) |
|---------|-------------------|
| Service delivery and fix generation | Art. 6(1)(b) — Performance of a contract |
| Billing and payment processing | Art. 6(1)(b) — Performance of a contract |
| Account management and communication | Art. 6(1)(b) — Performance of a contract |
| Compliance with legal obligations | Art. 6(1)(c) — Legal obligation |
| Security monitoring and fraud prevention | Art. 6(1)(f) — Legitimate interest |
| Product improvement and analytics | Art. 6(1)(f) — Legitimate interest |
| Marketing communications (with consent) | Art. 6(1)(a) — Consent |
| Cookie-based analytics (non-essential) | Art. 6(1)(a) — Consent (via cookie banner) |

**Legitimate Interest Assessment:** Our legitimate interests include ensuring the security and integrity of our Service, improving our products, understanding usage patterns to enhance user experience, and preventing fraud or abuse. We balance these interests against your privacy rights and implement appropriate safeguards.

## 4. How We Use Your Data

We use your personal data for the following purposes:

### 4.1 Service Operation

- Processing GitHub issues through our AI agent pipeline
- Generating code fixes and creating pull requests
- Managing your Account and subscription
- Providing customer support and technical assistance
- Monitoring Service performance and uptime

### 4.2 Billing and Payments

- Processing subscription payments through Stripe
- Managing invoices and receipts
- Handling payment disputes and refunds
- Detecting and preventing fraudulent transactions

### 4.3 Product Improvement

- Analyzing usage patterns to improve fix accuracy
- Training and refining our AI models (using only anonymized code snippets with your consent or where permitted by law)
- Identifying common issues and failure modes
- Developing new features and capabilities

### 4.4 Communication

- Sending service-related notifications (fix status, subscription updates)
- Responding to support inquiries
- Sending product updates and feature announcements (with opt-out)
- Security alerts and incident notifications

## 5. Data Retention

We retain your personal data only as long as necessary to fulfill the purposes for which it was collected:

| Data Category | Retention Period | Rationale |
|---------------|-----------------|-----------|
| Account information | Duration of Account + 90 days | Service delivery, legal obligations |
| Payment records | 10 years (German commercial law) | Legal retention (Handelsgesetzbuch §257, Abgabenordnung §147) |
| Code snippets | **Maximum 90 days** | Fix generation context, after which they are permanently deleted |
| Fix generation logs | 24 months | Product improvement, debugging |
| Usage analytics | 24 months | Product analytics and optimization |
| Support correspondence | 3 years | Quality assurance, dispute resolution |
| Discord community messages | Duration of Discord membership | Community continuity |

### 5.1 Data Deletion Process

Upon expiration of the retention period or upon your deletion request:

1. Code snippets are permanently deleted from our systems within 30 days;
2. Account data is anonymized or deleted within 90 days;
3. Backup archives are purged within the regular backup rotation cycle (maximum 90 days).

## 6. Third-Party Processors

We engage the following third-party processors who may access your personal data:

| Processor | Purpose | Data Accessed | Location | Safeguards |
|-----------|---------|---------------|----------|------------|
| **Stripe** | Payment processing | Billing info, payment method, email | USA | DPA, EU-US DPF, SCCs |
| **OpenAI** | AI fix generation | Code snippets, issue content | USA | DPA, SOC 2, data retention 30 days |
| **Anthropic** | AI fix generation | Code snippets, issue content | USA | DPA, SOC 2, no training on API data |
| **GitHub** | Repository access | Repository metadata, code | USA | DPA, EU-US DPF, GitHub Privacy Statement |
| **Sentry** | Error monitoring | Error logs, stack traces, IP | USA | DPA, EU-US DPF |
| **Discord** | Community support | Discord username, messages | USA, EU | DPA, EU-US DPF |
| **Hetzner** | Cloud hosting | Encrypted data at rest, logs | Germany (EU) | DPA, GDPR-compliant |
| **Vercel** | Web application hosting | Web traffic data, session data | USA, EU | DPA, EU-US DPF |
| **Postmark** | Transactional email | Email address | USA | DPA, EU-US DPF |

All processors are contractually bound to process data only on our documented instructions and to implement appropriate technical and organizational security measures (Art. 28 GDPR). Where processors are located outside the EU, we ensure adequate safeguards through:

1. EU Standard Contractual Clauses (SCCs) adopted by the European Commission;
2. EU-US Data Privacy Framework (DPF) certification where applicable;
3. Transfer Impact Assessments (TIAs) documenting the adequacy of protections.

## 7. International Data Transfers

As described in Section 6, some of your data may be transferred to countries outside the European Economic Area (EEA), including the **United States**.

### 7.1 Transfer Safeguards

We ensure adequate protection for international data transfers through:

1. **EU-US Data Privacy Framework (DPF)**: Where our processors (Stripe, GitHub, Sentry) are DPF-certified, we rely on the European Commission's adequacy decision of July 10, 2023.
2. **Standard Contractual Clauses (SCCs)**: For processors not covered by the DPF, we have executed the European Commission's Standard Contractual Clauses (Module 2 and Module 3 as applicable).
3. **Transfer Impact Assessments**: We conduct TIAs to verify that the legal framework in the destination country provides essentially equivalent protection to EU law.

### 7.2 Your Rights Regarding Transfers

You have the right to request a copy of the appropriate safeguards we have implemented for international data transfers by contacting privacy@stas.ai.

## 8. Security Measures

We implement comprehensive technical and organizational measures to protect your personal data:

### 8.1 Technical Measures

| Measure | Implementation |
|---------|---------------|
| Encryption in transit | TLS 1.3 for all API, web, and webhook traffic |
| Encryption at rest | AES-256 encryption for all stored data |
| Access controls | Role-based access control (RBAC), least-privilege principle |
| Authentication | OAuth 2.0, session management, API keys with scoped permissions |
| Audit logging | All access to production systems is logged and monitored |
| Network security | VPC isolation, firewall rules, intrusion detection |
| Backups | Encrypted daily backups with 90-day rotation |
| Vulnerability scanning | Weekly automated scans + quarterly penetration tests |
| Incident response | Documented IR plan with 24-hour notification commitment |

### 8.2 Organizational Measures

| Measure | Description |
|---------|-------------|
| Access policy | Production access requires approval and is reviewed quarterly |
| Employee training | Annual GDPR and security awareness training |
| Data protection | DPO appointed, privacy impact assessments conducted |
| Vendor due diligence | Pre-engagement security review of all processors |
| Incident management | Documented process with designated response team |

### 8.3 Security Incident Notification

In the event of a personal data breach that poses a risk to your rights and freedoms, we will notify you and the relevant supervisory authority within 72 hours of becoming aware of the breach, as required by Art. 33-34 GDPR.

## 9. Data Subject Rights

Under GDPR, you have the following rights regarding your personal data:

### 9.1 Right of Access (Art. 15 GDPR)

You have the right to obtain confirmation of whether we process your data and request a copy of the personal data we hold about you, along with information about:

- The purposes of processing;
- The categories of data processed;
- The recipients or categories of recipients;
- The retention period or criteria used to determine it;
- Your other rights under the GDPR;
- The source of the data (if not collected from you);
- The existence of automated decision-making.

### 9.2 Right to Rectification (Art. 16 GDPR)

You have the right to request correction of inaccurate personal data and completion of incomplete data.

### 9.3 Right to Erasure (Art. 17 GDPR)

You have the right to request deletion of your personal data ("right to be forgotten") when:

- The data is no longer necessary for the purposes for which it was collected;
- You withdraw consent and there is no other legal basis;
- You object to processing and there are no overriding legitimate grounds;
- The data has been unlawfully processed;
- Deletion is required by EU or Member State law.

### 9.4 Right to Restriction of Processing (Art. 18 GDPR)

You have the right to request restriction of processing when:

- You contest the accuracy of the data (for a period enabling us to verify);
- Processing is unlawful and you oppose erasure;
- We no longer need the data but you require it for legal claims;
- You have objected to processing pending verification of legitimate grounds.

### 9.5 Right to Data Portability (Art. 20 GDPR)

You have the right to receive your personal data in a structured, commonly used, and machine-readable format (e.g., JSON, CSV) and to transmit that data to another controller where:

- Processing is based on consent or a contract; and
- Processing is carried out by automated means.

### 9.6 Right to Object (Art. 21 GDPR)

You have the right to object to processing based on legitimate interests (Art. 6(1)(f)) or for direct marketing purposes. We will cease processing unless we demonstrate compelling legitimate grounds that override your interests.

### 9.7 Right to Withdraw Consent

Where processing is based on consent, you have the right to withdraw consent at any time without affecting the lawfulness of processing based on consent before its withdrawal.

### 9.8 How to Exercise Your Rights

To exercise any of these rights:

1. **Email**: Send your request to privacy@stas.ai
2. **Account Settings**: Access, export, or delete your data through your Account dashboard
3. **Response Time**: We will respond within 30 days (extendable by 60 days for complex requests)

We may request additional information to verify your identity before processing your request. We will not charge a fee unless the request is manifestly unfounded or excessive.

### 9.9 Right to Lodge a Complaint

If you believe our processing of your personal data violates GDPR, you have the right to lodge a complaint with your local data protection supervisory authority or with our lead authority:

```
Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)
Promenade 27
91522 Ansbach
Germany
```

## 10. Automated Decision-Making

### 10.1 AI Fix Generation

The core function of STAS involves **automated decision-making** (Art. 22 GDPR): our AI agents automatically determine whether and how to fix a given GitHub issue, and may create pull requests without human intervention.

### 10.2 Human Oversight

We provide the following safeguards:

1. **Opt-Out**: Repository owners can configure STAS to only suggest fixes (requiring manual approval) rather than automatically creating pull requests;
2. **Review Required**: All generated pull requests require human review and approval before merging;
3. **Account Control**: You can pause, disable, or remove STAS from any repository at any time;
4. **Transparency**: The Service clearly labels all AI-generated content;
5. **Override**: You can close, modify, or reject any AI-generated pull request.

### 10.3 Significance and Logic

The automated decision-making involves:

- **Input**: Issue description, repository code context, configuration rules
- **Logic**: Multi-stage AI pipeline analyzing the issue, generating candidate fixes, and evaluating their correctness
- **Output**: A pull request with proposed code changes, which is clearly labeled as AI-generated
- **Effect**: The output is a software suggestion — it does not produce legal effects or similarly significant effects concerning the user without human review

## 11. Cookies and Tracking

We use cookies and similar technologies as described in our Cookie Policy. Key points:

| Type | Purpose | Duration | Legal Basis |
|------|---------|----------|-------------|
| Essential | Session management, authentication | Session | Art. 6(1)(f) — Legitimate interest |
| Functional | User preferences, settings | 12 months | Art. 6(1)(a) — Consent |
| Analytics | Usage tracking, product metrics | 24 months | Art. 6(1)(a) — Consent |
| Marketing | Remarketing (not currently used) | N/A | N/A (not active) |

You can manage cookie preferences through our cookie banner or your browser settings.

## 12. Children's Privacy

The Service is not directed to individuals under the age of 18. We do not knowingly collect personal data from children. If you become aware that a child has provided us with personal data, please contact us at privacy@stas.ai. We will take steps to delete such data promptly.

## 13. Policy Updates and Version History

We may update this Privacy Policy from time to time. We will notify you of material changes via email or through the Service at least 30 days before they take effect.

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-07-28 | Initial draft |
| 1.0.1 | 2026-07-30 | Finalized for GitHub Marketplace — published at stas.aimino.io/privacy |

We recommend that you review this Privacy Policy periodically. Your continued use of the Service after changes take effect constitutes acceptance of the updated policy.

### 13.1 How to Track Changes

You can view the complete revision history of this Privacy Policy at [https://github.com/aimino-tech/stas/privacy-policy](https://github.com/aimino-tech/stas/privacy-policy) or by requesting a copy from privacy@stas.ai.

## 14. Data Breach Notification

In the event of a personal data breach:

1. **Internal**: Our incident response team is alerted immediately;
2. **Assessment**: We assess the risk to data subjects' rights and freedoms within 24 hours;
3. **Notification to Authority**: If required, we notify the BayLDA within 72 hours (Art. 33 GDPR);
4. **Notification to Data Subjects**: If the breach poses a high risk, we notify affected individuals without undue delay (Art. 34 GDPR);
5. **Remediation**: We take immediate steps to contain and remediate the breach.

All data breaches are documented internally, including the facts, effects, and remedial actions taken.

## 15. Contact and Complaints

### 15.1 Contact Information

| Purpose | Contact |
|---------|---------|
| Privacy inquiries | privacy@stas.ai |
| Data Protection Officer | dpo@stas.ai |
| Security issues | security@stas.ai |
| General support | support@stas.ai |
| Postal address | Aimino Technologies GmbH |
| | [Registered Address] |
| | [City, Postal Code] |
| | Germany |

### 15.2 Complaint Process

If you have a concern about our data handling practices:

1. **First step**: Contact us at privacy@stas.ai. We will investigate and respond within 30 days;
2. **Second step**: If unsatisfied, escalate to our Data Protection Officer at dpo@stas.ai;
3. **Third step**: You have the right to lodge a complaint with the BayLDA (contact details in Section 9.9) or your local supervisory authority at any time.

---

**© 2026 Aimino Technologies GmbH. All rights reserved.**

*This Privacy Policy was prepared with legal guidance to comply with the General Data Protection Regulation (GDPR), the German Federal Data Protection Act (BDSG), and the German Telemedia Act (TMG).*
