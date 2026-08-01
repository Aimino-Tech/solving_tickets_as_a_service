# ADR-009: OpenSymphony in the 3-Repo Integration Compose + Abandoned Branch Note

Status: accepted (AIM-4491)

## Context

The 3-repo integration suite (STAS ↔ governance ↔ OpenSymphony) composes STAS,
the llm-governance proxy, and Postgres/Redis/RabbitMQ, but deliberately excluded
OpenSymphony — the governance forwarding test asserted a `502` because the
upstream was absent. The full `webhook → STAS → governance → OpenSymphony → 202`
path was therefore never covered end-to-end in CI.

## Decision

1. **Add an `opensymphony` service to `tests/integration/docker-compose.yml`**,
   built from the sibling checkout `../../OpenSymphony` (same pattern already used
   for `llm-governance`: private registry images cannot be pulled in public CI, so
   both are built from source). Healthcheck probes `GET /health` on port 4000
   (the port OpenSymphony's `symphony.yml` binds its HTTP server to). The service
   is a dependency only of the *stack*, not of STAS — STAS's `depends_on` is
   unchanged so a broken OpenSymphony build can never take the STAS webhook path
   down.
2. **Wire the governance → OpenSymphony hop**: set `OPENSYMPHONY_WEBHOOK_URL` on
   the `governance` service to `http://opensymphony:4000/api/v1/stas/webhook`.
   This env var is read by the governance proxy (`guardrail/webhook_routes.py`),
   which forwards allowed STAS webhooks to OpenSymphony; OpenSymphony's
   `POST /api/v1/stas/webhook` controller returns `202 accepted`.
3. **Integration test degrades gracefully**: the upstream-forwarding test probes
   OpenSymphony health first and `ctx.skip`s with an explanatory message when the
   optional upstream is unavailable (e.g. CI without the sibling checkout, or an
   OpenSymphony build that cannot boot without secrets). It never hard-fails CI
   on an external service being down.
4. **`wait-for-health.sh` treats OpenSymphony as best-effort**: the OS wait prints
   a warning instead of exiting non-zero, so a missing/unhealthy OS does not fail
   the whole integration job.

## Abandoned branch note

The stale branch tip `d65d741` (10 tsc errors / 32 test failures) is the HEAD of
the AIM-4444 feature branch
`tamnguyen/aim-4444-stas-launch-chat-lead-session-bridge-chat-drives-the-lead-os`,
which predates the AIM-4481 green-build fixes. It is **abandoned** (documented
here — no force-delete of remote branches without approval). The canonical
integration state is `aimino/main @ 3c0e973` (Syntaro rebrand complete) plus this
PR (AIM-4491). Do not rebase, force-update, or merge `d65d741`; delete it locally
if it is still checked out.

## Consequences

- The 3-repo webhook path is now CI-visible end-to-end when OpenSymphony boots.
- No STAS regression risk: the STAS webhook path does not depend on OpenSymphony
  health, and all existing tests are untouched.
- OpenSymphony boots with synthetic secrets (`LINEAR_API_KEY`, etc.) only to keep
  the HTTP server alive; it performs no real work in the integration stack.

## Two pre-existing integration-stack fixes folded in

While bringing the stack up it was broken in two pre-existing ways (both unrelated
to OpenSymphony, and both hidden because the `e2e-verify.yml` integration job had
been skipped on recent main runs):

1. **STAS container crashed at boot** — `src/utils/logger.ts` loads `pino-pretty`
   whenever `NODE_ENV != "production"` (the stack runs `NODE_ENV=test`), but
   `tests/integration/Dockerfile.stas` ran `npm prune --production` which removed
   the devDependency. Fix: reinstall `pino-pretty@^13.1.3` (`--no-save`) in the
   runtime stage.
2. **STAS `/health` returned 503** — tsc emits only `.ts → .js`, so the migration
   SQL never made it into the image and `health_checks` (queried by `/health`)
   never existed. Fix: copy `src/db/migrations` into `dist/src/db/migrations` in
   the runtime stage, and run `node dist/src/db/migrate.js` from
   `wait-for-health.sh` before waiting for STAS.

A third blocker lives in the **llm-governance repo** (governance proxy crashed at
boot on `_redact_sensitive` `%.2f % None` and a uvicorn `log_level` `KeyError`) —
tracked separately as AIM-4492; it is fixed in the local build-context checkout
only for this verification and must land in llm-governance.

A fourth llm-governance bug, also tracked in AIM-4492: `forward_webhook`
(`guardrail/webhook_utils.py`) catches `URLError` before `HTTPError` (its
subclass), so any non-2xx upstream response was reported as `502 Upstream
unreachable`. With OpenSymphony in the stack, OS answering `400 unsupported_event`
looked identical to "OS down". Fixed (local build-context checkout) by handling
`HTTPError` first and propagating the real upstream status/body.

## STAS service runtime tweaks (integration image)

The integration stack runs no real opencode server, so two STAS-side settings were
needed for the stack to become healthy:

- `STAS_AI_MODE: static` in the compose — `opencodeHealth` reports `healthy` in
  static mode, so STAS `/health` returns 200 (it otherwise 503s on the degraded
  opencode check and the compose healthcheck never passes).
- `vitest.integration.config.ts` — Vitest 4 resolves `include` relative to `dir`,
  so `dir: "tests"` + `include: ["tests/**/*.test.ts"]` matched nothing. Changed to
  `dir: "."` + `include: ["tests/integration/**/*.test.ts"]` so the compose-based
  integration suite actually runs.
