/**
 * PHASE 5 — one-command driver: audio in -> analysis + composition + .ts, one step.
 *
 *   yarn compose "src/audio/song.mp3" [--seed N] [--section N] [--llm] [--explain]
 *                [--rules taste/rules.yaml] [--bpm N] [--no-ts] [--open]
 *
 * Runs scripts/analyze_music.py -> <name>.analysis.json, then scripts/translate.py ->
 * <name>.song.json (the canonical {song,timeframes}), then generates src/songs/<name>.ts
 * from that JSON via the UI generator (so it round-trips). --open launches the UI.
 *
 * The deterministic path needs no API key and is instant. --llm adds Gemini pattern
 * choice (needs GEMINI_API_KEY). Edit taste/rules.yaml to own the style.
 */
import * as path from "path";
import * as fs from "fs";
import { spawnSync, execSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function flag(name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) { args.splice(i, 1); return true; }
  return false;
}
function opt(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) { const v = args[i + 1]; args.splice(i, 2); return v; }
  return undefined;
}

const doOpen = flag("--open");
const noTs = flag("--no-ts");
const useLlm = flag("--llm");
const explain = flag("--explain");
const seed = opt("--seed");
const section = opt("--section");
const rules = opt("--rules");
const bpm = opt("--bpm");
const audio = args[0];

if (!audio) {
  console.error('Usage: yarn compose "<audio file>" [--seed N] [--section N] [--llm] [--explain] [--rules path] [--bpm N] [--no-ts] [--open]');
  process.exit(1);
}

function findPython(): string {
  for (const cmd of [process.env.PYTHON, "python", "python3"].filter(Boolean) as string[]) {
    try { execSync(`"${cmd}" -c "import librosa"`, { stdio: "ignore", timeout: 15000 }); return cmd; } catch {}
  }
  return "python";
}
const PY = findPython();

function run(label: string, cmd: string, cmdArgs: string[]) {
  process.stdout.write(`\n▸ ${label}\n  ${cmd} ${cmdArgs.map(a => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: process.env });
  if (r.status !== 0) { console.error(`✗ ${label} failed (exit ${r.status}).`); process.exit(r.status ?? 1); }
}

const stem = path.basename(audio).replace(/\.[^.]+$/, "");
const safe = stem.replace(/[^a-zA-Z0-9._-]+/g, "_");
const analysisPath = path.join(ROOT, `${safe}.analysis.json`);
const songPath = path.join(ROOT, `${safe}.song.json`);

// 1. analyze
const aArgs = ["scripts/analyze_music.py", audio, "-o", analysisPath, "--validate"];
if (bpm) aArgs.push("--bpm", bpm);
run("Analyze audio (librosa MIR)", PY, aArgs);

// 2. translate
const tArgs = ["scripts/translate.py", analysisPath, "-o", songPath];
if (seed) tArgs.push("--seed", seed);
if (section) tArgs.push("--section", section);
if (rules) tArgs.push("--rules", rules);
if (useLlm) tArgs.push("--llm");
if (explain) tArgs.push("--explain");
run("Translate (taste rules -> beat-synced patterns)", PY, tArgs);

// 3. generate .ts from the canonical JSON (so it round-trips)
let tsPath: string | null = null;
if (!noTs) {
  process.stdout.write("\n▸ Generate src/songs/" + safe + ".ts (UI generator)\n");
  const tmpGen = path.join(ROOT, ".compose-tmp");
  fs.mkdirSync(tmpGen, { recursive: true });
  for (const f of ["generateSequenceTs.ts", "movementGenerators.ts"]) {
    fs.copyFileSync(path.join(ROOT, "ui", "src", f), path.join(tmpGen, f));
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateSequenceTs } = require(path.join(tmpGen, "generateSequenceTs.ts"));
    const data = JSON.parse(fs.readFileSync(songPath, "utf8"));
    const ts = generateSequenceTs(data.song, data.timeframes, "..");
    tsPath = path.join(ROOT, "src", "songs", `${safe}.ts`);
    fs.writeFileSync(tsPath, ts);
    process.stdout.write(`  wrote ${path.relative(ROOT, tsPath)}\n`);
  } finally {
    fs.rmSync(tmpGen, { recursive: true, force: true });
  }
}

// 4. summary
const data = JSON.parse(fs.readFileSync(songPath, "utf8"));
console.log("\n✓ Composed.");
console.log(`  analysis : ${path.relative(ROOT, analysisPath)}`);
console.log(`  song JSON: ${path.relative(ROOT, songPath)}  (${data.timeframes.length} timeframes)`);
if (tsPath) console.log(`  song TS  : ${path.relative(ROOT, tsPath)}`);
console.log(`\nLoad it: in the UI click 🎵 Compose to regenerate live, or open the song JSON via Load.`);

if (doOpen) {
  try {
    const url = "http://localhost:5173/";
    if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else spawnSync(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
    console.log(`Opened ${url}`);
  } catch {}
}
