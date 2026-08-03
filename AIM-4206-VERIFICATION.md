# AIM-4206: Billing & Analytics Infrastructure — Verification

This PR verifies the implementation of AIM-4206 (Billing & Analytics Infrastructure), which was completed via the verification ticket **AIM-4212** (PR #659).

## Implemented Features

### 1. PostHog Event Tracking (was AIM-4187)
- **Analytics client** (`src/analytics/tracker.ts`) — PostHog SDK integration with `initAnalytics()`, `captureEvent()`, `shutdownAnalytics()`
- **6 core events** instrumented across the codebase:
  - `app_installed` — GitHub App installation
  - `issue_labeled` — Issue labeled with syntaro:fix
  - `user_signup` — User authentication/signup
  - `fix_completed` — Fix successfully completed
  - `user_converted` — Free → paid conversion
  - `user_canceled` — Subscription cancellation
- **Privacy**: Graceful no-op when POSTHOG_API_KEY not set
- **Config**: `POSTHOG_API_KEY` and `POSTHOG_HOST` env vars

### 2. Free Tier Metering (was AIM-4192)
- **Subscription plans** (`src/billing/plans.ts`) — Free ($0/50 fixes), Solo ($49/100), Team ($149/500), Enterprise (custom)
- **Free tier**: 10→50 fixes/month (increased from original implementation)
- **Exposure**: Remaining fix count displayed in PR footer

### 3. Stripe Billing — Price IDs (was AIM-4188)
- **Price IDs**: Free ($0), Solo ($49/mo), Team ($149/mo), Enterprise (custom)
- **Webhook handler** (`src/billing/webhook.ts`) — Stripe subscription lifecycle:
  - `checkout.session.completed` → Activate subscription
  - `invoice.paid` → Update billing period
  - `customer.subscription.updated` → Plan change sync
  - `customer.subscription.deleted` → Downgrade to free
- **Error handling**: Missing STRIPE_WEBHOOK_SECRET → 500, invalid signature → 401, unknown events → 200 with log

### 4. Usage Tracking
- **UsageTracker** (`src/metering/tracker.ts`) — Records triage, agent runs, fallback models, sandbox time, PR creation
- **Cost calculation** integrated with analytics events

## Verification Status
- [x] PostHog integration with 6 core events
- [x] Analytics no-ops gracefully when API key not set
- [x] Free tier set to 50 fixes/month
- [x] Subscription plans: Free/Solo/Team/Enterprise
- [x] Stripe webhook handlers for subscription lifecycle
- [x] Usage tracking with cost calculation
- [x] All existing tests pass
