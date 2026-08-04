# Database migrations

## Two folders

| Folder | Domain | Tracking name |
|--------|--------|---------------|
| [`supabase/migrations/`](../../supabase/migrations/) | **User / commercial** (users, accounts, credits, billing, teams, OAuth, GDPR) | `supabase/<file>.sql` |
| [`src/db/migrations/`](.) | **Ops / pipeline** (runs, webhooks, analytics, feature flags, …) | `<file>.sql` |

Runner: [`src/db/migrate.ts`](../migrate.ts) — applies **supabase first**, then ops.

## Rules

1. **New user/commercial DDL → `supabase/migrations/` only.** Do not add new identity/billing/credits/team DDL here.
2. Files in this folder that historically created user tables (`001_initial` credits, `013_users`, …) are **frozen** for checksum/history. Leave them; they stay idempotent (`IF NOT EXISTS`) alongside the Supabase pack.
3. Ops schema changes continue here as usual.

See [`supabase/migrations/README.md`](../../supabase/migrations/README.md).
