# AIM-1213: Stripe Billing Integration for Hosted Service

## Status: ✅ Completed (merged into `main`)

## Implementation Summary

The Stripe billing integration has been implemented and merged into `main`.
This document serves as a tracking summary for the work.

## Files Implemented

### Stripe Module (`src/stripe/`)
| File | Purpose |
|---|---|
| `checkout.ts` | Stripe Checkout session creation for credit purchases |
| `credit-packs.ts` | Credit pack definitions (small/medium/large) with price IDs |
| `index.ts` | Barrel export for stripe module |
| `webhook.ts` | Webhook handler for Stripe events (checkout, invoice, subscription) |

### Billing API (`src/credits/`)
| File | Purpose |
|---|---|
| `routes.ts` | REST API: balance, transactions, top-up (Stripe Checkout), usage, admin adjust |
| `middleware.ts` | Deduct middleware for credit checking |

### Pricing Tiers (`src/pricing/`)
| File | Purpose |
|---|---|
| `tiers.ts` | Feature gates per tier (free/pro/enterprise) |
| `quota.ts` | Monthly fix quota enforcement per billing period |
| `middleware.ts` | Express middleware for quota checks |
| `admin.ts` | Admin pricing endpoints |

### Configuration
| File | Purpose |
|---|---|
| `src/config.ts` | Zod schema for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` |
| `.env.example` | Documentation for all Stripe-related environment variables |

### Webhooks
| File | Purpose |
|---|---|
| `src/webhooks/github.ts` | `marketplace_purchase` handler for GitHub Marketplace billing plan changes |
| `src/server.ts` | Registers `POST /webhook/stripe` route with raw body middleware |

### Tests
| File | Purpose |
|---|---|
| `src/__tests__/stripe/checkout.test.ts` | Unit tests for Stripe Checkout session creation |

## Features Implemented

### Credit-based Purchasing
- Three credit packs: 100 credits ($10), 500+50 bonus ($45), 2000+200 bonus ($150)
- Stripe Checkout integration with metadata-based fulfillment
- Webhook handler credits account on `checkout.session.completed`

### Subscription & Webhook Handling
- `checkout.session.completed` -> credit account
- `invoice.paid` -> subscription credit top-up
- `invoice.payment_failed` -> log and notify
- `customer.subscription.updated` -> plan changes
- `customer.subscription.deleted` -> plan downgrade

### Marketplace Integration
- GitHub Marketplace `marketplace_purchase` webhook handler
- Maps marketplace plan names to internal billing tiers
- Updates account tier in database

### Pricing Tiers
- Free: 1 concurrent fix, 10 fixes/month, no premium models
- Pro: 3 concurrent fixes, 100 fixes/month, premium models
- Enterprise: 10 concurrent fixes, unlimited, all features

### Usage Metering
- Per-account per-period fix counting
- Quota enforcement with clear errors
- Configurable credit consumption per action (fix run, triage, sandbox)

## Environment Variables

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_100_CREDITS=price_100credits
STRIPE_PRICE_500_CREDITS=price_500credits
STRIPE_PRICE_2000_CREDITS=price_2000credits
USAGE_CREDITS_FIX_RUN=50
USAGE_CREDITS_TRIAGE=10
USAGE_CREDITS_SANDBOX=5
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/credits/balance` | Current credit balance |
| GET | `/api/v1/credits/transactions` | Transaction history |
| POST | `/api/v1/credits/top-up` | Create Stripe Checkout session |
| GET | `/api/v1/credits/usage` | Usage statistics |
| POST | `/admin/credits/adjust` | Admin credit adjustment |
| POST | `/webhook/stripe` | Stripe webhook receiver |
