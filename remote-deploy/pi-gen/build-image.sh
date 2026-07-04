#!/usr/bin/env bash
# Build the LED Rings Raspberry Pi .img with pi-gen.
#
# Requires Docker + QEMU binfmt (Linux, or Windows via WSL2/Docker Desktop). It CANNOT run on
# native Windows PowerShell. Normally this runs in CI — see .github/workflows/build-image.yml.
#
#   bash remote-deploy/pi-gen/build-image.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # remote-deploy/pi-gen
REMOTE_DEPLOY="$(cd "$HERE/.." && pwd)"                 # remote-deploy
REPO_ROOT="$(cd "$REMOTE_DEPLOY/.." && pwd)"
WORK="${WORK:-$REPO_ROOT/.pi-gen-work}"
# The arm64 image MUST be built from pi-gen's `arm64` branch — `master` produces a 32-bit armhf
# image (no Node 22 / librosa wheels on armv7). See pi-gen README.
PIGEN_REF="${PIGEN_REF:-arm64}"

echo "[build-image] pi-gen work dir: $WORK"
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$PIGEN_REF" https://github.com/RPi-Distro/pi-gen.git "$WORK"
fi

# Drop in our config + stage.
cp "$HERE/config" "$WORK/config"
rm -rf "$WORK/stage-ledrings"
cp -a "$HERE/stage-ledrings" "$WORK/stage-ledrings"
# pi-gen SKIPS run scripts that aren't executable (a Windows checkout drops the +x bit) — force it.
chmod +x "$WORK/stage-ledrings/prerun.sh" "$WORK/stage-ledrings/"*-run.sh 2>/dev/null || true

# Assemble the stage's files/ from the real host bundle so there's ONE source of truth
# (never the actual .led-rings-secrets — only the example).
FILES="$WORK/stage-ledrings/files"
rm -rf "$FILES"
mkdir -p "$FILES/led-rings-host/firstboot"
for f in led-rings-host.sh led-rings-host-run.sh led-rings-host-enable-autostart.sh \
         led-rings-host-stop.sh bridge.js .led-rings-secrets.example; do
  [ -e "$REMOTE_DEPLOY/$f" ] && cp -a "$REMOTE_DEPLOY/$f" "$FILES/led-rings-host/"
done
cp -a "$REMOTE_DEPLOY/firstboot/." "$FILES/led-rings-host/firstboot/"
cp -a "$REMOTE_DEPLOY/firstboot/led-rings-firstboot.service" "$FILES/led-rings-firstboot.service"
cp -a "$REMOTE_DEPLOY/boot/ledrings-config.txt" "$FILES/ledrings-config.txt"

# Only export OUR image, not the plain Lite one from stage2.
touch "$WORK/stage2/SKIP_IMAGES"

cd "$WORK"
echo "[build-image] running pi-gen via Docker (this takes a while)…"
./build-docker.sh
echo "[build-image] done. Image(s) in: $WORK/deploy/"
ls -la "$WORK/deploy/" || true
