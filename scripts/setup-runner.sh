#!/usr/bin/env bash
# scripts/setup-runner.sh
#
# One-shot installer for a DatIQ self-hosted GitHub Actions runner.
# Designed for a dedicated, always-on box (mini PC, old laptop, home
# server). macOS and Linux are both supported. Once the runner is
# registered and the service is enabled, every job in this repo that
# targets `runs-on: self-hosted` will run on YOUR box — for free,
# using YOUR pre-warmed node_modules and Playwright cache, never
# counting against GitHub Actions minutes.
#
# Usage (run as the user that will own the runner — NOT root):
#   1. In the GitHub UI: Settings → Actions → Runners → New self-hosted
#      runner. Pick macOS or Linux. Copy the ./config.sh invocation it
#      gives you — it'll look like:
#        ./config.sh --url https://github.com/vikashkaruna/scrapelite \
#                   --token AAAAAAAAAAAAAA \
#                   --name datiq-runner-01
#   2. Set the matching env vars in your shell:
#        export RUNNER_CFG_URL='https://github.com/vikashkaruna/scrapelite'
#        export RUNNER_CFG_TOKEN='AAAA...'
#        export RUNNER_NAME='datiq-runner-01'   # optional
#   3. Run this script from the repo root:
#        ./scripts/setup-runner.sh
#
# What it does:
#   1. Creates a working directory at $RUNNER_DIR (default: $HOME/actions-runner)
#   2. Downloads the matching GitHub Actions runner tarball
#   3. Verifies the SHA-256 against the official checksum
#   4. Runs `./config.sh` non-interactively with your URL + token + name
#   5. Installs + starts the runner as a launchd (mac) or systemd (linux)
#      service so it auto-starts on boot and survives logout
#   6. Installs Node.js 20, npm ci, and Playwright's chromium so the
#      first job doesn't have to
#
# Operational notes (after install):
#   - Status:        sudo launchctl list | grep actions (mac) | grep datiq-runner
#                    systemctl status actions.runner.*-datiq-runner-01 (linux)
#   - Stop:          sudo launchctl stop <label>          (mac)
#                    sudo systemctl stop actions.runner.*  (linux)
#   - Disable:       sudo launchctl unload <plist>         (mac)
#                    sudo systemctl disable actions.runner.* (linux)
#   - Update:        cd $RUNNER_DIR && ./run.sh --update    (interactive)
#                    or: stop service → replace tarball → start
#   - Remove:        stop service → cd $RUNNER_DIR && ./config.sh remove --token …
#   - Drain offline jobs: in GH UI, mark runner "Offline" — jobs already picked
#                         up will finish; new ones go to GitHub-hosted runners.
#
# 2026-08-12: created as part of CI-local-first, the dedicated-box
# upgrade path. See docs/CI-LOCAL-FIRST.md §"Self-hosted runner".
# 2026-08-12: NOT enabled yet — workflows still say `runs-on: ubuntu-latest`.
#              To switch, see docs/CI-LOCAL-FIRST.md §"Switching the runners".

set -euo pipefail

# ── Inputs ──────────────────────────────────────────────────────────────
RUNNER_CFG_URL="${RUNNER_CFG_URL:-}"
RUNNER_CFG_TOKEN="${RUNNER_CFG_TOKEN:-}"
RUNNER_NAME="${RUNNER_NAME:-datiq-runner-01}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,datiq,linux,x64}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
NODE_VERSION="${NODE_VERSION:-20}"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.55.0}" # match package.json

if [ -z "$RUNNER_CFG_URL" ] || [ -z "$RUNNER_CFG_TOKEN" ]; then
  cat >&2 <<'EOF'
✗ setup-runner: RUNNER_CFG_URL and RUNNER_CFG_TOKEN must be set.

  1. In GitHub: Settings → Actions → Runners → New self-hosted runner.
  2. Copy the config command. From it, extract --url and --token.
  3. Export them:
       export RUNNER_CFG_URL='https://github.com/<owner>/<repo>'
       export RUNNER_CFG_TOKEN='AAA...'
  4. Re-run: ./scripts/setup-runner.sh
