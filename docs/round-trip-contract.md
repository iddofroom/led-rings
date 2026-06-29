# Round-Trip Contract (PHASE 0)

> **Status:** Audit complete. This is the authoritative list of what is safe for a generator
> to emit. The composition pipeline (Phases 1–5) may **only** emit effects/structures marked
> ✅ SAFE below. Anything ⚠️ or ❌ must be fixed first or avoided.
>
> **Scope of "round-trip":** the canonical loop the pipeline depends on is
> `{song, timeframes}` JSON → **generator** ([ui/src/generateSequenceTs.ts](../ui/src/generateSequenceTs.ts)) → `.ts` → **recorder** ([src/recorder/recorder.ts](../src/recorder/recorder.ts) via [src/recorder/parse-song.ts](../src/recorder/parse-song.ts)) → JSON.
> The contract is **JSON↔JSON stability** through that loop.

---

## 0. How the round-trip actually works (and a correction to the plan)

The plan lists `shared/preset-conversion.ts` as "the reverse path (TS→JSON)". **That is wrong and
worth flagging.** There are two unrelated reverse implementations in this repo:

1. **The recorder** ([recorder.ts](../src/recorder/recorder.ts) + [parse-song.ts](../src/recorder/parse-song.ts) + [effect-key-map.ts](../src/recorder/effect-key-map.ts)) —
   the real TS→JSON path. It *executes* the song with `setRecordingMode(true)`; each effect
   function calls `tagEffect(key, params)`, and `addEffect` forwards that tag to
   `recorder.recordEffect`. This is the path `export-song.ts` and the UI import use.
2. **[shared/preset-conversion.ts](../shared/preset-conversion.ts)** — a *preset*→timeframes
   importer (`FloatFunc` JSON → timeframes) for the preset browser and
   `generate-category-ui-song.ts`. It has its **own** reverse mappers (`reverseMapBrightness`,
   `reverseMapSnake`, …) that are a **third** representation and can drift from the recorder.

**The contract below is pinned to the recorder path.** preset-conversion is out of scope for
round-trip correctness; if a future phase relies on it, it needs its own audit.

There are also **zero automated tests** in this repo (`package.json` `test` script just runs
`src/test.ts`). The round-trip has no executable guard today — recommend adding one (Phase 4
already calls for it; it should arguably exist now as the executable form of this contract).

---

## 1. Empirical results

Every song in `src/songs/*.ts` was run through `JSON_A = recorder(song)` →
`TS' = generator(JSON_A)` → `JSON_B = recorder(TS')`, then `JSON_A` and `JSON_B` were
structurally diffed (ids/labels stripped, numbers rounded to 2 dp, effects sorted).

| Song | timeframes | matched A↔B | unmatched | verdict |
|---|---|---|---|---|
| `agent` | 0 | 0 | 0 | n/a — **empty stub** (`// Empty animation`), no content |
| `togual` | 8 | **8** | 0 | ✅ perfect |
| `aladdin` | 134 | **134** | 0 | ✅ perfect |
| `buttons` | 213 | 172 | 41 | ⚠️ lossy — `cycleBeats`, `rainbow`+phase, movement |
| `loop` | 120 | **0** | 120 | ❌ total — `beatTimestampsMs` (variable-BPM) breaks timing |

The clean corpus (`togual`, `aladdin`) is **fixed-BPM, plain `cycle`, no movement, no
rainbow-with-phase**. `aladdin` exercises a wide vocabulary (constColor, fadeIn/Out/InOut/OutIn,
blink, brightness, fade, staticHueShift, hueShiftStartToEnd, snake, snakeHeadMove, staticSnake,
snakeInOut, snakeFillGrow, plain `cycle`, raw `position_hue`) and still round-trips 134/134 — that
vocabulary is the proven-safe core. `buttons` and `loop` isolate the four breaks (§3).

---

## 2. Effect-by-effect table

Legend: ✅ lossless · ⚠️ works with caveats · ❌ broken. "Params" = what the recorder records
and the generator re-emits.

### 2.1 Color (lives on `timeframe.color` + `hasExplicitColor`, **not** in `effects[]`)

| Source fn | Recorder result | RT | Notes |
|---|---|---|---|
| `constColor({hue,sat,val})` | sets `tf.color` (hex), `hasExplicitColor=true` | ✅ | HSV↔hex via 4-dp; stable (proven by togual/aladdin) |
| *(no color fn / "modifiers only")* | `hasExplicitColor=false`, no constColor emitted | ✅ | color hex intentionally dropped |
| `noColor()` | `tf.color="#000000"`, explicit | ✅* | generator never *emits* `noColor()`; only hand-written songs hit this |
| `vivid` / `pastel` | folded into `tf.color` | ✅* | never emitted as an effect entry by the generator |
| `rainbow()` | `tf.color` + a `position_hue` effect | ⚠️ | see §3.4 — lossy when per-ring phase present |

