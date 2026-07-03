import React, { useEffect, useState } from 'react'
import App from '../App'
import { library } from '../lib/library'
import ProjectPicker from './ProjectPicker'
import SongPicker from './SongPicker'

/**
 * Top-level navigation shell wrapping the editor: Login (enforced at the Worker) →
 * Project picker → Song picker → Editor. The whole leds subdomain is already behind a Google
 * sign-in (the front-door Worker), so reaching this code means the user is authenticated; the
 * shell just shows who's logged in and lets them pick an installation + song before editing.
 */

type View = 'projects' | 'songs' | 'editor'
type PendingLoad = { slug: string; comp: string } | 'new' | null

interface ShellState {
  view: View
  projectId: string
  projectName: string
  pendingLoad: PendingLoad
}

const SHELL_KEY = 'leds:shell'

function loadShellState(): ShellState {
  try {
    const raw = localStorage.getItem(SHELL_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<ShellState>
      if (p && typeof p.view === 'string') {
        return {
          view: p.view === 'editor' || p.view === 'songs' ? p.view : 'projects',
          projectId: typeof p.projectId === 'string' ? p.projectId : 'rings',
          projectName: typeof p.projectName === 'string' ? p.projectName : 'Rings',
          pendingLoad: (p.pendingLoad as PendingLoad) ?? null,
        }
      }
    }
  } catch {}
  return { view: 'projects', projectId: 'rings', projectName: 'Rings', pendingLoad: null }
}

export default function RootShell() {
  const [state, setState] = useState<ShellState>(loadShellState)
  // Bumped on every "open song" so the keyed <App> remounts fresh and runs its initial-load.
  const [editorNonce, setEditorNonce] = useState(0)
  const [email, setEmail] = useState<string | null>(null)

  const { view, projectId, projectName, pendingLoad } = state
  const patch = (p: Partial<ShellState>) => setState((s) => ({ ...s, ...p }))

  useEffect(() => {
    try { localStorage.setItem(SHELL_KEY, JSON.stringify(state)) } catch {}
  }, [state])

  // Who's logged in (best-effort; same-origin in prod, may CORS-fail in local dev → null).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`${library.base}/auth/me`, { credentials: 'include' })
        if (!r.ok) return
        const j = await r.json()
        if (!cancelled && j && j.email) setEmail(j.email)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  // Clear pendingLoad when changing installations so the persisted shell state never carries a
  // song slug from a different project than projectId.
  const openProject = (id: string, name: string) => patch({ projectId: id, projectName: name, view: 'songs', pendingLoad: null })
  const openSong = (slug: string, comp: string) => {
    setEditorNonce((n) => n + 1)
    patch({ pendingLoad: { slug, comp }, view: 'editor' })
  }
  const newSong = () => {
    setEditorNonce((n) => n + 1)
    patch({ pendingLoad: 'new', view: 'editor' })
  }

  if (view === 'editor') {
    return (
      <App
        key={editorNonce}
        projectId={projectId}
        initialLoad={pendingLoad}
        onExitToSongs={() => patch({ view: 'songs' })}
      />
    )
  }

  return (
    <div style={shell}>
      <div style={topbar}>
        <span style={{ fontWeight: 700, letterSpacing: '0.02em' }}>🎛️ LED Studio</span>
        <span style={{ flex: 1 }} />
        {email && <span style={{ color: '#9aa7bd', fontSize: 13 }}>{email}</span>}
        <a href={`${library.base}/auth/logout`} style={logoutLink}>Logout</a>
      </div>
      {view === 'projects' ? (
        <ProjectPicker onOpen={openProject} />
      ) : (
        <SongPicker
          projectId={projectId}
          projectName={projectName}
          onOpenSong={openSong}
          onNewSong={newSong}
          onBack={() => patch({ view: 'projects', pendingLoad: null })}
        />
      )}
    </div>
  )
}

const shell: React.CSSProperties = { minHeight: '100vh', background: '#0f1218', color: '#e8eaed', display: 'flex', flexDirection: 'column' }
const topbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #1e232c', background: '#12161d' }
const logoutLink: React.CSSProperties = { color: '#9aa7bd', fontSize: 13, textDecoration: 'none', border: '1px solid #2a303b', borderRadius: 6, padding: '4px 12px' }
