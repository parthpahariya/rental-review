DOCKER ?= docker
COMPOSE = $(DOCKER) compose
# Production on the shared Google Cloud VM; run by deploy/bootstrap-vm.sh.
PRODUCTION = $(COMPOSE) -f compose.yaml -f compose.production.yaml
# The shared PostgreSQL lives in a sibling repo; cloned on first use.
PLATFORM_DIR ?= ../postgres-platform
PLATFORM_REPO ?= https://github.com/parthpahariya/postgres-platform.git
PLATFORM_REF ?= main
PYTHON ?= python3.13
export PLATFORM_DIR

.PHONY: db db-read up down full_up full_down watch logs test test-backend test-web smoke clean-test deploy deploy-status

$(PLATFORM_DIR):
	git clone --branch "$(PLATFORM_REF)" "$(PLATFORM_REPO)" "$(PLATFORM_DIR)"

db: | $(PLATFORM_DIR) ## Start the shared PostgreSQL if needed; create this app's database and roles if missing
	DOCKER="$(DOCKER)" $(PYTHON) "$(PLATFORM_DIR)/bin/ensure-db" rental_review

db-read: ## Open a read-only psql on the shared database (as rental_review_reader)
	$(DOCKER) exec -it shared-postgres psql -U rental_review_reader -d rental_review

up: db
	$(COMPOSE) up --build -d --wait --wait-timeout 180 --remove-orphans

watch:
	$(COMPOSE) watch --no-up backend web

down:
	$(COMPOSE) down

# postgres-platform owns the shared Colima VM. full_up starts it only if it is stopped;
# stop or resize it there (make -C $(PLATFORM_DIR) colima_down / vm_resize), since that hits every app.
full_up: | $(PLATFORM_DIR)
	$(MAKE) -C "$(PLATFORM_DIR)" colima_up
	$(MAKE) up

full_down: | $(PLATFORM_DIR)
	@if $(MAKE) -s -C "$(PLATFORM_DIR)" vm_running; then $(MAKE) down; \
	else echo "The Colima VM is already stopped."; fi

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