### 2.2 Brightness `effects[]` (first-class UI effects)

| effectKey | params | RT |
|---|---|---|
| `brightness` | `{value}` | ✅ |
| `fadeIn` | – | ✅ |
| `fadeOut` | – | ✅ |
| `fadeInOut` | `{high?}` | ✅ |
| `fadeOutIn` | `{low?}` | ✅ |
| `blink` | `{low?}` | ✅ |
| `pulse` | `{low?, staticPhase?}` | ✅ |
| `fade` | `{start, end}` | ✅ |

### 2.3 Hue `effects[]`

| effectKey | params | RT |
|---|---|---|
| `staticHueShift` | `{value}` | ✅ |
| `hueShiftStartToEnd` | `{start, end}` | ✅ |
| `hueShiftSin` | `{amount}` | ✅ |

### 2.4 Motion `effects[]`

| effectKey | params | RT | Notes |
|---|---|---|---|
| `snake` | `{tailLength, cyclic, reverse}` | ✅ | |
| `snakeHeadMove` | `{start, end, tail}` | ✅ | |
| `staticSnake` | `{start, end}` | ✅ | |
| `snakeHeadSin` | `{tailLength, cyclic}` | ✅ | |
| `snakeHeadSteps` | `{steps, tailLength}` | ✅ | |
| `snakeSlowFast` | `{tailLength}` | ✅ | |
| `snakeTailShrinkGrow` | – | ✅ | |
| `snakeFillGrow` | `{reverse?}` | ⚠️ | effect itself round-trips (proven in aladdin); `reverse:false`↔`{}` normalizes; **breaks only when wrapped in `movement`** (§3.3) |
| `snakeInOut` | `{start?, end?}` | ⚠️ | key+params round-trip, but `start`/`end` are **no-ops at runtime** (the impl ignores them and always sweeps a sin 0→1). Don't rely on the params meaning anything. |

### 2.5 Raw / advanced `effects[]` (emitted as `addEffect({key:{…}})`, no `tagEffect`)

These are recorded by `addEffect`'s fallback branch (object key = effectKey, value = params).

| effectKey | params shape | RT | Notes |
|---|---|---|---|
| `timed_brightness` | `{mult_factor_decrease\|increase: FloatFunc}` | ✅† | |
| `timed_hue` | `{offset_factor: FloatFunc}` | ✅† | (also the target of the `hue→timed_hue` alias) |
| `timed_saturation` | `{mult_factor_*: FloatFunc}` | ✅† | (alias target of `saturation`) |
| `position_brightness` | `{mult_factor_*: FloatFunc}` | ✅† | |
| `position_hue` | `{offset_factor: FloatFunc}` | ✅† | proven in aladdin (7×) |
| `position_saturation` | `{mult_factor_*: FloatFunc}` | ✅† | |
| `snake_brightness` | `{head, tail_length, cyclic, mult_factor_*}` | ✅† | requires `mult_factor_*` or emits nothing |
| `snake_hue` | `{head, tail_length, cyclic, offset_factor}` | ✅† | requires `offset_factor` or emits nothing |
| `snake_saturation` | `{head, tail_length, cyclic, mult_factor_*}` | ✅† | |

**† Critical FloatFunc caveat:** the generator's `formatFloatFunction` only serializes
`const_value`, `linear`, `sin`, and `steps`. A FloatFunc of kind **`half` or `comb2` is silently
replaced with `const_value:{value:1}`** on the way out → **lossy**. So raw effects are safe
**only if** their inner FloatFunc is one of the four supported kinds. (`half`/`comb2` are produced
internally by `fadeInOut`, `blink`, `snakeFillGrow`, `snakeSlowFast`, `snakeTailShrinkGrow` — but
those are emitted via their named helpers, not as raw FloatFunc, so they're fine. The danger is a
generator emitting a *hand-built* raw effect with a `half`/`comb2` factor.)

### 2.6 Structure / non-effect dimensions

