---
name: led-pipeline
description: Use when working on the KivSee led-rings music→LED composition pipeline — analyzing audio, generating/translating LED compositions, editing taste rules, or emitting timeframe effects. Loads the round-trip contract so generated effects stay SAFE and reversible. Triggers include analyze_music.py, translate.py, taste/rules.yaml, generateSequenceTs, parse-song, ComposePanel, "compose a song", "LED pattern", "beat-synced animation".
---

# LED composition pipeline — agent contract

The pipeline turns audio into a beat-synced `{song, timeframes}` LED composition. The
**taste is the human's** (`taste/rules.yaml`); your job is to apply it under a strict
round-trip contract. Read `docs/pipeline.md` and `docs/round-trip-contract.md` first.

## The flow

`audio → scripts/analyze_music.py → <song>.analysis.json → scripts/translate.py (+ taste/rules.yaml) → <song>.song.json → generateSequenceTs → src/songs/<song>.ts → parse-song → JSON`.
One command: `yarn compose "<audio>"`. Guard: `yarn roundtrip`.

## HARD RULE — only emit SAFE-list effects

Any generated timeframe/effect MUST round-trip JSON↔TS↔JSON. Emit ONLY
(docs/round-trip-contract.md §4):

- **Color:** `constColor` (timeframe.color + `hasExplicitColor:true`); "no color".
- **Brightness:** `brightness, fadeIn, fadeOut, fadeInOut, fadeOutIn, blink, pulse, fade`.
- **Hue:** `staticHueShift, hueShiftStartToEnd, hueShiftSin`.
- **Motion:** `snake, snakeHeadMove, staticSnake, snakeHeadSin, snakeHeadSteps, snakeSlowFast, snakeTailShrinkGrow` (+ `snakeInOut`/`snakeFillGrow` standalone, NOT in movement).
- **Raw** `timed_*`/`position_*`/`snake_*` ONLY with FloatFunc kinds `const_value/linear/sin/steps`.
- **Structure:** any `rings`; mapping in `all/arc/ind/b1/b2/centric/updown/rand`; plain `cycle`; `cycleBeats` (fixed); `phase` ONLY on a color-only timeframe; fixed-BPM or `beatTimestampsMs` beats (recorder inversion fixed).

### NEVER emit
- `movement` (stagger/random never round-trip; spread/sweep only heuristically) — use
  explicit **per-ring timeframes** instead (this is how the patterns build "movement").
- `phase` on a timeframe that also has `effects[]`, or per-effect `phase` (splits the tf).
- `rainbow` as an effect (use `constColor` + `position_hue` linear).
- `snakeBrightness/snakeSaturation/snakeHue` helper keys (generator drops them; use raw `snake_*`).
- raw FloatFunc `half`/`comb2`.

## Taste = `taste/rules.yaml` — never hardcode it

Per section: lists of allowed **patterns** (`build_up, accumulate, sweep,
per_ring_blink, snake_seg, pulse_beat, solid_fade`) + **palettes**. The translator
picks randomly (`randomness`, `--seed`). Patterns emit per-ring, beat-aligned
timeframes modelled on `src/songs/loop.ts`. To add expressiveness, add a pattern
generator in `translate.py` (must stay SAFE) and list it in `rules.yaml` — do NOT bake
taste into prompts or TS.

## When you change recorder / generator / effects
Run `yarn roundtrip` (must stay green) — it guards the SAFE set, the clean song corpus,
and the full analysis→translate→TS→parse pipeline.
