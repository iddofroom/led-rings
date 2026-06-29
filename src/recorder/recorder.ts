import { als } from "../async-local-storage";

interface CycleInfo {
  type: "cycle" | "cycleBeats";
  beatsInCycle: number;
  // Field names MUST match the UI/generator TimeframeCycleEntry type
  // (ui/src/generateSequenceTs.ts) and App.tsx normalizeCycles so cycleBeats
  // round-trips. Do NOT rename to *InCycle.
  startBeat?: number;
  endBeat?: number;
}

interface RecordedEffect {
  id: string;
  effectKey: string;
  params?: Record<string, any>;
  phase?: number;
}

interface RecordedTimeframe {
  id: string;
  startTime: number;
  endTime: number;
  label: string;
  color: string;
  hasExplicitColor?: boolean;
  rings: number[];
  mapping: string;
  phase?: number;
  cycles?: CycleInfo[];
  effects: RecordedEffect[];
}

interface SongMeta {
  name: string;
  bpm: number;
  lengthSeconds: number;
  startOffsetMs: number;
  animationType?: string;
  beatTimestampsMs?: number[];
}

/**
 * Convert absolute ms back to a beat number.
 * When beatTimestampsMs is present this is the TRUE inverse of time.ts beatToMs
 * (3 branches: clamp <= table[0] -> 0, extrapolate >= last via avgBeatMs=lastMs/maxIndex,
 * else binary-search + linear interpolation). Without a table, falls back to fixed BPM.
 * Result is snapped to a 0.1-beat grid (stable; matches the forward grid).
 */
function msToBeats(ms: number, bpm: number, beatTimestampsMs?: number[]): number {
  let beat: number;
  if (!beatTimestampsMs || beatTimestampsMs.length === 0) {
    beat = ms * bpm / 60000;
  } else {
    const maxIndex = beatTimestampsMs.length - 1;
    if (ms <= beatTimestampsMs[0]) {
      beat = 0; // forward clamp is many-to-one; beats <= 0 all map here (irreversible)
    } else if (ms >= beatTimestampsMs[maxIndex]) {
      const lastMs = beatTimestampsMs[maxIndex];
      const avgBeatMs = maxIndex > 0 ? lastMs / maxIndex : 60000 / bpm;
      beat = maxIndex + (ms - lastMs) / avgBeatMs;
    } else {
      let lo = 0;
      let hi = maxIndex;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (beatTimestampsMs[mid] <= ms) lo = mid;
        else hi = mid;
      }
      const span = beatTimestampsMs[lo + 1] - beatTimestampsMs[lo];
      beat = lo + (span > 0 ? (ms - beatTimestampsMs[lo]) / span : 0);
    }
  }
  return Math.round(beat * 10) / 10;
}

