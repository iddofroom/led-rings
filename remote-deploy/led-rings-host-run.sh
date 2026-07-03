#!/usr/bin/env bash
# led-rings host RUNNER (Raspberry Pi). Pure launch, no install/build.
# Starts the control server + single-origin bridge in the background, then execs
# the Cloudflare Tunnel connector in the foreground. Run by both:
#   - led-rings-host.sh  (via nohup, for "run now")
#   - systemd            (led-rings-host-enable-autostart.sh installs the unit)
# A supervisor (systemd) that kills this process's cgroup reaps the node children too.
set -uo pipefail

PUBLIC_URL='https://leds.iddofroom.co.il'
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Cloudflare Tunnel token (SECRET — never committed to git) ----
# The token lives in a local, untracked file next to this script:
#   remote-deploy/.led-rings-secrets   (copy .led-rings-secrets.example to create it)
# On the Raspberry Pi, paste the token the tunnel owner sends you into that file.
SECRETS_FILE="$BASE/.led-rings-secrets"
if [ -f "$SECRETS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
fi
: "${TUNNEL_TOKEN:?TUNNEL_TOKEN is not set. Create $SECRETS_FILE (copy .led-rings-secrets.example) and paste the Cloudflare tunnel token into it.}"

# Locate the repo (no clone here; led-rings-host.sh handles install/clone).
if   [ -f "$BASE/src/control-server.ts" ];           then REPO="$BASE"
elif [ -f "$BASE/led-rings/src/control-server.ts" ]; then REPO="$BASE/led-rings"
else echo "[led-rings] ERROR: repo not found. Run led-rings-host.sh first." >&2; exit 1; fi

# Prefer a system cloudflared; fall back to the one downloaded next to this script.
if command -v cloudflared >/dev/null 2>&1; then CF="cloudflared"; else CF="$BASE/cloudflared"; fi

cd "$REPO"

# Make sure node / yarn-global bins are on PATH under systemd's minimal env.
export PATH="$REPO/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH"

node node_modules/ts-node-dev/lib/bin.js --respawn src/control-server.ts \
  > "$REPO/control-server.log" 2> "$REPO/control-server.err.log" &
node bridge.js \
  > "$REPO/bridge.log" 2> "$REPO/bridge.err.log" &

exec "$CF" tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
