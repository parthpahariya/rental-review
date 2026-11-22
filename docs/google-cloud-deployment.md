# Deploying to the shared Google Cloud VM

rental-review deploys the same way as meal-manager, onto **the same VM**:

```
push to main
  └─ backend, frontend, compose-smoke checks pass
       └─ deploy job ── SSH ──▶ VM
            ~/rental-review   git checkout of the exact tested commit
            .env              generated from deploy/production.env.example
            make deploy       docker compose (compose.yaml + compose.production.yaml)
            host Nginx        rentalreview.boringman.in → 127.0.0.1:4180, HTTPS via Let's Encrypt
```

| | meal-manager | rental-review |
| --- | --- | --- |
| Checkout | `~/meal-manager` | `~/rental-review` |
| Compose project | `meal-manager` | `rental-review` |
| Database | Its own `postgres` container | Shared `shared-postgres` (postgres-platform, with wardrobe-manager); database `rental_review` |
| Web container on loopback | `127.0.0.1:4173` | `127.0.0.1:4180` |
| Nginx site | `conf.d/meal-manager.conf`, the `default_server` | `conf.d/rental-review.conf`, matched by name only |
| Domain and certificate | `mealmanagers.online` | `rentalreview.boringman.in` |

Both apps use `~/.meal-manager-deploy.lock`, so their deployments never run at the
same time: they share apt, Docker and Nginx. The scripts in `deploy/` are adapted
from meal-manager's and only install or change rental-review's own files.

## One-time setup

1. **DNS:** point an `A` record for `rentalreview.boringman.in` at the VM's public
   IPv4 address, the same address as `mealmanagers.online`. Remove any `AAAA`
   record unless the VM serves IPv6. Certificate issuance on the first deploy needs this.
2. **Firewall:** nothing new. Ports 22, 80 and 443 are already open for meal-manager.
   Keep 4180, like 4173, closed to the internet.
3. **Google sign-in:** in Google Cloud Console → APIs & Services → Credentials, add
   `https://rentalreview.boringman.in` to the OAuth client's *Authorized JavaScript
   origins*.
4. **Google Maps:** in the same project, enable the *Maps JavaScript API* and
   *Places API (New)*. Create an API key restricted to those two APIs and to the
   HTTP referrer `https://rentalreview.boringman.in/*`, and a vector Map ID under
   *Map Management*. Set a budget alert on the billing account: Maps is billed
   per map load and per search pick beyond the monthly free caps.
5. **GitHub:** under repository **Settings → Environments**, create `production`
   and add:

   | Type | Name | Value |
   | --- | --- | --- |
   | Variable | `GCP_VM_HOST` | Same as meal-manager |
   | Variable | `GCP_VM_USER` | Same as meal-manager |
   | Variable | `GOOGLE_CLIENT_IDS` | The OAuth web client id (`….apps.googleusercontent.com`) |
   | Variable | `MAP_PROVIDER` | `google`, `here`, `mapbox`, `ola` or `osm` (optional; empty picks Google when its key is set) |
   | Variable | `HERE_API_KEY` / `MAPBOX_ACCESS_TOKEN` / `OLA_MAPS_API_KEY` | Only the chosen provider's key is needed |
   | Variable | `GOOGLE_MAPS_API_KEY` | The referrer-restricted Maps browser key (optional; without it the map is unavailable) |
   | Variable | `GOOGLE_MAPS_MAP_ID` | The vector Map ID (optional) |
   | Secret | `GCP_SSH_PRIVATE_KEY` | Same private key as meal-manager's deploy key |
   | Secret | `GCP_SSH_KNOWN_HOSTS` | Same verified known-hosts line as meal-manager |
   | Secret | `SECRET_KEY` | New random value, 32+ chars |

   Generate `SECRET_KEY` with
   `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. There is no
   database secret: the shared PostgreSQL's passwords are generated on the VM by
   postgres-platform (`~/postgres-platform/credentials/`). Optionally limit the
   environment's deployment branches to `main`.

   GitLab: set the same names as CI/CD variables (the SSH key and known hosts as
   **file** variables) and protect the `main` branch.

The first deploy installs nothing new on the VM except rental-review's Nginx site
and certificate, because Docker, Nginx and Certbot are already there from meal-manager.

## Changing the deploy branch

Update it together in `.github/workflows/ci.yml` (`on.push.branches`,
`env.DEPLOY_BRANCH` and the deploy job's `if`) and in `.gitlab/ci.yml` (the deploy
job's `DEPLOY_BRANCH` and rule).

## Rollback

Revert the bad commit on the deploy branch and push. The deploy builds and starts
that commit. Database migrations run on start (`alembic upgrade head`) and are
not rolled back automatically, so keep schema changes backward-compatible.

## On the VM

```sh
cd ~/rental-review
make deploy-status                                                   # containers + health
docker compose -f compose.yaml -f compose.production.yaml logs -f --tail=100
```

## Shared PostgreSQL (postgres-platform)

The database runs in the `shared-postgres` container from
[postgres-platform](https://github.com/parthpahariya/postgres-platform), checked out at
`~/postgres-platform` (the deploy clones or fast-forwards it). `make deploy` first runs its
`ensure-db rental_review`, which starts the container if needed and creates the database and
roles if missing. The API connects as `rental_review_writer`; migrations run as
`rental_review_owner`.

### One-time move from the old per-app database

Do this once, by hand, before the first deploy of this change. Downtime is a few minutes.

```sh
# On the VM
git clone https://github.com/parthpahariya/postgres-platform.git ~/postgres-platform
python3.13 ~/postgres-platform/bin/ensure-db rental_review        # empty database + roles

cd ~/rental-review
sudo docker compose -f compose.yaml -f compose.production.yaml stop backend web
sudo docker exec rental-review-db-1 pg_dump -Fc -U rental rental_review > ~/rental_review.dump
python3.13 ~/postgres-platform/bin/import-dump rental_review ~/rental_review.dump
```

Then push (or re-run) the deploy. Afterwards, check the row counts against the old database.
Keep `rental-review-db-1`'s volume `rental-review_postgres_v1_data` for a week as a rollback.
`--remove-orphans` removes the old container, but never volumes. Then delete it.
