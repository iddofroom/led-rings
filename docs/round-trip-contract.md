# Round-Trip Contract (PHASE 0)

> **Status:** Audit complete, **empirically validated** (52 synthetic single-effect cases) and
> **adversarially reviewed** (5-dimension multi-agent pass). This is the authoritative list of what
> is safe for a generator to emit. The composition pipeline (Phases 1–5) may **only** emit
> effects/structures marked ✅ SAFE below. Anything ⚠️ or ❌ must be fixed first or avoided.
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
   `reverseMapSnake`, …) — a **third** representation. (Audited separately in §7: for the
   brightness/hue/snake key+param shapes it emits, it does **not** diverge from the recorder path;
   but its mappers are themselves lossy *preset→timeframe*, and it is out of scope for the JSON↔JSON
   contract.)

**The contract below is pinned to the recorder path.** There are also **zero automated tests** in
this repo. The round-trip has no executable guard today — recommend adding one (Phase 4 calls for
it; it should arguably exist now as the executable form of this contract).

---

## 1. Empirical results

**Two evidence passes back this contract:**

**(a) Real songs.** Every song in `src/songs/*.ts` was run through `JSON_A = recorder(song)` →
`TS' = generator(JSON_A)` → `JSON_B = recorder(TS')`, then structurally diffed:

| Song | timeframes | matched A↔B | verdict |
|---|---|---|---|
| `agent` | 0 | 0 | n/a — **empty stub** (`// Empty animation`) |
| `togual` | 8 | **8** | ✅ perfect |
| `aladdin` | 134 | **134** | ✅ perfect |
| `buttons` | 213 | 172 | ⚠️ `cycleBeats`, `rainbow`+phase, movement |
| `loop` | 120 | **0** | ❌ `beatTimestampsMs` (variable-BPM) |

**(b) Synthetic per-effect grid.** 52 minimal single-effect timeframes (one per effectKey/param
shape) were round-tripped. **All SAFE effects matched exactly; all documented breaks reproduced.**

**(c) Adversarial multi-agent review** then found **three breaks the first two passes missed**:
phase+effects splitting (§3.5), the `snakeBrightness/Saturation/Hue` helper drop (§2.7), and it
corrected the contract's earlier overstatement of `sweep` and the `beatTimestampsMs` fix recipe.

The clean corpus (`togual`, `aladdin`) is **fixed-BPM, plain `cycle`, no movement, no
phase-on-effects**. That is the proven-safe core.

---

## 2. Effect-by-effect table

Legend: ✅ lossless · ⚠️ works with caveats · ❌ broken.

### 2.1 Color (lives on `timeframe.color` + `hasExplicitColor`, **not** in `effects[]`)

| Source fn | Recorder result | RT | Notes |
|---|---|---|---|
| `constColor({hue,sat,val})` | sets `tf.color` (hex), `hasExplicitColor=true` | ✅ | HSV↔hex via 4-dp; stable |
| *(no color fn / "modifiers only")* | `hasExplicitColor=false`, no constColor emitted | ✅ | color hex intentionally dropped |
| `noColor()` | `tf.color="#000000"`, explicit | ✅* | generator never *emits* `noColor()`; hand-written only |
| `vivid` / `pastel` | folded into `tf.color` | ✅* | never emitted as an effect entry by the generator |
| `rainbow()` | `tf.color` + a `position_hue` linear effect | ⚠️ | lossy with per-ring phase (§3.4). Use `constColor`+`position_hue` linear instead. |

- **`fullRainbow()` / `randomRangeColor()`** are wrappers — both call `rainbow()`, which re-tags
  `rainbow` (their own tag is overwritten), so they record as `rainbow` and lower to
  `constColor` + `position_hue` linear; same ⚠️ caveat. `randomRangeColor` uses `Math.random()` for
  its hue range (captured into the JSON once, so not a *stability* problem).