| Dimension | RT | Notes |
|---|---|---|
| Beat times, **fixed BPM** | ✅ (to 0.1 beat) | `msToBeats` rounds to nearest 0.1 beat — sub-0.1 precision is lost every pass, but stable |
| Beat times, **`beatTimestampsMs`** (variable BPM) | ❌ | **drifts every pass** — see §3.1 |
| `rings` (`all/even/odd/left/right/center`/explicit list) | ✅ | `mergeIdenticalRings` recombines per-ring blocks |
| `mapping` (`all/arc/ind/b1/b2/centric/updown/rand`) | ✅ | |
| `phase` (simple, on an effect or color) | ✅ | proven in aladdin/togual |
| `cycle` (plain) | ✅ | only `beatsInCycle` |
| `cycleBeats` (windowed) | ❌ | **field-name mismatch** — see §3.2 |
| `movement` `spread`/`sweep` (≥3 uniform rings) | ⚠️ | heuristically re-detected; color/`hasExplicitColor` can drift |
| `movement` `stagger` | ❌ | recorder has no stagger detection |
| `movement` `random` | ❌ | shuffled order is undetectable |
| `movement` `retire`/`bounce`/`holdOff` | ❌/⚠️ | `holdOff` emits a literal `timed_brightness:0`, never re-collapsed |
| `disabled` timeframes | n/a | generator drops them (`filter(!disabled)`) before emit |
| `brightnessEffect/hueEffect/motionEffect` (legacy slots) | one-way | normalized into `effects[]`; never re-emitted in slot form |

---

## 3. The four breaks (with evidence)

### 3.1 ❌ `beatTimestampsMs` (variable-BPM) destroys timing — *highest severity*

