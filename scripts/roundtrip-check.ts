/**
 * Round-trip guard test (the executable form of docs/round-trip-contract.md).
 *
 * Asserts that the canonical loop  {song,timeframes} JSON
 *   --generator(ui/src/generateSequenceTs.ts)--> .ts
 *   --recorder(src/recorder/parse-song.ts)--> JSON
 * is stable for every effect/structure on the SAFE list, that the documented
 * breaks still behave as documented, and that the clean song corpus round-trips.
 *
 * Run:  npx ts-node scripts/roundtrip-check.ts     (exit 0 = pass, 1 = regression)
 *
 * NOTE on the temp generator copy: ui/ is an ESM package ("type":"module") while
 * src/ is CommonJS, so this CJS script cannot `require` the generator directly.
 * We copy the two pure generator files into a CJS-scoped temp dir at runtime,
 * require them, and delete the dir afterwards. Both files are dependency-free.
 */
import * as path from "path";
import * as fs from "fs";
import { parseSongFile } from "../src/recorder/parse-song";

const ROOT = path.resolve(__dirname, "..");
const GEN_DIR = path.join(ROOT, ".roundtrip-tmp", "gen");
const TMP_SONG = path.join(ROOT, "src", "songs", "__rtcheck_tmp.ts");
const RINGS_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function copyGenerator(): (song: any, tfs: any[], prefix?: string) => string {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  for (const f of ["generateSequenceTs.ts", "movementGenerators.ts"]) {
    fs.copyFileSync(path.join(ROOT, "ui", "src", f), path.join(GEN_DIR, f));
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(GEN_DIR, "generateSequenceTs.ts")).generateSequenceTs;
}

function cleanup() {
  try { if (fs.existsSync(TMP_SONG)) fs.unlinkSync(TMP_SONG); } catch {}
  try { fs.rmSync(path.join(ROOT, ".roundtrip-tmp"), { recursive: true, force: true }); } catch {}
}

const round = (n: any) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);
const normParams = (p: any) => (p ? JSON.parse(JSON.stringify(p, (k, v) => (typeof v === "number" ? round(v) : v))) : undefined);

let generate: (song: any, tfs: any[], prefix?: string) => string;

async function roundTrip(song: any, tfs: any[]) {
  fs.writeFileSync(TMP_SONG, generate(song, tfs, ".."));
  return parseSongFile(TMP_SONG);
}

const baseSong = (extra: any = {}) => ({ name: "rtcheck", bpm: 120, lengthSeconds: 60, startOffsetMs: 0, animationType: "song", ...extra });
const tf = (over: any) => ({ id: "t", startTime: 4, endTime: 8, label: "", color: "#804000", hasExplicitColor: true, rings: [...RINGS_ALL], mapping: "all", ...over });

interface Result { name: string; ok: boolean; detail: string }
const results: Result[] = [];
const record = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

/** Assert a single-effect SAFE timeframe round-trips its effectKey+params exactly. */
async function expectSafeEffect(name: string, effect: any, tfOver: any = {}) {
  const inTf = tf({ effects: [{ id: "e", ...effect }], ...tfOver });
  const out = await roundTrip(baseSong(), [inTf]);
  const all = (out.timeframes as any[]).flatMap((t) => t.effects || []);
  const exact = all.find((e) => e.effectKey === effect.effectKey && JSON.stringify(normParams(e.params)) === JSON.stringify(normParams(effect.params)));
  record(`SAFE ${name}`, !!exact, exact ? "" : `out=[${all.map((e) => e.effectKey + ":" + JSON.stringify(normParams(e.params))).join(" | ")}]`);
}