- **`dotted()`** decomposes at runtime into **two `constColor` entries** on `segment_b1` and
  `segment_b2`; round-trips as plain colors ✅, but the `dotted` tag never reaches `effects[]` and
  the generator can never re-emit a `dotted()` call. (Inventory completeness.)

### 2.2 Brightness `effects[]`

| effectKey | params | RT |
|---|---|---|
| `brightness` | `{value}` | ✅ |
| `fadeIn` / `fadeOut` | – | ✅ |
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
| `snakeFillGrow` | `{reverse?}` | ⚠️ | round-trips standalone (`reverse:false`↔`{}` normalizes); **breaks inside `movement`** (§3.3) |
| `snakeInOut` | `{start?, end?}` | ⚠️ | key+params round-trip, but `start`/`end` are **runtime no-ops** (impl always sweeps sin 0→1). Don't encode meaning in them. |

### 2.5 Raw / advanced `effects[]` (emitted as `addEffect({key:{…}})`, no `tagEffect`)

| effectKey | params shape | RT |
|---|---|---|
| `timed_brightness` | `{mult_factor_decrease\|increase: FloatFunc}` | ✅† |
| `timed_hue` | `{offset_factor: FloatFunc}` | ✅† |
| `timed_saturation` | `{mult_factor_*: FloatFunc}` | ✅† |
| `position_brightness` | `{mult_factor_*: FloatFunc}` | ✅† |
| `position_hue` | `{offset_factor: FloatFunc}` | ✅† |
| `position_saturation` | `{mult_factor_*: FloatFunc}` | ✅† |
| `snake_brightness` | `{head, tail_length, cyclic, mult_factor_*}` | ✅† |
| `snake_hue` | `{head, tail_length, cyclic, offset_factor}` | ✅† |
| `snake_saturation` | `{head, tail_length, cyclic, mult_factor_*}` | ✅† |

> **Same-name trap:** these are the **RAW `addEffect` keys** (`snake_brightness`, …) and round-trip
> exactly. The similarly-named **camelCase helper functions** `snakeBrightness()` /
> `snakeSaturation()` / `snakeHue()` record a **different** key that the generator **drops** — see
> §2.7. Same name, opposite outcome.

**† Critical FloatFunc caveat:** the generator's `formatFloatFunction` only serializes
`const_value`, `linear`, `sin`, `steps`. A FloatFunc of kind **`half` or `comb2` is silently
replaced with `const_value:{value:1}`** → **lossy**. Raw effects are safe **only if** their inner
FloatFunc is one of those four kinds. (`half`/`comb2` produced internally by `fadeInOut`/`blink`/
`snakeFillGrow`/`snakeSlowFast`/`snakeTailShrinkGrow` are fine because they're emitted via their
named helpers, not as raw FloatFunc.)

### 2.6 Structure / non-effect dimensions

| Dimension | RT | Notes |
|---|---|---|
| Beat times, **fixed BPM** | ✅ (to 0.1 beat) | `msToBeats` rounds to nearest 0.1 beat — stable |
| Beat times, **`beatTimestampsMs`** (variable BPM) | ❌ | drifts every pass — §3.1 |
| `rings` (`all/even/odd/left/right/center`/explicit) | ✅ | `mergeIdenticalRings` recombines |
| `mapping` (`all/arc/ind/b1/b2/centric/updown/rand`) | ✅ | **unknown mapping silently coerces to `segment_all`, no error** |
| `phase` on a **color-only** timeframe | ✅ | the only safe phase use (togual/aladdin) |
| `phase` on a timeframe that **also has effects** | ❌ | splits the timeframe, drops phase from effects — §3.5 |
| per-effect `phase` on a multi-effect timeframe | ❌ | fragments into one tf per distinct phase value — §3.5 |
| `cycle` (plain) | ✅ | only `beatsInCycle` |
| `cycleBeats` (windowed) | ❌ | field-name mismatch; breaks codegen **and** UI import — §3.2 |
| `movement` `spread` and `spread`+`retire` (≥3 uniform rings) | ⚠️→✅ | only forms re-detected; color/`hasExplicitColor` can drift on the per-ring-hue (`detectPhase`) path |
| `movement` `sweep` / `sweep`+`bounce` | ❌ | **never** re-detected, even with ≥3 uniform rings — §3.3 |
| `movement` `stagger` | ❌ | no detector; also corrupted by the `cycleBeats` bug — §3.3 |
| `movement` `random` (+`retire`/`accumulate`) | ❌ | seeded shuffle + `holdOff` blocks are non-invertible — §3.3 |
| `disabled` timeframes | n/a | generator drops them before emit |
| `brightnessEffect/hueEffect/motionEffect` (legacy slots) | one-way | normalized into `effects[]`; never re-emitted in slot form |

