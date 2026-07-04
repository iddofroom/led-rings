# LED Rings — one-click Raspberry Pi image

Goal (step 3 of the onboarding flow): a non-technical user writes a downloadable `.img` with
Raspberry Pi Imager / balenaEtcher, edits one text file, and boots — no terminal. This replaces
running `led-rings-host.sh` by hand.

> Status: the image **build pipeline and first-boot provisioner are authored here but have not been
> run yet** — the first real validation is a CI build (`.github/workflows/build-image.yml`). pi-gen
> needs Linux + Docker + QEMU and cannot run on Windows.

## Design: a *thin* image

The image is deliberately minimal. It does **not** bake Node/cloudflared/the repo. Instead it ships:

- `/opt/led-rings-host/` — the existing host bundle (`led-rings-host.sh`, `-run.sh`, autostart, stop,
  `bridge.js`, `firstboot/`).
- `led-rings-firstboot.service` (enabled) — runs once on first boot.
- `/boot/firmware/ledrings-config.txt` — the one file the user edits.

On first boot, `firstboot/led-rings-firstboot.sh`:
1. reads `ledrings-config.txt` (Wi-Fi, tunnel token, per-device `PUBLIC_URL`, optional service IPs),
2. joins Wi-Fi (NetworkManager, wpa_supplicant fallback),
3. writes the token + URL into `/opt/led-rings-host/.led-rings-secrets` (chmod 600, run-user owned),
4. **wipes the token line** from the world-readable FAT partition,
5. waits for the network, then runs the normal installer (`led-rings-host.sh`) + enables autostart,
6. writes a sentinel and disables itself.

Why thin: the installer is already battle-tested (Node/cloudflared/clone/build, swap handling,
armv7 quirks). Duplicating that in a pi-gen chroot would be fragile and a second source of truth.
Cost: first boot takes ~10–15 min (install + UI build) instead of being instant.

## Building the image

```bash
# Linux / WSL2 / Docker Desktop (NOT native Windows PowerShell):
bash remote-deploy/pi-gen/build-image.sh
# → .pi-gen-work/deploy/led-rings.img.xz
```

Or push a tag `image-v*` (or run the workflow manually) and let GitHub Actions build it
(`ubuntu-latest`, ~60–120 min) and upload `led-rings.img.xz` as an artifact — no local Linux needed.

Files: `remote-deploy/pi-gen/config` (Bookworm Lite **arm64** — 64-bit is required for Node 18+ /
librosa), `stage-ledrings/` (thin overlay), `build-image.sh` (assembles the stage's `files/` from
the real bundle so there's one source of truth, and `SKIP_IMAGES` on stage2 so only our image
exports).

## The secure token flow (why the shared image ships secret-free)

A Cloudflare tunnel token is a **full credential** — anyone with it can run the tunnel. So it is
**never** baked into the downloadable image. Instead:

1. The user gets their token (+ per-device `PUBLIC_URL`) from the website and pastes them into
   `ledrings-config.txt` on the SD card's boot partition.
2. First boot moves them to `.led-rings-secrets` (600, on the ext4 rootfs) and blanks the token line
   on the FAT partition, so the secret doesn't linger on a removable, world-readable card.
3. A leak revokes only that one device's tunnel.

## Hostname-agnostic UI (so one image works on every device)

Each device serves its own per-device subdomain, but the image ships ONE prebuilt UI. The app now
falls back to **same-origin** for the control-server API when `VITE_API_URL` is unset
(`ui/src/App.tsx` `apiBase`), so the same `ui/dist` works on any hostname (the bridge serves the UI
and proxies `/api` at that origin). The current single-tunnel deploy still sets `VITE_API_URL`, so
it is unaffected.

## Per-device tunnel minting — next step (not built)

For a truly public, multi-installation download, the website should mint a Cloudflare tunnel +
subdomain per device and hand back `{ hostname, token }` so the user's `ledrings-config.txt` is
pre-filled. That needs a Worker endpoint calling the CF API (`POST /accounts/{acct}/cfd_tunnel`, PUT
ingress, `POST /zones/{zone}/dns_records` CNAME → `<id>.cfargotunnel.com`) with an account-scoped
`CF_API_TOKEN` **Worker secret** (Tunnel:Edit + DNS:Edit), degrading to the manual flow if the secret
is absent. This is the remaining host-side work after the image itself; until then, users create a
tunnel in the Cloudflare dashboard and paste its token (today's flow, now via the config file).

## Known limitations / to validate in CI

- Untested end-to-end — validate with a CI build + a real Pi boot before publishing.
- Wi-Fi provisioning assumes Bookworm/Trixie (NetworkManager) with a wpa_supplicant fallback.
- First boot needs internet to install/build; the ~10–15 min is a one-time cost.
- `pi-gen` output is arm64 only (no Pi Zero/older 32-bit).
