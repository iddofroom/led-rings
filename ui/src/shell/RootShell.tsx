import React, { useEffect, useState } from 'react'
import { SignedIn, SignedOut, SignIn, UserButton, useAuth, useUser } from '@clerk/clerk-react'
import App from '../App'
import { library } from '../lib/library'
import ProjectPicker from './ProjectPicker'
import SongPicker from './SongPicker'

/**
 * Top-level navigation shell: Clerk sign-in → Project picker → Song picker → Editor.
 * Auth (identity) is Clerk; authorization (which projects you see, admin vs member) is enforced
 * per-request at the Worker against KV membership records keyed by the verified email.
 */

type View = 'projects' | 'songs' | 'editor'
type PendingLoad = { slug: string; comp: string } | 'new' | null

interface ShellState {
  view: View
  projectId: string
  projectName: string
  projectRole: 'admin' | 'member' | null
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
          projectRole: p.projectRole === 'admin' || p.projectRole === 'member' ? p.projectRole : null,
          pendingLoad: (p.pendingLoad as PendingLoad) ?? null,
        }
      }
    }
  } catch {}
  return { view: 'projects', projectId: 'rings', projectName: 'Rings', projectRole: null, pendingLoad: null }
}

export default function RootShell() {
  return (
    <>
      <SignedOut>
        <div style={signInWrap}>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <ShellInner />
      </SignedIn>
    </>
  )
}

function ShellInner() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? null

  // Wire the Clerk session token into the library client BEFORE the pickers' data effects fire
  // (child effects run before parent effects, so set it during render, not in a useEffect).
  library.setTokenGetter(() => getToken())

  const [state, setState] = useState<ShellState>(loadShellState)
  // Bumped on every "open song" so the keyed <App> remounts fresh and runs its initial-load.
  const [editorNonce, setEditorNonce] = useState(0)

  const { view, projectId, projectName, projectRole, pendingLoad } = state
  const patch = (p: Partial<ShellState>) => setState((s) => ({ ...s, ...p }))

  useEffect(() => {
    try { localStorage.setItem(SHELL_KEY, JSON.stringify(state)) } catch {}
  }, [state])

  // Detach the token supplier on unmount (e.g. after sign-out) so no stale getToken lingers.
  useEffect(() => () => { library.setTokenGetter(null) }, [])

  const openProject = (id: string, name: string, role: 'admin' | 'member' | null) =>
    patch({ projectId: id, projectName: name, projectRole: role, view: 'songs', pendingLoad: null })
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
        <UserButton afterSignOutUrl="/" />
      </div>
      {view === 'projects' ? (
        <ProjectPicker onOpen={openProject} />
      ) : (
        <SongPicker
          projectId={projectId}
          projectName={projectName}
          projectRole={projectRole}
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
const signInWrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1218', padding: 24 }