**Multi-effect timeframes:** a timeframe with several effects (e.g. `constColor` + `brightness` +
`hueShiftStartToEnd` + `snake`) round-trips **losslessly in params** and re-merges to **one**
timeframe — **but effect ORDER is normalized** to `color → modifiers(brightness/hue) → motion`
(the generator emits the three as separate `beats()` blocks). Relative order within a layer is kept;
motion is always pushed after non-motion. If effect order is runtime-significant, it will change.

**Simultaneous multi-ring:** timeframes with the **same** start+end but different per-ring colors
are **not** collapsed into movement+phase (movement detection needs ≥2 distinct step start-times);
they round-trip as N separate single-ring timeframes — lossless but un-merged, no phantom movement
invented. (Staggered start-times are what trigger movement/phase collapse.)

### 2.7 Helper/recorder keys the generator CANNOT re-emit — ❌ DROPPED

| recorder key | source helper | RT |
|---|---|---|
| `snakeBrightness` | `brightness.ts` `snakeBrightness()` | ❌ vanishes |
| `snakeSaturation` | `saturation.ts` `snakeSaturation()` | ❌ vanishes |
| `snakeHue` | `hue.ts` `snakeHue()` | ❌ vanishes |

These helpers `tagEffect('snakeBrightness'…)` (camelCase), so the recorder records them into
`effects[]`. But the generator's `SNAKE_KEYS` only knows the raw `snake_brightness`/`snake_hue`/
`snake_saturation`; the camelCase keys fall through `emitSingleEffect` to `return []` and are
**silently dropped** on the next generate pass (color survives, effect gone). **Use the raw
`snake_*` forms (§2.5), which DO round-trip.** Fix option: alias the camelCase keys to raw in the
recorder, or teach the generator the camelCase forms.

---

## 3. The breaks (with evidence)

### 3.1 ❌ `beatTimestampsMs` (variable-BPM) destroys timing — *highest severity*

