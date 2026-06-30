# Music → LED composition pipeline

Audio in → a beat-synced LED composition you refine. The **emotion/taste is yours**
(`taste/rules.yaml`); the tools are the arm that applies your style to a new song's
structure. Everything stays inside the Phase-0 round-trip contract, so code ↔ visual
timeline stay in sync.

```
  audio.mp3
     │  scripts/analyze_music.py        (deterministic MIR — librosa, no LLM)
     ▼
  <song>.analysis.json                  beats, downbeats, bpm, sections+energy, curves
     │  scripts/translate.py + taste/rules.yaml   (beat-synced pattern generator)
     ▼
  <song>.song.json   { song, timeframes }         canonical, SAFE-list only
     │  ui/src/generateSequenceTs.ts               ┌────────────────┐
     ▼                                              │ round-trip      │  guaranteed by
  src/songs/<song>.ts                               │ JSON ↔ TS ↔ JSON │  docs/round-trip-contract.md
     │  src/recorder/parse-song.ts                  └────────────────┘  + `yarn roundtrip`
     ▼
  { song, timeframes }  (identical for the SAFE set)
```

## One command

```bash
yarn compose "src/audio/your-song.mp3" [--seed N] [--section N] [--llm] [--explain] [--rules path] [--bpm N] [--no-ts] [--open]
```

Runs analyze → translate → writes `<song>.analysis.json`, `<song>.song.json`, and
`src/songs/<song>.ts`. Deterministic, instant, no API key. `--llm` lets Gemini choose
the pattern + palette per section (needs `GEMINI_API_KEY`). `--seed` reproduces a run.

## In the browser (the daily driver)

Run the control server (`CONTROL_SERVER_PORT=8088 npm run control-server`, or
double-click `compose-dev.cmd`) and the UI (`cd ui && npm run dev`), then click the
floating **🎵 Compose** button:

1. **Analyze** an audio file → review the detected sections, energy curve, beats/
   downbeats, and ear-check against the inline audio player.
2. **Edit `taste/rules.yaml`** in the panel (Save) — choose which patterns/palettes
   each section may use.
3. **Generate** → the composition loads straight into the timeline. Each Generate is a
   new random variation; check **Use Gemini** to let Gemini pick patterns.

## The three refinement surfaces

| Stage | What you change | How |
|---|---|---|
| **Taste** | which patterns/palettes a section uses; randomness | edit `taste/rules.yaml` (in the Compose panel or on disk), regenerate |
| **Per-effect** | one timeframe's params / effect / ring / color | edit it in the timeline or the .ts — survives a round-trip (`yarn roundtrip`) |
| **Structure** | the section→pattern mapping for a single part | regenerate one section (`--section N` / per-part reroll) |

## Where taste lives — `taste/rules.yaml`

Per section (`intro/build/drop/breakdown/chorus/verse/outro`): a list of allowed
**patterns** and **palettes**. The translator picks randomly each run (`randomness`
knob). Patterns are SAFE, beat-aligned, and modelled on `src/songs/loop.ts`:

- `build_up` — rings light up one-by-one on beats and stay on (rising)
- `accumulate` — build_up + each ring pulses as it joins
- `sweep` — a lit ring sweeps across, one at a time
- `per_ring_blink` — every ring blinks on its own staggered cycle
- `snake_seg` — a snake runs a segment (centric/arc/rand/ind/updown) on a cycle
- `pulse_beat` — all rings pulse on the beat (drops/choruses)
- `solid_fade` — one solid colour + fade envelope (calm)

`taste/learned-patterns.json` (from `npx ts-node scripts/mine-taste.ts`) is mined
reference material from `src/songs/*` — what our corpus actually uses. Rules override it.

## Round-trip guarantees

The generator may only emit effects/structures certified in
[round-trip-contract.md](round-trip-contract.md) §4 (SAFE list). The translator stays
inside it by construction (per-ring timeframes instead of movement; plain `cycle`;
snake/blink/pulse/fade/hue). `yarn roundtrip` guards it: SAFE per-effect grid + clean
song corpus + the full pipeline (analysis → translate → TS → parse) must round-trip.

## Files

| Path | Role |
|---|---|
| `scripts/analyze_music.py` | MIR analysis → `<song>.analysis.json` (schema: `docs/analysis-schema.json`) |
| `scripts/translate.py` | analysis + rules → `<song>.song.json` (beat-synced patterns) |
| `scripts/compose.ts` | `yarn compose` one-command driver |
| `scripts/mine-taste.ts` | mine `src/songs/*` → `taste/learned-patterns.json` |
| `scripts/roundtrip-check.ts` | `yarn roundtrip` contract guard |
| `taste/rules.yaml` | **your taste** — section → patterns/palettes |
| `ui/src/components/ComposePanel.tsx` | the in-browser Compose flow |
| `src/control-server.ts` | `/api/analyze`, `/api/taste-rules`, `/api/translate` |
| `docs/round-trip-contract.md` | the authoritative SAFE-emit contract |
