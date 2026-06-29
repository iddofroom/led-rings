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
