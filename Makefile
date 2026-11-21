DOCKER ?= docker
COMPOSE = $(DOCKER) compose
# One VM for every workspace app, so they share one shared-postgres container.
COLIMA_PROFILE ?= default
COLIMA_MEMORY ?= 8
COLIMA_CPUS ?= 4
COLIMA_CONTEXT = $(if $(filter default,$(COLIMA_PROFILE)),colima,colima-$(COLIMA_PROFILE))
# Production on the shared Google Cloud VM; run by deploy/bootstrap-vm.sh.
PRODUCTION = $(COMPOSE) -f compose.yaml -f compose.production.yaml
# The shared PostgreSQL lives in a sibling repo; cloned on first use.
PLATFORM_DIR ?= ../postgres-platform
PLATFORM_REPO ?= https://github.com/parthpahariya/postgres-platform.git
PLATFORM_REF ?= main
PYTHON ?= python3.13
export PLATFORM_DIR

.PHONY: db db-read up down full_up full_down vm_down vm_resize watch logs test test-backend test-web smoke clean-test deploy deploy-status

db: ## Start the shared PostgreSQL if needed; create this app's database and roles if missing
	@test -d "$(PLATFORM_DIR)" || git clone --branch "$(PLATFORM_REF)" "$(PLATFORM_REPO)" "$(PLATFORM_DIR)"
	DOCKER="$(DOCKER)" $(PYTHON) "$(PLATFORM_DIR)/bin/ensure-db" rental_review

db-read: ## Open a read-only psql on the shared database (as rental_review_reader)
	$(DOCKER) exec -it shared-postgres psql -U rental_review_reader -d rental_review

up: db
	$(COMPOSE) up --build -d --wait --wait-timeout 180 --remove-orphans

watch:
	$(COMPOSE) watch --no-up backend web

down:
	$(COMPOSE) down

# The Colima VM is shared with the other workspace apps and shared-postgres, so full_up and
# full_down never restart it; use vm_down / vm_resize for that.
full_up:
	@colima status --profile "$(COLIMA_PROFILE)" >/dev/null 2>&1 || \
		colima start --profile "$(COLIMA_PROFILE)" --memory "$(COLIMA_MEMORY)" --cpus "$(COLIMA_CPUS)"
	docker context use $(COLIMA_CONTEXT)
	$(MAKE) up DOCKER_CONTEXT="$(COLIMA_CONTEXT)"

full_down:
	@if colima status --profile "$(COLIMA_PROFILE)" >/dev/null 2>&1; then \
		$(MAKE) down DOCKER_CONTEXT="$(COLIMA_CONTEXT)"; \
	else echo "Colima profile $(COLIMA_PROFILE) is already stopped."; fi

vm_down:
	colima stop --profile "$(COLIMA_PROFILE)"

vm_resize:
	colima stop --profile "$(COLIMA_PROFILE)"
	colima start --profile "$(COLIMA_PROFILE)" --memory "$(COLIMA_MEMORY)" --cpus "$(COLIMA_CPUS)"
	docker context use $(COLIMA_CONTEXT)

logs:
	$(COMPOSE) logs -f --tail=100

test: test-backend test-web

test-backend:
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml up -d --wait db
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml build backend
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend alembic upgrade head
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend alembic check
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend ruff check .
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml run --rm backend pytest -q

test-web:
	cd fronend/webUI && npm ci && npm test && npm run build

smoke:
	python3 scripts/smoke.py "http://$$($(COMPOSE) port web 8080)"

clean-test:
	$(COMPOSE) -p rental-review-test -f compose.yaml -f compose.test.yaml down --volumes --remove-orphans

deploy: db
	$(PRODUCTION) config --quiet
	$(PRODUCTION) up --build -d --wait --wait-timeout 300 --remove-orphans

deploy-status:
	$(PRODUCTION) ps
	curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/health -o /dev/null
	curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/api/health/ready -o /dev/null
