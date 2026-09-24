#!/usr/bin/env bash
# Replaces the deployment database with a dump taken from another environment.
#
#   bash scripts/deploy/restore-db-from-dump.sh /tmp/local-db.dump
#
# Built for the review case: standing a copy of a local/dev database on the
# deployment host so a branch can be reviewed against real data. It is
# destructive to the current database — a safety dump is taken first and its
# path is printed.
#
# Two things this script cannot check for you:
#
#   1. The deployed code must be the branch the dump came from. A dump carries
#      tables for every module the source app had; deploying a smaller app
#      leaves that data unreachable (there is no UI for it).
#   2. The encryption secrets must match the ones the source wrote with. See
#      align-secrets.sh — encrypted columns and keyed lookup hashes are
#      unreadable under different TENANT_DATA_ENCRYPTION_FALLBACK_KEY /
#      LOOKUP_HASH_PEPPER values.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kc-cb-digital-base}"
COMPOSE_FILE="docker-compose.deploy.yml"
DB_NAME="${DB_NAME:-open-mercato}"
DB_USER="${DB_USER:-postgres}"

DUMP="${1:?usage: restore-db-from-dump.sh <dump file>  (pg_dump -Fc format)}"
[ -f "${DUMP}" ] || { echo "ERROR: ${DUMP} not found" >&2; exit 1; }

cd "${APP_DIR}"
compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }
psql_admin() { compose exec -T postgres psql -U "${DB_USER}" -d postgres "$@"; }

echo "=== verifying the dump is readable ==="
psql_admin -c "select 1" >/dev/null
compose exec -T postgres pg_restore -l < "${DUMP}" >/dev/null
TABLES="$(compose exec -T postgres pg_restore -l < "${DUMP}" | grep -c 'TABLE DATA' || true)"
echo "dump parses; ${TABLES} table-data entries"

echo
echo "=== safety backup of the current database ==="
mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="backups/pre-restore-${STAMP}.dump"
compose exec -T postgres pg_dump -U "${DB_USER}" -Fc "${DB_NAME}" > "${BACKUP}"
echo "wrote ${APP_DIR}/${BACKUP} ($(du -h "${BACKUP}" | cut -f1))"
echo "restore it with: bash scripts/deploy/restore-db-from-dump.sh ${APP_DIR}/${BACKUP}"

echo
echo "=== stopping the app so nothing holds a connection ==="
compose stop app

echo
echo "=== recreating ${DB_NAME} ==="
# Dropping rather than pg_restore --clean: --clean only drops objects present in
# the archive, so anything the target has and the archive does not would survive
# and collide.
psql_admin -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)"
psql_admin -c "CREATE DATABASE ${DB_NAME}"

echo
echo "=== restoring ==="
compose exec -T postgres pg_restore \
  -U "${DB_USER}" -d "${DB_NAME}" \
  --no-owner --no-acl --single-transaction \
  < "${DUMP}"

echo
echo "=== ensuring required extensions ==="
# pg_restore recreates extensions it finds in the archive, but a dump taken
# without --create may omit the one the vector index depends on.
compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null
echo "vector extension present"

echo
echo "=== starting the app ==="
compose start app

echo
echo "=== result ==="
compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "select count(*) || ' tables' from information_schema.tables where table_schema = 'public'"
compose ps app
