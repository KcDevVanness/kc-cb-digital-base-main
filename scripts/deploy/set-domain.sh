#!/usr/bin/env bash
# Points an existing deployment at its public HTTPS hostname.
#
#   bash scripts/deploy/set-domain.sh app.example.com
#
# Deliberately separate from bootstrap-host.sh: the database is already
# initialized with the current POSTGRES_PASSWORD, so regenerating the whole
# .env would lock the app out of its own data.
#
# The domain must already have an A record pointing at this host, otherwise
# Caddy's ACME challenge fails and the deploy health gate fails with it.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kc-cb-digital-base}"
DOMAIN="${1:?usage: set-domain.sh <domain>  (e.g. app.example.com)}"

case "${DOMAIN}" in
  *://*|*/*) echo "ERROR: pass a bare hostname, not a URL: ${DOMAIN}" >&2; exit 1 ;;
esac

cd "${APP_DIR}"
[ -f .env ] || { echo "ERROR: ${APP_DIR}/.env not found" >&2; exit 1; }

BACKUP=".env.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp .env "${BACKUP}"
echo "backed up .env -> ${BACKUP}"

set_kv() {
  awk -v k="$1" -v v="$2" '
    BEGIN { FS = OFS = "=" }
    $1 == k { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' .env > .env.tmp
  mv .env.tmp .env
}

set_kv APP_DOMAIN "${DOMAIN}"
set_kv APP_URL "https://${DOMAIN}"
# Caddy owns 80/443; the app binds loopback only.
set_kv APP_PORT "3000"
chmod 600 .env

echo "--- public values now (secrets untouched) ---"
grep -E '^(APP_DOMAIN|APP_URL|APP_PORT)=' .env
