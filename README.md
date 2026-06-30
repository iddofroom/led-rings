# led-rings

Software for **KivSee's 12 big-ring LED installation** — turn a song into a beat-synced
light show, perform it live, and drive the physical LEDs. Originally a CLI for sending
hand-coded sequences; it now includes a full visual editor, an audio→LED composition
pipeline, a cloud song library, and a fullscreen live VJ console.

The rings are 12 "big rings", each made of 12 sub-rings of 12 pixels. Effects are described
as **timeframes** (`{startTime, endTime, rings, color, effects[], cycles[]}`) that the
renderer plays back on the hardware.

---

## What's in here

| Area | What it does |
|---|---|
| **Timeline UI** (`ui/`) | React app to author a show: place timeframes on a timeline, pick effects/colors/cycles, preview on a 12-ring visualizer, play audio in sync, send to the LEDs. |
| **Compose pipeline** (`scripts/`) | Audio → MIR analysis → taste-driven, beat-synced LED composition. Deterministic + optional Gemini LLM. Strictly round-trip-safe. |
| **Pattern library** | Browse/curate a library of reusable patterns (presets), edit a pattern's name/speed/colors, and build a per-song animation set. |
| **Live Console** | Fullscreen VJ surface: pattern pads, a multi-lane timeline, drag-to-paint, speed curves, a spectrogram strip with section lines, and auto-push to the LEDs. |
| **Cloud library** (`cf-worker/`) | Every uploaded MP3, its analysis, AI output and saved animations stored in Cloudflare KV — shared between local dev and the live tool. |
| **Remote access** (`cf-worker/`, `remote-deploy/`) | Operate the rings from `https://leds.iddofroom.co.il` via a Cloudflare Worker + tunnel; a friend runs a tiny host bundle. |
| **Control server** (`src/control-server.ts`) | HTTP bridge the UI talks to: analyze/translate audio, run/stop sequences, beat detection, brightness (MQTT), save files. |

---

## Architecture

```
                  ┌─────────────── browser (UI) ───────────────┐
                  │  Timeline editor · Pattern library · 🎵 Compose · 📚 Library · 🎛️ Live Console │
                  └───────┬───────────────────────────────────┬───┘
        /api/library/* (KV)│                                   │/api/* (analyze, translate,
                           ▼                                   │ send-sequence, brightness…)
              ┌──────────────────────┐                         ▼
              │ Cloudflare Worker     │              ┌──────────────────────┐
              │ leds-frontdoor + KV   │              │ control-server (TS)   │
              │ (song library)        │              │  ├─ analyze_music.py  │  (MIR)
              └──────────────────────┘              │  ├─ translate.py      │  (taste→LED, Gemini)
                                                     │  └─ services/* ──────►│  LEDs (object/sequence/
                                                     └──────────────────────┘   trigger services, MQTT)
```

- **Locally**: `ui` (Vite, port 5173) talks to the control server (port 8088). The cloud
  library is reached at its absolute Worker URL (`VITE_LIBRARY_URL`).
- **Remotely**: a friend's PC runs `bridge.js` (serves the built UI + proxies `/api/*` to
  the control server) behind a Cloudflare tunnel; the `leds-frontdoor` Worker proxies the
  live app and serves the library API from KV. When the host is down it serves a landing page.

---

## The composition pipeline

`audio → analyze_music.py → <song>.analysis.json → translate.py (+ taste/rules.yaml) → {song, timeframes} → generateSequenceTs → src/songs/<song>.ts → parse-song → JSON`

One command: `yarn compose "<audio>"`. Guard: `yarn roundtrip`.

- **`scripts/analyze_music.py`** — deterministic DSP (librosa): beats, downbeats, global +
  per-section + dynamic BPM, beat-synced sections with heuristic labels, and energy / onset /
  centroid / band-energy (sub·low·mid·high) curves. See `docs/analysis-schema.json`.
- **`scripts/translate.py`** — applies the **taste** (`taste/rules.yaml`: per-section pattern
  + palette lists) to the analysis and emits a canonical `{song, timeframes}` composition,
  per-section, downbeat-snapped. Deterministic by default; `--llm` lets **Gemini** pick the
  pattern+palette per section (falls back to rules if no key). The human owns the taste — the
  model only maps structure → effects.
- **Round-trip contract** (`docs/round-trip-contract.md`) — every generated effect must
  survive `JSON ↔ TS ↔ JSON`. Only a vetted SAFE set of effects is ever emitted. `yarn
  roundtrip` guards this.

The taste is mined from example songs (`scripts/mine-taste.ts` → `taste/learned-patterns.json`),
not baked into prompts or code.

---

## The UI (`ui/`)

A React + Vite timeline editor. Highlights:

- **Timeline** — drag timeframes, set start/end, rings, color (HSV), effects, cycles; section
  dividers from the composition; undo/redo; autosave.
- **Playback** — 12-ring visualizer, audio synced to beats, live brightness (MQTT), "Send to
  LEDs", a fullscreen view.
- **🎵 Compose** — analyze an audio file, ear-check the detected structure, edit the taste
  rules in-app, and generate a first-draft composition into the timeline (Gemini).
