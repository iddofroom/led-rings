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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

const metaKey = (slug) => `song:${slug}:meta`;
const analysisKey = (slug) => `song:${slug}:analysis`;
const audioKey = (slug) => `song:${slug}:audio`;
const workingKey = (slug) => `song:${slug}:working`;
const compKey = (slug, comp) => `song:${slug}:comp:${comp}`;
const compPrefix = (slug) => `song:${slug}:comp:`;
// Version history (git-like): each manual Save is an immutable snapshot with a parent +
// branch, so the timeline can be rolled back and branched.
const verKey = (slug, id) => `song:${slug}:ver:${id}`;
const verPrefix = (slug) => `song:${slug}:ver:`;

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

export async function handleLibrary(request, env, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/library')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const KV = env && env.LED_LIBRARY;
  if (!KV) return err('Library storage not configured (KV binding missing)', 500);

  try {
    if (request.method === 'GET' && p === '/api/library/songs') return await listSongs(KV);
    if (request.method === 'GET' && p === '/api/library/song') return await getSong(KV, url.searchParams.get('slug'));
    if ((request.method === 'GET' || request.method === 'HEAD') && p === '/api/library/audio')
      return await getAudio(KV, url.searchParams.get('slug'), request.method === 'HEAD');
    if (request.method === 'GET' && p === '/api/library/analysis') {
      const slug = slugSafe(url.searchParams.get('slug'));
      if (!slug) return err('Missing slug');
      const a = await KV.get(analysisKey(slug));
      return a == null ? err('No analysis', 404) : rawJson(a);
    }
    if (request.method === 'GET' && p === '/api/library/composition') {
      const slug = slugSafe(url.searchParams.get('slug'));
      const comp = url.searchParams.get('comp') || 'working';
      if (!slug) return err('Missing slug');
      const key = comp === 'working' ? workingKey(slug) : compKey(slug, slugify(comp));
      const v = await KV.get(key);
      return v == null ? err('Composition not found', 404) : rawJson(v);
    }

    if (request.method === 'GET' && p === '/api/library/versions') return await listVersions(KV, url.searchParams.get('slug'));
    if (request.method === 'GET' && p === '/api/library/version')
      return await getVersion(KV, url.searchParams.get('slug'), url.searchParams.get('id'));

    if (request.method === 'POST' && p === '/api/library/song') return await upsertSong(KV, request);
    if (request.method === 'POST' && p === '/api/library/composition') return await upsertComposition(KV, request);
    if (request.method === 'POST' && p === '/api/library/version') return await createVersion(KV, request);
    if (request.method === 'POST' && p === '/api/library/delete') return await deleteEntry(KV, request);

    return err('Unknown library route: ' + p, 404);
  } catch (e) {
    return err('Library error: ' + (e && e.message ? e.message : String(e)), 500);
  }
}

function slugSafe(s) {
  return s ? slugify(s) : '';
}

async function listSongs(KV) {
  const songs = new Map();
  let cursor;
  do {
    const res = await KV.list({ prefix: 'song:', cursor, limit: 1000 });
    for (const k of res.keys) {
      const rest = k.name.slice('song:'.length);
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

async function getSong(KV, slugRaw) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  const prefix = `song:${slug}:`;
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
  const meta = await KV.get(metaKey(slug), 'json');
  if (!meta && !flags.hasAudio && comps.length === 0) return err('Song not found', 404);
  comps.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ slug, meta, ...flags, compositions: comps });
}

