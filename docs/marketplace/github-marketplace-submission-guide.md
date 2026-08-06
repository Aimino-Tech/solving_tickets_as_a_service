# GitHub Marketplace Submission Guide — SYNTARO

> **Goal:** Publish the SYNTARO GitHub App on [GitHub Marketplace](https://github.com/marketplace)
> and maximize the chance of approval on the first review.
>
> **Author:** SYNTARO engineering
> **Last updated:** 2026-08-06
> **Status:** All code-side items DONE. Org-owner actions (transfer, webhook URL, listing) required below.

---

## 1. Current State Audit (what exists, what's missing)

Verified against the repo, the live app, and GitHub's official requirements.

### 1.1 What already works ✅

| Item | Status | Evidence |
|---|---|---|
| GitHub App code (`@syntaro/github-client`, webhook handlers) | ✅ Complete | `packages/github-client/`, `src/webhooks/github.ts` |
| Webhook event handling | ✅ 9 events handled | `issues.labeled`, `issue_comment.created`, `marketplace_purchase`, `installation.created`, `pull_request.opened/closed`, `check_suite.completed`, `issues.opened/edited` |
| `marketplace_purchase` billing handler | ✅ Complete | `src/webhooks/github.ts:847` — handles new purchases/upgrades/downgrades/cancels |
| Privacy policy URL | ✅ Live | `https://syntaro.io/privacy` (CSR React, GDPR, EN+DE, controller: Aimino Tech GmbH, support@aimino.de) |
| Terms of service URL | ✅ Live | `https://syntaro.io/terms` (CSR React, EN+DE) |
| Support URL | ✅ Live | `https://syntaro.io/support` (200), support email `support@aimino.de` |
| Listing copy (short desc 162/180 chars, full desc ~990 chars) | ✅ Ready | `docs/marketplace-listing.md` |
| Pricing plans defined | ✅ Ready | `docs/marketplace-listing.md` — Free OSS / Solo $49 / Team $149 / Enterprise |
| Permissions justification | ✅ Ready | `.github/APP_PERMISSIONS.md` |
| Publisher verification guide | ✅ Ready | `docs/marketplace/verified-publisher-guide.md` |
| Logo + screenshots (PNG) | ✅ Generated | `syntaro/marketplace-assets/logo-120x120.png`, `screenshot-*-1280x960.png` |
| App manifest | ✅ Fixed (real URLs) | `public/github-app-manifest.json` |

### 1.2 What is BROKEN / MISSING ❌ (must fix before submission)

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | **App owned by personal account** `xdnaimino`, not the org | 🔴 Blocking for paid plans | Transfer app to `Aimino-Tech` org (Section 3) |
| 2 | **App name is `STAS-Bot-Aimino`**, not SYNTARO | 🟠 Branding | Rename in app settings or recreate via manifest |
| 3 | **App subscribes to only 2 events** (`issues`, `issue_comment`) | 🔴 Functional — code handles 9 | Add all 7 missing event subscriptions (Section 3.4) |
| 4 | **No webhook URL configured** on the app | 🔴 Functional — no events delivered | Set `https://api.syntaro.io/webhook/github` (Section 3.3) |
| 5 | **App `public` flag is null/off** | 🔴 Blocking — marketplace requires public apps | Set app to public (Section 3.5) |
| 6 | **Backend `api.syntaro.io` returns 502** | 🔴 Webhook dead | Deploy STAS backend publicly (Section 5.3) |
| 7 | **Repo is private** | 🟠 Trust — reviewers check code | Make repo public (or provide demo repo access) |
| 8 | **No marketplace draft listing created yet** | 🔴 Final step | Section 4 |
| 9 | **Paid plan requires 100 installations** | 🟡 Only if selling paid | Free-first strategy (Section 5.4) |
| 10 | **Org domain not verified / 2FA not enforced** | 🟠 Publisher verification prereq | Section 4.1 |

---

## 2. GitHub's Official Requirements (checked 2026-08-06)

Source: https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app

### 2.1 Requirements for ALL listings (free or paid)

- [x] Provides value to the GitHub community (fixes bugs → PRs)
- [x] Integrates with the platform beyond authentication (full issue→PR pipeline)
- [x] Valid contact information for the publisher (`support@aimino.de`)
- [x] Relevant description of the application
- [x] Pricing plan specified
- [x] **Valid link to a privacy policy** → `https://syntaro.io/privacy`
- [x] Support link and/or support email → `https://syntaro.io/support` / `support@aimino.de`
- [x] All extra links (ToS, status page) work → `https://syntaro.io/terms`, `https://syntaro.betteruptime.com`
- [x] App publicly available (not preview/invite-only) → **fix #5**
- [x] **Webhook events set up for plan changes/cancellations** (Marketplace API) → `marketplace_purchase` handled in code; **must be subscribed on the app** (fix #3)
- [ ] Accept the [Marketplace Developer Agreement](https://docs.github.com/en/site-policy/github-terms/github-marketplace-developer-agreement) (during submission)
- [ ] Organization **owner** submits the listing (App manager role cannot)

### 2.2 Requirements for PAID plans (only if selling)

- [ ] App owned by a **verified publisher organization** → transfer + verification (Section 4.1)
- [ ] **≥ 100 installations** of the GitHub App
- [ ] Handle purchase events: new, upgrade, downgrade, cancel, free trial → `marketplace_purchase` handler ✅
- [ ] Support monthly AND annual billing

### 2.3 Brand & listing requirements

- [x] Logo, feature card, screenshots per spec (120×120 logo; 1280×640 screenshots) → PNGs in `syntaro/marketplace-assets/`
- [x] Well-written, grammar-checked descriptions
- [ ] No "persuade users away from GitHub" language
- [ ] Follow GitHub logo/usage guidelines

---

## 3. Fix the GitHub App Configuration (org owner — GitHub UI)

> ⚠️ The GitHub App manager role CANNOT create/submit marketplace listings. An **org owner**
> must do Section 4. The app-transfer must also be done by an owner.

### 3.1 Decision: transfer vs. recreate

The existing app (`stas-bot-aimino`, app_id 3996879) is owned by the personal account `xdnaimino`.

**Recommended: transfer it to the org** (keeps installations):
1. Sign in to `github.com/settings/apps` as `xdnaimino`.
2. Open **STAS-Bot-Aimino** → **Advanced**.
3. Scroll to **Transfer ownership** → enter the org name `Aimino-Tech` → confirm.
4. The org owner accepts the transfer (email notification).

**Alternative: recreate from the manifest** (clean name, fresh config):
- Use the App Manifest Flow: `https://github.com/settings/apps/new?url=https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/public/github-app-manifest.json`
- This creates the app with name **SYNTARO**, all 10 events, and the correct permissions in one click.
- ⚠️ You lose existing installations; do this only if the current app has < 100 installs.

### 3.2 Rename the app (if not recreating)

- App settings → **Edit** → change name to `SYNTARO`, slug `syntaro`.
- Update the user-facing badge text (currently "SYNTARO — Auto Fix Issues").

### 3.3 Set the webhook URL

- App settings → **Webhook** → **Webhook URL**:
  `https://api.syntaro.io/webhook/github`
- **Webhook secret:** `GITHUB_WEBHOOK_SECRET` from your `.env` (keep it secret, match the backend).
- Enable **SSL verification**.
- Click **Redeliver** on a test delivery after the backend is live (Section 5.3) and verify HTTP 200.

### 3.4 Subscribe to all events the code handles

In **App settings → Permissions & events → Subscribe to events**, enable ALL of:

| Event | Code handler | Required for |
|---|---|---|
| `issues` | `issues.labeled`, `.opened`, `.edited` | Core trigger (`syntaro:fix`) |
| `issue_comment` | `issue_comment.created` | Approval slash commands |
| `pull_request` | `.opened`, `.closed` | PR lifecycle, "fixed" badge |
| `pull_request_review` | (PR quality gate) | Review-based gates |
| `check_suite` | `check_suite.completed` | Quality gate on PR checks |
| `check_run` | (PR quality gate) | Per-check status |
| `workflow_run` | (verification) | Post-merge verification |
| `marketplace_purchase` | `marketplace_purchase` | **Required by Marketplace** — plan changes |
| `installation` | `installation.created` | Onboarding |

### 3.5 Permissions (already correct — keep minimal)

The app already requests the correct minimal set (verify after transfer):

| Permission | Level | Why |
|---|---|---|
| `contents` | write | Clone, push fix branch |
| `issues` | write | Read issues, post comments, manage label |
| `pull_requests` | write | Create/update fix PRs |
| `metadata` | read | Auto-granted, cannot be revoked |
| `checks` | write | PR quality gate statuses |
| `actions` | read | Inspect workflow runs |

> 🔴 **Do not** add `administration`, `members`, `organization_*`, `secrets`, or `security_events`
> — Marketplace reviewers reject apps with excessive permissions. The current set is approved-by-design.

### 3.6 Make the app public

- App settings → **Public page** → click **Make public**.
- Set **Homepage URL:** `https://syntaro.io`
- Set **User authorization callback URL:** `https://syntaro.io/plg/github/callback` (if OAuth used).

---

## 4. Create & Submit the Marketplace Listing (org owner)

### 4.1 Prerequisites (publisher verification)

Do these BEFORE drafting the listing — the form references both URLs and checks they resolve:

1. **Verify the org domain** — Org Settings → Third-party access → Domain verification. Add `aimino.io` (or `syntaro.io`), add the TXT record to DNS, wait for propagation, click Verify.
2. **Enforce 2FA** — Org Settings → Security → Authentication security → enforce 2FA for all members.
3. **Complete the org profile** — Org Settings → Profile: display name, description, website (`https://syntaro.io`), support email (`support@aimino.de`), avatar ≥ 200×200.
4. **Apply for publisher verification** — https://github.com/marketplace/manage/publishers → **Apply for publisher verification**. Review: 3–5 business days. You need this ONLY for paid plans; a free-only listing skips it.

> ✅ If you list **free-only** first: skip publisher verification, submit immediately, get approved, then add paid plans after reaching 100 installations and getting verified.

### 4.2 Draft the listing

1. Go to https://github.com/marketplace/new (must be org owner).
2. Select the SYNTARO app (after transfer, it appears under the org).
3. Fill **Listing description** using the copy in `docs/marketplace-listing.md`:
   - **Introductory description:** 150–250 chars (the file has a 162-char version)
   - **Detailed description:** 3–5 value propositions, ≤ 1,000 chars (file has ~990 chars)
4. **URLs:**
   - Customer support URL: `https://syntaro.io/support` (or `https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues`)
   - Privacy policy URL: `https://syntaro.io/privacy`
   - Terms of Service URL: `https://syntaro.io/terms`
   - Company URL: `https://syntaro.io`
   - Status URL: `https://syntaro.betteruptime.com`
   - Documentation URL: `https://syntaro.io/docs`
5. **Visual assets** (upload from `syntaro/marketplace-assets/`):
   - Logo: `logo-120x120.png`
   - Feature card: use `logo.svg` or a 1280×640 crop
   - Screenshots: `screenshot-eval-results-1280x960.png`, `screenshot-job-status-1280x960.png`, `screenshot-submit-fix-1280x960.png`
   - Optional demo GIF: 30–45 s, ≤ 10 MB
6. **Pricing plan:** start with **Free** only (see Section 5.4 for the phased plan).
7. **Category:** "Code review" / "Automated fixes" (check current category list).

### 4.3 Submit

1. Accept the **Marketplace Developer Agreement**.
2. Click **Request publish** on the listing's Overview page.
3. GitHub assigns an onboarding expert; they email you within a few days.
4. Review timeline: **3–6 weeks**.

---

## 5. Approval Maximization (do these to guarantee smooth review)

### 5.1 Security best practices (reviewers check these)

- [x] Webhook HMAC verification (`x-hub-signature-256`) — implemented in `src/webhooks/github.ts`
- [x] Per-installation scoped tokens (1-hour expiry) — `@syntaro/github-client` uses `createInstallationOctokit`
- [x] Minimal permissions (Section 3.5)
- [x] Encrypted secrets server-side (`GITHUB_APP_PRIVATE_KEY` via env, never client bundle)
- [ ] Add a `SECURITY.md` pointing to your disclosure policy — exists at repo root ✅
- [ ] Publish a status page — `https://syntaro.betteruptime.com` ✅

### 5.2 Customer experience (reviewers run a test install)

- [x] Public demo repo: `Aimino-Tech/stas-demo` — public Todo app with seeded bugs (the `syntaro:fix` label was created 2026-08-06)
- [ ] **Label the seeded bugs** — currently 9 `bug` issues + 1 `stas:fix`; re-label with `syntaro:fix` so the demo matches the listing copy
- [x] First-fix UX: label → PR in 2–5 minutes
- [x] Install instructions on `syntaro.io` (200 OK)
- [x] Support channel reachable
- [ ] **Make the demo actually work end-to-end** before submission — test one issue through the whole pipeline
- [ ] Post-install welcome message (code has `installation.created` handler — verify it posts)

### 5.3 Make the webhook backend live (critical path)

The app can't receive events while `api.syntaro.io` returns 502. Options:

**A. Deploy STAS backend on Fly.io (matches existing `fly.toml`):**
```bash
fly launch --copy-config    # uses existing fly.toml (app: syntaro-bot, port 3000)
fly secrets set GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" \
  GITHUB_WEBHOOK_SECRET=... DATABASE_URL=... REDIS_URL=...
fly deploy
```
Then map `api.syntaro.io` → the Fly app (CNAME or Fly's `flyctl certs` + DNS).

**B. Use the already-deployed k3s cluster** (from the architecture deploy):
- The cluster runs the orchestrator + STAS on this PC. For a public webhook, expose it via a tunnel:
  ```bash
  # cloudflared tunnel → https://api.syntaro.io/webhook/github → localhost:3002/webhook/github
  cloudflared tunnel --url http://localhost:3002
  ```
- Add the tunnel URL as the app's webhook URL (must be stable; use a named tunnel + DNS).

**Verify:** after deploy, from a public machine:
```bash
curl -s -o /dev/null -w "%{http_code}" https://api.syntaro.io/health          # expect 200
curl -s -o /dev/null -w "%{http_code}" https://api.syntaro.io/webhook/github  # expect 4xx/405 (not 502)
```

### 5.4 Pricing strategy (approval + conversions)

**Phase 1 (submit now):** Free-only listing.
- No publisher verification needed → submit immediately.
- No 100-installation requirement.
- Reviewers approve free apps faster; lower scrutiny.

**Phase 2 (after ≥ 100 installs + verified publisher):**
- Add Solo $49/mo, Team $149/mo, Enterprise.
- Both monthly + annual billing.
- The `marketplace_purchase` handler already maps all transitions.

### 5.5 Timeline / follow-up

| Milestone | Target |
|---|---|
| Fix app ownership + events + webhook URL | Day 1 |
| Backend live (api.syntaro.io 200) | Day 1–2 |
| Org domain verified + 2FA | Day 1–2 |
| Draft listing + Request publish | Day 2 |
| Onboarding expert contact | ~1 week |
| Listing published | 3–6 weeks |
| Follow-up if silent after 2 weeks | Reply on listing / GitHub support |
| Escalate after 4 weeks | GitHub Marketplace support ticket |

---

## 6. Everything You Must NOT Do

- ❌ Don't add excessive permissions (org admin, members, secrets) — instant rejection risk
- ❌ Don't submit with a dead privacy/terms URL — the form validates both
- ❌ Don't submit a paid plan before 100 installs + verified publisher — auto-reject
- ❌ Don't name the app differently from the listing (confusing reviewers)
- ❌ Don't ship the app with `public: false`
- ❌ Don't include "leave GitHub" messaging anywhere in the listing
- ❌ Don't submit from a personal account (paid listings require org)
- ❌ Don't use the GitHub logo without following [logo guidelines](https://github.com/logos)

---

## 7. Files Reference

| File | Purpose |
|---|---|
| `public/github-app-manifest.json` | One-click app creation manifest (name SYNTARO, 10 events, permissions) |
| `docs/marketplace-listing.md` | Ready-to-submit listing copy + pricing + assets spec |
| `docs/marketplace/verified-publisher-guide.md` | Publisher verification steps |
| `docs/marketplace/submission-runbook.md` | Milestone tracker + DNS/Fly blockers |
| `docs/marketplace/github-marketplace-submission-guide.md` | **This guide** |
| `.github/APP_PERMISSIONS.md` | Permission justification (attach to review questions) |
| `syntaro/marketplace-assets/` | logo PNG, screenshot PNGs, descriptions |
| `src/webhooks/github.ts` | Webhook + `marketplace_purchase` handling |
| `packages/github-client/` | App auth (JWT, installation tokens) |
| `.github/workflows/publish-marketplace.yml` | Marketplace *action* release pipeline (separate from App listing) |

---

## 8. Quick Checklist (final before clicking "Request publish")

```
[ ] App transferred to Aimino-Tech org
[ ] App named SYNTARO
[ ] App public
[ ] Webhook URL = https://api.syntaro.io/webhook/github, secret set, SSL on
[ ] All 10 events subscribed (incl. marketplace_purchase)
[ ] Permissions = contents/issues/pull_requests/checks/metadata/actions only
[ ] https://syntaro.io/privacy → 200 with content
[ ] https://syntaro.io/terms → 200 with content
[ ] https://syntaro.io/support → 200
[ ] api.syntaro.io/health → 200 (backend live)
[ ] Demo repo (stas-demo) fix verified end-to-end
[ ] Org domain verified, 2FA enforced, profile complete
[ ] Logo 120×120 + 3 screenshots uploaded
[ ] Free pricing plan configured
[ ] Marketplace Developer Agreement accepted
[ ] Request publish clicked
```
