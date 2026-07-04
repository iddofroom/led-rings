import React, { useCallback, useEffect, useState } from 'react'
import { library, type LibraryProject } from '../lib/library'

/**
 * First screen after login: pick an installation ("project"). "Rings" is the built-in project
 * (the original 12-ring rig); more installations can be added and each keeps its own song
 * library. The per-installation LED-mapping tool is a later stage — for now a project is a
 * named library scope.
 */

interface Props {
  onOpen: (id: string, name: string, role: 'admin' | 'member' | null) => void
}

const icon = (p: LibraryProject) => (p.builtin ? '💍' : '🎨')

export default function ProjectPicker({ onOpen }: Props) {
  const [projects, setProjects] = useState<LibraryProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setProjects(await library.listProjects())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function createProject() {
    const name = window.prompt('New installation name:', '')
    if (name == null || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const p = await library.createProject(name.trim())
      await refresh()
      onOpen(p.id, p.name, p.role ?? 'admin')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <h1 style={{ fontSize: 26, margin: '8px 0 4px' }}>Choose an installation</h1>
        <p style={{ color: '#8a93a3', margin: '0 0 24px' }}>Each installation keeps its own song library.</p>

        {error && <div style={errorBox}>{error}</div>}

        {loading ? (
          <div style={{ color: '#9aa', padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : (
          <div style={grid}>
            {projects.map((p) => (
              <button key={p.id} style={card} onClick={() => onOpen(p.id, p.name, p.role ?? null)} disabled={busy}>
                <span style={{ fontSize: 40 }}>{icon(p)}</span>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{p.name}</span>
                {p.role && <span style={{ ...roleBadge, ...(p.role === 'admin' ? adminBadge : {}) }}>{p.role}</span>}
              </button>
            ))}
            <button style={{ ...card, ...addCard }} onClick={createProject} disabled={busy}>
              <span style={{ fontSize: 40 }}>＋</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>New installation</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { flex: 1, padding: '32px 20px', overflowY: 'auto' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }
const card: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 150, background: '#1b1f27', color: '#e8eaed', border: '1px solid #2a303b', borderRadius: 14,
  cursor: 'pointer', padding: 20, transition: 'border-color .15s, transform .05s',
}
const addCard: React.CSSProperties = { background: 'transparent', borderStyle: 'dashed', color: '#9aa7bd' }
const roleBadge: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9aa7bd', background: '#2a303b', borderRadius: 4, padding: '1px 7px' }
const adminBadge: React.CSSProperties = { color: '#04150f', background: '#34d399' }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 13 }
