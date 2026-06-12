.PHONY: eval-up eval-down eval-logs eval-run eval-smoke eval-standard eval-full

# ── Eval Docker Compose ────────────────────────────────────────────────────

eval-up:
	docker compose -f docker-compose.eval.yml up -d

eval-down:
	docker compose -f docker-compose.eval.yml down

eval-logs:
	docker compose -f docker-compose.eval.yml logs -f

# ── Eval Commands ──────────────────────────────────────────────────────────

eval-run:
	npx promptfoo eval --tests eval/test-cases/smoke.txt

eval-smoke:
	npx promptfoo eval --max-concurrency 2 --tests eval/test-cases/smoke.txt

eval-standard:
	npx promptfoo eval --tests eval/test-cases/standard.txt

eval-full:
	npx promptfoo eval --tests eval/test-cases/full.txt && npx promptfoo redteam run