The forward path ([time.ts](../src/time/time.ts) `beats()`) converts beat→ms via the
`beatTimestampsMs` **lookup table with interpolation**. The reverse path
([recorder.ts](../src/recorder/recorder.ts#L40) `msToBeats`) converts ms→beat with the **fixed-BPM
formula** `ms·bpm/60000`, ignoring `beatTimestampsMs` entirely. These are **not inverses** unless
beats are perfectly uniform.

**Evidence:** `loop.ts` source calls `beats(0, 76, …)` for ring 1. After a single
recorder pass the JSON reports `startTime: 15.2` (because `beatTimestampsMs[0]=3035ms`, and
`3035·300/60000 = 15.2`). Beat `0` → `15.2` on *one* pass; the diff matched **0 of 120**
timeframes. Each further pass re-multiplies the drift.

This is the most important finding for the pipeline: **Phase 1 is specified to emit
`beatTimestampsMs` + `downbeatTimestampsMs` + a per-section `bpmCurve`** — i.e. exactly the
variable-BPM case that today cannot survive a round-trip. The edit loop the plan is built around
is broken for any real (non-constant-tempo) song until this is fixed.

### 3.2 ❌ `cycleBeats` field-name mismatch

Recorder emits cycle entries as
`{type:'cycleBeats', beatsInCycle, startBeatInCycle, endBeatInCycle}`
([recorder.ts](../src/recorder/recorder.ts#L111)), but the generator's `wrapWithCycles` and the
`TimeframeCycleEntry` type read `{… startBeat, endBeat}`
([generateSequenceTs.ts](../ui/src/generateSequenceTs.ts#L25)). So a recorded `cycleBeats` becomes
`cycleBeats(4, undefined, undefined, …)` on re-emit.

**Evidence (buttons):** `A.cycles = [{cycle,4},{cycleBeats,4,startBeatInCycle:0,endBeatInCycle:2}]`
→ after the loop `B.cycles = undefined`. Plain `cycle` is fine; only the windowed `cycleBeats`
form breaks.

### 3.3 ⚠️/❌ `movement` reconstruction is heuristic and partial

The forward path expands a `movement` timeframe into per-ring `beats()` blocks
([generateSequenceTs.ts](../ui/src/generateSequenceTs.ts#L345)); the recorder tries to *re-detect*
the pattern geometrically (`detectMovementPatterns`). Consequences:

- `stagger` and `random`: **never** reconstructed (no detector; random order is shuffled). ❌
- `spread`/`sweep`: reconstructed only with **≥3 rings at uniform intervals**; fewer rings stay as
  separate single-ring timeframes. ⚠️
- `retire`/`bounce`/`holdOff`: partial; `holdOff` (random+retire) emits a literal
  `timed_brightness:{mult_factor_decrease:{const_value:{value:0}}}` that is recorded as an ordinary
  effect, never re-collapsed. ❌
- Even when geometry matches, `color`/`hasExplicitColor` on the merged timeframe can differ.

**Evidence (buttons):** a `snakeFillGrow` timeframe with `movement:{spread,forward,retire}` came
back with `hasExplicitColor` flipped and failed to match. Note `snakeFillGrow` itself round-trips
fine **outside** movement (aladdin, 12×).

### 3.4 ⚠️ `rainbow` → `position_hue` + per-ring phase

`rainbow()` is lowered by the recorder to a base color + a `position_hue` linear effect
([recorder.ts](../src/recorder/recorder.ts#L185)). With multi-ring per-ring hue progression the
phase-detection heuristics (`detectPhase`) don't always invert cleanly, so the timeframe doesn't
match. The safe alternative is to emit **`constColor` + `position_hue {offset_factor:{linear}}`
directly** (that pair *is* lossless — see aladdin), not `rainbow`.

---

## 4. Authoritative SAFE-TO-EMIT list (the generator's allowed vocabulary)

A Phase 3 generator may emit **only** the following and stay lossless:

**Color**
- `constColor` (i.e. set `timeframe.color` + `hasExplicitColor:true`)
- "no color" (`hasExplicitColor:false`, no color effect)

**Brightness** — `brightness`, `fadeIn`, `fadeOut`, `fadeInOut`, `fadeOutIn`, `blink`, `pulse`, `fade`

**Hue** — `staticHueShift`, `hueShiftStartToEnd`, `hueShiftSin`

**Motion (non-movement)** — `snake`, `snakeHeadMove`, `staticSnake`, `snakeHeadSin`,
`snakeHeadSteps`, `snakeSlowFast`, `snakeTailShrinkGrow`

**Raw modifiers** — `timed_*`, `position_*`, `snake_*` **only** with FloatFunc kinds
`const_value` / `linear` / `sin` / `steps`. (`constColor` + `position_hue` linear = the safe way to
do a rainbow gradient.)

**Structure** — any `rings` subset; any `mapping` in
`all/arc/ind/b1/b2/centric/updown/rand`; simple `phase`; plain `cycle`; **fixed-BPM** beat times,
authored to a **0.1-beat grid** (finer precision is silently rounded).

### Conditionally safe (use deliberately)
- `snakeInOut` — fine, but its `start`/`end` params do nothing; don't encode meaning in them.
- `snakeFillGrow` — fine standalone; **not** inside a `movement` timeframe.

### ❌ DO NOT EMIT until fixed
- Beat numbers tied to `beatTimestampsMs` / variable BPM (§3.1).
- `cycleBeats` windowed cycles (§3.2).
- Any `movement` (`stagger`/`random` always; `spread`/`sweep` only via fragile heuristic) (§3.3).
- `rainbow` as an effect (use `constColor` + `position_hue` linear instead) (§3.4).
- Raw modifiers whose FloatFunc is `half` or `comb2` (§2.5).

---

## 5. Proposed minimal fixes (NOT built in Phase 0 — for review)

Ordered by value-to-cost. Each lists the round-trip cost.

1. **Fix `beatTimestampsMs` inversion (recorder).** Make `msToBeats` invert beat→ms using the
   *same* `beatTimestampsMs` lookup + interpolation (binary search the array, interpolate the
   fractional beat), falling back to fixed-BPM only when the array is absent. Localized to
   `recorder.ts`; unblocks **all** real (variable-tempo) songs and the entire Phase 1→4 loop.
   **Highest priority — the pipeline's premise depends on it.**

2. **Fix `cycleBeats` field names.** Rename recorder output to `startBeat`/`endBeat` (or have the
   generator/type accept both). Trivial; check the UI timeline consumers read the same names.

3. **Raise beat precision.** `msToBeats` rounds to 0.1 beat; make it 0.01 (or configurable) so
   off-grid hits survive. Trivial.

4. **Make `movement` round-trip explicitly.** Two options:
   (a) emit a machine-readable movement marker the recorder reads back verbatim (a `tagMovement`
   analogous to `tagEffect`) instead of geometric re-detection; or
   (b) declare movement **off-contract** for the generator and have it emit explicit per-ring
   timeframes (lossless, verbose). Recommend (b) for Phase 3 to avoid scope, (a) later if the
   timeline UI needs movement preserved as a single editable unit. Medium cost either way.

5. **`half`/`comb2` FloatFunc support in `formatFloatFunction`** — only if a generator ever needs
   those shapes raw; otherwise leave them off-contract. Low priority.

6. **Add an executable round-trip test** (`JSON → generate → parse → JSON`, assert structural
   equality on the safe set) so this contract can't silently regress. This is Phase 4's test, but
   it's cheap to stand up now and would have caught all four breaks above.

---

## 6. Bottom line for the plan

The round-trip is **solid for the fixed-BPM, plain-cycle, no-movement subset** (proven: togual
8/8, aladdin 134/134) and **broken for exactly the features the later phases most want**:
variable-BPM timing (Phase 1's `beatTimestampsMs`/`bpmCurve`) and movement (Phase 3's expressive
mapping). Recommendation: **fix #1 and #2 before Phase 1**, decide #4 before Phase 3, and stand up
#6 as the contract's guard. Until then, the generator must stay inside §4's SAFE list.
