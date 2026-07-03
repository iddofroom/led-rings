#!/usr/bin/env bash
# Stops the LED Rings host: the systemd service (if installed) and any loose
# control-server / bridge / cloudflared processes. Does not uninstall anything.
set -uo pipefail
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files led-rings-host.service >/dev/null 2>&1; then
  if [ "${1:-}" = "--disable" ]; then
    echo "[led-rings] Stopping and disabling the autostart service ..."
    sudo systemctl disable --now led-rings-host.service 2>/dev/null || true
  else
    echo "[led-rings] Stopping the autostart service (still enabled for next boot; use --disable to turn off) ..."
    sudo systemctl stop led-rings-host.service 2>/dev/null || true
  fi
fi

# Kill any loose (nohup) instance too.
pkill -f 'src/control-server.ts' 2>/dev/null || true
pkill -f 'bridge.js' 2>/dev/null || true
pkill -f 'cloudflared tunnel --no-autoupdate run' 2>/dev/null || true

echo "[led-rings] LED Rings host stopped."
