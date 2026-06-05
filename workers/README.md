# STAS Celery Workers

Python Celery worker service for the STAS agent pipeline.

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
| `triage`       | `stas.agents.triage`     | Issue classification via OpenAI |
| `agent`        | `stas.agents.dispatch`   | OpenCode agent dispatch         |
| `sandbox`      | `stas.agents.sandbox`    | E2B sandbox management          |
| `verification` | `stas.agents.verification` | Test suite verification       |
| `pr_creation`  | `stas.agents.pr_creation` | GitHub PR creation              |
| `notifications`| `stas.agents.notifications` | Slack/webhook notifications   |

## Monitoring

Start Flower for task monitoring:

```bash
celery -A celery_app flower --port=5555
```

## Docker

```bash
docker compose up workers-celery
```
