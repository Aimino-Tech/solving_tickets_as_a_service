# AIM-4456 — Fix TypeScript build (8 tsc errors) + restore test suite (36 failures)

P0. `npm run build` fails with 8 real TS errors; `npm test` fails 36/2013. Blocks AIM-3200 gates and CI.

## S1 — Build (8 tsc errors)

1. `src/credits/routes.ts:166,168` — snake_case `account_id`/`lifetime_credits` vs camelCase type `accountId`/`lifetimeCredits` → align object keys to the declared type.
2. `src/dispatch/celeryDispatcher.ts:157,170` — `runId` undefined → should be `dedupId` (field name bug).
3. `src/github/auth.ts:17,101` — `@syntaro/github-client` TS2307. Build script already runs `npm run build -w @syntaro/github-client && tsc`, so verify the workspace package actually emits types to `dist` and that `tsconfig` resolves them (may need package.json `types`/`exports` or build order). Do not check in `dist`.
4. `src/routes/github.ts:65,108` — string→number type mismatches; `:171` `getInstallationToken` undefined → verify import/export (likely not exported from the module that should provide it).
5. `src/routes/githubOAuth.ts:44` — `config.publicUrl` doesn't exist → use the real config key (verify `config.ts`, likely `publicBaseUrl`).

## S2 — Tests (36 failures)

Dominant root cause: `src/__tests__/server.test.ts:83` `vi.mock('../config.js')` lacks the `auth` key → `config.auth` undefined at `src/auth/rateLimit.ts:10` (~18 failures). Fix by mirroring EVERY top-level section of `src/config.ts` in the central shared config mock (`src/__tests__/setup.ts`).

Others to fix at root (mocks/setup), never by disabling tests:
- auth middleware id string-vs-number mock drift
- platforms/messages `mockConfig` hoisting → wrap in `vi.hoisted`
- db/migrations needs `DATABASE_URL` → temp sqlite or mock repo
- opensymphony-e2e payload-shape mismatch (`body`→`description`, `repo`→`repoOwner`)
- linear.createLink `mockFetch` never called → mock the fetch the code actually uses
- logger pino-pretty transport → configure logger for tests

## Dependency install path

Plain `npm ci` fails on ERESOLVE (@slack/bolt@4.7.3 wants @types/express@^5 vs pinned ^4.17). Minimal fix: add `.npmrc` with `legacy-peer-deps=true` (do NOT upgrade @slack/bolt).

## Verification

- `npm run build` exit 0 (paste output)
- `npm test` green (paste final summary)
- `npm ci` plain succeeds
- Manual: boot built server, curl /health + one /api/v1 route

## Commits

Conventional, e.g. `fix(AIM-4456): ...`. Push to `aimino tamnguyen/aim-4456-fix-build-tests`. Draft PR vs `main`. Attach PR URL to Linear.