function hsvToHex(h: number, s: number, v: number): string {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Normalize raw addEffect keys to the UI's expected effect key names. */
const EFFECT_KEY_ALIASES: Record<string, string> = {
  hue: "timed_hue",
  saturation: "timed_saturation",
};

class Recorder {
  private timeframes: RecordedTimeframe[] = [];
  private contextMap = new Map<string, RecordedTimeframe>();
  private tfCounter = 0;
  private effectCounter = 0;
  private bpm = 120;
  private startOffsetMs = 0;
  private hasBeatTimestamps = false;
  private beatTimestampsMs?: number[];

  reset() {
    this.timeframes = [];
    this.contextMap.clear();
    this.tfCounter = 0;
    this.effectCounter = 0;
  }

  setBpm(bpm: number, startOffsetMs: number, beatTimestampsMs?: number[]) {
    this.bpm = bpm;
    this.startOffsetMs = startOffsetMs;
    this.beatTimestampsMs = beatTimestampsMs && beatTimestampsMs.length > 0 ? beatTimestampsMs : undefined;
    this.hasBeatTimestamps = !!this.beatTimestampsMs;
  }

  recordEffect(effectKey: string, params: Record<string, any>) {
    const store = als.getStore();
    if (!store) return;

    const effectConfig = store.effectConfig || {};
    // When beat timestamps are present, times are already absolute — no offset to subtract
    const offset = this.hasBeatTimestamps ? 0 : this.startOffsetMs;
    const startBeat = msToBeats((effectConfig.start_time ?? 0) - offset, this.bpm, this.beatTimestampsMs);
    const endBeat = msToBeats((effectConfig.end_time ?? 0) - offset, this.bpm, this.beatTimestampsMs);
    const rings: number[] = store.elements || [];
    const mapping: string = effectConfig.segments || "all";
    const phaseValue: number = store.phase || 0;

    // Build cycle info from cycleStack (preferred) or fall back to repeat_num reconstruction
    const cycles: CycleInfo[] = [];
    if (store.cycleStack && store.cycleStack.length > 0) {
      for (const entry of store.cycleStack) {
        if (entry.startBeat === 0 && entry.endBeat === entry.beatsInCycle) {
          cycles.push({ type: "cycle", beatsInCycle: entry.beatsInCycle });
        } else {
          cycles.push({
            type: "cycleBeats",
            beatsInCycle: entry.beatsInCycle,
            startBeat: entry.startBeat,
            endBeat: entry.endBeat,
          });
        }
      }
    } else if (effectConfig.repeat_num != null && effectConfig.repeat_num > 0) {
      const totalBeats = endBeat - startBeat;
      const beatsInCycle = Math.round(totalBeats / effectConfig.repeat_num * 10) / 10;
      const repeatStart = effectConfig.repeat_start ?? 0;
      const repeatEnd = effectConfig.repeat_end ?? 1;

      if (repeatStart === 0 && repeatEnd === 1) {
        cycles.push({ type: "cycle", beatsInCycle });
      } else {
        cycles.push({
          type: "cycleBeats",
          beatsInCycle,
          startBeat: Math.round(repeatStart * beatsInCycle * 10) / 10,
          endBeat: Math.round(repeatEnd * beatsInCycle * 10) / 10,
        });
      }
    }

    // Build context key for grouping
    const contextKey = JSON.stringify({ startBeat, endBeat, rings, mapping, phaseValue, cycles });

    let tf = this.contextMap.get(contextKey);
    if (!tf) {
      tf = {
        id: `tf-${this.tfCounter++}`,
        startTime: startBeat,
        endTime: endBeat,
        label: "",
        color: "#3b82f6",
        rings,
        mapping,
        effects: [],
      };
      if (phaseValue) tf.phase = phaseValue;
      if (cycles.length) tf.cycles = cycles;
      this.timeframes.push(tf);
      this.contextMap.set(contextKey, tf);
    }

    // constColor sets the timeframe color instead of being an effect
    if (effectKey === "constColor" && params.hue != null) {
      tf.color = hsvToHex(params.hue, params.sat ?? 1, params.val ?? 1);
      tf.hasExplicitColor = true;
      return;
    }

    // vivid/pastel set the timeframe color (same as constColor)
    if (effectKey === "vivid" && params.hue != null) {
      tf.color = hsvToHex(params.hue, 1, 1);
      tf.hasExplicitColor = true;
      return;
    }
    if (effectKey === "pastel") {
      tf.color = hsvToHex(params.hue ?? 0, 0.8, 1);
      tf.hasExplicitColor = true;
      return;
    }

    // noColor sets timeframe to black
    if (effectKey === "noColor") {
      tf.color = "#000000";
      tf.hasExplicitColor = true;
      return;
    }

    // rainbow → constColor + position_hue with linear offset
    if (effectKey === "rainbow") {
      const startHue = params?.startHue ?? 0;
      const endHue = params?.endHue ?? 1;
      tf.color = hsvToHex(startHue, 1, 1);
      tf.hasExplicitColor = true;
      const effect: RecordedEffect = {
        id: `e-${this.effectCounter++}`,
        effectKey: "position_hue",
        params: { offset_factor: { linear: { start: 0, end: endHue - startHue } } },
      };
      if (phaseValue) effect.phase = phaseValue;
      tf.effects.push(effect);
      return;
    }

    // Normalize effect key aliases (raw addEffect keys like "hue" → "timed_hue")
    const normalizedKey = EFFECT_KEY_ALIASES[effectKey] || effectKey;

    const effect: RecordedEffect = {
      id: `e-${this.effectCounter++}`,
      effectKey: normalizedKey,
    };
    if (params && Object.keys(params).length > 0) effect.params = params;
    if (phaseValue) effect.phase = phaseValue;
    tf.effects.push(effect);
  }

  getResult(songMeta: SongMeta) {
    // Mark timeframes that never received an explicit color
    for (const tf of this.timeframes) {
      if (!tf.hasExplicitColor) tf.hasExplicitColor = false;
    }
    const ringsMerged = mergeIdenticalRings(this.timeframes);
    const collapsed = detectMovementPatterns(ringsMerged);
    return {
      song: {
        ...songMeta,
        animationType: songMeta.animationType || "song",
      },
      timeframes: collapsed,
    };
  }
}

export const recorder = new Recorder();

// ---------------------------------------------------------------------------
// Ring merging — combines timeframes with identical time range, mapping,
// effects, and color into a single timeframe with a combined ring list.
// This handles cases like per-ring code that applies the same effect to
// groups of rings (e.g. ringParty with (e + i) % 4 grouping).
// ---------------------------------------------------------------------------

/** Key that identifies timeframes eligible for ring merging (same time range + same shape). */
function ringMergeKey(tf: RecordedTimeframe): string {
  const efx = tf.effects.map(e => ({
    effectKey: e.effectKey,
    params: e.params,
    phase: e.phase,
  }));
  return JSON.stringify({
    startTime: Math.round(tf.startTime * 100) / 100,
    endTime: Math.round(tf.endTime * 100) / 100,
    mapping: tf.mapping,
    cycles: tf.cycles ?? [],
    effects: efx,
    hasExplicitColor: tf.hasExplicitColor,
    color: tf.color,
  });
}

function mergeIdenticalRings(timeframes: RecordedTimeframe[]): RecordedTimeframe[] {
  const groups = new Map<string, RecordedTimeframe[]>();
  for (const tf of timeframes) {
    const key = ringMergeKey(tf);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tf);
  }

  const result: RecordedTimeframe[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    // Merge ring lists
    const allRings = [...new Set(group.flatMap(tf => tf.rings))].sort((a, b) => a - b);
    const merged: RecordedTimeframe = {
      ...group[0],
      rings: allRings,
    };
    result.push(merged);
  }

  result.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return result;
}

