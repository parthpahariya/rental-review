# Rental Review

A working rental-review model with a FastAPI API, React/TypeScript interface, and PostgreSQL. The folder name `fronend` follows the requested structure.

## Start with Docker

Requires Docker with Compose v2.24.4+ (v5 also works). On macOS, start Docker Desktop or Colima first.

```sh
# First setup only; keep your existing .env if you have one.
cp -n .env.example .env
docker compose up --build -d --wait --wait-timeout 180
```

- Web UI: <http://localhost:8080>
- Interactive API docs: <http://localhost:8000/api/docs>
- Readiness: <http://localhost:8000/api/health/ready>

`WEB_PORT` and `API_PORT` in `.env` override these ports. Nginx proxies `/api` to FastAPI, so the UI needs no build-time API URL. PostgreSQL stays on the Docker network without a host port.

The default setup seeds four **fictional** Bengaluru buildings, five flats, tenant reviews, and interactions. The interaction-only building appears in map results. Set `SEED_DEMO_DATA=false` for an empty database. Property provisioning is an operator task while its product workflow remains undecided; the demo seeder is an example.

Sign-in is **Google only**. Create an OAuth client ID of type "Web application" in Google Cloud Console (APIs & Services → Credentials), add every origin you open the site on (for example `http://localhost:8080` and `http://localhost:5173`) under *Authorized JavaScript origins*, and set `GOOGLE_CLIENT_IDS` in `.env`. Without it the sign-in dialog says Google sign-in is unavailable and nobody can sign in. The first Google sign-in creates an account; later sign-ins reuse it, keyed on Google's stable account id rather than the email.

```sh
docker compose logs -f --tail=100
docker compose ps
docker compose down          # Stops containers; preserves database and files
```

`make up` builds and starts the stack; `make down` stops it while preserving data.
For Colima, use `make full_up` to start the `rental-review` profile and the stack,
then `make full_down` to stop both and release the VM's resources. Override the
profile with `COLIMA_PROFILE=default` (or another name) on both commands if needed.

After startup, run `make watch` to rebuild the backend and web UI when their source
files change. With Colima, use `DOCKER_CONTEXT=colima-rental-review make watch`
(or `colima` for the default profile) to target that VM explicitly. Press Ctrl+C
to stop watching; the stack keeps running.

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
compose.test.yaml       Isolated PostgreSQL integration-test stack
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
| PostgreSQL | 512 MB | 256 MB | 1 |
| FastAPI | 384 MB | 128 MB | 1 |
| Nginx/web | 128 MB | 32 MB | 0.5 |

The default runtime caps total **1 GiB**, excluding Docker/VM overhead and image builds. `DB_MEMORY_LIMIT`, `BACKEND_MEMORY_LIMIT`, and `WEB_MEMORY_LIMIT` customize the hard caps. `mem_limit` applies to ordinary Compose containers; matching `memswap_limit` values prevent extra swap allocation where the host supports it. PostgreSQL has bounded connections and buffers; FastAPI uses one worker and a bounded connection pool. Container logs rotate.

Data lives in `postgres_v1_data` and `uploads` named volumes. The `postgres_v1_data` name deliberately keeps an older `postgres_data` prototype volume intact; it does not migrate that prototype's `properties`/`reviews` tables. Do not use `docker compose down --volumes` when you want to retain application data. Back up PostgreSQL and the upload volume together.

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

For direct API development: use Python 3.12+, install `python/backend/requirements-dev.txt` into a virtual environment, set `DATABASE_URL` to a local PostgreSQL instance, and run `alembic upgrade head` followed by `uvicorn app.main:app --reload` from `python/backend`. Run `npm ci && npm run dev` from `fronend/webUI`; Vite proxies `/api` to `127.0.0.1:8000`.

## GitHub and GitLab CI/CD

The GitHub workflow lives in `.github/workflows/ci.yml`. GitLab's pipeline lives
in `.gitlab/ci.yml`. In GitLab, open **Settings → CI/CD → General pipelines**,
set **CI/CD configuration file** to `.gitlab/ci.yml`, and save the changes.
See [GitLab's custom configuration instructions](https://docs.gitlab.com/ci/pipelines/settings/#specify-a-custom-cicd-configuration-file).

Both pipelines run backend checks and real PostgreSQL integration tests, frontend tests/builds, then an assembled Docker Compose smoke check. Successful push pipelines publish backend and web images tagged `sha-<full commit SHA>`; the default branch also publishes `latest`. GitHub uses GHCR and `GITHUB_TOKEN`; GitLab uses its built-in container registry credentials. Pull/merge requests test without publishing. GitLab's Docker jobs require a privileged runner configured for TLS Docker-in-Docker with the shared `/certs/client` volume, as described in [GitLab's runner setup](https://docs.gitlab.com/ci/docker/using_docker_build/#use-the-docker-executor-with-docker-in-docker).

Pushes to `topic/parth/plan` also **deploy to production** at <https://rentalreview.boringman.in>, after all checks pass, using the same flow as meal-manager. The deploy job SSHes into the Google Cloud VM it shares with meal-manager, checks out the tested commit in `~/rental-review`, writes `.env` from `deploy/production.env.example`, runs `make deploy`, then installs a named host Nginx site with a Let's Encrypt certificate. Setup, required variables and secrets, and rollback are in [docs/google-cloud-deployment.md](docs/google-cloud-deployment.md).

## Configuration and working-model boundaries

`.env.example` lists the Compose settings. Google sign-in allows 100 attempts per client IP per hour (`GOOGLE_SIGN_IN_IP_LIMIT`); it is a backend `Settings` field and can be overridden in backend environment configuration. Browser sessions use `sessionStorage`; closing the tab clears its credential. Public map tiles and optional Google Fonts need an internet connection; the accessible property list and system font fallback still work without them.

Before deployment, use `APP_ENV=production`, a random `SECRET_KEY` of at least 32 characters, `GOOGLE_CLIENT_IDS` with the production origin authorized, a unique URL-safe PostgreSQL password, and `SEED_DEMO_DATA=false`. Production startup rejects the development secret or a missing Google client ID. The backend must reach `www.googleapis.com` to fetch Google's signing keys. Backend rate limits use the actual peer IP, so Nginx clients share an IP bucket; add a trusted-proxy/IP strategy before serving substantial public traffic.

Files are synchronously signature-checked and can return `ready` immediately from the `202` upload response; asynchronous ingestion and malware scanning are not included. Storage is a private Docker volume rather than object storage. Location/flat creation, arbitrary-point nearby search, interaction text editing/deletion, and retention of old authentication/audit rows remain deferred product decisions. These choices and defaults make the existing [requirements](REQUIREMENTS.md), [API proposal](API_CONTRACTS.md), and [database proposal](DATABASE_MODEL.md) runnable; those documents remain the design reference. The running [OpenAPI schema](http://localhost:8000/api/openapi.json) is the authoritative implemented API.
