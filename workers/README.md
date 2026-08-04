# SYNTARO Celery Workers

Python Celery worker service for the SYNTARO agent pipeline.

## Quick start

```bash
cd workers
cp .env.example .env
pip install -r requirements.txt
celery -A celery_app worker --loglevel=info --concurrency=4
```

## Task modules

| Module         | Queue                    | Purpose                        |
|----------------|--------------------------|--------------------------------|
| `triage`       | `syntaro.agents.triage`     | Issue classification via OpenAI |
| `agent`        | `syntaro.agents.dispatch`   | OpenCode agent dispatch         |
| `sandbox`      | `syntaro.agents.sandbox`    | E2B sandbox management          |
| `verification` | `syntaro.agents.verification` | Test suite verification       |
| `pr_creation`  | `syntaro.agents.pr_creation` | GitHub PR creation              |
| `notifications`| `syntaro.agents.notifications` | Slack/webhook notifications   |

## Monitoring

Start Flower for task monitoring:

```bash
celery -A celery_app flower --port=5555
```

## Running modes

### Plan A: Full Docker (production)

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Plan B: Containerless development (fast iteration)

```bash
make dev-infra     # Redis + RabbitMQ in Docker (lightweight)
make dev-webhook   # Express on host
make dev-worker    # Celery on host
```

**Note**: Plan B has NO Docker sandbox. Sandbox tasks will fail with
"E2B_API_KEY not configured" error. This is by design — sandbox
tasks need Docker. For testing sandbox code, use Plan A.
For testing non-sandbox tasks (triage, notifications), Plan B works fine.

## Docker

```bash
docker compose up workers-celery
```
