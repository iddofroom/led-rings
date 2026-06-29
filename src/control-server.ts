/**
 * Control server for the Timeline UI: send-sequence, start-song, stop.
 * Run from repo root: npx ts-node-dev src/control-server.ts
 * Set CONTROL_SERVER_PORT (default 3080).
 */
import http from "http";
import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";
import { sendSequence } from "./services/sequence";
import { startSong, stop, trigger } from "./services/trigger";
import { initMqttBrightness, getBrightnessState, setBrightness } from "./mqtt-brightness";

const PORT = parseInt(process.env.CONTROL_SERVER_PORT || "3080", 10);
const ROOT = process.cwd();

/** Find a Python executable that has librosa installed. */
function findPython(): string {
  const candidates = [
    process.env.PYTHON,
    "python",
    "python3",
  ].filter(Boolean) as string[];

  // Also check for virtualenvs in common locations
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const venvGlob = path.join(home, ".virtualenvs");
  try {
    if (fs.existsSync(venvGlob)) {
      for (const dir of fs.readdirSync(venvGlob)) {
        const winPath = path.join(venvGlob, dir, "Scripts", "python.exe");
        const unixPath = path.join(venvGlob, dir, "bin", "python");
        if (fs.existsSync(winPath)) candidates.push(winPath);
        else if (fs.existsSync(unixPath)) candidates.push(unixPath);
      }
    }
  } catch {}

  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" -c "import librosa"`, { stdio: "ignore", timeout: 10000 });
      return cmd;
    } catch {}
  }
  return "python"; // fallback
}

const PYTHON_CMD = findPython();

function send(res: http.ServerResponse, status: number, body: string, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

/** Resolve an audio file path, checking multiple known locations. */
function resolveAudioPath(rawPath: string): string | null {
  const asIs = path.resolve(ROOT, rawPath);
  if (fs.existsSync(asIs) && fs.statSync(asIs).isFile()) return asIs;
  const publicPath = path.resolve(ROOT, "ui", "public", rawPath);
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) return publicPath;
  const songsPath = path.resolve(ROOT, "src", "songs", path.basename(rawPath));
  if (fs.existsSync(songsPath) && fs.statSync(songsPath).isFile()) return songsPath;
  const audioPath = path.resolve(ROOT, "src", "audio", path.basename(rawPath));
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).isFile()) return audioPath;
  return null;
}

