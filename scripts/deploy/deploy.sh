#!/usr/bin/env bash
# Server-side half of the production deploy.
#
# Piped to the host over SSH by `.github/workflows/deploy.yml`:
#   ssh "$DEPLOY_USER@$DEPLOY_HOST" "TARGET_SHA=... APP_IMAGE=... bash -s" < scripts/deploy/deploy.sh
#
# Piping (rather than checking the script out first) is what breaks the
# chicken-and-egg: the revision being deployed is fetched *by* this script, so
# it cannot be read from the working tree it is about to overwrite.
#
# Inputs (env): TARGET_SHA (required), APP_IMAGE (required), APP_DIR, HEALTH_TIMEOUT
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kc-cb-digital-base}"
COMPOSE_FILE="docker-compose.deploy.yml"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-900}"
HEALTH_PATH="${HEALTH_PATH:-/api/healthz}"

: "${TARGET_SHA:?TARGET_SHA is required}"
: "${APP_IMAGE:?APP_IMAGE is required}"

log() { printf '\n=== %s ===\n' "$*"; }

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env is missing. It is gitignored and holds JWT_SECRET/APP_URL;" >&2
  echo "create it before the first deploy (see docs/deploy/cicd.md)." >&2
  exit 1
fi

# The published host port; read from .env so the health probe matches what
# compose actually binds rather than assuming the default.
APP_PORT="$(sed -n 's/^APP_PORT=//p' .env | tail -1 | tr -d '"'"'"' ')"
APP_PORT="${APP_PORT:-3000}"

# Only used by the informational public probe at the end.
APP_DOMAIN="$(sed -n 's/^APP_DOMAIN=//p' .env | tail -1 | tr -d '"'"'"' ')"

log "checkout ${TARGET_SHA}"
git fetch --prune --quiet origin
# Force-create the branch at the deployed commit: the working tree must match the
# image that is about to run, and a dirty tree from an earlier manual edit must
# not survive a deploy.
git checkout --force --quiet -B production "${TARGET_SHA}"
echo "now at $(git log --oneline -1)"

# APP_IMAGE arrived as an environment variable, so compose interpolates it in
# preference to any value in .env — that is what makes the tag immutable.
export APP_IMAGE

log "pull ${APP_IMAGE}"
compose pull --quiet app

log "up -d"
compose up -d --remove-orphans

log "wait for ${HEALTH_PATH} on port ${APP_PORT} (timeout ${HEALTH_TIMEOUT}s)"
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
while :; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${APP_PORT}${HEALTH_PATH}" || true)"
  if [ "${CODE}" = "200" ]; then
    echo "healthy after $(( HEALTH_TIMEOUT - (DEADLINE - $(date +%s)) ))s"
    break
  fi
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "ERROR: no 200 from ${HEALTH_PATH} within ${HEALTH_TIMEOUT}s (last status: ${CODE:-none})" >&2
    echo "--- compose ps ---" >&2
    compose ps >&2 || true
    echo "--- app logs (tail 200) ---" >&2
    compose logs app --tail=200 >&2 || true
    exit 1
  fi
  sleep 5
done

log "reclaim disk"
# The running image is still referenced by its container, so this only drops
# superseded tags. The host has a 28 GB root volume shared with Postgres data.
docker image prune -af --filter "until=24h" >/dev/null 2>&1 || true
df -h / | tail -1

# Informational, not a gate: on a first deploy the certificate may still be
# mid-issuance, and DNS may legitimately not resolve from inside the host. The
# app-level probe above is what decides success.
if [ -n "${APP_DOMAIN:-}" ]; then
  log "public probe https://${APP_DOMAIN}${HEALTH_PATH} (informational)"
  curl -sS -o /dev/null -w 'public http=%{http_code}\n' --max-time 20 \
    "https://${APP_DOMAIN}${HEALTH_PATH}" \
    || echo "public probe failed (certificate issuance or DNS propagation still pending?)"
fi

log "deployed"
compose ps
