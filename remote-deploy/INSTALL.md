# Set up the Raspberry Pi — the simple way

One command sets up a whole installation: the **KivSee backend** (the LED object / sequence /
trigger services + MQTT + time-sync, via Docker) **and** the **LED Rings host** (control-server +
web UI + Cloudflare tunnel). No image to build, no manual service juggling.

## 1. Flash the SD card

1. Open **Raspberry Pi Imager** → choose **Raspberry Pi OS Lite (64-bit)**.
2. Click the **⚙️ gear** (edit settings) and set: **hostname**, **enable SSH**, your **Wi-Fi**
   network + password, and Wi-Fi **country**. (Imager does this for the official OS — no config
   file needed.)
3. Write the card, put it in the Pi, and power on. Give it a minute to join Wi-Fi.

## 2. Connect and run one command

SSH into the Pi (`ssh pi@<hostname>.local`), then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/iddofroom/led-rings/iddo_AI/remote-deploy/rpi-install.sh | bash
```

It installs Docker, starts the KivSee backend, installs the LED Rings host, and turns on
start-on-boot. When it asks, paste the **Cloudflare tunnel token** the website gave you
(*Set up the Raspberry Pi → Get my Pi config*), or press Enter to add it later.

First run builds the web UI on the Pi — a few minutes. When it finishes, open your installation's
URL and you're live.

## 3. That's it

- Backend status: `cd ~/kivsee-backend && sudo docker compose ps`
- Host status: `systemctl status led-rings-host.service`
- Update later: `bash ~/led-rings-host/led-rings-host.sh --update`

---

### Notes

- The KivSee backend comes from [KivSee/raspberry-installation](https://github.com/KivSee/raspberry-installation)
  (its `docker-compose.yml`), exposed on the Pi at the exact ports the host expects (object 8081,
  sequence 8082, trigger 8083, MQTT 1883, time-sync 12321) — so the host's default `.env`
  (`127.0.0.1`) works unchanged.
- **Audio:** the `wavplayeralsa` player wants a sound device; on a Pi with no DAC/audio it may not
  play audio, but the LED services still run.
- **Which repo/branch:** the installer defaults to `iddofroom/led-rings @ iddo_AI` (where the newest
  features live). Override with `LED_RINGS_REPO` / `LED_RINGS_BRANCH` env vars. Point these at the
  canonical repo once the work is merged upstream.
- A prebuilt **`.img`** (Raspberry Pi Imager one-flash, no SSH) is an optional advanced path — see
  `IMAGE.md`. This script is the recommended, simplest route.
