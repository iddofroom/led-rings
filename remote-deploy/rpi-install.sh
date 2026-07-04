#!/usr/bin/env bash
# ── LED Rings — full Raspberry Pi install, ONE command ───────────────────────
# Sets up an entire installation on a fresh Raspberry Pi OS:
#   1. Docker + Compose
#   2. the KivSee backend (object / sequence / trigger services + MQTT + time-sync) via the
#      official docker-compose (github.com/KivSee/raspberry-installation)
#   3. the LED Rings host (control-server + single-origin bridge + Cloudflare tunnel + web UI)
#   4. start-on-boot for both
#
# Run it straight from the internet on the Pi:
#   curl -fsSL https://raw.githubusercontent.com/iddofroom/led-rings/iddo_AI/remote-deploy/rpi-install.sh | bash
#
# Re-running is safe. Override the source with LED_RINGS_REPO / LED_RINGS_BRANCH.
set -euo pipefail

REPO_RAW_BASE="${REPO_RAW_BASE:-https://raw.githubusercontent.com/iddofroom/led-rings/iddo_AI/remote-deploy}"
LED_RINGS_REPO="${LED_RINGS_REPO:-https://github.com/iddofroom/led-rings.git}"
LED_RINGS_BRANCH="${LED_RINGS_BRANCH:-iddo_AI}"
BACKEND_REPO="${BACKEND_REPO:-https://github.com/KivSee/raspberry-installation.git}"
HOST_DIR="${HOST_DIR:-$HOME/led-rings-host}"
BACKEND_DIR="${BACKEND_DIR:-$HOME/kivsee-backend}"

info() { printf '\033[36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[install]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[install] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have apt-get || die "This installer targets Raspberry Pi OS / Debian (apt-get not found)."
have sudo    || die "sudo is required."
USER_NAME="$(id -un)"

# ── 1. Base packages ──
info "Installing base packages (git, curl)…"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates

# ── 2. Docker + Compose ──
if ! have docker; then
  info "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER_NAME" || true
  warn "Added $USER_NAME to the 'docker' group — a re-login is needed for non-sudo docker; we use sudo below meanwhile."
fi
# Prefer the compose plugin; `docker compose` (v2). Fall back to installing it.
if ! sudo docker compose version >/dev/null 2>&1; then
  info "Installing the Docker Compose plugin…"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || true
fi
DC="sudo docker compose"
$DC version >/dev/null 2>&1 || { have docker-compose && DC="sudo docker-compose"; }
$DC version >/dev/null 2>&1 || die "Docker Compose is not available."

# ── 3. KivSee backend (the LED services) ──
info "Fetching the KivSee backend (docker-compose)…"
if [ -d "$BACKEND_DIR/.git" ]; then
  git -C "$BACKEND_DIR" pull --ff-only || true
else
  git clone "$BACKEND_REPO" "$BACKEND_DIR"
fi
mkdir -p "$HOME/repos/led_object_repo" "$HOME/repos/led_sequence_repo" "$HOME/Music"
info "Starting the backend (object / sequence / trigger / mqtt / time-sync)…"
( cd "$BACKEND_DIR" && $DC up -d )

# ── 4. LED Rings host bundle ──
info "Fetching the LED Rings host bundle…"
mkdir -p "$HOST_DIR"
for f in led-rings-host.sh led-rings-host-run.sh led-rings-host-enable-autostart.sh \
         led-rings-host-stop.sh bridge.js .led-rings-secrets.example; do
  curl -fsSL "$REPO_RAW_BASE/$f" -o "$HOST_DIR/$f" || warn "could not fetch $f"
done
chmod +x "$HOST_DIR"/*.sh 2>/dev/null || true

# Tunnel token (secret). If missing, ask for it interactively (works under curl | bash via /dev/tty).
SECRETS="$HOST_DIR/.led-rings-secrets"
if [ ! -s "$SECRETS" ]; then
  if [ -e /dev/tty ]; then
    echo
    echo "Paste your Cloudflare tunnel token (from the website — 'Set up the Raspberry Pi'),"
    printf "or press Enter to skip and add it later to %s:\n> " "$SECRETS"
    read -r TOKEN </dev/tty || TOKEN=""
    { [ -n "$TOKEN" ] && printf 'TUNNEL_TOKEN=%s\n' "$TOKEN"; } > "$SECRETS"
    chmod 600 "$SECRETS"
  else
    cp -n "$HOST_DIR/.led-rings-secrets.example" "$SECRETS" 2>/dev/null || true
    warn "No terminal to prompt for the tunnel token — edit $SECRETS and add TUNNEL_TOKEN, then re-run."
  fi
fi

# ── 5. Install + start the host (Node, control-server, bridge, tunnel, UI) ──
info "Installing and starting the LED Rings host (first run builds the UI — several minutes)…"
env LED_RINGS_REPO="$LED_RINGS_REPO" LED_RINGS_BRANCH="$LED_RINGS_BRANCH" bash "$HOST_DIR/led-rings-host.sh"

# ── 6. Start on every boot ──
info "Enabling start-on-boot…"
RUN_USER="$USER_NAME" bash "$HOST_DIR/led-rings-host-enable-autostart.sh" || warn "autostart enable returned nonzero"

echo
echo -e "\033[32m========================================================\033[0m"
echo -e "\033[32m  Done. KivSee backend + LED Rings host are running.\033[0m"
echo -e "\033[32m  Backend:  cd $BACKEND_DIR && $DC ps\033[0m"
echo -e "\033[32m  Host:     systemctl status led-rings-host.service\033[0m"
echo -e "\033[32m========================================================\033[0m"
