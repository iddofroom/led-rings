#!/usr/bin/env bash
# led-rings HOST setup + launcher for Raspberry Pi (Cloudflare edition).
# One command: installs everything missing, builds the UI, and exposes it on a
# permanent public URL via a Cloudflare Tunnel. The operator just opens the URL.
# Re-running is safe; installs/build are skipped once done.
#
#   bash led-rings-host.sh         # install + build (first run), then start now in the background
#   bash led-rings-host.sh --update            # git pull latest of the current branch, rebuild, restart
#   LED_RINGS_BRANCH=my-branch bash led-rings-host.sh          # clone/switch to a specific branch
#   LED_RINGS_BRANCH=my-branch bash led-rings-host.sh --update # switch branch + pull + rebuild
#
# For start-on-every-boot:  bash led-rings-host-enable-autostart.sh
set -euo pipefail

PUBLIC_URL='https://leds.iddofroom.co.il'
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_FILE="$BASE/.led-rings-source"   # remembers which repo/branch this host tracks

# Resolve which repo + branch to use. Precedence: explicit env var > remembered file > default.
# The remembered file lets --update (and reboots / systemd) keep tracking the right branch
# without having to pass LED_RINGS_* every time.
REMEMBERED_REPO=''; REMEMBERED_BRANCH=''
if [ -f "$SOURCE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SOURCE_FILE"
  REMEMBERED_REPO="${LED_RINGS_REPO_SAVED:-}"
  REMEMBERED_BRANCH="${LED_RINGS_BRANCH_SAVED:-}"
fi
REPO_URL="${LED_RINGS_REPO:-${REMEMBERED_REPO:-https://github.com/KivSee/led-rings.git}}"
BRANCH="${LED_RINGS_BRANCH:-${REMEMBERED_BRANCH:-main}}"

# Persist the resolved repo/branch so future runs default to them.
remember_source() {
  printf 'LED_RINGS_REPO_SAVED=%s\nLED_RINGS_BRANCH_SAVED=%s\n' "$REPO_URL" "$BRANCH" > "$SOURCE_FILE"
}

# --update forces a git pull (+ branch switch) and a UI rebuild even if things already exist.
UPDATE=0
for arg in "$@"; do case "$arg" in --update) UPDATE=1 ;; esac; done

info() { printf '\033[36m[led-rings]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[led-rings]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[led-rings] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] && warn "Running as root. Prefer running as the normal 'pi' user (sudo is used only where needed)."
have sudo || die "sudo is required. Install it or run on a normal Raspberry Pi OS image."
have apt-get || die "This installer targets Raspberry Pi OS / Debian (apt-get not found)."

# ---- System packages (git, unzip, curl) ----
APT_PKGS=()
for pkg in git unzip curl ca-certificates; do
  dpkg -s "$pkg" >/dev/null 2>&1 || APT_PKGS+=("$pkg")
done
if [ "${#APT_PKGS[@]}" -gt 0 ]; then
  info "Installing system packages: ${APT_PKGS[*]} ..."
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PKGS[@]}"
fi

# ---- Node.js (>= 18, for vite 5 + ts-node-dev) ----
node_ok() { have node && [ "$(node -v | sed 's/^v\([0-9]*\).*/\1/')" -ge 18 ] 2>/dev/null; }
if ! node_ok; then
  info "Installing Node.js LTS (NodeSource) ..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node_ok || die "Node.js 18+ is required and could not be installed. Install from https://nodejs.org and re-run."

# ---- cloudflared (ARM/arm64 static binary, kept next to this script) ----
if ! have cloudflared && [ ! -x "$BASE/cloudflared" ]; then
  case "$(uname -m)" in
    aarch64|arm64)              CFARCH=arm64 ;;
    armv6l|armv7l|armv8l|armhf) CFARCH=arm ;;
    x86_64|amd64)               CFARCH=amd64 ;;
    *)                          CFARCH=arm64 ;;
  esac
  info "Downloading cloudflared ($CFARCH) ..."
  curl -fL --retry 3 -o "$BASE/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CFARCH}"
  chmod +x "$BASE/cloudflared"
fi

# ---- Locate, clone, or update the led-rings git repo ----
# Track whether the code changed so we know to rebuild the UI later.
CODE_CHANGED=0
if   [ -f "$BASE/src/control-server.ts" ];           then REPO="$BASE"
elif [ -f "$BASE/led-rings/src/control-server.ts" ]; then REPO="$BASE/led-rings"
else
  info "Cloning led-rings ($BRANCH) from $REPO_URL ..."
  rm -rf "$BASE/led-rings"
  git clone --branch "$BRANCH" "$REPO_URL" "$BASE/led-rings"
  REPO="$BASE/led-rings"
  CODE_CHANGED=1
  remember_source
