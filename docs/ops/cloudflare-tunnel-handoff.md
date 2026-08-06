# Handoff: Cloudflare Tunnel — bring `api.syntaro.io` back to life

> **For:** Malek's agent (Cloudflare/infra owner)
> **From:** SYNTARO bot setup agent
> **Date:** 2026-08-06
> **Status:** awaiting execution — every step below is verified-ready except the tunnel itself

---

## 1. Context

`https://api.syntaro.io` currently returns **HTTP 502** (Cloudflare edge is proxying
the zone, but the origin is down). This blocks the GitHub App webhook endpoint
`https://api.syntaro.io/webhook`, which blocks the whole SYNTARO fix pipeline.

Everything on the GitHub side is **already done and verified** — the only missing
piece is the tunnel + a reachable backend.

## 2. GitHub App (already configured — do not change)

| Item | Value |
|---|---|
| App name | `syntaro-bot` (org Aimino-Tech) |
| App ID | `4506189` |
| Client ID | `Iv23lix38nVkPbBQG2V5` |
| Public page | `https://github.com/apps/syntaro-bot` |
| Webhook URL (set & active) | `https://api.syntaro.io/webhook` |
| SSL verification | Enabled (Cloudflare edge cert is fine) |
| Events subscribed | `issues`, `issue_comment`, `pull_request`, `check_suite` |
| Permissions | checks/contents/issues/pull_requests = **write**, metadata = read |
| Installation | org Aimino-Tech, installation ID `151695407`, all repositories |

> `marketplace_purchase` event is NOT subscribable via UI — GitHub auto-subscribes
> it when the app gets a Marketplace listing (`/marketplace/new/app/4506189`).

## 3. Secrets (NOT in this file — repo is public)

| Secret | Location / how to get |
|---|---|
| `GITHUB_APP_ID` | `4506189` (above) |
| `GITHUB_PRIVATE_KEY` | `/home/xdn/Documents/Syntaro/solving_tickets_as_a_service/.secrets/syntaro-bot.private-key.pem` (RSA; fingerprint `SHA256:ymp7Mpu7O7vr2nNgOukY50WfX3VGdr0NgKNbzbxVK2s=`; already gitignored) — copy to the deployment host |
| `GITHUB_WEBHOOK_SECRET` | Ask the repo owner (xdnaimino) — send over a secure channel. **Never commit it.** |

## 4. Step 1 — Run the backend

Use the existing STAS stack: `docker-compose.prod.yml` (Postgres 16 + Redis 7 +
RabbitMQ + webhook + worker + celery-beat + nginx), or plain `node dist/src/index.js`
for a minimal webhook-only run.

- Webhook endpoint: **`POST /webhook`** (alias `/webhook/github`) — this is exactly
  the path the GitHub App points at.
- Health: **`GET /health`**.
- Port: default `SYNTARO_PORT=3000` (the compose healthcheck probes
  `http://localhost:3000/health`). **Note:** on the shared dev box, port 3000 is
  already taken by an unrelated project (Medtronic) — if deploying there, set
  `SYNTARO_PORT` to e.g. `3001` and point the tunnel at that port.
- Required env:
  ```
  GITHUB_APP_ID=4506189
  GITHUB_PRIVATE_KEY_PATH=<path to the pem above>
  GITHUB_WEBHOOK_SECRET=<from owner>
  SYNTARO_PORT=<3000 or 3001 if port conflict>
  REDIS_URL / DATABASE_URL / AMQP_URL=<from the compose stack>
  ```
- An STAS instance already runs locally under `/home/malek`
  (`node dist/src/index.js`, MCP SSE on 4095, OpenCode on 4096). If repointing it,
  verify it is rebuilt with the **new** app credentials (App ID `4506189`) and is
  listening on a known port.

## 5. Step 2 — Cloudflare Tunnel

- Zone: **`syntaro.io`** — already on Cloudflare (proxied A/AAAA, edge IPs
  `104.21.92.4` / `172.67.183.113`).
- Create a tunnel (dashboard: Zero Trust → Networks → Tunnels, or
  `cloudflared tunnel create` + `cloudflared tunnel route dns <id> api.syntaro.io`).
- **Ingress (HTTP only — no TCP routes needed):**
  ```
  hostname: api.syntaro.io
  service:  http://<backend-host>:<SYNTARO_PORT>
  ```
  Cloudflare terminates TLS at the edge; the origin can be plain HTTP on localhost.
- Run the connector: `cloudflared tunnel run <TUNNEL_ID>` (or docker) with the
  tunnel token/credentials.

## 6. Step 3 — Verify (acceptance criteria — all must pass)

Fastest path — run the ready-made checker:

```bash
bash scripts/check-webhook-live.sh
# expect: "All checks passed — the webhook endpoint is live." (exit 0)
```

Or manually:

```bash
# 1. Health
curl -sI https://api.syntaro.io/health          # expect HTTP 200 (was 502)

# 2. Webhook reachable (may return 4xx — that's fine, just NOT 502)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.syntaro.io/webhook

# 3. GitHub confirms delivery
#    App settings → syntaro-bot → Advanced → Recent Deliveries → status 200
```

Then end-to-end smoke test:

1. Open `https://github.com/Aimino-Tech/syntaro-demo`.
2. Label any open issue with `syntaro:fix`.
3. Expect: webhook received → bot posts "working on it" comment → fix PR within minutes.

## 7. Report back

When done, report:
- Tunnel ID + hostname routed
- Backend host:port
- Output of the two curl checks
- Result of the label smoke test

## 8. After verification (follow-up, owned by the bot-setup agent)

- Old app `stas-bot-aimino` (App ID `3996879`, webhook `smee.io/stas-dev`) gets retired.
- The Marketplace listing can proceed (`/marketplace/new/app/4506189`) — which also
  auto-enables the `marketplace_purchase` webhook event.
