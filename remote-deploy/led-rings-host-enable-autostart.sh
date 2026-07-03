#!/usr/bin/env bash
# Run ONCE to make the LED Rings host start automatically on every boot,
# supervised by systemd (auto-restart on crash). Run led-rings-host.sh first
# (it installs deps + builds the UI). This only registers the service.
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$BASE/led-rings-host-run.sh"
UNIT=/etc/systemd/system/led-rings-host.service
USR="${SUDO_USER:-$USER}"
HOMEDIR="$(getent passwd "$USR" | cut -d: -f6)"

[ -f "$RUN" ] || { echo "[led-rings] ERROR: led-rings-host-run.sh missing next to this script." >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo "[led-rings] ERROR: sudo required." >&2; exit 1; }

# A loose (nohup) instance from led-rings-host.sh would clash on the ports — stop it first.
pkill -f 'src/control-server.ts' 2>/dev/null || true
pkill -f 'bridge.js' 2>/dev/null || true
pkill -f 'cloudflared tunnel --no-autoupdate run' 2>/dev/null || true
sleep 1

echo "[led-rings] Installing systemd service ($UNIT) running as '$USR' ..."
sudo tee "$UNIT" >/dev/null <<UNIT_EOF
[Unit]
Description=LED Rings host (control server + bridge + Cloudflare tunnel)
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=$USR
Environment=HOME=$HOMEDIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WorkingDirectory=$BASE
ExecStart=/bin/bash $RUN
Restart=always
RestartSec=5
KillMode=control-group

[Install]
WantedBy=multi-user.target
UNIT_EOF

sudo systemctl daemon-reload
sudo systemctl enable --now led-rings-host.service

echo
echo "[led-rings] Done. The host now starts on every boot and restarts if it crashes."
echo "[led-rings]   status:  systemctl status led-rings-host.service"
echo "[led-rings]   logs:    journalctl -u led-rings-host.service -f"
echo "[led-rings]   stop:    bash $BASE/led-rings-host-stop.sh"
