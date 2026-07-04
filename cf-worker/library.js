// KV-backed song library for the LED composition tool.
//
// Stores, per song, everything the workbench produces so progress survives across
// machines and sessions:
//   song:<slug>:meta            JSON  { slug, name, bpm, lengthSeconds, audioFilename,
//                                       beatTimestampsMs?, animationType, createdAt, updatedAt }
//   song:<slug>:analysis        JSON  full analyze_music.py output
//   song:<slug>:audio           bytes the uploaded MP3/WAV (KV metadata holds contentType)
//   song:<slug>:working         JSON  { song, timeframes, updatedAt } — auto-saved live timeline
//   song:<slug>:comp:<name>     JSON  named saved animation { name, method, song, timeframes }
//
// handleLibrary() returns a Response for /api/library/* routes, or null to let the
// caller fall through to the normal host proxy.

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB hard cap per upload (KV value limit is 25 MB)
const MAX_JSON_BYTES = 8 * 1024 * 1024; // 8 MB cap for analysis / composition payloads

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Library-Key',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}
function rawJson(str) {
  return new Response(str, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

function slugify(s) {
  return (
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9֐-׿]+/g, '-') // keep Hebrew letters too
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

// Per-project namespacing: the built-in "rings" project keeps the legacy `song:` prefix (no
// migration); any other project id lives under `proj:<id>:song:`. So every key builder is
// scoped by a project id (pid).
const projectPrefix = (pid) => (pid && pid !== 'rings' ? `proj:${pid}:` : '');
const songListPrefix = (pid) => `${projectPrefix(pid)}song:`;
const metaKey = (pid, slug) => `${songListPrefix(pid)}${slug}:meta`;
const analysisKey = (pid, slug) => `${songListPrefix(pid)}${slug}:analysis`;
const audioKey = (pid, slug) => `${songListPrefix(pid)}${slug}:audio`;
const workingKey = (pid, slug) => `${songListPrefix(pid)}${slug}:working`;
const compKey = (pid, slug, comp) => `${songListPrefix(pid)}${slug}:comp:${comp}`;
const compPrefix = (pid, slug) => `${songListPrefix(pid)}${slug}:comp:`;
// Version history (git-like): each manual Save is an immutable snapshot with a parent +
// branch, so the timeline can be rolled back and branched.
const verKey = (pid, slug, id) => `${songListPrefix(pid)}${slug}:ver:${id}`;
const verPrefix = (pid, slug) => `${songListPrefix(pid)}${slug}:ver:`;

// Camera-derived LED position map for the installation (one blob per project). KivSee's
// geometry schema is 1-D (index+relPos), so the (x,y) map lives here, not in led-object-service.
const mappingKey = (pid) => `${projectPrefix(pid)}mapping`;

// Declared controllers for the installation (one blob per project): the user names each ESP
// and lists its LED output GPIO pins — NO led count (that's discovered by the camera mapping).
const devicesKey = (pid) => `${projectPrefix(pid)}devices`;

// Installation flow rules (one blob per project): map physical inputs (RFID scans) to actions
// (play a song, fire a trigger, set brightness). Interpreted on the Pi by the flow engine.
const flowKey = (pid) => `${projectPrefix(pid)}flow`;

// Registry of non-default projects. "rings" is implicit/built-in and always listed first.
const PROJECTS_INDEX = 'projects:index';

/** Normalize a project id from a request. Empty/unsluggable input defaults to built-in "rings"
 *  (must NOT fall through to slugify's "untitled" fallback, or a blank project would orphan data). */
function normProject(p) {
  const s = String(p || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'rings';
}

// ── Per-project membership (roles) ────────────────────────────────────────────
// `project:<id>:members` → { "<email-lc>": { role:'admin'|'member', addedAt, addedBy } }.
// Separate from the song data keys; authorization is by the caller's verified email.
const membersKey = (pid) => `project:${pid}:members`;

async function readMembers(KV, pid) {
  try {
    const raw = await KV.get(membersKey(pid), 'json');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {}; // corrupt/non-JSON members blob → treat as empty (fail closed, no crash)
  }
}
function writeMembers(KV, pid, members) {
  return KV.put(membersKey(pid), JSON.stringify(members));
}

/**
 * The caller's role in a project: 'admin' | 'member' | null. The built-in "rings" project is
 * owned by OWNER_EMAIL, seeded as its admin on first access so the owner always retains control.
 * Exported for the Worker's LED-control gate.
 */
export async function roleOf(KV, pidRaw, email, ownerEmail) {
  if (!KV || !email) return null;
  const pid = normProject(pidRaw);
  const members = await readMembers(KV, pid);
  const m = members[email];
  if (m && (m.role === 'admin' || m.role === 'member')) return m.role;
  if (pid === 'rings' && ownerEmail && email === ownerEmail && !members[email]) {
    members[email] = { role: 'admin', addedAt: Date.now(), addedBy: 'system' };
    try { await writeMembers(KV, pid, members); } catch {}
    return 'admin';
  }
  return null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function numOr(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function guessAudioType(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.wav')) return 'audio/wav';
  if (n.endsWith('.ogg')) return 'audio/ogg';
  if (n.endsWith('.m4a')) return 'audio/mp4';
  return 'audio/mpeg';
}
function base64ToBytes(b64) {
  const i = b64.indexOf(',');
  const raw = b64.startsWith('data:') && i >= 0 ? b64.slice(i + 1) : b64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
  return bytes;
}

export async function handleLibrary(request, env, url, auth) {
  const p = url.pathname;
  if (!p.startsWith('/api/library')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const KV = env && env.LED_LIBRARY;
  if (!KV) return err('Library storage not configured (KV binding missing)', 500);

  // Which installation/project this request targets (defaults to the built-in "rings").
  const pid = normProject(url.searchParams.get('project'));
  const isPost = request.method === 'POST';

  // ── Authorization ──
  // The local-dev library key is a superuser and skips membership. Otherwise a verified email is
  // required, and every project-scoped route needs membership in `pid` (admin for member mgmt).
  const a = auth || {};
  const email = a.email || '';
  const ownerEmail = a.ownerEmail || '';
  const superuser = !!a.isSuperuser;
  if (!superuser) {
    if (!email) return err('Unauthorized', 401);
    const selfScoped = p === '/api/library/projects' || (p === '/api/library/project' && isPost);
    if (!selfScoped) {
      const role = await roleOf(KV, pid, email, ownerEmail);
      if (!role) return err('Not a member of this project', 403);
      const adminOnly = p === '/api/library/member' || p === '/api/library/member/remove';
      if (adminOnly && role !== 'admin') return err('Admin only', 403);
    }
  }

  try {
    // Project registry — the list is user-scoped; creating one makes the caller its admin.
    if (request.method === 'GET' && p === '/api/library/projects') return await listProjects(KV, email, ownerEmail, superuser);
    if (isPost && p === '/api/library/project') return await createProject(KV, request, email);

    // Per-project membership management.
    if (request.method === 'GET' && p === '/api/library/members') return await listMembersRoute(KV, pid);
    if (isPost && p === '/api/library/member') return await addMemberRoute(KV, pid, request, email);
    if (isPost && p === '/api/library/member/remove') return await removeMemberRoute(KV, pid, request);

    if (request.method === 'GET' && p === '/api/library/songs') return await listSongs(KV, pid);
    if (request.method === 'GET' && p === '/api/library/song') return await getSong(KV, pid, url.searchParams.get('slug'));
    if ((request.method === 'GET' || request.method === 'HEAD') && p === '/api/library/audio')
      return await getAudio(KV, pid, url.searchParams.get('slug'), request.method === 'HEAD');
    if (request.method === 'GET' && p === '/api/library/analysis') {
      const slug = slugSafe(url.searchParams.get('slug'));
      if (!slug) return err('Missing slug');
      const a = await KV.get(analysisKey(pid, slug));
      return a == null ? err('No analysis', 404) : rawJson(a);
    }
    if (request.method === 'GET' && p === '/api/library/composition') {
      const slug = slugSafe(url.searchParams.get('slug'));
      const comp = url.searchParams.get('comp') || 'working';
      if (!slug) return err('Missing slug');
      const key = comp === 'working' ? workingKey(pid, slug) : compKey(pid, slug, slugify(comp));
      const v = await KV.get(key);
      return v == null ? err('Composition not found', 404) : rawJson(v);
    }

    if (request.method === 'GET' && p === '/api/library/mapping') return await getMapping(KV, pid);
    if (request.method === 'POST' && p === '/api/library/mapping') return await saveMapping(KV, pid, request);

    if (request.method === 'GET' && p === '/api/library/devices') return await getDevices(KV, pid);
    if (request.method === 'POST' && p === '/api/library/device') return await upsertDevice(KV, pid, request, email);
    if (request.method === 'POST' && p === '/api/library/device/remove') return await removeDevice(KV, pid, request);

    if (request.method === 'GET' && p === '/api/library/flow') return await getFlow(KV, pid);
    if (request.method === 'POST' && p === '/api/library/flow') return await saveFlow(KV, pid, request);

    if (request.method === 'GET' && p === '/api/library/versions') return await listVersions(KV, pid, url.searchParams.get('slug'));
    if (request.method === 'GET' && p === '/api/library/version')
      return await getVersion(KV, pid, url.searchParams.get('slug'), url.searchParams.get('id'));

    if (request.method === 'POST' && p === '/api/library/song') return await upsertSong(KV, pid, request);
    if (request.method === 'POST' && p === '/api/library/composition') return await upsertComposition(KV, pid, request);
    if (request.method === 'POST' && p === '/api/library/version') return await createVersion(KV, pid, request);
    if (request.method === 'POST' && p === '/api/library/delete') return await deleteEntry(KV, pid, request);

    return err('Unknown library route: ' + p, 404);
  } catch (e) {
    return err('Library error: ' + (e && e.message ? e.message : String(e)), 500);
  }
}

function slugSafe(s) {
  return s ? slugify(s) : '';
}

async function listSongs(KV, pid) {
  const listPrefix = songListPrefix(pid);
  const songs = new Map();
  let cursor;
  do {
    const res = await KV.list({ prefix: listPrefix, cursor, limit: 1000 });
    for (const k of res.keys) {
      const rest = k.name.slice(listPrefix.length);
      const i = rest.indexOf(':');
      if (i < 0) continue;
      const slug = rest.slice(0, i);
      const tail = rest.slice(i + 1);
      if (!songs.has(slug)) songs.set(slug, { slug, compositions: [], hasAnalysis: false, hasAudio: false, hasWorking: false });
      const entry = songs.get(slug);
      const md = k.metadata || {};
      if (tail === 'meta') Object.assign(entry, md, { slug });
      else if (tail === 'analysis') entry.hasAnalysis = true;
      else if (tail === 'audio') {
        entry.hasAudio = true;
        if (md.size) entry.audioSize = md.size;
        if (md.filename && !entry.audioFilename) entry.audioFilename = md.filename;
      } else if (tail === 'working') entry.hasWorking = true;
      else if (tail.startsWith('comp:')) entry.compositions.push({ slug: tail.slice('comp:'.length), ...md });
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  const arr = [...songs.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const s of arr) s.compositions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ songs: arr });
}

async function getSong(KV, pid, slugRaw) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  const prefix = `${songListPrefix(pid)}${slug}:`;
  const flags = { hasAnalysis: false, hasAudio: false, hasWorking: false };
  const comps = [];
  let cursor;
  do {
    const res = await KV.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) {
      const tail = k.name.slice(prefix.length);
      if (tail === 'analysis') flags.hasAnalysis = true;
      else if (tail === 'audio') flags.hasAudio = true;
      else if (tail === 'working') flags.hasWorking = true;
      else if (tail.startsWith('comp:')) comps.push({ slug: tail.slice('comp:'.length), ...(k.metadata || {}) });
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  const meta = await KV.get(metaKey(pid, slug), 'json');
  if (!meta && !flags.hasAudio && comps.length === 0) return err('Song not found', 404);
  comps.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ slug, meta, ...flags, compositions: comps });
}

async function getAudio(KV, pid, slugRaw, headOnly) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  if (headOnly) {
    // Cheap existence check — list the exact key for its metadata, never read the 5 MB value.
    const res = await KV.list({ prefix: audioKey(pid, slug), limit: 1 });
    const k = res.keys.find((x) => x.name === audioKey(pid, slug));
    if (!k) return new Response(null, { status: 404, headers: CORS });
    const md = k.metadata || {};
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': md.contentType || 'audio/mpeg', 'Content-Length': String(md.size || 0), 'Accept-Ranges': 'bytes', ...CORS },
    });
  }
  const { value, metadata } = await KV.getWithMetadata(audioKey(pid, slug), { type: 'arrayBuffer' });
  if (value == null) return err('Audio not found', 404);
  const ct = (metadata && metadata.contentType) || 'audio/mpeg';
  return new Response(value, {
    headers: {
      'Content-Type': ct,
      'Content-Length': String(value.byteLength),
      'Accept-Ranges': 'bytes',
      // Access-controlled per project — must NOT be shared/edge-cacheable, or a cached URL could
      // serve one project's audio to a non-member. `private` = the user's own browser only.
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function upsertSong(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = body.slug ? slugify(body.slug) : slugify(body.name || body.audioFilename || '');
  if (!slug) return err('Missing name/slug');

  const existing = (await KV.get(metaKey(pid, slug), 'json')) || {};
  const now = Date.now();
  const meta = {
    slug,
    name: body.name != null ? String(body.name) : existing.name || slug,
    bpm: numOr(body.bpm, existing.bpm, 120),
    lengthSeconds: numOr(body.lengthSeconds, existing.lengthSeconds, 0),
    startOffsetMs: numOr(body.startOffsetMs, existing.startOffsetMs, 0),
    animationType: body.animationType || existing.animationType || 'song',
    audioFilename: body.audioFilename != null ? String(body.audioFilename) : existing.audioFilename,
    audioContentType: existing.audioContentType,
    beatTimestampsMs: Array.isArray(body.beatTimestampsMs) ? body.beatTimestampsMs : existing.beatTimestampsMs,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };

  const writes = [];

  if (typeof body.audioBase64 === 'string' && body.audioBase64.length > 0) {
    const bytes = base64ToBytes(body.audioBase64);
    if (bytes.byteLength > MAX_AUDIO_BYTES) return err('Audio too large (max 20MB)', 413);
    const ct = body.audioContentType || guessAudioType(meta.audioFilename) || 'audio/mpeg';
    meta.audioContentType = ct;
    writes.push(
      KV.put(audioKey(pid, slug), bytes, {
        metadata: { contentType: ct, filename: meta.audioFilename || '', size: bytes.byteLength },
      }),
    );
  }

  if (body.analysis && typeof body.analysis === 'object') {
    const aStr = JSON.stringify(body.analysis);
    if (aStr.length > MAX_JSON_BYTES) return err('Analysis too large', 413);
    writes.push(KV.put(analysisKey(pid, slug), aStr));
  }

  const summary = {
    name: meta.name,
    bpm: meta.bpm,
    lengthSeconds: meta.lengthSeconds,
    audioFilename: meta.audioFilename || '',
    updatedAt: meta.updatedAt,
  };
  writes.push(KV.put(metaKey(pid, slug), JSON.stringify(meta), { metadata: summary }));

  await Promise.all(writes);
  return json({ ok: true, slug, meta });
}

async function upsertComposition(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = body.slug ? slugify(body.slug) : '';
  if (!slug) return err('Missing song slug');
  if (!body.song || !Array.isArray(body.timeframes)) return err('Missing song/timeframes');

  const now = Date.now();
  const payloadStr = JSON.stringify({ song: body.song, timeframes: body.timeframes, updatedAt: now });
  if (payloadStr.length > MAX_JSON_BYTES) return err('Composition too large', 413);

  // working = the live auto-saved timeline; named = an explicit snapshot ("animation")
  const isWorking = body.working === true || (body.name == null && body.compSlug == null);
  if (isWorking) {
    await KV.put(workingKey(pid, slug), payloadStr, { metadata: { updatedAt: now, timeframeCount: body.timeframes.length } });
    return json({ ok: true, slug, comp: 'working' });
  }

  const compSlug = slugify(body.compSlug || body.name);
  const metaSummary = {
    name: String(body.name || compSlug),
    method: body.method || 'manual',
    createdAt: now,
    timeframeCount: body.timeframes.length,
  };
  const full = JSON.stringify({ ...metaSummary, slug: compSlug, song: body.song, timeframes: body.timeframes });
  if (full.length > MAX_JSON_BYTES) return err('Composition too large', 413);
  await KV.put(compKey(pid, slug, compSlug), full, { metadata: metaSummary });
  return json({ ok: true, slug, comp: compSlug, meta: metaSummary });
}

// ── Installation mapping (camera-derived LED positions) ──────────────────────
// One blob per project: { controllers:[ { thing, numPixels, imageWidth, imageHeight,
// capturedAt, leds:[ {index, x, y, b} ] } ], updatedAt }. x,y normalized 0..1.
async function getMapping(KV, pid) {
  const v = await KV.get(mappingKey(pid), 'json');
  return json({ mapping: v ?? null });
}

async function saveMapping(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  if (!Array.isArray(body.controllers)) return err('Missing controllers[]');
  const now = Date.now();
  const blob = { controllers: body.controllers, updatedAt: now };
  const str = JSON.stringify(blob);
  if (str.length > MAX_JSON_BYTES) return err('Mapping too large', 413);
  await KV.put(mappingKey(pid), str, { metadata: { updatedAt: now, controllerCount: body.controllers.length } });
  return json({ ok: true, updatedAt: now });
}

// ── Device registry (declared controllers: name + LED output pins, NO count) ──
// Blob per project: { devices:[ { thing, chip, mac, pins:[{gpio,label}], addedBy, addedAt, updatedAt } ], updatedAt }.
// One ESP = one "thing" whose declared pins concatenate into its flat LED buffer; the pixel
// count per pin is learned later by the camera mapping, so it is intentionally absent here.
const THING_MAX = 16; // firmware thing_name limit

async function getDevices(KV, pid) {
  const v = await KV.get(devicesKey(pid), 'json');
  return json({ devices: v && Array.isArray(v.devices) ? v.devices : [] });
}

async function upsertDevice(KV, pid, request, email) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const thing = String(body.thing || '').trim();
  if (!thing) return err('Missing controller name');
  if (thing.length > THING_MAX) return err(`Controller name too long (max ${THING_MAX})`);
  if (!/^[A-Za-z0-9_-]+$/.test(thing)) return err('Controller name: letters, digits, - or _ only');

  const pins = Array.isArray(body.pins)
    ? body.pins
        .map((p) => ({ gpio: Number(p && p.gpio), label: p && p.label ? String(p.label).slice(0, 40) : undefined }))
        .filter((p) => Number.isInteger(p.gpio) && p.gpio >= 0 && p.gpio <= 48)
    : [];
  // Dedupe GPIOs (keep first occurrence) — the same pin can't drive two strips.
  const seen = new Set();
  const uniquePins = pins.filter((p) => (seen.has(p.gpio) ? false : seen.add(p.gpio)));
  if (uniquePins.length === 0) return err('At least one LED output pin is required');

  const v = await KV.get(devicesKey(pid), 'json');
  const devices = v && Array.isArray(v.devices) ? v.devices : [];
  const now = Date.now();
  const existing = devices.find((d) => d.thing === thing);
  const rec = {
    thing,
    chip: body.chip ? String(body.chip).slice(0, 24) : existing ? existing.chip : null,
    mac: body.mac ? String(body.mac).slice(0, 32) : existing ? existing.mac : null,
    pins: uniquePins,
    addedBy: existing ? existing.addedBy : email || 'unknown',
    addedAt: existing ? existing.addedAt : now,
    updatedAt: now,
  };
  const next = existing ? devices.map((d) => (d.thing === thing ? rec : d)) : [...devices, rec];
  await KV.put(devicesKey(pid), JSON.stringify({ devices: next, updatedAt: now }), { metadata: { count: next.length, updatedAt: now } });
  return json({ ok: true, device: rec });
}

async function removeDevice(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const thing = String(body.thing || '').trim();
  if (!thing) return err('Missing thing');
  const v = await KV.get(devicesKey(pid), 'json');
  const devices = v && Array.isArray(v.devices) ? v.devices : [];
  const next = devices.filter((d) => d.thing !== thing);
  const now = Date.now();
  await KV.put(devicesKey(pid), JSON.stringify({ devices: next, updatedAt: now }), { metadata: { count: next.length, updatedAt: now } });
  return json({ ok: true });
}

// ── Installation flow rules ───────────────────────────────────────────────────
// Blob per project: { rules:[ { id, when:{box?,color?}, then:{action, song?, trigger?, brightness?} } ], updatedAt }.
async function getFlow(KV, pid) {
  const v = await KV.get(flowKey(pid), 'json');
  return json({ flow: v ?? null });
}

async function saveFlow(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  if (!Array.isArray(body.rules)) return err('Missing rules[]');
  const now = Date.now();
  const blob = { rules: body.rules, updatedAt: now };
  const str = JSON.stringify(blob);
  if (str.length > MAX_JSON_BYTES) return err('Flow too large', 413);
  await KV.put(flowKey(pid), str, { metadata: { updatedAt: now, ruleCount: body.rules.length } });
  return json({ ok: true, updatedAt: now });
}

// ── Version history (git-like) ───────────────────────────────────────────────
const VER_ID_RE = /^[a-z0-9]+$/;

// Create an immutable version snapshot on a branch, and advance the live working buffer
// to it (so a reload restores the latest state + its branch/HEAD).
async function createVersion(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = body.slug ? slugify(body.slug) : '';
  if (!slug) return err('Missing song slug');
  if (!body.song || !Array.isArray(body.timeframes)) return err('Missing song/timeframes');

  const now = Date.now();
  const id = `v${now.toString(36)}${Math.floor(Math.random() * 1e8).toString(36)}`;
  const branch = String(body.branch || 'main').slice(0, 60) || 'main';
  const parentId = body.parentId && VER_ID_RE.test(String(body.parentId)) ? String(body.parentId) : null;
  const label = body.label != null ? String(body.label).slice(0, 120) : '';
  const md = { id, parentId, branch, label, ts: now, timeframeCount: body.timeframes.length };

  const full = JSON.stringify({ ...md, song: body.song, timeframes: body.timeframes });
  if (full.length > MAX_JSON_BYTES) return err('Version too large', 413);
  const workingStr = JSON.stringify({ song: body.song, timeframes: body.timeframes, branch, headVerId: id, updatedAt: now });

  await Promise.all([
    KV.put(verKey(pid, slug, id), full, { metadata: md }),
    KV.put(workingKey(pid, slug), workingStr, { metadata: { updatedAt: now, timeframeCount: body.timeframes.length, branch, headVerId: id } }),
  ]);
  return json({ ok: true, slug, id, ts: now, branch, parentId });
}

async function listVersions(KV, pid, slugRaw) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  const versions = [];
  const prefix = verPrefix(pid, slug);
  let cursor;
  do {
    const res = await KV.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) versions.push({ id: k.name.slice(prefix.length), ...(k.metadata || {}) });
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  versions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); // oldest → newest (lets the client build the tree)
  return json({ slug, versions });
}

async function getVersion(KV, pid, slugRaw, idRaw) {
  const slug = slugSafe(slugRaw);
  const id = String(idRaw || '');
  if (!slug || !id) return err('Missing slug/id');
  if (!VER_ID_RE.test(id)) return err('Bad version id');
  const v = await KV.get(verKey(pid, slug, id));
  return v == null ? err('Version not found', 404) : rawJson(v);
}

async function deleteEntry(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = slugSafe(body.slug);
  if (!slug) return err('Missing slug');

  if (body.version) {
    const id = String(body.version);
    if (!VER_ID_RE.test(id)) return err('Bad version id');
    await KV.delete(verKey(pid, slug, id));
    return json({ ok: true, deleted: { slug, version: id } });
  }

  if (body.comp) {
    const comp = slugify(body.comp);
    await KV.delete(comp === 'working' ? workingKey(pid, slug) : compKey(pid, slug, comp));
    return json({ ok: true, deleted: { slug, comp } });
  }

  // Delete the fixed keys unconditionally (KV `list` is eventually consistent and can miss
  // freshly-written keys, which would orphan them); enumerate the dynamic comp + ver keys.
  const dels = [metaKey(pid, slug), analysisKey(pid, slug), audioKey(pid, slug), workingKey(pid, slug)].map((k) => KV.delete(k));
  for (const prefix of [compPrefix(pid, slug), verPrefix(pid, slug)]) {
    let cursor;
    do {
      const res = await KV.list({ prefix, cursor, limit: 1000 });
      for (const k of res.keys) dels.push(KV.delete(k.name));
      cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
  }
  await Promise.all(dels);
  return json({ ok: true, deleted: { slug }, keys: dels.length });
}

// ── Projects (installations) ─────────────────────────────────────────────────
// The built-in "rings" project is implicit (legacy `song:` keys) and always listed first;
// user-created projects live in a single `projects:index` JSON array.

const BUILTIN_RINGS = { id: 'rings', name: 'Rings', builtin: true };

async function readProjectsIndex(KV) {
  const raw = await KV.get(PROJECTS_INDEX, 'json');
  return Array.isArray(raw) ? raw : [];
}

// User-scoped: return only projects the caller is a member of (rings included via the owner
// bootstrap), each annotated with their role. The local-dev superuser sees all, unannotated.
async function listProjects(KV, email, ownerEmail, superuser) {
  const extra = (await readProjectsIndex(KV)).filter((p) => p && p.id && p.id !== 'rings');
  const all = [BUILTIN_RINGS, ...extra];
  const out = [];
  for (const proj of all) {
    if (superuser) { out.push({ ...proj }); continue; }
    const role = await roleOf(KV, proj.id, email, ownerEmail);
    if (role) out.push({ ...proj, role });
  }
  out.sort((a, b) => (a.builtin ? -1 : b.builtin ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  return json({ projects: out });
}

async function createProject(KV, request, email) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const name = String(body.name || '').trim();
  if (!name) return err('Missing project name');
  const id = normProject(body.id || name);
  if (id === 'rings') return err('“rings” is reserved', 409);

  const list = await readProjectsIndex(KV);
  if (list.some((p) => p && p.id === id)) return err('A project with that id already exists', 409);
  const project = { id, name, createdAt: Date.now(), createdBy: email || 'unknown' };
  list.push(project);
  // The creator becomes the project's first admin.
  const members = {};
  if (email) members[email] = { role: 'admin', addedAt: Date.now(), addedBy: 'system' };
  await Promise.all([KV.put(PROJECTS_INDEX, JSON.stringify(list)), writeMembers(KV, id, members)]);
  return json({ ok: true, project: { ...project, role: 'admin' } });
}

// ── Membership routes (authorization already enforced in handleLibrary) ────────
async function listMembersRoute(KV, pid) {
  const members = await readMembers(KV, pid);
  const arr = Object.entries(members).map(([email, m]) => ({ email, role: m.role, addedAt: m.addedAt, addedBy: m.addedBy }));
  arr.sort((x, y) => (x.addedAt || 0) - (y.addedAt || 0));
  return json({ members: arr });
}

async function addMemberRoute(KV, pid, request, actorEmail) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return err('Valid email required');
  const role = body.role === 'admin' ? 'admin' : 'member';
  const members = await readMembers(KV, pid);
  const existing = members[email];
  // Demoting the last admin would orphan the project (member management is admin-only) — refuse.
  if (existing && existing.role === 'admin' && role !== 'admin') {
    const admins = Object.values(members).filter((m) => m.role === 'admin');
    if (admins.length <= 1) return err('Cannot demote the last admin', 409);
  }
  members[email] = { role, addedAt: (existing && existing.addedAt) || Date.now(), addedBy: (existing && existing.addedBy) || actorEmail || 'unknown' };
  await writeMembers(KV, pid, members);
  return json({ ok: true, email, role });
}

async function removeMemberRoute(KV, pid, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return err('Missing email');
  const members = await readMembers(KV, pid);
  if (!members[email]) return json({ ok: true }); // already gone
  // Never remove the last admin — it would orphan the project.
  const admins = Object.values(members).filter((m) => m.role === 'admin');
  if (members[email].role === 'admin' && admins.length <= 1) return err('Cannot remove the last admin', 409);
  delete members[email];
  await writeMembers(KV, pid, members);
  return json({ ok: true });
}
