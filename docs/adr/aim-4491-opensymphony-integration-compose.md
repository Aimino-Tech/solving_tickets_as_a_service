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

The stale local branch `d65d741` (10 tsc errors / 32 test failures) predates the
AIM-4481 green-build fixes. It is **abandoned**. The canonical integration state
is `aimino/main @ 4392aca` (merge of AIM-4481 PR #743) plus this PR (AIM-4491).
Do not rebase, force-update, or merge `d65d741`; delete it locally if it is still
checked out.

## Consequences

- The 3-repo webhook path is now CI-visible end-to-end when OpenSymphony boots.
- No STAS regression risk: the STAS webhook path does not depend on OpenSymphony
  health, and all existing tests are untouched.
- OpenSymphony boots with synthetic secrets (`LINEAR_API_KEY`, etc.) only to keep
  the HTTP server alive; it performs no real work in the integration stack.
