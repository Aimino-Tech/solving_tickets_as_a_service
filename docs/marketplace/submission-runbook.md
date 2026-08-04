# GitHub Marketplace Submission Runbook — STAS

> Tracks AIM-4363: "GitHub Marketplace Listing — Submit and Complete".
> This runbook turns the remaining launch steps into a deterministic,
> verifiable checklist. The agents/engineers can complete the code-verifiable
> parts; the org-level actions (DNS, billing, GitHub org settings) require a
> human with admin access.
>
> **Current state:** all copy, the action (`Aimino-Tech/solving_tickets_as_a_service/.github/actions/stas-fix`), the
> privacy/terms pages, and the deploy pipeline exist. The listing is **not yet
> submitted** and the privacy/terms URLs are **not yet live** because the
> website has never successfully deployed (blockers in Phase A below).

---

## Summary of the 5 ticket requirements

| # | Requirement | State | Where tracked |
|---|-------------|-------|---------------|
| 1 | Submit action to GitHub Marketplace for review | ⛔ Blocked — Phase C | `docs/marketplace-listing.md` + this file |
| 2 | Publisher verification (badge, 2FA, domain) | ⛔ Blocked — Phase B | `docs/marketplace/verified-publisher-guide.md` |
| 3 | Privacy policy live at `stas.aimino.io/privacy` (200) | ⛔ Blocked — Phase A | `scripts/check-marketplace-live.sh` |
| 4 | Terms live at `stas.aimino.io/terms` (200) | ⛔ Blocked — Phase A | `scripts/check-marketplace-live.sh` |
| 5 | Track approval follow-up (3–6 weeks) | 📋 Phase D tracker below | `#follow-up-tracker` below |

---

## Phase A — Get the privacy/terms pages live (unblocks #3 and #4)

The pages already exist (`website/privacy.html`, `website/terms.html`) and the
`Deploy Website` workflow (`deploy-website.yml`) pushes them to the Fly.io app
`stas-website`. Nothing has ever gone live. Three independent blockers, in the
order you must fix them:

### A1. DNS — `stas.aimino.io` must resolve

**Current state:** `dig stas.aimino.io` returns NXDOMAIN. The domain is not
pointed anywhere.

1. Log in to the DNS provider for `aimino.io` (check which provider hosts the
   zone; GitHub org domain verification in Phase B needs the same zone).
2. Create a `CNAME` record:
   - Host: `stas`
   - Target: `stas-website.fly.dev`
   - TTL: 300
3. Verify:
   ```bash
   dig +short stas.aimino.io
   # expect: stas-website.fly.dev (once the Fly app is deployed, this resolves to the app's IPs)
   ```

> **Why CNAME to `stas-website.fly.dev`:** the Fly app owns its IPs. A CNAME
> keeps DNS in sync with Fly's anycast addresses automatically. Do **not** add
> an A record unless you are pinning a specific IP and understand the tradeoff.

### A2. Fly.io — app must exist and be deployable

**Current state:** `stas-website.fly.dev` does not resolve, which means either
the app has not been created or it has never been deployed.

1. Install the Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
2. Log in (as an owner of the Aimino Fly org):
   ```bash
   flyctl auth login
   ```
3. Create the app (idempotent — errors if it already exists):
   ```bash
   flyctl apps create stas-website
   ```
4. Check the `website/fly.toml` (app `stas-website`, internal port 80, nginx)
   is present, then deploy once from a machine with `FLY_API_TOKEN`:
   ```bash
   FLY_API_TOKEN=$FLY_API_TOKEN flyctl deploy --remote-only \
     --app stas-website --dockerfile website/Dockerfile
   ```

### A3. GitHub Actions — unblock deploys

**Current state:** every `Deploy Website` run fails before any job starts with:
> "The job was not started because recent account payments have failed or your
> spending limit needs to be increased."

and the `FLY_API_TOKEN` secret is **not set** in the repo (the workflow's
`deploy-fly` job is skipped at runtime when the secret is empty).

1. **Org admin:** fix the GitHub organization billing / spending limit
   (Settings → Billing & plans). No Actions run until this is resolved.
