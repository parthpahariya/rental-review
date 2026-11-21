DOCKER ?= docker
COMPOSE = $(DOCKER) compose
COLIMA_PROFILE ?= rental-review
COLIMA_CONTEXT = $(if $(filter default,$(COLIMA_PROFILE)),colima,colima-$(COLIMA_PROFILE))
# Production on the shared Google Cloud VM; run by deploy/bootstrap-vm.sh.
PRODUCTION = $(COMPOSE) -f compose.yaml -f compose.production.yaml

.PHONY: up down full_up full_down watch logs test test-backend test-web smoke clean-test deploy deploy-status

up:
	$(COMPOSE) up --build -d --wait --wait-timeout 180

watch:
	$(COMPOSE) watch --no-up backend web

down:
	$(COMPOSE) down

full_up:
	colima start --profile "$(COLIMA_PROFILE)"
	$(MAKE) up DOCKER_CONTEXT="$(COLIMA_CONTEXT)"

full_down:
	@status=0; \
	if colima status --profile "$(COLIMA_PROFILE)" >/dev/null 2>&1; then \
		$(MAKE) down DOCKER_CONTEXT="$(COLIMA_CONTEXT)" || status=$$?; fi; \
	colima stop --profile "$(COLIMA_PROFILE)" || status=$$?; exit $$status

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

deploy:
	$(PRODUCTION) config --quiet
	$(PRODUCTION) up --build -d --wait --wait-timeout 300 --remove-orphans

deploy-status:
	$(PRODUCTION) ps
	curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/health -o /dev/null
	curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/api/health/ready -o /dev/null
