# User Story — SYNTARO Referral Program (AIM-4643)

> Status: implemented baseline 2026-08-07 (UI redesign + stats + click tracking + auth-gate fix).
> Tracked from Linear `AIM-4643`. Docs trace: `docs/user-stories-todo.md` (US-12 checklist), `docs/test-plan.md` (Dashboard — Core group).

## Story

**As a** SYNTARO user,
**I want** to invite friends with a personal referral link and earn **10 free fixes** when they sign up,
**so that** I get rewarded for growing the platform and friends can try automated bug-fixing for free.

## Background / business intent

Referral is a PLG growth mechanism: word-of-mouth signups reduce CAC versus paid channels.
**Reward unit = fixes** (per the public pricing model at syntaro.io/pricing: "Prepaid credit packs are not
part of the Syntaro pricing model" — the product is metered **fixes**, not credits). Both referrer and
referee earn **10 fixes** (`REFERRAL_REWARD_FIXES = 10`), granted as an account-level fixes allowance
(`accounts.referral_fixes_remaining`) that the quota gate (`src/pricing/middleware.ts`) consumes
automatically once a run exceeds the plan's monthly fix limit — no toggle required.
Attribution is measurable via the `referral_source` field on the `user_signup` analytics event
(`docs/gtm/analytics-dashboard.md`).

## Acceptance Criteria

### AC-1 — Referral code & link
- [ ] A logged-in user has exactly one referral code (auto-generated on first access, 8 chars,
      base32 alphabet without `0/1/I/L/O`).
- [ ] `GET /api/v1/referral/code` returns the code (creating it on first call); repeated calls are stable.
- [ ] The dashboard renders the full link `https://syntaro.io/?ref=<CODE>` and copies it on one click
      with visible success feedback (`Copied!` + toast); falls back to `window.prompt` without clipboard.

### AC-2 — Redemption at signup (anti-abuse)
- [ ] `POST /api/v1/referral/redeem` is reachable WITHOUT authentication (public), rate-limited
      (10/min/IP), and returns `400 Invalid referral code` for an unknown code, **not 401** (auth-gate regression guard).
- [ ] Redeeming creates two `pending` rewards: one for the referrer and one for the referee (10 fixes each).
- [ ] Self-referral (redeeming your own code, incl. email aliases like `user+tag@` / `user.tag@`) is rejected with `400`.
- [ ] Disposable email domains (mailinator, 10minutemail, yopmail, …) are rejected with `400`.
- [ ] A given email can be redeemed at most once (idempotent on the NORMALIZED email — aliases cannot create duplicates).

### AC-3 — Rewards, claiming & fixes allowance
- [ ] `GET /api/v1/referral/rewards` lists the caller's rewards oldest-first with qualification progress
      (1/2 steps = signed up; 2/2 = first fix completed) and a real status: `pending` → `qualified` → `claimed`.
- [ ] Both rewards are only claimable after the referred person has **completed ≥1 fix run**
      (`runs.status IN ('completed','success')`) — qualification gate kills account-farming.
- [ ] `POST /api/v1/referral/rewards/:id/claim` grants **10 fixes** to `accounts.referral_fixes_remaining`
      exactly once (atomic `UPDATE … RETURNING` gated on `status = 'pending' OR 'qualified'`; second claim → `400 Reward already claimed`; foreign id → `404`).
- [ ] Claim response includes `newAllowance`; the dashboard updates optimistically and surfaces it in a toast.
- [ ] `src/pricing/middleware.ts` consumes one referral fix (`consumeReferralFix`) when a run exceeds the
      plan's monthly fix limit — before any paid overage/credits path — then `402` if no allowance remains.

### AC-4 — Metrics (new)
- [ ] `GET /api/v1/referral/stats` (authenticated) returns `{ totalClicks, totalInvited,
      totalEarnedFixes, pendingFixes }`, numeric, `0` when empty.
- [ ] `POST /api/v1/referral/click` (public, rate-limited 60/min/IP) increments the code's click counter;
      unknown code → `400`.
- [ ] Dashboard shows 3 metric cards (Total Clicks, Successful Signups, Total Earned Fixes) fed by
      real API data, with skeleton and error states.

### AC-5 — Lifecycle & statuses
- [ ] Reward statuses render for `pending | qualified | claimed | expired | fraud` (backend type
      future-proof; actual transition today is `pending → qualified → claimed`).
- [ ] Status shown as a colored badge; Claim action only for claimable rows; progress bar shows 1/2 vs 2/2.
- [ ] Qualification is computed at read/claim time from the referee's actual run history
      (`runs.account_id` + completed status) — no fake states.

### AC-6 — i18n
- [ ] All page strings are translatable via `useI18n().t()`; keys exist in `en/de/fr/es`
      with equal key counts.

### AC-7 — UI quality
- [ ] Responsive (mobile-friendly, table scrolls), WCAG AA contrast, keyboard navigable,
      ≥44px touch targets, dark/light theme consistent with the dashboard design system.
- [ ] Value prop is legible in the product's own unit: "Give 10, Get 10" badge, metric card shows
      earned fixes, info strip explains fixes are applied automatically past the plan limit.

## Out of scope (documented follow-ups)
- Eager qualification trigger on first fix-run completion (today: computed lazily at list/claim time).
- Website-side (syntaro.io) integration: landing page click counter calls `POST /v1/referral/click`;
  signup deep-link `?ref=` capture lives in `Aimino-Tech/syntaro-website` (dashboard provides
  `captureReferralCodeFromUrl()` util).
- Referral expiry rules / fraud flagging automation (statuses reserved in the type).
- Team/Unlimited plans: fixes allowance is a no-op (quota gate is skipped at `monthlyFixQuota >= 999_999`).

## Test evidence (2026-08-07)
- Auth-gate fix: `POST /api/v1/referral/redeem` invalid code → `400` (was `401` before fix);
  `POST /api/v1/preview` no longer gated.
- Anti-abuse: normalization (gmail `+tag`/dots), disposable-domain block, redeem rate limit,
  qualification gate (claim blocked without a completed referee run) — covered in
  `src/__tests__/referral/service.test.ts` + `routes.test.ts`.
- Quota gate: `src/__tests__/pricing/middleware.test.ts` covers referral-fixes consumption order.
- Dashboard hooks covered by Vitest (`useCopyClipboard`, `useClaimReward` rollback).
