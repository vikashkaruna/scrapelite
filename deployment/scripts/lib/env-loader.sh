#!/usr/bin/env bash
# deployment/scripts/lib/env-loader.sh — the env-file contract (doc 06 §5).
# Usage:  source "$(dirname "$0")/lib/env-loader.sh"; load_env local
# Every deployment script loads its .env.<env> here and references ${VAR} only.
# Zero literal project identifiers exist outside deployment/env/*.example.

set -euo pipefail

LOADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # deployment/scripts/lib
DEPLOY_DIR="$(cd "$LOADER_DIR/../.." && pwd)"                   # deployment/
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"                        # repo root

die() { echo "✗ $*" >&2; exit 1; }

# load_env <name> — source deployment/env/.env.<name> (exported).
load_env() {
  local name="${1:?usage: load_env <env-name>}"
  local f="$DEPLOY_DIR/env/.env.$name"
  [ -f "$f" ] || die ".env.$name not found. Copy $f.example → $f and fill values (see $f.example notes)."
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
  DATIQ_ENV="$name"
}

# require_vars A B C — fail fast listing every missing required variable.
require_vars() {
  local missing=() v
  for v in "$@"; do
    [ -n "${!v:-}" ] || missing+=("$v")
  done
  [ ${#missing[@]} -eq 0 ] || die "missing required vars in .env.${DATIQ_ENV:-?}: ${missing[*]}"
}
