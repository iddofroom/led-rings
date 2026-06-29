/**
 * PHASE 2 (step 2) — mine audio-INDEPENDENT structural taste patterns from the
 * existing song corpus. Runs every src/songs/*.ts through the recorder to get
 * canonical {song,timeframes} JSON, then aggregates how WE actually use the
 * vocabulary: effect frequency, effect co-occurrence, color/hue strategy, mapping,
 * cycle, movement, phase, timeframe duration, ring usage.
 *
 * Output: taste/learned-patterns.json  (reference material for the translator;
 * NOT a black-box model). The effect<->section/energy alignment that the plan also
 * wants requires per-song AUDIO analysis (scripts/analyze_music.py) and is left as a
 * documented follow-up — see the "pendingAudioAlignment" note in the output.
 *
 * Usage: npx ts-node scripts/mine-taste.ts
 */
import * as path from "path";
import * as fs from "fs";
import { parseSongFile } from "../src/recorder/parse-song";

const SONGS_DIR = path.resolve(__dirname, "../src/songs");
const OUT = path.resolve(__dirname, "../taste/learned-patterns.json");

function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null; // greyscale: no meaningful hue
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6; if (h < 0) h += 1;
  return h;
}

const HUE_NAMES = ["red", "orange", "yellow", "yellow-green", "green", "spring", "cyan", "azure", "blue", "violet", "magenta", "rose"];
const hueBucket = (h: number) => HUE_NAMES[Math.floor(((h % 1) + 1) % 1 * 12) % 12];

function inc(map: Record<string, number>, key: string, by = 1) { map[key] = (map[key] || 0) + by; }

function percentiles(arr: number[]) {
  if (!arr.length) return {};
  const s = [...arr].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: s[s.length - 1], mean: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 };
}

interface Agg {
  timeframes: number;
  effectFreq: Record<string, number>;          // # timeframes containing each effectKey
  coOccurrence: Record<string, number>;         // sorted effectKey-set per timeframe -> count
  mapping: Record<string, number>;
  hueBuckets: Record<string, number>;
  explicitColor: { yes: number; no: number };
  cycleBeats: Record<string, number>;           // plain cycle beatsInCycle value -> count
  windowedCycles: number;                        // cycleBeats (windowed) count
  movement: Record<string, number>;
  phaseTimeframes: number;
  ringMode: Record<string, number>;             // all / single / subset
  durationsBeats: number[];                      // endTime-startTime per timeframe
}

function emptyAgg(): Agg {
  return { timeframes: 0, effectFreq: {}, coOccurrence: {}, mapping: {}, hueBuckets: {}, explicitColor: { yes: 0, no: 0 }, cycleBeats: {}, windowedCycles: 0, movement: {}, phaseTimeframes: 0, ringMode: {}, durationsBeats: [] };
}

function foldTimeframe(agg: Agg, tf: any) {
  agg.timeframes++;
  const effects: string[] = (tf.effects || []).map((e: any) => e.effectKey).filter(Boolean);
  for (const k of effects) inc(agg.effectFreq, k);
  const set = [...new Set(effects)].sort();
  inc(agg.coOccurrence, set.length ? set.join("+") : "(color-only)");
  inc(agg.mapping, tf.mapping || "all");
  if (tf.hasExplicitColor === false) agg.explicitColor.no++; else agg.explicitColor.yes++;
  const hue = hexToHue(tf.color);
  if (hue != null && tf.hasExplicitColor !== false) inc(agg.hueBuckets, hueBucket(hue));
  for (const c of tf.cycles || []) {
    if (c.type === "cycle") inc(agg.cycleBeats, String(c.beatsInCycle));
    else agg.windowedCycles++;
  }
  if (tf.movement) inc(agg.movement, `${tf.movement.type}/${tf.movement.direction}`);
  if (tf.phase) agg.phaseTimeframes++;
  const rings: number[] = tf.rings || [];
  agg.ringMode[rings.length === 12 ? "all" : rings.length === 1 ? "single" : "subset"] = (agg.ringMode[rings.length === 12 ? "all" : rings.length === 1 ? "single" : "subset"] || 0) + 1;
  if (typeof tf.startTime === "number" && typeof tf.endTime === "number") agg.durationsBeats.push(Math.round((tf.endTime - tf.startTime) * 10) / 10);
}

function topN(map: Record<string, number>, n = 12) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n));
}

function summarize(agg: Agg) {
  return {
    timeframes: agg.timeframes,
    effectFreq: topN(agg.effectFreq, 30),
    topCoOccurrence: topN(agg.coOccurrence, 15),
    mapping: topN(agg.mapping),
    hueBuckets: topN(agg.hueBuckets),
    explicitColor: agg.explicitColor,
    cycleBeats: topN(agg.cycleBeats),
    windowedCycles: agg.windowedCycles,
    movement: topN(agg.movement),
    phaseTimeframes: agg.phaseTimeframes,
    ringMode: agg.ringMode,
    durationBeats: percentiles(agg.durationsBeats),
  };
}

async function main() {
  const files = fs.readdirSync(SONGS_DIR).filter((f) => f.endsWith(".ts") && !f.startsWith("__"));
  const perSong: Record<string, any> = {};
  const global = emptyAgg();
  for (const f of files) {
    const songName = f.replace(/\.ts$/, "");
    try {
      const { song, timeframes } = await parseSongFile(path.join(SONGS_DIR, f));
      if (!timeframes.length) { perSong[songName] = { skipped: "0 timeframes (empty/stub)" }; continue; }
      const agg = emptyAgg();
      for (const tf of timeframes as any[]) { foldTimeframe(agg, tf); foldTimeframe(global, tf); }
      perSong[songName] = { bpm: (song as any).bpm, variableBpm: !!((song as any).beatTimestampsMs?.length), ...summarize(agg) };
    } catch (e: any) {
      perSong[songName] = { error: e?.message || String(e) };
    }
  }
  const out = {
    note: "Audio-INDEPENDENT structural taste mined from src/songs/* via parse-song (recorder). Reference material for the translator, not a model. Rules in taste/rules.yaml OVERRIDE these on conflict.",
    pendingAudioAlignment: "The effect<->section/energy alignment (which effect appears under which intro/build/drop + energy band) needs per-song audio run through scripts/analyze_music.py; add audio and re-run with alignment to complete it.",
    generatedFromSongs: files.map((f) => f.replace(/\.ts$/, "")),
    aggregate: summarize(global),
    perSong,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log("\n=== AGGREGATE (all songs) ===");
  console.log("timeframes:", out.aggregate.timeframes);
  console.log("top effects:", out.aggregate.effectFreq);
  console.log("mappings:", out.aggregate.mapping);
  console.log("hues:", out.aggregate.hueBuckets);
  console.log("cycles(beats):", out.aggregate.cycleBeats, "windowed:", out.aggregate.windowedCycles);
  console.log("movement:", out.aggregate.movement, "| phase tfs:", out.aggregate.phaseTimeframes);
  console.log("ringMode:", out.aggregate.ringMode, "| durationBeats:", out.aggregate.durationBeats);
}

main();
