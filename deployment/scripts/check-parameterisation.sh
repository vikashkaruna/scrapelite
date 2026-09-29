#!/usr/bin/env bash
# deployment/scripts/check-parameterisation.sh — the doc 06 §9 grep gate.
# Fails when a forbidden literal (project ids, regions, resource names, hosts,
# emails, key prefixes) appears in deployable files under deployment/ — values
# may live ONLY in deployment/env/*.example, docs and tests.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # deployment/scripts
DEPLOY_DIR="$(cd "$HERE/.." && pwd)"                           # deployment/
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"                       # repo root

# Forbidden literals — extend when a new real value lands anywhere (doc 06 §1).
FORBIDDEN=(
  "vikash-saas-project"      # GCP project id
  "asia-south1"              # region
  "aubwooslkkrprdxuiyvj"     # supabase refs
  "sikkfxysjhirmtwkumpt"
  "datiq-vsp-"               # concrete resource names (composed, never literal)
  "DatIQ-vsp-"
  "https://datiq.app"        # hosts
  "staging--datiqapp"
  "sk-ant" "sk-proj-" "fc-" "rzp_" "sb_secret_"  # key prefixes
  "supabase.co"
)
SELF_NAME="$(basename "${BASH_SOURCE[0]}")"
ALLOW_GLOBS=(
  "*/env/.env.*.example"
  "*/tests/*"
  "*/README*"
  "*/docs/*"
)

# Build find args: deployment/{scripts,compose,gcp,docker,adapter,migrator}
SCAN_DIRS=()
for d in scripts compose gcp docker adapter migrator gateway; do
  [ -d "$DEPLOY_DIR/$d" ] && SCAN_DIRS+=("$DEPLOY_DIR/$d")
done

hits=0
for literal in "${FORBIDDEN[@]}"; do
  while IFS= read -r -d '' f; do
    rel="${f#$REPO_DIR/}"
    [ "$rel" = "deployment/scripts/$SELF_NAME" ] && continue  # the gate itself defines the patterns
    skip=0
    for g in "${ALLOW_GLOBS[@]}"; do
      case "$rel" in $g) skip=1; break;; esac
    done
    [ "$skip" = "1" ] && continue
    if grep -nF -- "$literal" "$f" >/dev/null 2>&1; then
      echo "✗ literal '$literal' in $rel:"
      grep -nF -- "$literal" "$f" | head -3 | sed 's/^/    /'
      hits=$((hits+1))
    fi
  done < <(find "${SCAN_DIRS[@]}" -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' -o -name 'Dockerfile*' -o -name '*.conf' -o -name 'manifest*' -o -name 'firebase*' \) -print0 2>/dev/null)
done

# Root-level deployable files too (Cloud Build triggers from repo root).
for f in "$REPO_DIR/.gcloudignore" "$REPO_DIR/.dockerignore"; do
  [ -f "$f" ] || continue
  for literal in "${FORBIDDEN[@]}"; do
    grep -nF -- "$literal" "$f" >/dev/null 2>&1 && { echo "✗ literal '$literal' in ${f#$REPO_DIR/}"; hits=$((hits+1)); }
  done
done

if [ "$hits" -gt 0 ]; then
  echo "parameterisation gate: $hits violation(s) — move values into deployment/env/.env.<env> (doc 06 §1)"
  exit 1
fi
echo "✓ parameterisation gate: no forbidden literals in deployment/ deployables"