async function getAudio(KV, slugRaw, headOnly) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  if (headOnly) {
    // Cheap existence check — list the exact key for its metadata, never read the 5 MB value.
    const res = await KV.list({ prefix: audioKey(slug), limit: 1 });
    const k = res.keys.find((x) => x.name === audioKey(slug));
    if (!k) return new Response(null, { status: 404, headers: CORS });
    const md = k.metadata || {};
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': md.contentType || 'audio/mpeg', 'Content-Length': String(md.size || 0), 'Accept-Ranges': 'bytes', ...CORS },
    });
  }
  const { value, metadata } = await KV.getWithMetadata(audioKey(slug), { type: 'arrayBuffer' });
  if (value == null) return err('Audio not found', 404);
  const ct = (metadata && metadata.contentType) || 'audio/mpeg';
  return new Response(value, {
    headers: {
      'Content-Type': ct,
      'Content-Length': String(value.byteLength),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function upsertSong(KV, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = body.slug ? slugify(body.slug) : slugify(body.name || body.audioFilename || '');
  if (!slug) return err('Missing name/slug');

  const existing = (await KV.get(metaKey(slug), 'json')) || {};
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
      KV.put(audioKey(slug), bytes, {
        metadata: { contentType: ct, filename: meta.audioFilename || '', size: bytes.byteLength },
      }),
    );
  }

  if (body.analysis && typeof body.analysis === 'object') {
    const aStr = JSON.stringify(body.analysis);
    if (aStr.length > MAX_JSON_BYTES) return err('Analysis too large', 413);
    writes.push(KV.put(analysisKey(slug), aStr));
  }

  const summary = {
    name: meta.name,
    bpm: meta.bpm,
    lengthSeconds: meta.lengthSeconds,
    audioFilename: meta.audioFilename || '',
    updatedAt: meta.updatedAt,
  };
  writes.push(KV.put(metaKey(slug), JSON.stringify(meta), { metadata: summary }));

  await Promise.all(writes);
  return json({ ok: true, slug, meta });
}

async function upsertComposition(KV, request) {
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
    await KV.put(workingKey(slug), payloadStr, { metadata: { updatedAt: now, timeframeCount: body.timeframes.length } });
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
  await KV.put(compKey(slug, compSlug), full, { metadata: metaSummary });
  return json({ ok: true, slug, comp: compSlug, meta: metaSummary });
}

// ── Version history (git-like) ───────────────────────────────────────────────
const VER_ID_RE = /^[a-z0-9]+$/;

// Create an immutable version snapshot on a branch, and advance the live working buffer
// to it (so a reload restores the latest state + its branch/HEAD).
async function createVersion(KV, request) {
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
    KV.put(verKey(slug, id), full, { metadata: md }),
    KV.put(workingKey(slug), workingStr, { metadata: { updatedAt: now, timeframeCount: body.timeframes.length, branch, headVerId: id } }),
  ]);
  return json({ ok: true, slug, id, ts: now, branch, parentId });
}

async function listVersions(KV, slugRaw) {
  const slug = slugSafe(slugRaw);
  if (!slug) return err('Missing slug');
  const versions = [];
  let cursor;
  do {
    const res = await KV.list({ prefix: verPrefix(slug), cursor, limit: 1000 });
    for (const k of res.keys) versions.push({ id: k.name.slice(verPrefix(slug).length), ...(k.metadata || {}) });
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  versions.sort((a, b) => (a.ts || 0) - (b.ts || 0)); // oldest → newest (lets the client build the tree)
  return json({ slug, versions });
}

async function getVersion(KV, slugRaw, idRaw) {
  const slug = slugSafe(slugRaw);
  const id = String(idRaw || '');
  if (!slug || !id) return err('Missing slug/id');
  if (!VER_ID_RE.test(id)) return err('Bad version id');
  const v = await KV.get(verKey(slug, id));
  return v == null ? err('Version not found', 404) : rawJson(v);
}

async function deleteEntry(KV, request) {
  const body = await readJson(request);
  if (!body) return err('Invalid JSON');
  const slug = slugSafe(body.slug);
  if (!slug) return err('Missing slug');

  if (body.version) {
    const id = String(body.version);
    if (!VER_ID_RE.test(id)) return err('Bad version id');
    await KV.delete(verKey(slug, id));
    return json({ ok: true, deleted: { slug, version: id } });
  }

  if (body.comp) {
    const comp = slugify(body.comp);
    await KV.delete(comp === 'working' ? workingKey(slug) : compKey(slug, comp));
    return json({ ok: true, deleted: { slug, comp } });
  }

  // Delete the fixed keys unconditionally (KV `list` is eventually consistent and can miss
  // freshly-written keys, which would orphan them); enumerate the dynamic comp + ver keys.
  const dels = [metaKey(slug), analysisKey(slug), audioKey(slug), workingKey(slug)].map((k) => KV.delete(k));
  for (const prefix of [compPrefix(slug), verPrefix(slug)]) {
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
