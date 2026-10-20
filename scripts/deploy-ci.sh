#!/usr/bin/env bash
# Requires a provisioned Docker host with production .env and registry login.
set -euo pipefail
: "${SSH_PRIVATE_KEY:?Set SSH_PRIVATE_KEY (GitLab) or DEPLOY_SSH_KEY (GitHub)}"
: "${SSH_KNOWN_HOSTS:?Set pinned SSH host keys}"
: "${DEPLOY_HOST:?Set deployment host}"
: "${DEPLOY_USER:?Set deployment user}"
: "${DEPLOY_PATH:?Set absolute deployment directory}"
: "${IMAGE_ROOT:?Set image registry path}"
: "${IMAGE_TAG:?Set immutable image tag}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 2
[[ "$DEPLOY_USER" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9_/-]+$ ]] || exit 2
IMAGE_ROOT=$(printf '%s' "$IMAGE_ROOT" | tr '[:upper:]' '[:lower:]')
[[ "$IMAGE_ROOT" =~ ^[a-z0-9./:_-]+$ ]] || exit 2
[[ "$IMAGE_TAG" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 2
key_dir=$(mktemp -d)
trap 'rm -rf "$key_dir"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$key_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$key_dir/known_hosts"
chmod 600 "$key_dir/key" "$key_dir/known_hosts"
ssh_options=(-i "$key_dir/key" -o "UserKnownHostsFile=$key_dir/known_hosts" -o StrictHostKeyChecking=yes -o BatchMode=yes)
ssh "${ssh_options[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
scp "${ssh_options[@]}" compose.yaml "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/compose.yaml"
ssh "${ssh_options[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
  "cd '$DEPLOY_PATH' && BACKEND_IMAGE='$IMAGE_ROOT/backend:$IMAGE_TAG' WEB_IMAGE='$IMAGE_ROOT/web:$IMAGE_TAG' docker compose pull && BACKEND_IMAGE='$IMAGE_ROOT/backend:$IMAGE_TAG' WEB_IMAGE='$IMAGE_ROOT/web:$IMAGE_TAG' docker compose up -d --no-build --wait --wait-timeout 180"
