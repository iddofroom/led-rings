# Taste model (PHASE 2)

The taste comes from **you**, not the model. This directory is the single source of
that taste. The translator (Phase 3) is just the arm that applies your style to a new
song's analyzed structure.

## Files

- **`rules.yaml`** — *yours to own and edit.* Explicit human-authored mapping from
  `section.label` + energy/onset/spectral features → effect palette, colour strategy,
  motion, brightness envelope. The committed version is a transparent **first draft**;
  overwrite it. Only Phase-0 SAFE-list effects may be referenced (the file lists the
  allowed palette at the top).
- **`learned-patterns.json`** — *auto-generated, do not hand-edit.* Audio-independent
  structural patterns mined from `src/songs/*` via the recorder (`scripts/mine-taste.ts`):
  how our existing songs actually use effects, colours, mappings, cycles, motion, phase,
  and timeframe durations. This is **reference material** given to the translator as
  context, NOT a black-box model.

## Precedence

**`rules.yaml` overrides `learned-patterns.json` on any conflict.** The mined patterns
fill gaps and supply defaults / vocabulary priors; your explicit rules win.

## Regenerate the mined patterns

```
npx ts-node scripts/mine-taste.ts        # -> taste/learned-patterns.json
```

## What the corpus currently shows (mined 2026-06, 442 timeframes, 5 songs)

- **Brightness-driven:** `fadeOut`/`fadeIn` dominate (envelopes everywhere); `pulse`,
  `blink`, `fadeInOut` for rhythm.
- **Colour movement:** `hueShiftStartToEnd` + `position_hue` frequently paired (gradient
  sweeps); `staticHueShift` for fixed tints.
- **Motion:** `snakeFillGrow` and `snake` are the staples.
- **Mapping:** mostly `all`, with `arc` / `rand` / `centric` / `ind` for variety.
- **Palette:** red-dominant, then blue/violet/cyan.
- **Structure:** ~half the timeframes are "modifiers only" (no own colour); the most
  common cycle is `beatsInCycle: 1`; median timeframe ~4 beats.

## Pending (needs audio)

`learned-patterns.json` is **audio-independent**: it captures *what* we use, not *under
which musical condition*. The plan also wants the effect ↔ section/energy alignment
("effect X tends to appear under condition Y"). That requires each corpus song's audio
run through `scripts/analyze_music.py` and the timeframes aligned to the resulting
sections/energy. The corpus songs (aladdin/loop/togual/buttons) have no audio in the
repo yet; drop their audio in and we can extend the miner to add the alignment.
(`src/audio/` currently holds the *target* track to compose for, not corpus examples.)
