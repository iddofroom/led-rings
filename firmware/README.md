# KivSee LED Controller — firmware contract for browser install

This is the **precise contract** the website (`kivsee.iddofroom.co.il`) needs from the ESP32
firmware so a user can **flash and configure a controller from the browser**, WLED-style. The
website side is already built against this contract (see `ui/src/onboard/`), gated so it degrades
gracefully until the firmware ships. Everything below is the firmware work; none of it lives in this
repo (the firmware is [`KivSee/esp32-animations`](https://github.com/KivSee/esp32-animations)).

The gap today: KivSee bakes Wi-Fi, MQTT broker, service IPs and the LED data pin at **compile
time**; `thing_name` is a SPIFFS file. Browser install needs those to be **runtime**-configurable on
a single generic binary. Below is the minimal set of changes.

---

## 1. Flashable binaries — one merged image per chip, at offset 0

esp-web-tools flashes from a `manifest.json`. Emit, per supported chip, a **single merged binary at
offset 0** (avoids the per-chip bootloader-offset trap: 0x1000 on ESP32/S2 vs 0x0 on C3/S3):

```bash
esptool.py --chip esp32 merge_bin -o kivsee-esp32.bin \
  0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 firmware.bin
```

Publish per chip we support (start with **ESP32**, add **ESP32-S3**, **ESP32-C3** later). The website
serves the manifest same-origin from the edge at **`/firmware/manifest.json`** (Cloudflare Worker,
`cf-worker/worker.js` → `FIRMWARE_MANIFEST`) and the `.bin` parts from `/firmware/…`. Target shape:

```json
{
  "name": "KivSee LED Controller",
  "version": "1.0.0",
  "new_install_prompt_erase": true,
  "builds": [
    { "chipFamily": "ESP32",    "parts": [{ "path": "/firmware/kivsee-esp32.bin",   "offset": 0 }] },
    { "chipFamily": "ESP32-S3", "parts": [{ "path": "/firmware/kivsee-esp32s3.bin", "offset": 0 }] }
  ]
}
```

The moment `builds` is non-empty, `FlashController.tsx` loads esp-web-tools and shows the flash
button — no website change needed.

## 2. Improv-Serial — for Wi-Fi provisioning ONLY

Implement Improv-Serial on **UART0 @ 115200** (reuse [`improv-wifi/sdk-cpp`](https://github.com/improv-wifi/sdk-cpp)):
emit `CURRENT_STATE` on boot, parse the `IMPROV` frame + checksum, handle `SEND_WIFI_SETTINGS`
(0x01), `REQUEST_DEVICE_INFO` (0x03), `REQUEST_WIFI_NETWORKS` (0x04); attempt STA connect; reply
`PROVISIONED`. **Do not flood UART0 with boot logs** — a stray log corrupts the `CURRENT_STATE`
packet and breaks detection (a known WLED gotcha).

Improv carries **only ssid + password** (+ optional hostname/device-name). It **cannot** carry the
KivSee config below — do not try to smuggle it through Improv fields.

## 3. Runtime config store (NVS)

Persist in NVS/Preferences, read on boot, changeable without a reflash:

| key            | type   | meaning |
|----------------|--------|---------|
| `thing_name`   | string | device identity (≤16 chars), replaces the SPIFFS `thing_info` |
| `broker`       | string | MQTT broker `host:port` (was a `-D` flag) |
| `obj_base`     | string | led-object-service base URL (was a `-D` flag) — optional if derived from broker host |
| `pins`         | blob   | ordered LED output layout, see §5 |

On boot **with** config: connect Wi-Fi → subscribe MQTT → publish presence on
`thing/<thing_name>/status` → keep the existing `obj/<thing>/guid` reboot-on-change geometry fetch.
On boot **without** config: run Improv (Wi-Fi) then wait for the config frame (§4).

## 4. Config transport — length-prefixed JSON frame over the SAME serial port (PRESCRIPTIVE)

This is the one decision we make **for** the firmware, because we control both ends and it keeps the
website flow single-page. Immediately after Improv (while the Web Serial port is still open, **before
the browser navigates anywhere**), the website writes ONE frame:

```
"KVSC" (4 magic bytes) | uint32 length (LE) | <length bytes of UTF-8 JSON>
```

JSON body:

```json
{ "thing": "ring1", "broker": "10.0.0.200:1883", "pins": [ { "gpio": 2 }, { "gpio": 4 } ] }
```

Firmware: validate magic + length, parse, persist to NVS, ack with a single line `KVSC OK\n`, then
reboot into normal operation. (Alternatives we deliberately rejected: a SoftAP captive page — more
firmware, but revisit if phones must configure; per-device bins compiled on the Pi — one build per
device.) The website writer lives in `ui/src/onboard/` behind a `FIRMWARE_SUPPORTS_CONFIG_FRAME`
flag, off until this ships.

## 5. Multi-pin LED layout — several output pins, one flat buffer

A controller may drive LEDs on **several GPIO pins**. Concatenate them into ONE contiguous buffer so
it still matches led-object-service's single-`numberOfPixels`-buffer-per-thing model:

```
pins:[{gpio,count}]  →  buffer index 0..count0-1 = pin0, count0..count0+count1-1 = pin1, …
```

**Invariant:** `sum(count)` MUST equal the object-service `numberOfPixels`, and **led-object-service
is the geometry authority** — `pins` in NVS is only the physical routing table.

**On counts:** the website registry declares pins **without a count** (the user shouldn't have to
count LEDs). Per-pin counts are learned by the **camera-mapping** stage (`ui/src/mapping/`), which
sweeps buffer indices and detects where each lights up. So the firmware should size the buffer from
object-service (as it does today; default cap) and treat `pins[].count` as optional — filled in once
mapping publishes geometry. Note the mapping stage currently caps at **1024** pixels
(`src/mapping/index.ts` `MAX_CAP`); raise it there for installations larger than that.

## 6. `next_url` after Wi-Fi join

The Improv `PROVISIONED` result's first string should be a URL back to **our** site so the React app
resumes the KivSee config step, e.g. `https://kivsee.iddofroom.co.il/onboard?mac=<mac>&chip=<chip>` —
not a device-served IP page. (The config frame in §4 is written **before** this navigation, since
navigating forfeits the Web Serial port.)

---

## Website side (already built, waiting on the above)

- `cf-worker/worker.js` serves `/firmware/manifest.json` (placeholder `builds: []`) same-origin.
- `ui/src/onboard/FlashController.tsx` loads esp-web-tools once `builds` is non-empty; else shows a
  graceful "not published yet" panel; feature-detects Web Serial (Chromium desktop only).
- `ui/src/onboard/ControllerSetup.tsx` + the device-registry KV routes store `{ thing, pins }` per
  project — the source the config frame (§4) will send to the device.