fi
cd "$REPO"
info "Repo: $REPO"

# Update: switch branch if asked and pull the latest. Only when --update is passed,
# so a normal run (or reboot) never touches the network or risks a broken upstream commit.
if [ "$UPDATE" -eq 1 ]; then
  if [ -d "$REPO/.git" ]; then
    info "Updating led-rings (branch: $BRANCH) ..."
    # Re-point origin if a different repo was requested (e.g. switching to a fork).
    if [ "$(git -C "$REPO" remote get-url origin 2>/dev/null)" != "$REPO_URL" ]; then
      info "Pointing origin -> $REPO_URL"
      git -C "$REPO" remote set-url origin "$REPO_URL"
    fi
    git -C "$REPO" fetch --prune origin
    # Switch branches if the requested branch differs from the checked-out one.
    CURRENT_BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
      info "Switching branch: $CURRENT_BRANCH -> $BRANCH"
      git -C "$REPO" checkout "$BRANCH"
    fi
    BEFORE="$(git -C "$REPO" rev-parse HEAD)"
    # Fast-forward to origin; hard-reset keeps the working tree in sync with upstream.
    git -C "$REPO" reset --hard "origin/$BRANCH"
    AFTER="$(git -C "$REPO" rev-parse HEAD)"
    if [ "$BEFORE" != "$AFTER" ]; then
      info "Updated $(echo "$BEFORE" | cut -c1-7) -> $(echo "$AFTER" | cut -c1-7)"
      CODE_CHANGED=1
    else
      info "Already up to date."
    fi
    remember_source   # persist repo/branch so plain reruns keep tracking them
  else
    warn "--update requested but $REPO is not a git checkout (was it unzipped?). Skipping pull."
    warn "To get git-based updates, delete '$REPO' and re-run this script to clone fresh."
  fi
fi

# ---- yarn + node dependencies ----
# On a code update, package.json may have changed, so refresh deps too.
# --ignore-engines: the root has a packaging-only devDependency (@yao-pkg/pkg) that
# requires Node >=22, which the Pi's armv7 build can't have (Node 20 is the last armv7).
# It's never used on the Pi, so skip the engine check instead of failing the install.
have yarn || { info "Installing yarn ..."; sudo npm install -g yarn; }
if [ ! -d node_modules ] || [ "$CODE_CHANGED" -eq 1 ]; then
  info "Installing root dependencies ..."; yarn install --ignore-engines
fi
if [ ! -d ui/node_modules ] || [ "$CODE_CHANGED" -eq 1 ]; then
  info "Installing UI dependencies ..."; ( cd ui && yarn install --ignore-engines )
fi

# ---- LED backend service IPs (.env) ----
if [ ! -f .env ]; then
  cat > .env <<'ENV'
# IPs of the Kivsee LED services on this LAN. If they run on THIS device leave 127.0.0.1.
LEDS_OBJECT_SERVICE_IP=127.0.0.1
SEQUENCE_SERVICE_IP=127.0.0.1
TRIGGER_SERVICE_IP=127.0.0.1
ENV
  warn ".env created with 127.0.0.1 placeholders — edit if the LED services run on another device."
fi

# ---- Python deps for beat detection (OPTIONAL, non-fatal; piwheels makes this feasible on a Pi) ----
if have python3; then
  if ! python3 -c 'import librosa, paho.mqtt.client, requests' >/dev/null 2>&1; then
    info "Installing optional Python deps (beat detection). This can take several minutes — safe to Ctrl-C; everything else still works."
    dpkg -s python3-pip >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip || true
    python3 -m pip install --user --break-system-packages -r scripts/requirements.txt paho-mqtt requests \
      || warn "Python deps failed — beat detection unavailable; everything else works."
  fi
else
  warn "python3 not found — beat detection unavailable (everything else works)."
fi

