# User-domain migrations (Supabase)

**Source of truth** for identity + commercial user schema.

## Rules

1. **New user/commercial DDL** goes here only — not in `src/db/migrations/`.
2. Applied by [`src/db/migrate.ts`](../../src/db/migrate.ts) **before** ops migrations, tracked as `supabase/<filename>.sql`.
3. Keep statements **idempotent** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
4. Ops tables (`runs`, webhooks, analytics, pipeline) stay in `src/db/migrations/` (historical user DDL there is frozen).

## Auth

- Supabase Auth (`auth.users`) owns credentials.
- `public.users.id` is the Auth UUID.
- App CRUD uses the Postgres pool (`pg`), not supabase-js table APIs.