// ---------------------------------------------------------------------------
// Movement pattern detection — collapses per-ring timeframes back into
// single movement-enabled timeframes when they match spread/sweep patterns.
// ---------------------------------------------------------------------------

const RING_CENTER = 6.5;

type MovementDirection = "forward" | "backward" | "center-out" | "edges-in";

interface MovementInfo {
  type: "spread" | "sweep";
  direction: MovementDirection;
  beatsPerRing: number;
  retire?: boolean;
  bounce?: boolean;
}

/** Fingerprint that identifies timeframes with identical "shape" (same effects, mapping, cycles). */
function effectsFingerprint(tf: RecordedTimeframe): string {
  const efx = tf.effects.map(e => ({
    effectKey: e.effectKey,
    params: e.params,
    phase: e.phase,
  }));
  return JSON.stringify({
    mapping: tf.mapping,
    cycles: tf.cycles ?? [],
    effects: efx,
    hasExplicitColor: tf.hasExplicitColor,
  });
}

/** Try to detect the direction from an ordered sequence of ring numbers at each step. */
function detectDirection(steps: number[][]): MovementDirection | null {
  const flatForward = steps.every(s => s.length === 1)
    && steps.map(s => s[0]).every((r, i, arr) => i === 0 || r > arr[i - 1]);
  if (flatForward) return "forward";

  const flatBackward = steps.every(s => s.length === 1)
    && steps.map(s => s[0]).every((r, i, arr) => i === 0 || r < arr[i - 1]);
  if (flatBackward) return "backward";

  // For edges-in / center-out, check distance from center
  const distances = steps.map(group => {
    const avgDist = group.reduce((sum, r) => sum + Math.abs(r - RING_CENTER), 0) / group.length;
    return avgDist;
  });

  const isDescending = distances.every((d, i, arr) => i === 0 || d <= arr[i - 1] + 0.01);
  if (isDescending) return "edges-in";

  const isAscending = distances.every((d, i, arr) => i === 0 || d >= arr[i - 1] - 0.01);
  if (isAscending) return "center-out";

  return null;
}