- **📚 Library** — every song you've worked on, with its analysis, audio and saved animations
  (see below).
- **Pattern library** (main "settings" page) — browse every preset, **preview** it animated
  on the rings, **edit its name / speed / colors** (persisted per pattern), and **add it to
  the song** — building the song's own animation set. Curate per song (hide) or globally;
  import pattern JSON.

### 🎛️ Live Console (fullscreen VJ surface)

Open with the ⛶ button. Built for performing + fast editing:

- **Pattern rail** — editable/curatable pads (rename, pin/unpin to the top), the song's own
  animations (🎬), and the full preset library; a 🎲 Random pad.
- **Multi-lane timeline** — one lane for ALL rings + one per ring (1–12). Drag a pad onto a
  lane to paint a timeframe; an ALL pattern shows only on the ALL lane. Zoom (ctrl+scroll),
  drag empty space to pan, click a block to edit it, drag a block's edges to resize (beat-snap).
- **Block editor** — change pattern / color / palette / **speed** (continuous slider) / fades
  (in/out) / **speed curve** (accelerate · decelerate · ease · manual graph, xLights-style);
  trim; "apply to ALL blocks".
- **Spectrogram strip** — the analysis energy + frequency bands over the song; **right-click**
  to add white **section lines** (every 1/2/4/8/16 beats or one at a time). Patterns snap to
  them, and **↻ Recompose** regenerates against them — from the song's own animations when it
  has any, otherwise the server (Gemini).
- Edits auto-push to the LEDs (debounced); LEDs render true-black when off.

---

## Cloud song library (`cf-worker/`)

A persistent workbench backed by **Cloudflare Workers KV** (namespace `LED_LIBRARY`), served
by the `leds-frontdoor` Worker under `/api/library/*` — one library shared by local dev and the
live tool. Per song it stores `meta`, `analysis`, the `audio` (MP3 bytes), the auto-saved
`working` timeline, named `comp:` animations, and a git-like `ver:` version history.

- `cf-worker/worker.js` — front door (proxy live host / landing page / gated host-bundle
  download) **+** intercepts the library API at the edge.
- `cf-worker/library.js` — the KV-backed library (`handleLibrary`).
- Deploy: `cd cf-worker && npx wrangler deploy`. (`cf-worker/` is not part of the npm build.)

---

## Setup & running

### 1. LED services

```sh
cat > .env <<EOF
LEDS_OBJECT_SERVICE_IP=<leds object service ip>
SEQUENCE_SERVICE_IP=<sequence service ip>
TRIGGER_SERVICE_IP=<trigger service ip>
GEMINI_API_KEY=<optional, for the LLM compose path>
EOF

yarn
yarn sync-segments     # push ring segments
```

### 2. Compose pipeline (Python)

```sh
pip install -r scripts/requirements.txt   # librosa, numpy, google-generativeai (optional)
yarn compose "src/audio/My Song.mp3"       # full audio → LED composition
yarn roundtrip                             # guard: SAFE set + full pipeline (must stay green)
```

### 3. The editor

```sh
yarn control-server                  # HTTP bridge on port 8088 (set CONTROL_SERVER_PORT)
cd ui && npm install && npm run dev   # Vite UI on 5173  (ui/.env: VITE_API_URL, VITE_LIBRARY_URL)
```

Open http://localhost:5173 → 🎵 Compose / 📚 Library / ⛶ Live Console.

### 4. Remote access

The live tool runs at `https://leds.iddofroom.co.il` (Cloudflare Worker + tunnel). The host
bundle (`remote-deploy/`, served from the Worker's gated `/download`) is what a friend runs on
the PC wired to the rings. See `remote-deploy/FRIEND-SETUP.md`.

---

## Beat detection (standalone)

The control server auto-detects a Python with librosa (the `PYTHON` env var, `python`/`python3`
on PATH, or any `~/.virtualenvs/*/`). Use the **Detect Beats** button in the UI, or:

```sh
python scripts/detect_beats.py path/to/audio.wav   # writes <audio>.beats.json (loadable in the UI)
```

When detected beats are present, beat→time uses the timestamps instead of fixed BPM (handles
variable-BPM songs — see `docs/beat-detection-variable-bpm.md`).

---

## Useful scripts

| Command | Purpose |
|---|---|
| `yarn compose "<audio>"` | One-command audio → LED composition |
| `yarn roundtrip` | Round-trip + full-pipeline guard (keep green) |
| `yarn control-server` | The HTTP bridge the UI uses |
| `yarn sync-segments` | Push ring segment definitions |
| `yarn stop` | Stop playback on the device |
| `npm run dev` (in `ui/`) | The editor |
| `npx wrangler deploy` (in `cf-worker/`) | Deploy the Worker + library |

## Docs

- `docs/pipeline.md` — the composition pipeline in depth
- `docs/round-trip-contract.md` — the SAFE effect set + why
- `docs/analysis-schema.json` — the analysis JSON schema
- `docs/beat-detection-variable-bpm.md`, `docs/overlapping-brightness-effects.md`
- `taste/README.md` — the taste model