EOF
  exit 1
fi

# ── Platform detection ──────────────────────────────────────────────────
OS_RAW="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$OS_RAW:$ARCH" in
  linux:x86_64)  PLATFORM="linux-x64";     PKG_EXT="tar.gz" ;;
  linux:aarch64) PLATFORM="linux-arm64";   PKG_EXT="tar.gz" ;;
  darwin:x86_64) PLATFORM="osx-x64";       PKG_EXT="tar.gz" ;;
  darwin:arm64)  PLATFORM="osx-arm64";     PKG_EXT="tar.gz" ;;
  *) echo "✗ unsupported platform: $OS_RAW $ARCH"; exit 1 ;;
esac

# GitHub's runner version. Bump here when upgrading.
RUNNER_VERSION="${RUNNER_VERSION:-2.319.1}"
RUNNER_TARBALL="actions-runner-${PLATFORM}-${RUNNER_VERSION}.${PKG_EXT}"
RUNNER_SHA_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}.sha256"
RUNNER_DL_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"

# Validate RUNNER_NAME so it doesn't blow up the service label.
if ! printf '%s' "$RUNNER_NAME" | grep -Eq '^[A-Za-z0-9_-]{1,64}$'; then
  echo "✗ RUNNER_NAME must be 1-64 chars of [A-Za-z0-9_-]. Got: $RUNNER_NAME"
  exit 1
fi

echo "▸ Installing GitHub Actions self-hosted runner"
echo "  platform:     $PLATFORM"
echo "  runner ver:   $RUNNER_VERSION"
echo "  runner dir:   $RUNNER_DIR"
echo "  runner name:  $RUNNER_NAME"
echo "  labels:       $RUNNER_LABELS"
echo "  repo URL:     $RUNNER_CFG_URL"
echo

# Refuse to run as root — the GH docs explicitly say not to, and the
# systemd unit will fail to install if we are.
if [ "$(id -u)" -eq 0 ]; then
  echo "✗ do NOT run this script as root. Run it as the user that will own the runner."
  echo "  The script will sudo internally only where strictly necessary."
  exit 1
fi

# ── 1. Download + verify ───────────────────────────────────────────────
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x "./run.sh" ]; then
  echo "▸ Downloading $RUNNER_TARBALL…"
  curl -fL --retry 3 -o "$RUNNER_TARBALL" "$RUNNER_DL_URL"

  echo "▸ Verifying SHA-256…"
  EXPECTED_SHA="$(curl -fsSL "$RUNNER_SHA_URL" | awk '{print $1}')"
  if [ -z "$EXPECTED_SHA" ]; then
    echo "✗ could not fetch the official SHA-256 from $RUNNER_SHA_URL"
    exit 1
  fi
  ACTUAL_SHA="$(shasum -a 256 "$RUNNER_TARBALL" 2>/dev/null | awk '{print $1}')"
  if [ -z "$ACTUAL_SHA" ]; then
    ACTUAL_SHA="$(sha256sum "$RUNNER_TARBALL" | awk '{print $1}')"
  fi
  if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    echo "✗ SHA-256 mismatch!"
    echo "  expected: $EXPECTED_SHA"
    echo "  actual:   $ACTUAL_SHA"
    exit 1
  fi

  tar xzf "$RUNNER_TARBALL"
  rm -f "$RUNNER_TARBALL"
  echo "  ✓ extracted to $RUNNER_DIR"
else
  echo "  ✓ run.sh already present, skipping download"
fi

# ── 2. Configure (non-interactive) ────────────────────────────────────
# `--unattended` skips prompts. `--replace` re-registers if a runner
# with this name already exists (useful after re-running this script).
echo "▸ Configuring runner (--unattended --replace)…"
./config.sh \
  --unattended \
  --replace \
  --url "$RUNNER_CFG_URL" \
  --token "$RUNNER_CFG_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work"
