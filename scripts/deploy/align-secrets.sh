#!/usr/bin/env bash
# Merges KEY=VALUE lines from a source file into the deployment .env.
#
#   bash align-secrets.sh /tmp/align-secrets.txt
#
# Used when the online database is replaced by a dump from another environment:
# encrypted columns and keyed lookup hashes are only readable when the receiving
# deployment carries the same secrets the data was written with.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kc-cb-digital-base}"
SRC="${1:?usage: align-secrets.sh <key=value file>}"

[ -f "${SRC}" ] || { echo "ERROR: ${SRC} not found" >&2; exit 1; }

cd "${APP_DIR}"
[ -f .env ] || { echo "ERROR: ${APP_DIR}/.env not found" >&2; exit 1; }

cp .env ".env.bak.$(date -u +%Y%m%dT%H%M%SZ)"

while IFS= read -r line; do
  case "${line}" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  awk -v k="${key}" -v v="${value}" '
    BEGIN { FS = OFS = "=" }
    $1 == k { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' .env > .env.tmp
  mv .env.tmp .env
done < "${SRC}"

chmod 600 .env
# The source file held secrets in the clear; it has served its purpose.
rm -f "${SRC}"

echo "--- lengths only, values never printed ---"
while IFS='=' read -r k v; do
  printf '%-42s len=%s\n' "${k}" "${#v}"
done < <(grep -E '^(TENANT_DATA_ENCRYPTION_FALLBACK_KEY|TENANT_DATA_ENCRYPTION_KEY|LOOKUP_HASH_PEPPER)=' .env)
