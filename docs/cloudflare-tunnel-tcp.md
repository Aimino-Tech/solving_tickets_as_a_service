# Cloudflare Tunnel TCP Routes — Full Setup Guide

How to expose raw TCP services (PostgreSQL, RabbitMQ AMQP, Redis) through
Cloudflare Tunnel so an application on another machine can reach them over the
tunnel, even though Cloudflare's public edge only listens on 80/443.

## 1. Why this is needed

Cloudflare's edge servers only accept connections on ports 80 and 443. A
normal tunnel route (`service: http://localhost:5432`) proxies *HTTP only* —
it is useless for PostgreSQL (5432), RabbitMQ AMQP (5672), or Redis (6379),
which speak raw binary protocols.

`cloudflared access tcp` solves this: it establishes a WebSocket connection to
the tunnel, Cloudflare routes it to the origin's TCP listener, and `cloudflared`
bridges your local TCP connection over that WebSocket. The client side then
talks to `localhost:<local-port>` as if the service were local.

```
Application ──> localhost:5672  (cloudflared access tcp forwarder)
                         │  WebSocket over 443
                         ▼
              Cloudflare edge (TCP route for mq.syntaro.io)
                         │  tunnel
                         ▼
              Origin host: RabbitMQ on 127.0.0.1:5672
```

This works from any machine that runs the `cloudflared` client and has a
tunnel account with TCP routes configured — no VPN required.

## 2. Prerequisites

- A Cloudflare account with the domain (`syntaro.io`) on Cloudflare DNS.
- The origin host where the services run (e.g. the Hetzner server
  `87.106.166.165`), with `cloudflared` installed and a tunnel already created
  for the HTTP hostnames (`mqadmin.syntaro.io` → RabbitMQ mgmt).
- A machine that needs to reach the services (the app server), also with
  `cloudflared` installed.

## 3. Origin side: declare the TCP routes

The tunnel's ingress rules live in the tunnel config. TCP routes are declared
exactly like HTTP routes, but the origin service is `tcp://`.

### 3.1 Edit the tunnel config

The tunnel config is defined either:

- **In the Cloudflare dashboard** (Zero Trust → Networks → Tunnels →
  <tunnel> → Configure → Public Hostname), or
- **In a config file** on the origin host (`config.yml`) for locally-managed
  tunnels.

Dashboard approach — for each raw service add a Public Hostname:

| Public Hostname | Service type | Origin URL |
|---|---|---|
| `db.syntaro.io` | TCP | `tcp://localhost:5432` |
| `mq.syntaro.io` | TCP | `tcp://localhost:5672` |
| `redis.syntaro.io` | TCP | `tcp://localhost:6379` |

Keep the HTTP routes as they are:

| Public Hostname | Service type | Origin URL |
|---|---|---|
| `mqadmin.syntaro.io` | HTTP | `http://localhost:15672` |

Config-file approach — `config.yml` on the origin host:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  # HTTP routes (existing)
  - hostname: mqadmin.syntaro.io
    service: http://localhost:15672

  # NEW TCP routes
  - hostname: db.syntaro.io
    service: tcp://localhost:5432
  - hostname: mq.syntaro.io
    service: tcp://localhost:5672
  - hostname: redis.syntaro.io
    service: tcp://localhost:6379

  # Catch-all: reject everything else
  - service: http_status:404
```

### 3.2 Restart the tunnel on the origin

```bash
# Locally-managed tunnel:
sudo systemctl restart cloudflared

# Verify the tunnel picked up the new routes:
cloudflared tunnel list
cloudflared tunnel info <TUNNEL_ID>
```

The routes are now live on Cloudflare's edge.

## 4. Client side: connect via `cloudflared access tcp`

### 4.1 One-shot connection (test)

```bash
# RabbitMQ AMQP
cloudflared access tcp --hostname mq.syntaro.io --url localhost:5672

# PostgreSQL
cloudflared access tcp --hostname db.syntaro.io --url localhost:5432

# Redis
cloudflared access tcp --hostname redis.syntaro.io --url localhost:6379
```

While each command runs, connect to `localhost:<port>` with the normal client:

```bash
redis-cli -h localhost -p 6379 -a <REDIS_PASSWORD>
psql "postgresql://postgres:<PW>@localhost:5432/postgres"
```

### 4.2 Persistent forwarders (systemd, current user — no sudo)

Create one unit per service so the forwarders survive reboots and are not
attached to a terminal.

`~/.config/systemd/user/cloudflared-mq.service`:

```ini
[Unit]
Description=Cloudflare Tunnel TCP forwarder: mq.syntaro.io -> localhost:5672
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared access tcp \
    --hostname mq.syntaro.io --url localhost:5672
Restart=always
RestartSec=5
StandardOutput=append:/tmp/cloudflared-mq.log
StandardError=append:/tmp/cloudflared-mq.log

[Install]
WantedBy=default.target
```

Repeat for `db.syntaro.io` (5432) and `redis.syntaro.io` (6379) with distinct
unit names and local ports.

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now cloudflared-mq cloudflared-db cloudflared-redis
systemctl --user status cloudflared-mq
```

### 4.3 Point the application at the forwarders

With forwarders running, the app uses `localhost` URLs — the tunnel is
transparent:

```bash
# .env
DATABASE_URL=postgresql://postgres:F1HFJo...@localhost:5432/postgres
REDIS_URL=redis://:moYDuD...@localhost:6379
RABBITMQ_URL=amqp://rmq_admin:Ntsrw...@localhost:5672/
```

Do NOT use `*.syntaro.io` in the app config — those hostnames are only used
by `cloudflared access tcp` as the tunnel destination; raw TCP to them times
out because the edge only speaks HTTP to the public DNS name.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error="websocket: bad handshake"` | Route is declared as `http://` on the origin, or no TCP route exists | Set the route to `tcp://localhost:<port>` in the tunnel config and restart cloudflared |
| `TimeoutError: timed out` connecting to `mq.syntaro.io:5672` directly | Cloudflare edge only accepts 80/443 publicly | Always connect via `cloudflared access tcp` to a local port, never the public hostname:port |
| `Cannot connect ... Network is unreachable` | App uses the public hostname instead of the local forwarder | Point the app at `localhost:<local-port>` (see 4.3) |
| Forwarder starts but connection resets | Firewall on origin blocks the local listener, or service isn't bound to 127.0.0.1/0.0.0.0 | Confirm `ss -tlnp` shows the service on the origin; check `journalctl --user -u cloudflared-mq` |
| Access denied / authentication required | Tunnel has Cloudflare Access policies | Add an Access service token or an allow policy for the client's IPs |

## 6. Security notes

- TCP routes are as exposed as HTTP routes: anyone who knows the hostname and
  credentials can attempt to connect. The services' own auth (Postgres
  passwords, Redis `requirepass`, RabbitMQ users) is the real gate — keep the
  strong credentials you deployed.
- Restrict with Cloudflare Access policies where possible (Zero Trust →
  Access → Applications) to allow only known IP ranges.
- Do not expose the OpenCode serve port (4096) or internal admin ports through
  the tunnel.
- Keep `guest` deleted on RabbitMQ and never bind services to 0.0.0.0 on the
  public internet directly — the tunnel is the only ingress.

## 7. Reference

- `cloudflared` binary: `/usr/local/bin/cloudflared`
- Client version in use: 2026.3.0
- Local forwarder logs: `/tmp/cloudflared-<svc>.log`
- Tunnel is managed via Zero Trust dashboard (token-based, remote config) —
  edit ingress rules there, then the tunnel auto-reloads.
