#!/bin/bash -e
# Runs on the BUILD host with the target rootfs mounted at ${ROOTFS_DIR}. Installs the
# LED Rings host bundle + first-boot provisioner into the image. Deliberately does NOT
# install Node/cloudflared/clone the repo here (that happens on first boot via the existing
# installer) — keeping the image thin and the install logic in one place.

# Host bundle → /opt/led-rings-host (scripts, bridge.js, firstboot/, secrets example).
install -d "${ROOTFS_DIR}/opt/led-rings-host"
cp -a "${STAGE_DIR}/files/led-rings-host/." "${ROOTFS_DIR}/opt/led-rings-host/"
chmod +x "${ROOTFS_DIR}/opt/led-rings-host/"*.sh 2>/dev/null || true
chmod +x "${ROOTFS_DIR}/opt/led-rings-host/firstboot/"*.sh 2>/dev/null || true

# First-boot systemd unit, enabled by symlink so it fires without a running systemd at build time.
install -m 0644 "${STAGE_DIR}/files/led-rings-firstboot.service" \
	"${ROOTFS_DIR}/etc/systemd/system/led-rings-firstboot.service"
install -d "${ROOTFS_DIR}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/led-rings-firstboot.service \
	"${ROOTFS_DIR}/etc/systemd/system/multi-user.target.wants/led-rings-firstboot.service"

# Editable config template on the boot (FAT) partition — the user edits it after flashing.
if [ -d "${ROOTFS_DIR}/boot/firmware" ]; then
	install -m 0644 "${STAGE_DIR}/files/ledrings-config.txt" "${ROOTFS_DIR}/boot/firmware/ledrings-config.txt"
else
	install -m 0644 "${STAGE_DIR}/files/ledrings-config.txt" "${ROOTFS_DIR}/boot/ledrings-config.txt"
fi