/** Detect phase (hue progression) across rings and return base color + phase intensity, or null. */
function detectPhase(
  ringColors: Map<number, string>,
  sortedRings: number[],
): { color: string; phase: number } | null {
  if (sortedRings.length < 3) return null;

  const hues: number[] = [];
  for (const r of sortedRings) {
    const hex = ringColors.get(r);
    if (!hex) return null;
    hues.push(hexToHue(hex));
  }

  // Check if hue differences between consecutive rings are roughly equal
  const diffs: number[] = [];
  for (let i = 1; i < hues.length; i++) {
    let d = hues[i] - hues[i - 1];
    // Normalize to [-0.5, 0.5]
    while (d > 0.5) d -= 1;
    while (d < -0.5) d += 1;
    diffs.push(d);
  }

  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  if (Math.abs(avgDiff) < 0.01) return null; // no meaningful hue variation

  const maxDeviation = Math.max(...diffs.map(d => Math.abs(d - avgDiff)));
  if (maxDeviation > 0.05) return null; // not a uniform progression

  const phase = avgDiff * sortedRings.length;
  const baseColor = ringColors.get(sortedRings[0])!;
  return { color: baseColor, phase: Math.round(phase * 100) / 100 };
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = h / 6;
  if (h < 0) h += 1;
  return h;
}

function approxEqual(a: number, b: number, eps = 0.15): boolean {
  return Math.abs(a - b) < eps;
}

function detectMovementPatterns(timeframes: RecordedTimeframe[]): RecordedTimeframe[] {
  // Group single-ring timeframes by effects fingerprint
  const groups = new Map<string, RecordedTimeframe[]>();
  const nonSingleRing: RecordedTimeframe[] = [];

  for (const tf of timeframes) {
    if (tf.rings.length === 1) {
      const key = effectsFingerprint(tf);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tf);
    } else {
      nonSingleRing.push(tf);
    }
  }

  const result: RecordedTimeframe[] = [...nonSingleRing];
  const consumed = new Set<string>(); // track timeframe IDs that got merged

  for (const [, group] of groups) {
    if (group.length < 3) {
      // Too few to be a meaningful pattern
      result.push(...group);
      continue;
    }

    const merged = tryMergeGroup(group);
    if (merged) {
      result.push(merged);
      for (const tf of group) consumed.add(tf.id);
    } else {
      result.push(...group);
    }
  }

  // Stable sort by start time
  result.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return result;
}

