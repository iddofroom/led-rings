import React, { useEffect, useState } from 'react'
import { SignedIn, SignedOut, SignIn, UserButton, useAuth, useUser } from '@clerk/clerk-react'
import App from '../App'
import { library } from '../lib/library'
import ProjectPicker from './ProjectPicker'
import ProjectHome from './ProjectHome'
import SongPicker from './SongPicker'
import MappingStage from '../mapping/MappingStage'
import ControllerSetup from '../onboard/ControllerSetup'
import FlowBuilder from '../onboard/FlowBuilder'
import { useI18n, LangToggle } from '../lib/i18n'

/**
 * Top-level navigation shell: Clerk sign-in → Project picker → Song picker → Editor.
 * Auth (identity) is Clerk; authorization (which projects you see, admin vs member) is enforced
 * per-request at the Worker against KV membership records keyed by the verified email.
 */

type View = 'projects' | 'home' | 'songs' | 'editor' | 'mapping' | 'onboard' | 'flow'
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
          view: ['editor', 'songs', 'mapping', 'home', 'onboard', 'flow'].includes(p.view as string) ? (p.view as View) : 'projects',
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
        <SignedOutLanding />
      </SignedOut>
      <SignedIn>
        <ShellInner />
      </SignedIn>
    </>
  )
}

/**
 * First thing a brand-new visitor sees. The app installs nothing (it's edge-served), so this is
 * the whole "front door": what the tool is, a link to the public build guide (open, no account),
 * and the Clerk sign-in to start. Bilingual with a language toggle since there's no header yet.
 */
function SignedOutLanding() {
  const { t, dir } = useI18n()
  return (
    <div style={landingWrap} dir={dir}>
      <div style={{ position: 'absolute', top: 16, insetInlineEnd: 16 }}>
        <LangToggle variant="dark" />
      </div>
      <div style={landingInner}>
        <div style={landingHero}>
          <div style={{ fontSize: 46 }}>🎛️</div>
          <h1 style={{ margin: '10px 0 8px', fontSize: 30, fontWeight: 850, letterSpacing: '-0.02em' }}>LED Studio</h1>
          <p style={{ margin: 0, fontSize: 17, color: '#aab6cc', lineHeight: 1.55, maxWidth: 460 }}>
            {t({
              en: 'Design music-synced LED light shows for your installation — right in the browser. Nothing to install.',
              he: 'עצבו מופעי תאורת LED מסונכרנים למוזיקה למיצב שלכם — ישר מהדפדפן. בלי שום התקנה.',
            })}
          </p>
          <a href="/guide" style={guideLink}>
            📖 {t({ en: 'How it works — the build guide', he: 'איך זה עובד — מדריך הבנייה' })}
          </a>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <SignIn routing="hash" />
        </div>
      </div>
    </div>
  )
}

function ShellInner() {
  const { t } = useI18n()
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
    patch({ projectId: id, projectName: name, projectRole: role, view: 'home', pendingLoad: null })
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

  if (view === 'mapping') {
    return <MappingStage projectId={projectId} projectName={projectName} onBack={() => patch({ view: 'home' })} />
  }

  if (view === 'onboard') {
    return <ControllerSetup projectId={projectId} projectName={projectName} onBack={() => patch({ view: 'home' })} />
  }

  if (view === 'flow') {
    return <FlowBuilder projectId={projectId} projectName={projectName} onBack={() => patch({ view: 'home' })} />
  }

  return (
    <div style={shell}>
      <div style={topbar}>
        <button
          onClick={() => patch({ view: 'projects', pendingLoad: null })}
          style={{ background: 'transparent', color: '#e8eaed', border: 0, padding: 0, cursor: 'pointer', fontWeight: 700, letterSpacing: '0.02em', fontSize: 15 }}
        >
          🎛️ {t({ en: 'LED Studio', he: 'LED Studio' })}
        </button>
        {(view === 'songs') && (
          <>
            <span style={{ color: '#4b5568' }}>/</span>
            <button
              onClick={() => patch({ view: 'home' })}
              style={{ background: 'transparent', color: '#8fb4ff', border: 0, padding: 0, cursor: 'pointer', fontSize: 14 }}
            >
              {projectName}
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {email && <span style={{ color: '#9aa7bd', fontSize: 13 }}>{email}</span>}
        <UserButton afterSignOutUrl="/" />
      </div>
      {view === 'projects' && <ProjectPicker onOpen={openProject} />}
      {view === 'home' && (
        <ProjectHome
          projectId={projectId}
          projectName={projectName}
          projectRole={projectRole}
          onCompose={() => patch({ view: 'songs' })}
          onMapping={() => patch({ view: 'mapping' })}
          onSetupControllers={() => patch({ view: 'onboard' })}
          onFlow={() => patch({ view: 'flow' })}
          onBack={() => patch({ view: 'projects', pendingLoad: null })}
        />
      )}
      {view === 'songs' && (
        <SongPicker
          projectId={projectId}
          projectName={projectName}
          projectRole={projectRole}
          onOpenSong={openSong}
          onNewSong={newSong}
          onBack={() => patch({ view: 'home' })}
        />
      )}
    </div>
  )
}

const shell: React.CSSProperties = { minHeight: '100vh', background: '#0f1218', color: '#e8eaed', display: 'flex', flexDirection: 'column' }
const topbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #1e232c', background: '#12161d' }
const landingWrap: React.CSSProperties = { position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(1100px 520px at 50% -8%, #1c2540, #0b0f1a 62%)', color: '#e8eaed', padding: 24 }
const landingInner: React.CSSProperties = { width: 'min(920px, 100%)', display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', justifyContent: 'center' }
const landingHero: React.CSSProperties = { flex: '1 1 340px', maxWidth: 460, textAlign: 'center' }
const guideLink: React.CSSProperties = { display: 'inline-block', marginTop: 18, color: '#8fb4ff', textDecoration: 'none', fontSize: 15, fontWeight: 600, border: '1px solid #2a3450', borderRadius: 10, padding: '9px 16px' }