# ---- Ensure enough swap before a memory-hungry build (low-RAM Pis thrash-lock otherwise) ----
# A production Vite/Rollup build peaks well above what a ~1GB Pi has free. Without headroom
# the whole Pi freezes (OOM / swap thrash). Bump swap to ~2GB when total RAM is under ~1.4GB
# and current swap is small. Skippable: LED_RINGS_NO_SWAP=1 (e.g. if you manage swap yourself).
ensure_swap_for_build() {
  [ "${LED_RINGS_NO_SWAP:-0}" = "1" ] && return 0
  have free || return 0
  local mem_mb swap_mb
  mem_mb="$(free -m | awk '/^Mem:/{print $2}')"
  swap_mb="$(free -m | awk '/^Swap:/{print $2}')"
  # Enough RAM already, or plenty of swap already — nothing to do.
  [ "${mem_mb:-0}" -ge 1400 ] && return 0
  [ "${swap_mb:-0}" -ge 1500 ] && return 0
  if have dphys-swapfile && [ -f /etc/dphys-swapfile ]; then
    warn "Low memory (RAM ${mem_mb}MB, swap ${swap_mb}MB). Raising swap to 2GB for the build ..."
    sudo dphys-swapfile swapoff || true
    sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile || true
    sudo sed -i 's/^#*CONF_MAXSWAP=.*/CONF_MAXSWAP=2048/' /etc/dphys-swapfile || true
    if sudo dphys-swapfile setup && sudo dphys-swapfile swapon; then
      info "Swap now: $(free -m | awk '/^Swap:/{print $2}')MB"
    else
      warn "Could not enlarge swap (SD card full?). Build may fail — free disk space and retry."
    fi
  else
    warn "Low memory and no dphys-swapfile to manage swap. Build may thrash; consider building the UI on a PC and shipping ui/dist (see FRIEND-SETUP.md)."
  fi
}

# ---- Build the UI against the public URL (when missing, when the URL changed, or after an update) ----
# You can skip building on the Pi entirely by shipping a prebuilt ui/dist from a beefier machine
# and creating ui/.prebuilt — then the Pi just serves it. See FRIEND-SETUP.md ("Build on your PC").
printf 'VITE_API_URL=%s\n' "$PUBLIC_URL" > ui/.env
if [ -f ui/.prebuilt ] && [ -f ui/dist/index.html ]; then
  info "Using prebuilt UI (ui/.prebuilt present) — skipping the on-Pi build."
elif [ "$CODE_CHANGED" -eq 1 ] \
   || ! { [ -f ui/dist/index.html ] && [ -f ui/.apiurl ] && [ "$(cat ui/.apiurl)" = "$PUBLIC_URL" ]; }; then
  ensure_swap_for_build
  info "Building UI (slow on a Pi — several minutes) ..."
  # Cap V8 heap so Rollup swaps gracefully instead of ballooning and OOM-killing the Pi.
  ( cd ui && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" node node_modules/vite/bin/vite.js build )
  printf '%s' "$PUBLIC_URL" > ui/.apiurl
fi

# ---- Single-origin bridge next to the repo ----
if [ -f "$BASE/bridge.js" ] && [ "$BASE/bridge.js" != "$REPO/bridge.js" ]; then cp -f "$BASE/bridge.js" "$REPO/bridge.js"; fi
[ -f "$REPO/bridge.js" ] || die "bridge.js missing — keep it next to this launcher."

# ---- Start now (background) ----
# Hand over cleanly if a systemd unit is already managing the host.
if systemctl list-unit-files led-rings-host.service >/dev/null 2>&1 \
   && systemctl is-enabled --quiet led-rings-host.service 2>/dev/null; then
  info "Autostart service is installed — (re)starting it instead of a loose process."
  sudo systemctl restart led-rings-host.service
else
  # Kill any previous loose instance to avoid port clashes, then relaunch detached.
  pkill -f 'src/control-server.ts' 2>/dev/null || true
  pkill -f "$REPO/bridge.js" 2>/dev/null || true
  pkill -f 'cloudflared tunnel --no-autoupdate run' 2>/dev/null || true
  sleep 1
  nohup bash "$BASE/led-rings-host-run.sh" > "$REPO/host.log" 2>&1 &
  disown || true
fi

echo
echo -e "\033[32m====================================================\033[0m"
echo -e "\033[32m  LED Rings host is running.\033[0m"
echo -e "\033[32m  Operator opens:  $PUBLIC_URL\033[0m"
echo -e "\033[32m====================================================\033[0m"
echo
echo "Running in the background (logs in $REPO/*.log). Stop with:  bash $BASE/led-rings-host-stop.sh"
echo "Keep it running on every boot:  bash $BASE/led-rings-host-enable-autostart.sh"
