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

# The app image is ~8.6 GB against a 28 GB root volume, so superseded images
# have to go *before* the pull or the pull fills the disk. The image backing the
# running container is referenced and therefore untouched — a failed pull still
# leaves a rollback target in place.
log "reclaim disk before pull"
docker image prune -af | tail -1

# The incoming image is the same application as the one already running, so its
# on-disk size is the best estimate available before the pull starts. Refusing
# here is deliberate: filling the root volume takes Postgres down with it, which
# is a worse outcome than a failed deploy.
RUNNING_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q app 2>/dev/null | head -1)" 2>/dev/null || true)"
NEED_BYTES="$(docker image inspect "${RUNNING_IMAGE:-absent}" --format '{{.Size}}' 2>/dev/null || echo 0)"
case "${NEED_BYTES}" in ''|*[!0-9]*) NEED_BYTES=0 ;; esac
if [ "${NEED_BYTES}" -le 0 ]; then
  # First deploy, or the image is no longer on disk. Conservative constant.
  NEED_BYTES=$(( 9 * 1024 * 1024 * 1024 ))
fi
# Layer unpacking needs temporary room beyond the final on-disk size.
NEED_KB=$(( NEED_BYTES / 1024 * 115 / 100 ))
AVAIL_KB="$(df -Pk / | awk 'NR==2 { print $4 }')"
printf 'need ~%s GB, have %s GB free\n' "$(( NEED_KB / 1048576 ))" "$(( AVAIL_KB / 1048576 ))"
if [ "${AVAIL_KB}" -lt "${NEED_KB}" ]; then
  echo "ERROR: not enough free space for ${APP_IMAGE}." >&2
  echo "Free space or grow the volume; a full root disk breaks Postgres too." >&2
  docker system df >&2
  df -h / >&2
  exit 1
fi

log "pull ${APP_IMAGE}"
# Not --quiet: an 8.6 GB pull is minutes of silence, and a silent SSH session is
# what a NAT or load balancer drops. Progress lines double as keepalive traffic.
compose pull app

log "up -d"
compose up -d --remove-orphans

# `up -d` recreates a service only when its compose definition changed, so a
# Caddyfile edit on its own would sit unread in the bind mount. A reload is
# Caddy's own zero-downtime path for config changes, and it fails loudly on a
# malformed file — which is the point.
if [ -n "$(compose ps -q caddy 2>/dev/null)" ]; then
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
fi

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
# The image the replaced container used is unreferenced now.
docker image prune -af | tail -1
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
