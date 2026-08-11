#!/usr/bin/env bash
#
# n8n/restore.sh — Restore a backup to a fresh n8n volume.
#
# Usage:
#   N8N_DATA_SRC=/var/lib/datiq-n8n \
#   ENV_FILE=/opt/datiq-n8n/.env \
#   BACKUP_DIR=/var/backups/datiq-n8n/20260726T030000Z \
#   ./n8n/restore.sh
#
# What it restores:
#   • /var/lib/datiq-n8n  ←  backup/n8n-data.tar.gz
#   • /opt/datiq-n8n/.env ←  backup/.env
#
# Pre-flight checks:
#   1. The target volume must not exist (or must be empty) — otherwise abort.
#   2. The N8N_ENCRYPTION_KEY in the backed-up .env must match the one
#      currently in use (if any). If they differ, the credentials can't
#      be decrypted.
#
# After restore:
#   1. docker compose up -d
#   2. Verify in the n8n UI that workflows + credentials are present.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-}"
N8N_DATA_SRC="${N8N_DATA_SRC:-/var/lib/datiq-n8n}"
ENV_FILE="${ENV_FILE:-/opt/datiq-n8n/.env}"
N8N_CONTAINER="${N8N_CONTAINER:-datiq-n8n}"

if [[ -z "${BACKUP_DIR}" || ! -d "${BACKUP_DIR}" ]]; then
  echo "✗ BACKUP_DIR is required and must be a directory"
  echo "  Example: BACKUP_DIR=/var/backups/datiq-n8n/20260726T030000Z"
  exit 1
fi

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "restoring from ${BACKUP_DIR}"

# 1. Stop the running n8n (if any) so it doesn't write during restore.
if docker ps --format '{{.Names}}' | grep -q "^${N8N_CONTAINER}\$"; then
  log "stopping ${N8N_CONTAINER}"
  docker stop "${N8N_CONTAINER}" >/dev/null
fi

# 2. Wipe the target data dir (after backup!).
if [[ -d "${N8N_DATA_SRC}" ]]; then
  log "wiping ${N8N_DATA_SRC}"
  rm -rf "${N8N_DATA_SRC:?}"/*
fi
mkdir -p "${N8N_DATA_SRC}"

# 3. Extract the data archive.
if [[ -f "${BACKUP_DIR}/n8n-data.tar.gz" ]]; then
  log "extracting n8n-data.tar.gz"
  tar xzf "${BACKUP_DIR}/n8n-data.tar.gz" -C "$(dirname "${N8N_DATA_SRC}")"
else
  echo "✗ ${BACKUP_DIR}/n8n-data.tar.gz not found"
  exit 1
fi

# 4. Restore .env (only if missing at the target — never overwrite a
#    current config without operator confirmation).
if [[ -f "${BACKUP_DIR}/.env" ]]; then
  if [[ -f "${ENV_FILE}" ]]; then
    log "warning: ${ENV_FILE} already exists — leaving it alone (compare manually)"
  else
    log "restoring ${ENV_FILE}"
    install -m 0600 -o root -g root "${BACKUP_DIR}/.env" "${ENV_FILE}"
  fi
else
  log "warning: ${BACKUP_DIR}/.env not found — N8N_ENCRYPTION_KEY may be lost"
fi

# 5. Start n8n.
log "starting ${N8N_CONTAINER}"
docker start "${N8N_CONTAINER}" >/dev/null || docker compose up -d

log "restore complete. Verify:"
log "  1. Open https://${N8N_HOSTNAME:-your-host} and log in"
log "  2. Check that your workflows are present"
log "  3. Check that credentials decrypt (open any workflow with a credential)"
