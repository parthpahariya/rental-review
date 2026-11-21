# Rental Review

A working rental-review model with a FastAPI API, React/TypeScript interface, and PostgreSQL. The folder name `fronend` follows the requested structure.

## Start with Docker

Requires Docker with Compose v2.24.4+ (v5 also works) and Python 3.13 (`brew install python@3.13`). On macOS, start Docker Desktop or Colima first.

```sh
# First setup only; keep your existing .env if you have one.
cp -n .env.example .env
make up
```

The database is the **shared PostgreSQL** from the sibling repo
[postgres-platform](https://github.com/parthpahariya/postgres-platform) (`../postgres-platform`).
`make up` runs `make db` first: it clones that repo if missing, then its idempotent
`ensure-db rental_review` starts the shared container if needed and creates the
`rental_review` database and its roles if missing. Plain `docker compose up` works once
`make db` has run.

| Role | Used for |
| --- | --- |
| `rental_review_writer` | The running API (`DATABASE_URL`): read and write rows, cannot change tables |
| `rental_review_owner` | Migrations at start-up (`MIGRATION_DATABASE_URL`, used by `alembic upgrade head`) |
| `rental_review_reader` | Read-only access for people and tools (`READ_DATABASE_URL`) |

Their passwords are generated on your machine in `../postgres-platform/credentials/` and
never stored in this repo. Open a read-only psql with
`make -C ../postgres-platform psql DB=rental_review`.

- Web UI: <http://localhost:8080>
- Interactive API docs: <http://localhost:8000/api/docs>
- Readiness: <http://localhost:8000/api/health/ready>

`WEB_PORT` and `API_PORT` in `.env` override these ports. Nginx proxies `/api` to FastAPI, so the UI needs no build-time API URL. PostgreSQL stays on the Docker network without a host port; `make -C ../postgres-platform local` publishes it on `127.0.0.1:5433` for local tools.

The default setup seeds four **fictional** Bengaluru buildings, five flats, tenant reviews, and interactions. The interaction-only building appears in map results. Set `SEED_DEMO_DATA=false` for an empty database. Property provisioning is an operator task while its product workflow remains undecided; the demo seeder is an example.

Sign-in is **Google only**. Create an OAuth client ID of type "Web application" in Google Cloud Console (APIs & Services → Credentials), add every origin you open the site on (for example `http://localhost:8080` and `http://localhost:5173`) under *Authorized JavaScript origins*, and set `GOOGLE_CLIENT_IDS` in `.env`. Without it the sign-in dialog says Google sign-in is unavailable and nobody can sign in. The first Google sign-in creates an account; later sign-ins reuse it, keyed on Google's stable account id rather than the email.

```sh
docker compose logs -f --tail=100
docker compose ps
docker compose down          # Stops containers; preserves database and files
```

`make up` builds and starts the stack; `make down` stops it while preserving data.
For Colima, every workspace app (rental-review, wardrobe-manager) runs in the `default`
profile (8 GiB / 4 CPUs), so they share one `shared-postgres` container. `make full_up`
starts that VM if needed, makes it the current Docker context, and starts the stack;
`make full_down` stops only this app. The VM itself is managed from postgres-platform:
`make -C ../postgres-platform colima_down` stops it (every app), and `colima_resize` restarts it
to apply `COLIMA_MEMORY` / `COLIMA_CPUS`.

After startup, run `make watch` to rebuild the backend and web UI when their source
files change. Press Ctrl+C to stop watching; the stack keeps running.

## UI and design

[UI_WORKFLOW.md](UI_WORKFLOW.md) describes every screen, flow and state; the visual system
(tokens, type, components, accessibility baseline) is in
[design-system/rental-review/MASTER.md](design-system/rental-review/MASTER.md).

## Included behavior

- OpenStreetMap/Leaflet map with pan, zoom, keyboard markers, and an equivalent searchable property list. Select a building, then a flat; switch between Tenant Reviews and Interactions.
- Google sign-in (ID tokens verified server-side against Google's keys, audience, issuer, expiry, and verified email); PostgreSQL-backed per-IP rate limit; hashed opaque sessions; sign-out; confirmed deactivation and reactivation.
- Owner names belong to individual reviews. Each tenant review includes rating, feedback, and immutable tenancy dates. A flat-row lock makes conflicting submissions by different tenants atomic. Adjacent tenancy periods and overlapping reviews by the same author are supported.
- Authors can edit rating and feedback for 30 days. They can request deletion at any time; an admin must approve it. Approved deletion updates public views, rating aggregates, and tenancy availability atomically.
- One interaction per author per flat, backed by a unique database constraint. Public reviews remain visible after account deactivation.
- Private PDF/PNG/JPEG uploads, bounded to 5 MB, with signature checks. Optional tenancy proofs, versioned proof policy, and author-managed interaction attachments. Removal immediately denies file access and queues physical cleanup.
- Account notebook for reviews, edits, attachments, deletion status, account deactivation, and an admin decision queue. Public responses exclude emails, author IDs, and file metadata.
- Signed, filter-bound keyset pagination; validation and structured error responses; request IDs; health checks; Alembic migrations; idempotent demo seeding.

## Structure

```text
python/backend/          FastAPI, SQLAlchemy models, Alembic migrations, pytest
fronend/webUI/           React, TypeScript, Vite, Leaflet, Vitest, Nginx
compose.yaml            Application stack and resource limits
compose.test.yaml       Isolated PostgreSQL 18.6 integration-test stack (never the shared database)
compose.ci.yaml         GitLab Docker-in-Docker port override
compose.production.yaml Production override for the shared Google Cloud VM
.github/workflows/ci.yml GitHub Actions CI/CD
.gitlab/ci.yml          GitLab CI/CD
deploy/                 VM bootstrap, Nginx/Certbot setup, production .env template
scripts/                Smoke checks, database readiness
```

## Memory and persistence

| Service | Default hard cap | Reservation | CPU cap |
| --- | --- | --- | --- |
| FastAPI | 384 MB | 128 MB | 1 |
| Nginx/web | 128 MB | 32 MB | 0.5 |

This app's containers cap at **512 MB**, excluding Docker/VM overhead and image builds. The shared PostgreSQL (640 MB, shared with wardrobe-manager) is sized and limited in postgres-platform. `BACKEND_MEMORY_LIMIT` and `WEB_MEMORY_LIMIT` customize the hard caps. `mem_limit` applies to ordinary Compose containers; matching `memswap_limit` values prevent extra swap allocation where the host supports it. PostgreSQL has bounded connections and buffers; FastAPI uses one worker and a bounded connection pool. Container logs rotate.

Database data lives in postgres-platform's `postgres-platform_data` volume, uploads in this project's `uploads` volume. Back them up together (`make -C ../postgres-platform backup` dumps the database). The old per-app `postgres_v1_data` volume is no longer used; keep it until you are sure the move to the shared database is complete, then remove it.

## Operator commands

Register the intended administrator through the UI first, then promote it using the server CLI. There is no seeded admin login.

```sh
docker compose exec backend python -m app.cli make-admin +919876543210
docker compose exec backend python -m app.cli proof-policy required
docker compose exec backend python -m app.cli proof-policy optional
docker compose exec backend python -m app.cli cleanup-files
```

`cleanup-files` physically deletes removed supporting files and unattached uploads older than 24 hours. Schedule it daily on the host if uploads are used. Proofs remain private and retained. Schema migrations run before API startup; deploy one backend instance with this Compose configuration. Larger deployments should run migrations as a separate release job.

## Tests

```sh
make test-backend        # Dedicated rental-review-test project, test DB and volume
make test-web            # Requires Node 22.12+; CI uses Node 24
python3 scripts/smoke.py http://localhost:8080
make clean-test         # Removes only the isolated test project's containers/volumes
```

Backend tests use real PostgreSQL and include concurrent overlapping submissions, duplicate interactions, Google token verification (signed with a test key), account lifecycle, edit deadlines, deletion approval, file access, proof policy, pagination, and validation. The test fixture refuses to truncate data unless `APP_ENV=test` and the database name ends in `_test`. Frontend tests cover flat/tab navigation, search states, Google sign-in, and failed retrieval.

For direct API development: use Python 3.12+, install `python/backend/requirements-dev.txt` into a virtual environment, run `make -C ../postgres-platform local`, set `DATABASE_URL` from `../postgres-platform/credentials/rental_review.env` with the host changed to `127.0.0.1:5433` (and `MIGRATION_DATABASE_URL` likewise for Alembic), and run `alembic upgrade head` followed by `uvicorn app.main:app --reload` from `python/backend`. Run `npm ci && npm run dev` from `fronend/webUI`; Vite proxies `/api` to `127.0.0.1:8000`.

## GitHub and GitLab CI/CD

The GitHub workflow lives in `.github/workflows/ci.yml`. GitLab's pipeline lives
in `.gitlab/ci.yml`. In GitLab, open **Settings → CI/CD → General pipelines**,
set **CI/CD configuration file** to `.gitlab/ci.yml`, and save the changes.
See [GitLab's custom configuration instructions](https://docs.gitlab.com/ci/pipelines/settings/#specify-a-custom-cicd-configuration-file).

Both pipelines run backend checks and real PostgreSQL integration tests, frontend tests/builds, then an assembled Docker Compose smoke check. Successful push pipelines publish backend and web images tagged `sha-<full commit SHA>`; the default branch also publishes `latest`. GitHub uses GHCR and `GITHUB_TOKEN`; GitLab uses its built-in container registry credentials. Pull/merge requests test without publishing. GitLab's Docker jobs require a privileged runner configured for TLS Docker-in-Docker with the shared `/certs/client` volume, as described in [GitLab's runner setup](https://docs.gitlab.com/ci/docker/using_docker_build/#use-the-docker-executor-with-docker-in-docker).

Pushes to `main` also **deploy to production** at <https://rentalreview.boringman.in>, after all checks pass, using the same flow as meal-manager. The deploy job SSHes into the Google Cloud VM it shares with meal-manager, checks out the tested commit in `~/rental-review`, writes `.env` from `deploy/production.env.example`, runs `make deploy`, then installs a named host Nginx site with a Let's Encrypt certificate. Setup, required variables and secrets, and rollback are in [docs/google-cloud-deployment.md](docs/google-cloud-deployment.md).

## Configuration and working-model boundaries

`.env.example` lists the Compose settings. Google sign-in allows 100 attempts per client IP per hour (`GOOGLE_SIGN_IN_IP_LIMIT`); it is a backend `Settings` field and can be overridden in backend environment configuration. Browser sessions use `sessionStorage`; closing the tab clears its credential. Public map tiles and optional Google Fonts need an internet connection; the accessible property list and system font fallback still work without them.

Before deployment, use `APP_ENV=production`, a random `SECRET_KEY` of at least 32 characters, `GOOGLE_CLIENT_IDS` with the production origin authorized, and `SEED_DEMO_DATA=false`. Database credentials are generated on the VM by postgres-platform. Production startup rejects the development secret or a missing Google client ID. The backend must reach `www.googleapis.com` to fetch Google's signing keys. Backend rate limits use the actual peer IP, so Nginx clients share an IP bucket; add a trusted-proxy/IP strategy before serving substantial public traffic.

Files are synchronously signature-checked and can return `ready` immediately from the `202` upload response; asynchronous ingestion and malware scanning are not included. Storage is a private Docker volume rather than object storage. Location/flat creation, arbitrary-point nearby search, interaction text editing/deletion, and retention of old authentication/audit rows remain deferred product decisions. These choices and defaults make the existing [requirements](REQUIREMENTS.md), [API proposal](API_CONTRACTS.md), and [database proposal](DATABASE_MODEL.md) runnable; those documents remain the design reference. The running [OpenAPI schema](http://localhost:8000/api/openapi.json) is the authoritative implemented API.
