# STAS Makefile — Development workflow
#
# Plan A: Full Docker (production-like)
#   docker compose -f docker-compose.prod.yml up -d
#
# Plan B: Containerless development (fast iteration)
#   make dev-infra     # Redis + RabbitMQ in Docker (lightweight)
#   make dev-webhook   # Express on host
#   make dev-worker    # Celery on host

.PHONY: dev-infra dev-worker dev-webhook dev-all

dev-infra:  ## Start only Redis + RabbitMQ (lightweight Docker)
	docker compose -f docker-compose.dev.yml up -d

dev-worker:  ## Run Celery worker directly (no Docker sandbox)
	pip install -q -r workers/requirements.txt
	celery -A workers.celery_app worker -l info \
	  -Q stas.agents.$(QUEUE) --concurrency=2 --without-heartbeat

dev-webhook:  ## Run webhook directly
	npm run dev

dev-all: dev-infra  ## Run everything native
	@echo ""
	@echo "=== Plan B: Containerless Development ==="
	@echo "Infra (Redis + RabbitMQ) started via Docker."
	@echo ""
	@echo "In separate terminals, run:"
	@echo "  make dev-webhook"
	@echo "  make dev-worker QUEUE=triage,dispatch,verification,pr_creation,notifications"
	@echo ""
	@echo "Note: Plan B has NO Docker sandbox."
	@echo "Sandbox tasks will fail with 'E2B_API_KEY not configured'."
	@echo "For testing sandbox code, use Plan A."
