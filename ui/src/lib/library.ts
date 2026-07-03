/**
 * Client for the Cloudflare-KV song library (served by the leds-frontdoor Worker at
 * /api/library/*). One cloud library shared by local dev and the live remote tool, so
 * every uploaded MP3, its analysis, the AI output, and saved animations persist across
 * machines and sessions.
 *
 * Base URL: VITE_LIBRARY_URL (absolute, e.g. https://leds.iddofroom.co.il). Empty =
 * same-origin, which is correct when the UI is served through the Worker itself.
 */
const LIBRARY_BASE: string = (import.meta as any).env?.VITE_LIBRARY_URL ?? ''

/**
 * Shared library key for LOCAL DEV only. In production the UI is served through the Worker
 * (same-origin) and authenticates with the Google session cookie, so this is empty and unused.
 * When set (local ui/.env), every request presents it so the auth gate lets it through.
 */
const LIBRARY_KEY: string = (import.meta as any).env?.VITE_LIBRARY_KEY ?? ''

/** Default project ("rings") — the built-in installation whose songs use the legacy KV keys. */
export const DEFAULT_PROJECT = 'rings'

/** Append the project (and, in local dev, the library key) to a library URL path. */
function scoped(path: string, projectId: string): string {
  const sep = path.includes('?') ? '&' : '?'
  let out = `${path}${sep}project=${encodeURIComponent(projectId || DEFAULT_PROJECT)}`
  if (LIBRARY_KEY) out += `&libkey=${encodeURIComponent(LIBRARY_KEY)}`
  return out
}

export interface LibraryProject {
  id: string
  name: string
  builtin?: boolean
  createdAt?: number
}

export interface LibraryCompSummary {
  slug: string
  name?: string
  method?: string
  createdAt?: number
  timeframeCount?: number
}

export interface LibrarySongSummary {
  slug: string
  name?: string
  bpm?: number
  lengthSeconds?: number
  audioFilename?: string
  audioSize?: number
  updatedAt?: number
  hasAnalysis?: boolean
  hasAudio?: boolean
  hasWorking?: boolean
  compositions: LibraryCompSummary[]
}

export interface LibrarySongMeta {
  slug: string
  name: string
  bpm: number
  lengthSeconds: number
  startOffsetMs?: number
  animationType?: string
  audioFilename?: string
  audioContentType?: string
  beatTimestampsMs?: number[]
  createdAt?: number
  updatedAt?: number
}

export interface SongDetail {
  slug: string
  meta: LibrarySongMeta | null
  hasAnalysis: boolean
  hasAudio: boolean
  hasWorking: boolean
  compositions: LibraryCompSummary[]
}

export interface CompositionPayload {
  song: Record<string, unknown>
  timeframes: unknown[]
  /** Present on the `working` buffer: which branch/version it descends from. */
  branch?: string
  headVerId?: string
}

/** One immutable save in a song's git-like history. */
export interface VersionSummary {
  id: string
  parentId?: string | null
  branch?: string
  label?: string
  ts?: number
  timeframeCount?: number
}

export interface VersionPayload extends VersionSummary {
  song: Record<string, unknown>
  timeframes: unknown[]
}

export interface SaveSongBody {
  slug?: string
  name?: string
  bpm?: number
  lengthSeconds?: number
  startOffsetMs?: number
  animationType?: string
  audioFilename?: string
  audioBase64?: string
  audioContentType?: string
  beatTimestampsMs?: number[]
  analysis?: unknown
}

export interface SaveCompositionBody {
  slug: string
  /** Omit name + set working:true for the live auto-saved timeline. */
  working?: boolean
  /** A named animation snapshot. Saving the same name overwrites. */
  name?: string
  compSlug?: string
  method?: string
  song: Record<string, unknown>
  timeframes: unknown[]
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/** Merge the library-key header (local dev only) into a request's headers. */
function withKey(init?: RequestInit): RequestInit | undefined {
  if (!LIBRARY_KEY) return init
  return { ...(init || {}), headers: { ...(init?.headers as Record<string, string> | undefined), 'X-Library-Key': LIBRARY_KEY } }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${LIBRARY_BASE}${path}`, withKey(init))
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j as any).error || `${path} failed (${r.status})`)
  }
  return r.json() as Promise<T>
}

/** Convert a File/Blob to a bare base64 string (no data: prefix), chunked for large files. */
export async function fileToBase64(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export const library = {
  base: LIBRARY_BASE,
  audioUrl: (slug: string, projectId: string = DEFAULT_PROJECT) =>
    `${LIBRARY_BASE}${scoped(`/api/library/audio?slug=${encodeURIComponent(slug)}`, projectId)}`,

  // ── Projects (installations) ──
  listProjects: () => call<{ projects: LibraryProject[] }>(`/api/library/projects`).then((d) => d.projects || []),
  createProject: (name: string) => call<{ ok: true; project: LibraryProject }>(`/api/library/project`, post({ name })).then((d) => d.project),

  listSongs: (projectId: string = DEFAULT_PROJECT) =>
    call<{ songs: LibrarySongSummary[] }>(scoped(`/api/library/songs`, projectId)).then((d) => d.songs || []),

  getSong: (slug: string, projectId: string = DEFAULT_PROJECT) =>
    call<SongDetail>(scoped(`/api/library/song?slug=${encodeURIComponent(slug)}`, projectId)),

  getAnalysis: (slug: string, projectId: string = DEFAULT_PROJECT) =>
    call<any>(scoped(`/api/library/analysis?slug=${encodeURIComponent(slug)}`, projectId)),

  getComposition: (slug: string, comp = 'working', projectId: string = DEFAULT_PROJECT) =>
    call<CompositionPayload>(scoped(`/api/library/composition?slug=${encodeURIComponent(slug)}&comp=${encodeURIComponent(comp)}`, projectId)),

  saveSong: (body: SaveSongBody, projectId: string = DEFAULT_PROJECT) =>
    call<{ ok: true; slug: string; meta: LibrarySongMeta }>(scoped(`/api/library/song`, projectId), post(body)),

  saveComposition: (body: SaveCompositionBody, projectId: string = DEFAULT_PROJECT) =>
    call<{ ok: true; slug: string; comp: string }>(scoped(`/api/library/composition`, projectId), post(body)),

  remove: (slug: string, comp?: string, projectId: string = DEFAULT_PROJECT) =>
    call<{ ok: true }>(scoped(`/api/library/delete`, projectId), post(comp ? { slug, comp } : { slug })),

  // ── Version history (git-like) ──
  saveVersion: (body: { slug: string; song: Record<string, unknown>; timeframes: unknown[]; parentId?: string | null; branch?: string; label?: string }, projectId: string = DEFAULT_PROJECT) =>
    call<{ ok: true; slug: string; id: string; ts: number; branch: string; parentId: string | null }>(scoped(`/api/library/version`, projectId), post(body)),

  listVersions: (slug: string, projectId: string = DEFAULT_PROJECT) =>
    call<{ versions: VersionSummary[] }>(scoped(`/api/library/versions?slug=${encodeURIComponent(slug)}`, projectId)).then((d) => d.versions || []),

  getVersion: (slug: string, id: string, projectId: string = DEFAULT_PROJECT) =>
    call<VersionPayload>(scoped(`/api/library/version?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`, projectId)),

  removeVersion: (slug: string, id: string, projectId: string = DEFAULT_PROJECT) =>
    call<{ ok: true }>(scoped(`/api/library/delete`, projectId), post({ slug, version: id })),
}

/** Reachable only if a library base is configured or we're served through the Worker. */
export const LIBRARY_CONFIGURED = true