2. **Org admin:** create a Fly API token (`flyctl auth token` or a
   [Fly machine API token](https://fly.io/docs/security/tokens/)) and add it:
   - Repo **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FLY_API_TOKEN`
   - Value: the Fly token (never commit it)
3. Trigger a deploy:
   ```bash
   gh workflow run "deploy-website.yml" -f deploy_env=production
   ```
   or push a change under `website/` to `main`.

### A4. Verify pages are live (ticket #3 and #4)

Once DNS + Fly + a successful deploy are all in place:

```bash
bash scripts/check-marketplace-live.sh
# Expect all checks PASS: DNS resolves, /privacy → 200, /terms → 200
```

The script exits `0` only when all of the following hold:

- `stas.aimino.io` resolves
- `https://stas.aimino.io/privacy` returns HTTP 200 with a non-empty HTML body
- `https://stas.aimino.io/terms` returns HTTP 200 with a non-empty HTML body

---

## Phase B — Publisher verification (unblocks #2)

Everything is documented in `docs/marketplace/verified-publisher-guide.md`.
The four org-level actions, all needing an org admin in the GitHub UI:

1. **Verify the org domain** — Org Settings → Third-party access → Domain
   verification. Add `aimino.io`, add the TXT record to the DNS provider
   (same zone as Phase A1), wait for propagation, click Verify.
2. **Enforce 2FA** — Org Settings → Security → Authentication security.
3. **Complete the org profile** — Org Settings → Profile (name, description,
   website, support email, avatar ≥200×200).
4. **Submit the publisher application** —
   <https://github.com/marketplace/manage/publishers> → "Apply for publisher
   verification". Review takes 3–5 business days; GitHub emails the outcome.

> **Sequencing note:** Phase A (privacy/terms URLs live) must finish before
> step 4 — the application form references both URLs, and Marketplace checks
> they resolve.

---

## Phase C — Submit the listing (unblocks #1)

1. Prepare the remaining assets (see `docs/marketplace-listing.md` →
   "Visual Assets Preparation Guide"):
   - Logo 120×120 PNG (≤1 MB)
   - One or more screenshots 1280×640 PNG (≤2 MB) — use the `stas-demo` repo
   - Optional demo GIF (30–45 s, ≤10 MB)
2. Configure the pricing plan in the Marketplace billing UI (tiers in the
   listing doc: Free OSS / Solo $49 / Team $149 / Enterprise).
3. Draft the listing at <https://github.com/marketplace/manage> using the copy
   in `docs/marketplace-listing.md` (short desc 162/180 chars, full desc
   ~990 chars, category "Code review / Automated fixes").
4. Set the privacy/terms URLs on the listing to
   `https://stas.aimino.io/privacy` and `https://stas.aimino.io/terms`
   (must be live — Phase A).
5. Submit for review. GitHub's review timeline is **3–6 weeks**.

---

## Phase D — Follow-up tracker (ticket #5)

Fill this in as the human steps complete. Timeline per GitHub Marketplace docs:
listing review typically **3–6 weeks**; publisher verification **3–5 business days**.

| Milestone | Target date | Date done | Notes / outcome |
|-----------|-------------|-----------|-----------------|
| DNS record for `stas.aimino.io` added | — | | `dig +short stas.aimino.io` must return `stas-website.fly.dev` |
| Fly app `stas-website` created | — | | `flyctl apps create stas-website` |
| `FLY_API_TOKEN` secret added to repo | — | | Repo Settings → Secrets → Actions |
| Org billing/spending limit resolved | — | | Blocks ALL Actions runs |
| First successful `Deploy Website` run | — | | `check-marketplace-live.sh` must PASS |
| `/privacy` and `/terms` return 200 | — | | Ticket #3 + #4 acceptance |
| Org domain verified (`aimino.io`) | — | | Phase B step 1 |
| 2FA enforced in org | — | | Phase B step 2 |
| Publisher application submitted | — | | Phase B step 4 |
| Publisher badge received | ~3–5 business days after submit | | Email notification |
| Listing assets uploaded (logo/screenshots) | — | | Phase C step 1 |
| Listing submitted for review | — | | Phase C step 5 |
| **Expected decision** | **~3–6 weeks after submit** | | GitHub emails the outcome |
| Follow-up #1 (if no response in 2 weeks) | submit + 14 days | | Reply on the listing / contact GitHub support |
| Follow-up #2 (if no response in 4 weeks) | submit + 28 days | | Escalate via GitHub support |

**Weekly cadence while in review:** re-run `bash scripts/check-marketplace-live.sh`
(regression guard for the URLs Marketplace is checking) and re-check the
`Deploy Website` workflow runs are green.

---

## What is intentionally out of scope here

- Rewriting the privacy/terms copy — sources live at
  `docs/policies/privacy-policy.md` and `docs/policies/terms-of-service.md`,
  rendered pages at `website/privacy.html` / `website/terms.html`.
- Creating the logo/screenshots — creative work, covered by the assets guide.
- Changing the deploy pipeline — it is correct since PR #736; it only needs
  the Phase A blockers cleared.