The forward path ([time.ts](../src/time/time.ts) `beats()`) converts beat→ms via the
`beatTimestampsMs` **lookup + interpolation**. The reverse path ([recorder.ts](../src/recorder/recorder.ts#L40)
`msToBeats`) converts ms→beat with the **fixed-BPM formula**, ignoring `beatTimestampsMs`. Not
inverses unless beats are uniform.

**Evidence:** `loop.ts` source calls `beats(0, 76, …)` for ring 1; one recorder pass reports
`startTime: 15.2` (`beatTimestampsMs[0]=3035ms`, `3035·300/60000 = 15.2`). Diff matched **0/120**.
Each pass re-multiplies the drift.

This is the most important finding: **Phase 1 is specced to emit `beatTimestampsMs` +
`downbeatTimestampsMs` + a `bpmCurve`** — exactly the case that cannot survive a round-trip today.
Fix recipe in §5 #1.

### 3.2 ❌ `cycleBeats` — doubly broken

Recorder emits `{type:'cycleBeats', beatsInCycle, startBeatInCycle, endBeatInCycle}`
([recorder.ts:111](../src/recorder/recorder.ts#L111)); the generator and the UI type read
`{… startBeat, endBeat}`. Two distinct failures:

1. **Codegen:** the generator emits literal `cycleBeats(N, undefined, undefined, …)` (verified) →
   NaN window at runtime.
2. **UI import:** `App.tsx` `normalizeCycles` type-guards on `startBeat`/`endBeat` being numbers, so
   a recorder-emitted `cycleBeats` **fails the guard and is silently dropped** from the imported
   timeframe.

Plain `cycle` is fine; only the windowed `cycleBeats` form breaks. Fix is **recorder-only** (§5 #2).

### 3.3 ❌/⚠️ `movement` reconstruction

Forward expands a `movement` timeframe into per-ring `beats()` blocks; the recorder tries to
*re-detect* the pattern geometrically (`detectMovementPatterns`). Reality by variant:

- **`spread` and `spread`+`retire`**: ✅ reconstructed cleanly with ≥3 uniform rings (both collapse
  back to 1 timeframe with movement intact). **These are the only movement forms that survive.**
- **`sweep` / `sweep`+`bounce`**: ❌ **never** reconstructed, even with ≥3 uniform rings. A forward
  sweep has *advancing* end times that the retire/diamond detector rejects (sign mismatch:
  `approxEqual(-beatsPerRing, +beatsPerRing)` is false), so it stays as N single-ring timeframes.
- **`stagger`**: ❌ never detected; *and* its per-ring expansion is a `cycleBeats(dur, offset, dur)`
  window, so the §3.2 bug also corrupts it. The §3.2 recorder rename is a prerequisite for any
  future stagger work.
- **`random`** (+`retire`/`accumulate`): ❌ the order is a seeded LCG shuffle
  (`movementGenerators.ts` `shuffledRingOrder`), non-invertible from per-ring windows; `random+retire`
  emits literal `timed_brightness:{mult_factor_decrease:{value:0}}` `holdOff` blocks that record as
  ordinary effects and are never re-collapsed.
- **Not a fixed point:** a `spread`+phase timeframe is *mislabeled* `sweep` on pass 1 and then fully
  decomposes into N single-ring tfs (movement **and** phase both lost) on pass 2.
- **Color drift:** the `color`/`hasExplicitColor` drift occurs specifically on the `detectPhase`
  sub-path (per-ring hue progression), not on uniform-color spreads.

### 3.4 ⚠️ `rainbow` → `position_hue` + per-ring phase

`rainbow()` is lowered to a base color + a `position_hue` linear effect. With multi-ring per-ring
hue progression the phase-detection heuristics don't always invert cleanly. **Safe alternative:
emit `constColor` + `position_hue {offset_factor:{linear}}` directly** (that pair is lossless).

### 3.5 ❌ `phase` + `effects[]` splits the timeframe and drops phase from effects — *newly found*

The generator applies tf-level `phase` **only to the color layer**
([generateSequenceTs.ts:308](../ui/src/generateSequenceTs.ts#L308) `wrapWithPhase(emitColor(tf), tf.phase)`);
modifier/motion layers get **no** tf-phase wrapper. Combined with the recorder keying its
`contextKey` on `phaseValue` ([recorder.ts:138](../src/recorder/recorder.ts#L138)), a single
timeframe carrying **both** a color and effects re-records as **2+ timeframes**: a color tf (retains
phase) and an effects tf (phase **lost**, `hasExplicitColor` **flips to false**, color divorced from
effects). **Per-effect `phase`** (`entry.phase`) is the same failure via line 317 — it fragments
into one timeframe per distinct phase value.

**Evidence:** input one tf `{phase:0.3, constColor #ff0000, effects:[brightness 0.5]}` → recorder
returns **2** timeframes (color phase:0.3; brightness no-phase, hasExplicitColor:false). The only
proven-safe phase use is wrapping a **color-only** timeframe.

This invalidates the earlier "simple phase ✅" claim — see the §4 correction.

---

## 4. Authoritative SAFE-TO-EMIT list (the generator's allowed vocabulary)

A Phase 3 generator may emit **only** the following and stay lossless:

**Color** — `constColor` (set `timeframe.color` + `hasExplicitColor:true`); "no color"
(`hasExplicitColor:false`).

**Brightness** — `brightness`, `fadeIn`, `fadeOut`, `fadeInOut`, `fadeOutIn`, `blink`, `pulse`, `fade`

**Hue** — `staticHueShift`, `hueShiftStartToEnd`, `hueShiftSin`

**Motion (non-movement)** — `snake`, `snakeHeadMove`, `staticSnake`, `snakeHeadSin`,
`snakeHeadSteps`, `snakeSlowFast`, `snakeTailShrinkGrow`

**Raw modifiers** — `timed_*`, `position_*`, **raw** `snake_*` **only** with FloatFunc kinds
`const_value` / `linear` / `sin` / `steps`. (`constColor` + `position_hue` linear = the safe rainbow.)

**Structure** — any `rings` subset; any `mapping` in `all/arc/ind/b1/b2/centric/updown/rand` (no
others — unknown values silently degrade to `segment_all`); plain `cycle`; **fixed-BPM** beat times
on a 0.1-beat grid; `phase` **only on a color-only timeframe (no `effects[]` in the same timeframe)**.

### Conditionally safe (use deliberately)
- `snakeInOut` — fine, but `start`/`end` params are runtime no-ops.
- `snakeFillGrow` — fine standalone; **not** inside a `movement` timeframe.
- Multi-effect timeframes — lossless in params but effect **order is normalized**
  (color → modifiers → motion); don't depend on authored order.

### ❌ DO NOT EMIT until fixed
- Beat numbers tied to `beatTimestampsMs` / variable BPM (§3.1).
- `cycleBeats` windowed cycles (§3.2).
- Any `movement` (`spread`/`spread+retire` only survive geometry; `sweep`/`stagger`/`random` are ❌) (§3.3).
- `rainbow` as an effect (use `constColor` + `position_hue` linear) (§3.4).
- **`phase` on a timeframe that also has `effects[]`, and any per-effect `phase`** (§3.5).
- **`snakeBrightness`/`snakeSaturation`/`snakeHue` helper keys** — use raw `snake_*` instead (§2.7).
- Raw modifiers whose FloatFunc is `half` or `comb2` (§2.5).

---

## 5. Proposed minimal fixes (NOT built in Phase 0 — for review)

1. **Fix `beatTimestampsMs` inversion (recorder).** *Highest priority — the pipeline's premise.*
   - **Plumbing precondition:** `setBpm` currently takes only a boolean `hasBeatTimestamps`
     ([recorder.ts:85](../src/recorder/recorder.ts#L85)); the array is discarded. Extend
     `setBpm(bpm, startOffsetMs, beatTimestampsMs?: number[])`, store it, and pass it into **both**
     `msToBeats` call sites ([recorder.ts:98-99](../src/recorder/recorder.ts#L98)).
     `parse-song.ts` already has `this.beatTimestampsMs` to forward.
   - **Algorithm (mirror `beatToMs` exactly — 3 branches, true inverse):**
     1. `ms <= table[0]` → beat `0`. *(Lossy clamp: all beats ≤ 0 collapse here, irreversible —
        generators must not emit negative beats.)*
     2. `ms >= table[maxIndex]` → `maxIndex + (ms - lastMs) / avgBeatMs`, with
        `avgBeatMs = lastMs / maxIndex` (the **same** formula as the forward extrapolation, not
        `(lastMs - table[0])/maxIndex`).
     3. else binary-search `[lo, lo+1]` → `lo + (ms - t[lo]) / (t[lo+1] - t[lo])`; guard
        `span <= 0 → frac 0`.
   - **Keep the offset gate:** when the table is present, operate on absolute ms and do **not**
     subtract `startOffsetMs` (forward `beats()` and `recordEffect` both use offset 0 with a table).
   - Verified: a corrected inverse recovers exact beats across integer/fractional/extrapolation
     cases and is idempotent on the real 1392-entry `loop` table.

2. **Fix `cycleBeats` — recorder only.** Rename `recorder.ts` output `startBeatInCycle`/
   `endBeatInCycle` → `startBeat`/`endBeat`. The entire UI (`App.tsx` `normalizeCycles` + type,
   `Timeline.formatCyclesLine`, `RingVisualization.computeT`, `TimeframePanel` editor) **and** the
   generator already use `startBeat`/`endBeat`; do **not** change them or the cycleBeats editor/
   preview/timeline desync. The recorder is the lone outlier.

3. **Raise beat precision.** `msToBeats` rounds to 0.1 beat. Moving to 0.01 is safe and stable once
   #1 lands (verified: 0/5000 unstable across two passes on the real `loop` table). Only residual:
   a one-quantum (0.01-beat) first-pass snap in sub-100ms beat gaps from the 1 ms `Math.round` in
   `beats()`; stable thereafter. To eliminate even that, drop the `Math.round` on `start_time`/
   `end_time` in `time.ts`, or invert before rounding.

4. **Make `movement` round-trip.** Geometric re-detection can **never** be lossless for the full set
   (random = non-invertible seeded shuffle; `random+retire` = information-destroying `holdOff`;
   sweep/stagger/random alias each other as per-ring windows). Recommended:
   - (a) **Implement `tagMovement`** (parallel to the existing `tagEffect`→`recordEffect` path) so
     the recorder reads the movement object back **verbatim** — the only lossless option that keeps
     movement as one editable timeline unit; works for every movement type.
   - (b) **Until then**, restrict the generator to `spread`/`spread+retire` and emit everything else
     as explicit per-ring timeframes (lossless, verbose).
   - Do **not** extend `detectMovementPatterns` heuristically — it's a dead end.

5. **`half`/`comb2` FloatFunc support in `formatFloatFunction`** — only if a generator needs those
   shapes raw; otherwise leave off-contract. Low priority.

6. **Resolve the `snakeBrightness/Saturation/Hue` drop (§2.7)** — alias camelCase → raw `snake_*` in
   the recorder's `EFFECT_KEY_ALIASES`, or teach the generator the camelCase keys. Low cost.

7. **Add an executable round-trip test** (`JSON → generate → parse → JSON`, assert structural
   equality on the safe set) so this contract can't silently regress. Cheap; would have caught every
   break above. (The 52-case synthetic grid built during this audit is a ready starting point.)

---

## 6. Bottom line for the plan

The round-trip is **solid for the fixed-BPM, plain-`cycle`, no-movement, no-phase-on-effects
subset** (proven: togual 8/8, aladdin 134/134, 52/52 synthetic) and **broken for several features
the later phases want**:

- **Variable-BPM timing** (Phase 1's `beatTimestampsMs`/`bpmCurve`) → must fix (#1).
- **`cycleBeats`** → trivial recorder rename (#2).
- **`phase` + effects** (newly found) → the generator must keep phase on color-only timeframes, or
  this needs a codegen fix.
- **Movement** (Phase 3's expressive mapping) → only `spread`/`spread+retire` survive; decide #4.

Recommendation: **fix #1 and #2 before Phase 1**, decide #4 before Phase 3, and stand up #7 as the
contract's guard. Until then the generator must stay inside §4's SAFE list.

---

## 7. preset-conversion.ts (third representation) — audited, out of scope

For the brightness/hue/snake **key + param shapes** its reverse mappers emit, `preset-conversion.ts`
does **not** diverge from the recorder/generator path — all such timeframes round-trip (verified).
Two caveats, neither affecting the JSON↔JSON contract:

- Its reverse mappers are themselves **lossy preset→timeframe** (e.g. a preset `sin` collapses to a
  single `{amount}`/`{tailLength}`, discarding `min`/`phase`/`repeats`). The resulting timeframe
  still round-trips; it's just not faithful to the original preset FloatFunc.
- A preset-conversion timeframe whose **color-level `phase` differs from a per-effect `phase`** is
  fragmented by the recorder into multiple timeframes (same root cause as §3.5). This shape is
  common in real presets (e.g. `chill/40ht`, `mystery/4n38`).