function tryMergeGroup(group: RecordedTimeframe[]): RecordedTimeframe | null {
  // Sort by start time
  const sorted = [...group].sort((a, b) => a.startTime - b.startTime);

  // Group by start time to find step groups (rings at same start = same step)
  const stepsByStart = new Map<number, RecordedTimeframe[]>();
  for (const tf of sorted) {
    const key = Math.round(tf.startTime * 100) / 100;
    if (!stepsByStart.has(key)) stepsByStart.set(key, []);
    stepsByStart.get(key)!.push(tf);
  }
  const startTimes = [...stepsByStart.keys()].sort((a, b) => a - b);
  const steps: number[][] = startTimes.map(t => {
    const tfs = stepsByStart.get(t)!;
    return tfs.map(tf => tf.rings[0]).sort((a, b) => a - b);
  });
  const allRings = steps.flat().sort((a, b) => a - b);

  // Detect direction
  const direction = detectDirection(steps);
  if (!direction) return null;

  // Calculate beatsPerRing from start time intervals
  if (startTimes.length < 2) return null;
  const intervals = startTimes.slice(1).map((t, i) => t - startTimes[i]);
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const intervalsUniform = intervals.every(iv => approxEqual(iv, avgInterval));
  if (!intervalsUniform) return null;
  const beatsPerRing = Math.round(avgInterval * 100) / 100;

  // Check end times to determine pattern type
  const endTimes = sorted.map(tf => tf.endTime);
  const uniqueEndTimes = [...new Set(endTimes.map(e => Math.round(e * 100) / 100))].sort((a, b) => a - b);

  // Group end times by step
  const endsByStep = startTimes.map(t => {
    const tfs = stepsByStart.get(t)!;
    const ends = [...new Set(tfs.map(tf => Math.round(tf.endTime * 100) / 100))];
    return ends.length === 1 ? ends[0] : null;
  });
  if (endsByStep.some(e => e === null)) return null;

  const allSameEnd = uniqueEndTimes.length === 1;
  const representative = sorted[0];

  let movement: MovementInfo;

  if (allSameEnd) {
    // All same end time: could be spread or sweep
    const commonEnd = uniqueEndTimes[0];
    const lastStart = startTimes[startTimes.length - 1];
    const lastWindow = commonEnd - lastStart;

    if (approxEqual(lastWindow, beatsPerRing)) {
      // Each ring's window ≈ beatsPerRing: sweep
      movement = { type: "sweep", direction, beatsPerRing };
    } else {
      // First ring has longest window, last has shortest: spread
      movement = { type: "spread", direction, beatsPerRing };
    }
  } else {
    // Different end times: check for retire (diamond) pattern
    const endTimesByStep = endsByStep as number[];
    const endIntervals = endTimesByStep.slice(1).map((e, i) => endTimesByStep[i] - e);
    const avgEndInterval = endIntervals.reduce((a, b) => a + b, 0) / endIntervals.length;
    const endIntervalsUniform = endIntervals.every(iv => approxEqual(iv, avgEndInterval));

    if (endIntervalsUniform && approxEqual(avgEndInterval, beatsPerRing)) {
      // Ends shrink by beatsPerRing each step → spread + retire
      movement = { type: "spread", direction, beatsPerRing, retire: true };
    } else {
      // Unrecognized pattern
      return null;
    }
  }

  // Detect sweep+bounce: if some rings appear twice in the group
  const ringCounts = new Map<number, number>();
  for (const tf of group) {
    const r = tf.rings[0];
    ringCounts.set(r, (ringCounts.get(r) || 0) + 1);
  }
  const hasDoubles = [...ringCounts.values()].some(c => c > 1);
  if (hasDoubles && movement.type === "sweep") {
    movement.bounce = true;
  }

  // Detect phase from per-ring colors
  const ringColors = new Map<number, string>();
  for (const tf of sorted) {
    if (tf.hasExplicitColor) {
      ringColors.set(tf.rings[0], tf.color);
    }
  }

  let mergedColor = representative.color;
  let mergedPhase: number | undefined;
  const phaseResult = detectPhase(ringColors, allRings);
  if (phaseResult) {
    mergedColor = phaseResult.color;
    mergedPhase = phaseResult.phase;
  }

  // Build merged timeframe
  const globalStart = Math.min(...sorted.map(tf => tf.startTime));
  const globalEnd = Math.max(...sorted.map(tf => tf.endTime));

  const merged: RecordedTimeframe = {
    id: representative.id,
    startTime: globalStart,
    endTime: globalEnd,
    label: "",
    color: mergedColor,
    rings: allRings,
    mapping: representative.mapping,
    effects: representative.effects,
  };
  if (representative.hasExplicitColor) merged.hasExplicitColor = true;
  if (mergedPhase) merged.phase = mergedPhase;
  if (representative.cycles?.length) merged.cycles = representative.cycles;
  (merged as any).movement = {
    type: movement.type,
    direction: movement.direction,
    beatsPerRing: movement.beatsPerRing,
    ...(movement.retire ? { retire: true } : {}),
    ...(movement.bounce ? { bounce: true } : {}),
  };

  return merged;
}
