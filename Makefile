.PHONY: up down logs test test-backend test-web smoke clean-test

up:
	docker compose up --build -d --wait --wait-timeout 180

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

test: test-backend test-web

test-backend:
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml up -d --wait db
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml build backend
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend alembic upgrade head
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend alembic check
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend ruff check .
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend pytest -q

test-web:
	cd fronend/webUI && npm ci && npm test && npm run build

smoke:
	python3 scripts/smoke.py "http://$$(docker compose port web 8080)"

clean-test:
	docker compose -p rental-review-test -f compose.yaml -f compose.test.yaml down --volumes --remove-orphans