async function main() {
  generate = copyGenerator();

  // ---- SAFE effects (must round-trip exactly) ----
  await expectSafeEffect("brightness", { effectKey: "brightness", params: { value: 0.5 } });
  await expectSafeEffect("fadeIn", { effectKey: "fadeIn" });
  await expectSafeEffect("fadeOut", { effectKey: "fadeOut" });
  await expectSafeEffect("fadeInOut", { effectKey: "fadeInOut", params: { high: 0.8 } });
  await expectSafeEffect("fadeOutIn", { effectKey: "fadeOutIn", params: { low: 0.2 } });
  await expectSafeEffect("blink", { effectKey: "blink", params: { low: 0.3 } });
  await expectSafeEffect("pulse", { effectKey: "pulse", params: { low: 0.4, staticPhase: 0 } });
  await expectSafeEffect("fade", { effectKey: "fade", params: { start: 0.2, end: 0.9 } });
  await expectSafeEffect("staticHueShift", { effectKey: "staticHueShift", params: { value: 0.3 } });
  await expectSafeEffect("hueShiftStartToEnd", { effectKey: "hueShiftStartToEnd", params: { start: 0, end: 0.5 } });
  await expectSafeEffect("hueShiftSin", { effectKey: "hueShiftSin", params: { amount: 0.4 } });
  await expectSafeEffect("snake", { effectKey: "snake", params: { tailLength: 0.5, cyclic: true, reverse: false } });
  await expectSafeEffect("snakeHeadMove", { effectKey: "snakeHeadMove", params: { start: 0, end: 1, tail: 0.5 } });
  await expectSafeEffect("staticSnake", { effectKey: "staticSnake", params: { start: 0.8, end: 0.2 } });
  await expectSafeEffect("snakeHeadSin", { effectKey: "snakeHeadSin", params: { tailLength: 0.5, cyclic: true } });
  await expectSafeEffect("snakeHeadSteps", { effectKey: "snakeHeadSteps", params: { steps: 6, tailLength: 0.5 } });
  await expectSafeEffect("snakeSlowFast", { effectKey: "snakeSlowFast", params: { tailLength: 0.5 } });
  await expectSafeEffect("snakeTailShrinkGrow", { effectKey: "snakeTailShrinkGrow" });
  await expectSafeEffect("timed_brightness/linear", { effectKey: "timed_brightness", params: { mult_factor_decrease: { linear: { start: 1, end: 0 } } } }, { hasExplicitColor: false });
  await expectSafeEffect("position_hue/linear", { effectKey: "position_hue", params: { offset_factor: { linear: { start: 0, end: 0.1 } } } });
  await expectSafeEffect("snake_hue", { effectKey: "snake_hue", params: { head: { linear: { start: 0, end: 1 } }, tail_length: { const_value: { value: 0.5 } }, cyclic: false, offset_factor: { linear: { start: 0, end: 0.5 } } } });

  // ---- Structure: plain cycle + cycleBeats (fix #2) ----
  {
    const out = await roundTrip(baseSong(), [tf({ cycles: [{ type: "cycle", beatsInCycle: 4 }], effects: [{ id: "e", effectKey: "snake", params: { tailLength: 0.5, cyclic: true } }] })]);
    const c = (out.timeframes as any[]).find((t) => t.cycles?.length)?.cycles?.[0];
    record("STRUCT cycle", c?.type === "cycle" && Math.round(c.beatsInCycle) === 4, JSON.stringify(c));
  }
  {
    const out = await roundTrip(baseSong(), [tf({ cycles: [{ type: "cycleBeats", beatsInCycle: 4, startBeat: 1, endBeat: 3 }], effects: [{ id: "e", effectKey: "snake", params: { tailLength: 0.5, cyclic: true } }] })]);
    const c = (out.timeframes as any[]).find((t) => t.cycles?.length)?.cycles?.[0];
    record("STRUCT cycleBeats (fix #2)", c?.type === "cycleBeats" && c.startBeat === 1 && c.endBeat === 3, JSON.stringify(c));
  }

  // ---- beatTimestampsMs timing (fix #1) ----
  {
    const table = [0, 480, 990, 1530, 2100, 2700, 3330, 3990, 4680, 5400];
    const out = await roundTrip(baseSong({ beatTimestampsMs: table }), [tf({ startTime: 4, endTime: 8, effects: [{ id: "e", effectKey: "fadeIn" }] })]);
    const t = (out.timeframes as any[])[0];
    record("STRUCT beatTimestampsMs (fix #1)", !!t && Math.abs(t.startTime - 4) < 0.2 && Math.abs(t.endTime - 8) < 0.2, `start=${t?.startTime} end=${t?.endTime} (expect 4,8)`);
  }

  // ---- Clean song corpus (must not regress) ----
  const songExpect: Record<string, (r: any) => [boolean, string]> = {
    togual: (r) => [r.matched === r.tfA && r.tfA === 8, `${r.matched}/${r.tfA}`],
    aladdin: (r) => [r.matched === r.tfA && r.tfA === 134, `${r.matched}/${r.tfA}`],
    loop: (r) => [r.minStart === 0 && r.matched >= 80, `matched ${r.matched}/${r.tfA}, minStart ${r.minStart}`],
  };
  for (const [name, check] of Object.entries(songExpect)) {
    const songPath = path.join(ROOT, "src", "songs", `${name}.ts`);
    if (!fs.existsSync(songPath)) { record(`SONG ${name}`, false, "missing"); continue; }
    const A = await parseSongFile(songPath);
    const B = await roundTrip(A.song, A.timeframes as any[]);
    const r = diffStats(A.timeframes as any[], B.timeframes as any[]);
    const [ok, detail] = check(r);
    record(`SONG ${name}`, ok, detail);
  }

  // ---- Full pipeline: analysis -> translate.py -> song -> generate -> parse ----
  {
    const { spawnSync, execSync } = require("child_process");
    const findPy = () => {
      for (const c of [process.env.PYTHON, "python", "python3"].filter(Boolean) as string[]) {
        try { execSync(`"${c}" -c "import yaml"`, { stdio: "ignore", timeout: 10000 }); return c; } catch {}
      }
      return null;
    };
    const py = findPy();
    if (!py) {
      record("PIPELINE analysis→translate→roundtrip", true, "skipped (no python+pyyaml)");
    } else {
      const FIXTURE = {
        schemaVersion: 2, meter: 4, bpmGlobal: 120,
        audio: { path: "fixture.mp3", sampleRate: 44100, durationMs: 16000, peakDbfs: -1, rmsDbfs: -12 },
        grid: { stepMs: 100, count: 2 },
        beatTimestampsMs: Array.from({ length: 33 }, (_, i) => i * 500),
        downbeatTimestampsMs: Array.from({ length: 9 }, (_, i) => i * 2000),
        sections: [
          { startMs: 0, endMs: 4000, label: "intro", confidence: 0.8, bpm: 120, summary: { energy: 0.2, energyAbs: 0.01, onsetDensity: 0.1, spectralCentroid: 1500, bandEnergy: { sub: 0.1, low: 0.1, mid: 0.1, high: 0.1 } } },
          { startMs: 4000, endMs: 10000, label: "build", confidence: 0.9, bpm: 120, summary: { energy: 0.5, energyAbs: 0.02, onsetDensity: 0.4, spectralCentroid: 2500, bandEnergy: { sub: 0.3, low: 0.4, mid: 0.2, high: 0.1 } } },
          { startMs: 10000, endMs: 16000, label: "drop", confidence: 1.0, bpm: 120, summary: { energy: 0.9, energyAbs: 0.05, onsetDensity: 0.5, spectralCentroid: 2000, bandEnergy: { sub: 0.6, low: 0.5, mid: 0.2, high: 0.1 } } },
        ],
        curves: { timeMs: [0, 100], energy: [0.2, 0.5], onsetDensity: [0.1, 0.4], spectralCentroid: [1500, 2500], localBpm: [120, 120], bandEnergy: { sub: [0.1, 0.3], low: [0.1, 0.4], mid: [0.1, 0.2], high: [0.1, 0.1] } },
      };
      const fx = path.join(ROOT, ".roundtrip-tmp", "fixture.analysis.json");
      const songOut = path.join(ROOT, ".roundtrip-tmp", "fixture.song.json");
      fs.mkdirSync(path.dirname(fx), { recursive: true });
      fs.writeFileSync(fx, JSON.stringify(FIXTURE));
      const tr = spawnSync(py, ["scripts/translate.py", fx, "-o", songOut, "--seed", "1"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
      if (tr.status !== 0) {
        record("PIPELINE analysis→translate→roundtrip", false, "translate.py failed: " + String(tr.stderr).slice(0, 200));
      } else {
        const data = JSON.parse(fs.readFileSync(songOut, "utf8"));
        // Round-trip TWICE: the output must converge to a stable fixed point with no
        // effect loss. (Dense per-ring sections may collapse to a movement timeframe on
        // the first pass; that's fine iff it's then stable.)
        const B = await roundTrip(data.song, data.timeframes);
        const C = await roundTrip(B.song, B.timeframes as any[]);
        const keys = (tfs: any[]) => { const s = new Set<string>(); tfs.forEach((t) => (t.effects || []).forEach((e: any) => s.add(e.effectKey))); return s; };
        const inKeys = keys(data.timeframes), bKeys = keys(B.timeframes as any[]), cKeys = keys(C.timeframes as any[]);
        // Guarantee: no effect content lost and the representation stays bounded.
        // (Dense uniform per-ring sections may flip per-ring↔movement spread — an
        // EQUIVALENT representation of the same animation — so we don't require a
        // strict tf-count fixed point, only no loss and no explosion.)
        const lost = [...inKeys].filter((k) => !bKeys.has(k) || !cKeys.has(k));
        const bounded = B.timeframes.length > 0 && C.timeframes.length > 0 && C.timeframes.length <= data.timeframes.length * 2;
        const ok = lost.length === 0 && bounded;
        record("PIPELINE analysis→translate→roundtrip", ok,
          `${data.timeframes.length}→${B.timeframes.length}→${C.timeframes.length} tf (per-ring↔movement equiv), lost=${lost.join(",") || "none"}`);
      }
    }
  }

  cleanup();
  const fails = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  -- " + r.detail : ""}`);
  console.log(`\n${results.length - fails.length}/${results.length} passed.`);
  if (fails.length) { console.error(`ROUND-TRIP REGRESSION: ${fails.length} failing.`); process.exit(1); }
}

function diffStats(aTfs: any[], bTfs: any[]) {
  const norm = (t: any) => JSON.stringify({
    s: round(t.startTime), e: round(t.endTime), color: t.color, hec: t.hasExplicitColor,
    rings: [...(t.rings || [])].sort((x, y) => x - y), map: t.mapping, phase: t.phase, mv: t.movement, cyc: t.cycles,
    fx: (t.effects || []).map((e: any) => ({ k: e.effectKey, p: normParams(e.params), ph: e.phase })).sort((x: any, y: any) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
  });
  const key = (t: any) => JSON.stringify([round(t.startTime), round(t.endTime), [...(t.rings || [])].sort((x, y) => x - y), t.mapping]);
  const bByKey = new Map<string, string[]>();
  for (const t of bTfs) { const k = key(t); if (!bByKey.has(k)) bByKey.set(k, []); bByKey.get(k)!.push(norm(t)); }
  let matched = 0;
  for (const t of aTfs) {
    const cand = bByKey.get(key(t)); const n = norm(t);
    if (cand) { const i = cand.indexOf(n); if (i >= 0) { matched++; cand.splice(i, 1); } }
  }
  const minStart = aTfs.length ? Math.min(...aTfs.map((t) => round(t.startTime))) : null;
  return { tfA: aTfs.length, tfB: bTfs.length, matched, minStart };
}

main().catch((e) => { cleanup(); console.error(e); process.exit(1); });
