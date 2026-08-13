#!/usr/bin/env bash
#
# n8n/backup.sh — Daily backup of the n8n volume to /var/backups/datiq-n8n.
#
# v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §4.3
#
# What it backs up:
#   • /home/node/.n8n (workflows, credentials, execution history, SQLite)
#   • .env (the encryption key + API keys; WITHOUT this the backup is
#     unrecoverable because n8n encrypts credentials with N8N_ENCRYPTION_KEY)
#
# Schedule: install via the host's cron
#   0 3 * * *  /opt/datiq-n8n/backup.sh >> /var/log/datiq-n8n-backup.log 2>&1
#
# Retention: keep 14 daily backups; older ones are deleted.
#
# Recovery: see restore.sh.

set -euo pipefail

BACKUP_ROOT="/var/backups/datiq-n8n"
N8N_DATA_SRC="${N8N_DATA_SRC:-/var/lib/datiq-n8n}"
ENV_FILE="${ENV_FILE:-/opt/datiq-n8n/.env}"
N8N_CONTAINER="${N8N_CONTAINER:-datiq-n8n}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "starting backup → ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# 1. Stop n8n gracefully so SQLite is in a consistent state.
if docker ps --format '{{.Names}}' | grep -q "^${N8N_CONTAINER}\$"; then
  log "stopping ${N8N_CONTAINER}"
  docker stop "${N8N_CONTAINER}" >/dev/null
  RESTART_AFTER=1
else
  log "warning: ${N8N_CONTAINER} not running — backing up live files anyway"
  RESTART_AFTER=0
fi

# 2. Copy the data directory.
if [[ -d "${N8N_DATA_SRC}" ]]; then
  log "copying ${N8N_DATA_SRC}"
  tar czf "${BACKUP_DIR}/n8n-data.tar.gz" \
    -C "$(dirname "${N8N_DATA_SRC}")" \
    "$(basename "${N8N_DATA_SRC}")"
else
  log "warning: ${N8N_DATA_SRC} not found"
fi

# 3. Copy .env (only readable by root).
if [[ -f "${ENV_FILE}" ]]; then
  log "copying ${ENV_FILE}"
  install -m 0600 "${ENV_FILE}" "${BACKUP_DIR}/.env"
else
  log "warning: ${ENV_FILE} not found — backup is unrecoverable without the encryption key"
fi

# 4. Restart n8n if we stopped it.
if [[ "${RESTART_AFTER}" -eq 1 ]]; then
  log "starting ${N8N_CONTAINER}"
  docker start "${N8N_CONTAINER}" >/dev/null
fi

# 5. Prune old backups.
if [[ -d "${BACKUP_ROOT}" ]]; then
  find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
  log "pruned backups older than ${RETENTION_DAYS} days"
fi

# 6. Print summary.
SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
log "backup complete: ${BACKUP_DIR} (${SIZE})"
