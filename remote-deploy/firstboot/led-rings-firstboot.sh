#!/usr/bin/env bash
# LED Rings FIRST-BOOT provisioner (runs once via led-rings-firstboot.service).
#
# Reads /boot/firmware/ledrings-config.txt (the file the user edits after flashing),
# joins Wi-Fi, writes the Cloudflare tunnel token + per-device PUBLIC_URL into the
# untracked secrets file, WIPES the token from the (world-readable) FAT partition,
# then hands off to the normal installer (led-rings-host.sh) + autostart. Idempotent:
# a sentinel + ConditionPathExists stop it re-running.
#
# Deliberately reuses the battle-tested installer instead of re-implementing install
# logic here, so the image stays thin and maintainable.
set -uo pipefail

LOG=/var/log/led-rings-firstboot.log
exec >>"$LOG" 2>&1
echo "=== led-rings firstboot: $(date -u 2>/dev/null || echo '?') ==="

SENTINEL=/var/lib/led-rings/provisioned
if [ -f "$SENTINEL" ]; then echo "already provisioned — exiting"; exit 0; fi

HOST_DIR=/opt/led-rings-host
BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
CFG="$BOOT/ledrings-config.txt"

# Whitelisted KEY=VALUE reader (never eval the file — it's user-editable).
get() {
  [ -f "$CFG" ] || return 0
  grep -E "^$1=" "$CFG" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

if [ ! -f "$CFG" ]; then
  echo "no $CFG present — leaving the device for manual setup (led-rings-host.sh)."
  exit 0
fi

WIFI_SSID="$(get WIFI_SSID)";   WIFI_PASS="$(get WIFI_PASS)";   WIFI_COUNTRY="$(get WIFI_COUNTRY)"
TUNNEL_TOKEN="$(get TUNNEL_TOKEN)"; PUBLIC_URL="$(get PUBLIC_URL)"; CLERK="$(get VITE_CLERK_PUBLISHABLE_KEY)"
OBJ_IP="$(get LEDS_OBJECT_SERVICE_IP)"; SEQ_IP="$(get SEQUENCE_SERVICE_IP)"
TRIG_IP="$(get TRIGGER_SERVICE_IP)";   MQTT="$(get MQTT_BROKER)"
REPO_URL="$(get LED_RINGS_REPO)";      BRANCH="$(get LED_RINGS_BRANCH)"

# The account the host runs as (default 'pi'; fall back to the first normal user).
RUN_USER=pi
id pi >/dev/null 2>&1 || RUN_USER="$(getent passwd 1000 | cut -d: -f1)"
[ -n "$RUN_USER" ] || RUN_USER=pi
echo "run user: $RUN_USER"

# ── Wi-Fi (NetworkManager on Bookworm/Trixie; wpa_supplicant fallback) ──
if [ -n "$WIFI_SSID" ]; then
  [ -n "$WIFI_COUNTRY" ] && { raspi-config nonint do_wifi_country "$WIFI_COUNTRY" >/dev/null 2>&1 || iw reg set "$WIFI_COUNTRY" 2>/dev/null || true; }
  rfkill unblock wifi 2>/dev/null || true
  if command -v nmcli >/dev/null 2>&1; then
    echo "Wi-Fi via NetworkManager: $WIFI_SSID"
    nmcli connection delete led-rings-wifi >/dev/null 2>&1 || true
    nmcli connection add type wifi con-name led-rings-wifi ifname wlan0 ssid "$WIFI_SSID" >/dev/null 2>&1 || true
    nmcli connection modify led-rings-wifi \
      wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$WIFI_PASS" connection.autoconnect yes >/dev/null 2>&1 || true
    nmcli connection up led-rings-wifi >/dev/null 2>&1 || true
  else
    echo "Wi-Fi via wpa_supplicant: $WIFI_SSID"
    WPA=/etc/wpa_supplicant/wpa_supplicant.conf
    {
      echo "country=${WIFI_COUNTRY:-IL}"
      echo "ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev"
      echo "update_config=1"
      echo "network={"
      echo "    ssid=\"$WIFI_SSID\""
      echo "    psk=\"$WIFI_PASS\""
      echo "}"
    } > "$WPA"
    chmod 600 "$WPA"
    wpa_cli -i wlan0 reconfigure >/dev/null 2>&1 || true
  fi
fi

# ── Secrets file (600, owned by the run user) ──
mkdir -p "$HOST_DIR"
SECRETS="$HOST_DIR/.led-rings-secrets"
{
  [ -n "$TUNNEL_TOKEN" ] && echo "TUNNEL_TOKEN=$TUNNEL_TOKEN"
  [ -n "$PUBLIC_URL" ]   && echo "PUBLIC_URL=$PUBLIC_URL"
  [ -n "$CLERK" ]        && echo "VITE_CLERK_PUBLISHABLE_KEY=$CLERK"
} > "$SECRETS"
chmod 600 "$SECRETS"
chown "$RUN_USER:$RUN_USER" "$SECRETS" 2>/dev/null || true

# ── Optional LED-service IP overrides → repo .env (written by the installer if absent;
# we pre-seed it only when the user gave non-default IPs) ──
if [ -n "$OBJ_IP$SEQ_IP$TRIG_IP$MQTT" ]; then
  ENVF="$HOST_DIR/.env"
  {
    echo "LEDS_OBJECT_SERVICE_IP=${OBJ_IP:-127.0.0.1}"
    echo "SEQUENCE_SERVICE_IP=${SEQ_IP:-127.0.0.1}"
    echo "TRIGGER_SERVICE_IP=${TRIG_IP:-127.0.0.1}"
    echo "MQTT_BROKER=${MQTT:-127.0.0.1}"
  } > "$ENVF"
  chown "$RUN_USER:$RUN_USER" "$ENVF" 2>/dev/null || true
fi

# ── SECURITY: remove the token from the world-readable FAT boot partition ──
if [ -n "$TUNNEL_TOKEN" ]; then
  sed -i 's/^TUNNEL_TOKEN=.*/TUNNEL_TOKEN=<consumed-on-first-boot>/' "$CFG" 2>/dev/null || true
  sync
fi

# ── Wait for connectivity, then run the installer (installs Node/cloudflared, clones,
# builds the UI) and enable autostart. Reuses the existing, tested scripts. ──
echo "waiting for network…"
for _ in $(seq 1 40); do getent hosts github.com >/dev/null 2>&1 && break; sleep 3; done

# Point the installer at a specific repo/branch when the user asked for one.
INSTALL_ENV=()
[ -n "$REPO_URL" ] && INSTALL_ENV+=("LED_RINGS_REPO=$REPO_URL")
[ -n "$BRANCH" ]   && INSTALL_ENV+=("LED_RINGS_BRANCH=$BRANCH")

echo "running installer as $RUN_USER…"
sudo -u "$RUN_USER" env "${INSTALL_ENV[@]}" bash "$HOST_DIR/led-rings-host.sh" \
  || echo "installer returned nonzero — see the host logs"
sudo -u "$RUN_USER" bash "$HOST_DIR/led-rings-host-enable-autostart.sh" \
  || echo "autostart enable returned nonzero"

# ── Done: mark provisioned + disable self ──
mkdir -p "$(dirname "$SENTINEL")"
echo "provisioned" > "$SENTINEL"
systemctl disable led-rings-firstboot.service >/dev/null 2>&1 || true
echo "=== firstboot complete ==="
