/**
 * Client for the mapping stage.
 *
 * Two backends:
 *  - The control-server on the RPi (VITE_API_URL / the app's saved control-server
 *    URL) drives the hardware: discover controllers + light one LED at a time.
 *    Same-origin in prod → carries the Clerk cookie through the Worker gate.
 *  - The Cloudflare KV library (via `library`) persists the resulting (x,y) map
 *    per project — KivSee's geometry schema is 1-D, so the map lives here.
 */
import { library } from './library'
export type { MappedLed, MappedController, MappingBlob } from './library'

/** Same source of truth as App.tsx for where the control-server lives. */
const CONTROL_SERVER_URL_STORAGE_KEY = 'kivsee-control-server-url'

export function controlBase(): string {
  try {
    const saved = localStorage.getItem(CONTROL_SERVER_URL_STORAGE_KEY)
    if (saved != null) return saved
  } catch {}
  return (import.meta as any).env?.VITE_API_URL ?? ''
}

export interface Hsv { hue: number; sat: number; val: number }

export interface Controller {
  thing: string
  alive: boolean
  lastSeen: number
  numPixels: number | null
}

async function ctl<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${controlBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
    credentials: 'include', // same-origin Clerk cookie through the Worker gate
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j as any).error || `${path} failed (${r.status})`)
  }
  return r.json() as Promise<T>
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const mappingApi = {
  /** Live controller roster from the RPi (MQTT thing/+/status), + pixel counts. */
  discover: (simulate = false) =>
    ctl<{ connected: boolean; controllers: Controller[] }>(
      `/api/mapping/controllers${simulate ? '?simulate=1' : ''}`,
    ),

  /** Push single-pixel segments so any index can be lit (one ESP reboot; awaits rejoin). */
  prepare: (thing: string, cap?: number, simulate = false) =>
    ctl<{ ok: true; cap: number; numberOfPixels: number; rejoined: boolean }>(
      `/api/mapping/prepare`,
      post({ thing, cap, simulate }),
    ),

  /** Light exactly one LED (index) on a controller. Fast (no reboot). */
  light: (thing: string, index: number, color?: Hsv, simulate = false) =>
    ctl<{ ok: true }>(`/api/mapping/light`, post({ thing, index, color, simulate })),

  /** Clear all controllers (baseline dark frame). */
  blank: (simulate = false) => ctl<{ ok: true }>(`/api/mapping/blank`, post({ simulate })),

  /** Restore the controller's original geometry (or publish a derived one). */
  finish: (thing: string, action: 'restore' | 'publish' = 'restore', config?: unknown, simulate = false) =>
    ctl<{ ok: true }>(`/api/mapping/finish`, post({ thing, action, config, simulate })),

  // ── Persistence (Cloudflare KV, per project) ──
  loadMap: (projectId: string) => library.getMapping(projectId),
  saveMap: (controllers: import('./library').MappedController[], projectId: string) =>
    library.saveMapping(controllers, projectId),
}
