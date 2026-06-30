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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${LIBRARY_BASE}${path}`, init)
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
  audioUrl: (slug: string) => `${LIBRARY_BASE}/api/library/audio?slug=${encodeURIComponent(slug)}`,

  listSongs: () => call<{ songs: LibrarySongSummary[] }>(`/api/library/songs`).then((d) => d.songs || []),

  getSong: (slug: string) => call<SongDetail>(`/api/library/song?slug=${encodeURIComponent(slug)}`),

  getAnalysis: (slug: string) => call<any>(`/api/library/analysis?slug=${encodeURIComponent(slug)}`),

  getComposition: (slug: string, comp = 'working') =>
    call<CompositionPayload>(`/api/library/composition?slug=${encodeURIComponent(slug)}&comp=${encodeURIComponent(comp)}`),

  saveSong: (body: SaveSongBody) => call<{ ok: true; slug: string; meta: LibrarySongMeta }>(`/api/library/song`, post(body)),

  saveComposition: (body: SaveCompositionBody) =>
    call<{ ok: true; slug: string; comp: string }>(`/api/library/composition`, post(body)),

  remove: (slug: string, comp?: string) => call<{ ok: true }>(`/api/library/delete`, post(comp ? { slug, comp } : { slug })),
}

/** Reachable only if a library base is configured or we're served through the Worker. */
export const LIBRARY_CONFIGURED = true
