# From bare LEDs to a music-synced installation — the flow

The full journey a user takes on **kivsee.iddofroom.co.il**, from a pile of parts to a running,
beat-synced light sculpture. Each step is a stage on the project home screen
(`ui/src/shell/ProjectHome.tsx`). Status is derived live, so stages light up as you complete them.

| # | Step | Where | State |
|---|------|-------|-------|
| 1 | Sign in | Clerk | ✅ built |
| 2 | Install & configure controllers (ESP32) | `onboard` view | ✅ registry + flasher scaffold built; ⏳ flashing waits on firmware binaries |
| 3 | Set up the Raspberry Pi (image) | download / image | ✅ script bundle today; ⏳ one-click `.img` designed, not built |
| 4 | Map the LEDs with the camera | `mapping` view | ✅ built |
| 5 | Pick a song | `songs` view | ✅ built |
| 6 | Generate the first animation (AI) | editor | ✅ built |
| 7 | Refine & edit | editor | ✅ built |
| 8 | Wire the installation flow (buttons / RFID) | (planned) | 🎨 designed, not built |

---

## 1 · Sign in
Google/Clerk login. Projects and every artifact (songs, mapping, devices) are scoped per project
with admin/member roles.

## 2 · Install & configure controllers
Like WLED. On the **Set up the controllers** screen (`ui/src/onboard/ControllerSetup.tsx`):

- **Install firmware** — plug an ESP32 into the computer over USB and flash it from the browser
  (esp-web-tools + Web Serial, Chrome/Edge desktop). *Turns on once firmware binaries are published —
  see [`firmware/README.md`](../firmware/README.md).* Until then it shows a clear "not yet" panel and
  you flash with PlatformIO.
- **Declare the controller** — give it a **name** and list the **GPIO output pins** wired to LED
  strips. You do **not** enter a LED count — the camera mapping (step 4) discovers that.

The declaration is stored per project (device-registry KV routes in `cf-worker/library.js`). One ESP
= one "controller" whose pins concatenate into a single flat LED buffer.

## 3 · Set up the Raspberry Pi
The Pi runs the control-server + tunnel that the website reaches. **Today:** download the host bundle
and run `bash led-rings-host.sh` (see `remote-deploy/FRIEND-SETUP.md`). **Planned:** a downloadable
`.img` you write with Raspberry Pi Imager / balenaEtcher and boot headless, with the tunnel token
injected securely at first boot (never baked into the shared image). Build pipeline designed in the
architecture notes; pi-gen stage + first-boot provisioner are the next host-side work.

## 4 · Map the LEDs
Aim the computer camera at the installation. The tool lights each LED one at a time (through the Pi →
the KivSee services → the ESPs, no firmware change) and detects each lit LED's (x,y) from the camera,
building a full position map. See the mapping stage (`ui/src/mapping/`, `src/mapping/`) and the
architecture doc. A **Demo mode** runs the whole flow offline with no hardware.

## 5 · Pick a song
Upload an MP3/WAV to the project's cloud library, or pick an existing one.

## 6 · Generate the first animation (AI)
The pipeline analyzes the audio (beats, downbeats, sections, energy), applies a taste model + LLM,
and produces a beat-synced timeline — the first draft you'll refine.

## 7 · Refine & edit
Edit the timeline: adjust effects per section, re-roll a section, branch/save versions. Manual edits
are preserved when a section is regenerated.

## 8 · Wire the installation flow (buttons / RFID)
*Planned.* A visual builder where you add physical inputs (buttons, RFID readers) and define logic —
"RFID tag X → play song Y", "button → next pattern" — over the existing sensor MQTT topics
(`sensors/rfid/…`) and trigger/playback. Crucially, the interface also **tells you how to wire the
electronics** (which GPIO, pull-ups, a wiring diagram) from your declared pins and chosen sensors.

---

### What's the critical path?
Steps 4–7 are built and working. Step 2's **configuration** (name + pins) and the device registry are
built now; step 2's **flashing** and the WLED-style end-to-end demo are blocked only on **firmware**
(the KivSee `esp32-animations` changes in `firmware/README.md`). Step 3's one-click image and step 8's
visual builder are designed and are the next host/website-side work — neither depends on firmware.
