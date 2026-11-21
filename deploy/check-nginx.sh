#!/usr/bin/env bash
# Validate both host Nginx sites with a throwaway certificate, like meal-manager's
# ci/check-nginx.sh. Uses docker cp, not bind mounts, so it also works in GitLab's
# Docker-in-Docker.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
domain=rentalreview.boringman.in
cert_dir=$(mktemp -d)
container=
cleanup() {
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
    rm -rf -- "$cert_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$cert_dir/live/$domain"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj "/CN=$domain" \
    -keyout "$cert_dir/live/$domain/privkey.pem" \
    -out "$cert_dir/live/$domain/fullchain.pem" 2>/dev/null
for config in deploy/nginx-http.conf deploy/nginx.conf; do
    container=$(docker create nginx:1.28-alpine nginx -t)
    docker cp "$config" "$container:/etc/nginx/conf.d/default.conf"
    docker cp "$cert_dir" "$container:/etc/letsencrypt"
    docker start --attach "$container"
    test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
    docker rm "$container" >/dev/null
    container=
    echo "ok: $config"
done