/** Spawn a Python script, resolve with {code, stdout, stderr}. */
function runPython(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_CMD, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Execute a TS file directly (it calls sendSequence/startSong itself). */
async function handleRunFile(filePath: string, res: http.ServerResponse, sendOnly = false) {
  const resolved = path.resolve(ROOT, filePath);
  if (!resolved.startsWith(ROOT) || !fs.existsSync(resolved)) {
    send(res, 400, JSON.stringify({ error: "File not found: " + filePath }));
    return;
  }
  const env = { ...process.env, ...(sendOnly ? { SEND_ONLY: "1" } : {}) };
  const child = spawn(process.execPath, ["-r", "ts-node/register", filePath], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (d) => { stderr += d.toString(); });
  child.stdout?.on("data", () => {});

  await new Promise<void>((resolve) => child.on("close", () => resolve()));

  if (child.exitCode !== 0) {
    console.error("Run file failed", stderr);
    send(res, 500, JSON.stringify({ error: "Run file failed", stderr: stderr.slice(0, 500) }));
    return;
  }
  send(res, 200, JSON.stringify({ ok: true }));
}

/** Legacy: execute inline runner code via temp file + JSON output. */
async function handleSendSequence(runnerCode: string, res: http.ServerResponse) {
  const runnerPath = path.join(ROOT, "src", ".tmp-sequence-runner.ts");
  const outPath = path.join(ROOT, ".tmp-sequence-out.json");
  try {
    fs.writeFileSync(runnerPath, runnerCode, "utf8");
  } catch (e) {
    console.error("Failed to write runner file", e);
    send(res, 500, JSON.stringify({ error: "Failed to write runner file" }));
    return;
  }

  // Use same Node as this process; avoid npx (ENOENT on Windows when PATH is minimal)
  const child = spawn(process.execPath, ["-r", "ts-node/register", "src/.tmp-sequence-runner.ts"], {
    cwd: ROOT,
    env: { ...process.env, TMP_SEQUENCE_OUT: outPath },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (d) => { stderr += d.toString(); });
  child.stdout?.on("data", () => {});

  await new Promise<void>((resolve) => child.on("close", (code) => resolve()));

  try {
    fs.unlinkSync(runnerPath);
  } catch (_) {}

  if (child.exitCode !== 0) {
    console.error("Runner failed", stderr);
    send(res, 500, JSON.stringify({ error: "Runner failed", stderr: stderr.slice(0, 500) }));
    return;
  }

  let data: { triggerName: string; sequence: Record<string, unknown> };
  try {
    const raw = fs.readFileSync(outPath, "utf8");
    fs.unlinkSync(outPath);
    data = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to read runner output", e);
    send(res, 500, JSON.stringify({ error: "Failed to read runner output" }));
    return;
  }

  try {
    await sendSequence(data.triggerName, data.sequence as any);
    send(res, 200, JSON.stringify({ ok: true, triggerName: data.triggerName }));
  } catch (e) {
    console.error("sendSequence failed", e);
    send(res, 500, JSON.stringify({ error: "sendSequence failed" }));
  }
}

async function handleParseSong(songCode: string, fileName: string, res: http.ServerResponse) {
  // Write to src/songs/ so relative imports (../effects/, ../time/, etc.) resolve
  const safeName = `.tmp-parse-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  const songPath = path.join(ROOT, "src", "songs", safeName);
  const outPath = path.join(ROOT, `.tmp-parse-out-${Date.now()}.json`);
  try {
    fs.writeFileSync(songPath, songCode, "utf8");
  } catch (e) {
    console.error("Failed to write temp song file", e);
    send(res, 500, JSON.stringify({ error: "Failed to write temp song file" }));
    return;
  }

  // Run export-song.ts in a child process for isolation
  const child = spawn(process.execPath, ["-r", "ts-node/register", "src/export-song.ts", songPath], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (d) => { stderr += d.toString(); });
  child.stdout?.on("data", () => {});

  await new Promise<void>((resolve) => child.on("close", () => resolve()));

  try { fs.unlinkSync(songPath); } catch (_) {}

  if (child.exitCode !== 0) {
    console.error("Parse song failed", stderr);
    send(res, 500, JSON.stringify({ error: "Parse song failed", stderr: stderr.slice(0, 500) }));
    return;
  }

  // export-song.ts writes to <songPath>.json (replacing .ts with .json)
  const jsonPath = songPath.replace(/\.ts$/, ".json");
  try {
    const raw = fs.readFileSync(jsonPath, "utf8");
    fs.unlinkSync(jsonPath);
    send(res, 200, raw);
  } catch (e) {
    console.error("Failed to read parse output", e);
    send(res, 500, JSON.stringify({ error: "Failed to read parse output" }));
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "";
  const pathname = url.split("?")[0];

  if (req.method === "POST" && pathname === "/api/send-sequence") {
    const body = await parseBody(req);
    let payload: { runnerCode?: string; filePath?: string; sendOnly?: boolean };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.filePath === "string") {
      await handleRunFile(payload.filePath, res, !!payload.sendOnly);
    } else if (typeof payload.runnerCode === "string") {
      await handleSendSequence(payload.runnerCode, res);
    } else {
      send(res, 400, JSON.stringify({ error: "Missing filePath or runnerCode" }));
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/start-song") {
    const body = await parseBody(req);
    let payload: { songName?: string; startOffsetSeconds?: number };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.songName !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing songName" }));
      return;
    }
    try {
      await startSong(payload.songName, payload.startOffsetSeconds);
      send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("startSong failed", e);
      send(res, 500, JSON.stringify({ error: "startSong failed" }));
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/trigger") {
    const body = await parseBody(req);
    let payload: { triggerName?: string; startOffsetSeconds?: number };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.triggerName !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing triggerName" }));
      return;
    }
    try {
      await trigger(payload.triggerName, payload.startOffsetSeconds);
      send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("trigger failed", e);
      send(res, 500, JSON.stringify({ error: "trigger failed" }));
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/stop") {
    try {
      await stop();
      send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("stop failed", e);
      send(res, 500, JSON.stringify({ error: "stop failed" }));
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/parse-song") {
    const body = await parseBody(req);
    let payload: { songCode?: string; fileName?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.songCode !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing songCode" }));
      return;
    }
    await handleParseSong(payload.songCode, payload.fileName || "import.ts", res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/detect-beats") {
    const body = await parseBody(req);
    let payload: { audioFilePath?: string; bpm?: number; method?: string; startSec?: number; endSec?: number; fillGrid?: boolean };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.audioFilePath !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing audioFilePath" }));
      return;
    }
    const startSec = payload.startSec;
    const endSec = payload.endSec;
    const useRange = typeof startSec === "number" && typeof endSec === "number";
    if (useRange && startSec >= endSec) {
      send(res, 400, JSON.stringify({ error: "startSec must be less than endSec" }));
      return;
    }
    const audioPath = resolveAudioPath(payload.audioFilePath);
    if (!audioPath) {
      send(res, 404, JSON.stringify({ error: "Audio file not found" }));
      return;
    }
    const scriptPath = path.join(ROOT, "scripts", "detect_beats.py");
    const pyArgs = [scriptPath, audioPath];
    if (payload.method === "onset" || payload.method === "beats") {
      pyArgs.push("--method", payload.method);
    }
    if (typeof payload.bpm === "number" && payload.bpm > 0) {
      pyArgs.push("--bpm", String(payload.bpm));
    }
    if (useRange) {
      pyArgs.push("--start-sec", String(startSec), "--end-sec", String(endSec), "--output", "-");
      if (payload.fillGrid) {
        pyArgs.push("--fill-grid");
      }
    }
    const child = spawn(PYTHON_CMD, pyArgs, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    await new Promise<void>((resolve) => child.on("close", () => resolve()));

    if (child.exitCode !== 0) {
      console.error("Beat detection failed", stderr);
      send(res, 500, JSON.stringify({ error: "Beat detection failed", stderr: stderr.slice(0, 500) }));
      return;
    }

    if (useRange) {
      try {
        send(res, 200, stdout);
      } catch (e) {
        console.error("Invalid JSON from script", e);
        send(res, 500, JSON.stringify({ error: "Invalid JSON from beat detection script" }));
      }
    } else {
      const beatsPath = audioPath.replace(/\.[^.]+$/, ".beats.json");
      try {
        const raw = fs.readFileSync(beatsPath, "utf8");
        send(res, 200, raw);
      } catch (e) {
        console.error("Failed to read beats file", e);
        send(res, 500, JSON.stringify({ error: "Failed to read beats file" }));
      }
    }
    return;
  }

  // GET /api/audio?path=... — serve audio file for spectrogram (same path resolution as detect-beats)
  if (req.method === "GET" && pathname === "/api/audio") {
    const q = new URL(url, `http://localhost`).searchParams;
    const audioPathParam = q.get("path");
    if (typeof audioPathParam !== "string" || !audioPathParam.trim()) {
      send(res, 400, JSON.stringify({ error: "Missing path query" }));
      return;
    }
    const audioPath = resolveAudioPath(audioPathParam);
    if (!audioPath) {
      send(res, 404, JSON.stringify({ error: "Audio file not found" }));
      return;
    }
    const ext = path.extname(audioPath).toLowerCase();
    const contentType =
      ext === ".wav" ? "audio/wav" : ext === ".mp3" ? "audio/mpeg" : "application/octet-stream";
    const contentLength = fs.statSync(audioPath).size;
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": contentLength,
    });
    fs.createReadStream(audioPath).pipe(res);
    return;
  }

  // POST /api/save-file — save a file to the repo (e.g. generated .ts to src/songs/)
  if (req.method === "POST" && pathname === "/api/save-file") {
    const body = await parseBody(req);
    let payload: { path?: string; content?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.path !== "string" || typeof payload.content !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing path or content" }));
      return;
    }
    const resolved = path.resolve(ROOT, payload.path);
    if (!resolved.startsWith(ROOT)) {
      send(res, 400, JSON.stringify({ error: "Path must be within the repo" }));
      return;
    }
    try {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, payload.content, "utf8");
      send(res, 200, JSON.stringify({ ok: true, path: payload.path }));
    } catch (e) {
      console.error("Failed to save file", e);
      send(res, 500, JSON.stringify({ error: "Failed to save file" }));
    }
    return;
  }

  // POST /api/upload-audio — upload audio file to ui/public/
  if (req.method === "POST" && pathname === "/api/upload-audio") {
    const body = await parseBody(req);
    let payload: { filename?: string; data?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.filename !== "string" || typeof payload.data !== "string") {
      send(res, 400, JSON.stringify({ error: "Missing filename or data" }));
      return;
    }
    const ext = path.extname(payload.filename).toLowerCase();
    if (ext !== ".wav" && ext !== ".mp3") {
      send(res, 400, JSON.stringify({ error: "Only .wav and .mp3 files are supported" }));
      return;
    }
    const basename = path.basename(payload.filename);
    const publicDir = path.resolve(ROOT, "ui", "public");
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    const dest = path.join(publicDir, basename);
    try {
      fs.writeFileSync(dest, Buffer.from(payload.data, "base64"));
      send(res, 200, JSON.stringify({ ok: true, savedPath: basename }));
    } catch (e) {
      console.error("Failed to upload audio", e);
      send(res, 500, JSON.stringify({ error: "Failed to upload audio" }));
    }
    return;
  }

  // GET /api/brightness — returns current brightness value and MQTT connection state
  if (req.method === "GET" && pathname === "/api/brightness") {
    send(res, 200, JSON.stringify(getBrightnessState()));
    return;
  }

  // POST /api/brightness — set brightness, publishes to MQTT with retain
  if (req.method === "POST" && pathname === "/api/brightness") {
    const body = await parseBody(req);
    let payload: { value?: number };
    try {
      payload = JSON.parse(body);
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    if (typeof payload.value !== "number" || isNaN(payload.value)) {
      send(res, 400, JSON.stringify({ error: "Missing or invalid value" }));
      return;
    }
    const value = setBrightness(payload.value);
    send(res, 200, JSON.stringify({ value, connected: getBrightnessState().connected }));
    return;
  }

  // POST /api/analyze — full MIR analysis (scripts/analyze_music.py) -> analysis.json
  if (req.method === "POST" && pathname === "/api/analyze") {
    const body = await parseBody(req);
    let payload: { audioFilePath?: string; bpm?: number; meter?: number; sections?: number };
    try { payload = JSON.parse(body); } catch { send(res, 400, JSON.stringify({ error: "Invalid JSON" })); return; }
    if (typeof payload.audioFilePath !== "string") { send(res, 400, JSON.stringify({ error: "Missing audioFilePath" })); return; }
    const audioPath = resolveAudioPath(payload.audioFilePath);
    if (!audioPath) { send(res, 404, JSON.stringify({ error: "Audio file not found" })); return; }
    const outPath = path.join(ROOT, `.tmp-analysis-${Date.now()}.json`);
    const args = [path.join(ROOT, "scripts", "analyze_music.py"), audioPath, "-o", outPath];
    if (typeof payload.bpm === "number" && payload.bpm > 0) args.push("--bpm", String(payload.bpm));
    if (typeof payload.meter === "number" && payload.meter >= 1) args.push("--meter", String(payload.meter));
    if (typeof payload.sections === "number" && payload.sections >= 2) args.push("--sections", String(payload.sections));
    const r = await runPython(args);
    if (r.code !== 0) { console.error("analyze failed", r.stderr); send(res, 500, JSON.stringify({ error: "analyze failed", stderr: r.stderr.slice(0, 800) })); return; }
    try { const raw = fs.readFileSync(outPath, "utf8"); fs.unlinkSync(outPath); send(res, 200, raw); }
    catch (e) { send(res, 500, JSON.stringify({ error: "Failed to read analysis output" })); }
    return;
  }

  // GET /api/taste-rules — read taste/rules.yaml
  if (req.method === "GET" && pathname === "/api/taste-rules") {
    try {
      const content = fs.readFileSync(path.join(ROOT, "taste", "rules.yaml"), "utf8");
      send(res, 200, JSON.stringify({ content }));
    } catch (e) { send(res, 500, JSON.stringify({ error: "Failed to read taste/rules.yaml" })); }
    return;
  }

  // POST /api/taste-rules — save taste/rules.yaml
  if (req.method === "POST" && pathname === "/api/taste-rules") {
    const body = await parseBody(req);
    let payload: { content?: string };
    try { payload = JSON.parse(body); } catch { send(res, 400, JSON.stringify({ error: "Invalid JSON" })); return; }
    if (typeof payload.content !== "string") { send(res, 400, JSON.stringify({ error: "Missing content" })); return; }
    try {
      fs.writeFileSync(path.join(ROOT, "taste", "rules.yaml"), payload.content, "utf8");
      send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) { send(res, 500, JSON.stringify({ error: "Failed to write taste/rules.yaml" })); }
    return;
  }

  // POST /api/translate — analysis (+ current rules) -> canonical {song, timeframes}
  if (req.method === "POST" && pathname === "/api/translate") {
    const body = await parseBody(req);
    let payload: { analysis?: unknown; section?: number; useLlm?: boolean };
    try { payload = JSON.parse(body); } catch { send(res, 400, JSON.stringify({ error: "Invalid JSON" })); return; }
    if (!payload.analysis || typeof payload.analysis !== "object") { send(res, 400, JSON.stringify({ error: "Missing analysis object" })); return; }
    const ts = Date.now();
    const inPath = path.join(ROOT, `.tmp-analysis-in-${ts}.json`);
    const outPath = path.join(ROOT, `.tmp-song-out-${ts}.json`);
    try { fs.writeFileSync(inPath, JSON.stringify(payload.analysis), "utf8"); }
    catch (e) { send(res, 500, JSON.stringify({ error: "Failed to write analysis temp" })); return; }
    const args = [path.join(ROOT, "scripts", "translate.py"), inPath, "-o", outPath];
    if (typeof payload.section === "number") args.push("--section", String(payload.section));
    if (payload.useLlm) args.push("--llm");
    const r = await runPython(args);
    try { fs.unlinkSync(inPath); } catch {}
    if (r.code !== 0) { console.error("translate failed", r.stderr); send(res, 500, JSON.stringify({ error: "translate failed", stderr: r.stderr.slice(0, 800) })); return; }
    try { const raw = fs.readFileSync(outPath, "utf8"); fs.unlinkSync(outPath); send(res, 200, raw); }
    catch (e) { send(res, 500, JSON.stringify({ error: "Failed to read song output" })); }
    return;
  }

  send(res, 404, JSON.stringify({ error: "Not found" }));
});

initMqttBrightness();

server.listen(PORT, () => {
  console.log(`Control server listening on http://localhost:${PORT}`);
  console.log(`Python for beat detection: ${PYTHON_CMD}`);
});