echo "  ✓ runner registered with labels: $RUNNER_LABELS"

# ── 3. Install + start as a service ────────────────────────────────────
echo "▸ Installing runner as a service…"
case "$OS_RAW" in
  darwin)
    # The `./svc.sh` script needs sudo. It installs a launchd plist
    # named after the runner, so `launchctl list | grep $RUNNER_NAME`
    # shows the status.
    sudo ./svc.sh install
    sudo ./svc.sh start
    echo "  ✓ installed + started via launchd"
    echo "  status: sudo launchctl list | grep $RUNNER_NAME"
    ;;
  linux)
    # `svc.sh install` creates a systemd unit named after the runner.
    sudo ./svc.sh install "${USER}"
    sudo systemctl enable "actions.runner.${RUNNER_CFG_URL##*/}-${RUNNER_NAME}.service"
    sudo systemctl start "actions.runner.${RUNNER_CFG_URL##*/}-${RUNNER_NAME}.service"
    echo "  ✓ installed + started via systemd"
    echo "  status: systemctl status actions.runner.*-${RUNNER_NAME}.service"
    ;;
esac

# ── 4. Pre-warm node + Playwright so the first job is fast ─────────────
# These are the two slowest first-time installs the runner would
# otherwise pay on the first job it picks up.
echo "▸ Pre-warming Node.js $NODE_VERSION and Playwright chromium…"
if command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  \. "$HOME/.nvm/nvm.sh"
  nvm install "$NODE_VERSION" >/dev/null
  nvm use "$NODE_VERSION"
elif ! command -v "node$NODE_VERSION" >/dev/null 2>&1 && ! node --version | grep -q "v$NODE_VERSION"; then
  echo "  ! Node $NODE_VERSION not on PATH. Install via nvm or your package manager,"
  echo "    then re-run this script (it will skip the download step)."
fi

# Install the repo's deps + Playwright browsers in the runner's working
# dir. We don't `npm ci` from this script because the runner dir isn't
# the repo dir — but installing Playwright here means the first job
# doesn't pay the download.
if command -v npx >/dev/null 2>&1; then
  # `playwright install chromium` without --with-deps assumes the system
  # libs (libnss, libxkbcommon) are already present. On Ubuntu/Debian the
  # runner install script usually handles that via apt; on macOS Homebrew
  # handles it. We use --with-deps on linux to be sure; on mac we skip
  # the deps step because Homebrew is the canonical source.
  case "$OS_RAW" in
    linux) npx --yes playwright@$PLAYWRIGHT_VERSION install --with-deps chromium ;;
    darwin) npx --yes playwright@$PLAYWRIGHT_VERSION install chromium ;;
  esac
  echo "  ✓ Playwright chromium ready"
fi

# ── 5. Health check ────────────────────────────────────────────────────
echo
echo "✓ setup-runner: complete. Verifying the runner registered…"
sleep 3
case "$OS_RAW" in
  darwin)
    if sudo launchctl list | grep -q "$RUNNER_NAME"; then
      echo "  ✓ runner is live and accepting jobs"
    else
      echo "  ! runner is registered but the service may not be running."
      echo "    Check: sudo launchctl list | grep $RUNNER_NAME"
    fi
    ;;
  linux)
    if systemctl is-active --quiet "actions.runner.${RUNNER_CFG_URL##*/}-${RUNNER_NAME}.service"; then
      echo "  ✓ runner is live and accepting jobs"
    else
      echo "  ! runner is registered but the service may not be running."
      echo "    Check: systemctl status actions.runner.*-${RUNNER_NAME}.service"
    fi
    ;;
esac

echo
echo "Next step: edit .github/workflows/staging-gate.yml and phase-gate.yml"
echo "and change 'runs-on: ubuntu-latest' to 'runs-on: self-hosted'. See"
echo "docs/CI-LOCAL-FIRST.md §'Switching the runners' for the rollout plan."
