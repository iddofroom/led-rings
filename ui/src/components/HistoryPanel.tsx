import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { library, type VersionSummary } from '../lib/library'

/**
 * Version history (git-like) for the active song. Each Save is an immutable snapshot with a
 * parent + branch, so the timeline can be rolled back and branched. Versions are grouped by
 * branch; you can Load any version (HEAD follows it) or Branch off it into a new branch.
 */

interface Props {
  slug?: string
  songName?: string
  currentBranch: string
  headVerId: string | null
  /** Commit the current timeline as a new version on the current branch. */
  onSave: (label?: string) => Promise<string | null>
  onLoadVersion: (id: string) => void | Promise<void>
  onBranch: (id: string, name: string) => void | Promise<void>
  onClose: () => void
}

const fmtDate = (ms?: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString()} ${d.toTimeString().slice(0, 5)}`
}
const shortId = (id?: string | null) => (id ? id.slice(0, 7) : '')

export default function HistoryPanel({ slug, songName, currentBranch, headVerId, onSave, onLoadVersion, onBranch, onClose }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const refresh = useCallback(async () => {
    if (!slug) { setVersions([]); setLoading(false); return }
    setError(null)
    try {
      setVersions(await library.listVersions(slug))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => { void refresh() }, [refresh])

  // KV `list` is eventually consistent — re-check shortly after a write.
  const refreshSoon = useCallback(() => { void refresh(); setTimeout(() => void refresh(), 1500) }, [refresh])

  async function doSave() {
    setBusy('Saving…')
    try {
      await onSave(label.trim() || undefined)
      setLabel('')
      refreshSoon()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  async function doLoad(id: string) {
    setBusy('Loading…')
    try { await onLoadVersion(id); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }
  async function doBranch(id: string) {
    const name = window.prompt('New branch name:', '')
    if (name == null || !name.trim()) return
    setBusy('Branching…')
    try { await onBranch(id, name.trim()); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }
  async function doDelete(id: string) {
    if (!slug || !window.confirm('Delete this version?')) return
    setBusy('Deleting…')
    try { await library.removeVersion(slug, id); refreshSoon() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  const byId = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions])

  // Group by branch; current branch first, then by earliest version time.
  const branches = useMemo(() => {
    const map = new Map<string, VersionSummary[]>()
    for (const v of versions) {
      const b = v.branch || 'main'
      if (!map.has(b)) map.set(b, [])
      map.get(b)!.push(v)
    }
    const entries = [...map.entries()].map(([name, vs]) => ({
      name,
      versions: [...vs].sort((a, b) => (b.ts || 0) - (a.ts || 0)),
      earliest: Math.min(...vs.map((v) => v.ts || 0)),
    }))
    entries.sort((a, b) =>
      a.name === currentBranch ? -1 : b.name === currentBranch ? 1 : a.earliest - b.earliest,
    )
    return entries
  }, [versions, currentBranch])

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>🕘 Version History {songName ? `· ${songName}` : ''}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={branchChip}>⎇ {currentBranch}</span>
            <button onClick={() => void refresh()} style={iconBtn} title="Refresh">↻</button>
            <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
        </div>

        {/* Save box */}
        <div style={saveBox}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doSave() }}
            placeholder={`Version description (optional) — saved on branch "${currentBranch}"`}
            style={saveInput}
          />
          <button onClick={() => void doSave()} disabled={!!busy} style={saveBtn}>💾 Save version</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}
        {busy && <div style={busyBox}><span style={spinner} /> {busy}</div>}

        {loading ? (
          <div style={{ color: '#9aa', padding: 24, textAlign: 'center' }}>Loading history…</div>
        ) : !slug ? (
          <div style={{ color: '#9aa', padding: 28, textAlign: 'center', lineHeight: 1.7 }}>
            This song is not in the library yet.<br />Click <b>💾 Save version</b> to create it and start its history.
          </div>
        ) : versions.length === 0 ? (
          <div style={{ color: '#9aa', padding: 28, textAlign: 'center', lineHeight: 1.7 }}>
            No saved versions yet.<br />Click <b>💾 Save version</b> to save the current timeline.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {branches.map((br) => (
              <div key={br.name}>
                <div style={{ ...branchHeader, ...(br.name === currentBranch ? branchHeaderActive : {}) }}>
                  ⎇ {br.name}
                  {br.name === currentBranch && <span style={{ fontSize: 11, color: '#34d399', marginInlineStart: 6 }}>· current</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {br.versions.map((v) => {
                    const isHead = v.id === headVerId
                    const parent = v.parentId ? byId.get(v.parentId) : undefined
                    const branchPoint = parent && parent.branch !== v.branch
                    return (
                      <div key={v.id} style={{ ...verRow, ...(isHead ? verRowHead : {}) }}>
                        {isHead && <span style={headPill}>● HEAD</span>}
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <b>{v.label || '(no description)'}</b>
                          {branchPoint && <span style={{ color: '#8a93a3', fontSize: 11 }}> · branched from {shortId(parent?.id)}</span>}
                        </span>
                        <span style={{ color: '#8a93a3', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {v.timeframeCount ?? '?'} tf · {fmtDate(v.ts)} · {shortId(v.id)}
                        </span>
                        <button onClick={() => void doLoad(v.id)} style={smallBtn} title="Load this version into the timeline">Load</button>
                        <button onClick={() => void doBranch(v.id)} style={smallBtnOutline} title="Branch off this version">⎇ Branch</button>
                        <button onClick={() => void doDelete(v.id)} style={smallTrash} title="Delete version">🗑</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 12, textAlign: 'center' }}>
          Manual saves only — changes are not saved automatically. Every save = a new version in the history.
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0009', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: 24 }
const modal: React.CSSProperties = { background: '#1b1e24', color: '#e8eaed', borderRadius: 10, padding: 18, width: 'min(760px, 95vw)', boxShadow: '0 10px 40px #000a', marginTop: 24 }
const branchChip: React.CSSProperties = { background: '#0b2a22', color: '#34d399', border: '1px solid #14532d', fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '3px 10px' }
const saveBox: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }
const saveInput: React.CSSProperties = { flex: 1, background: '#12151b', color: '#e8eaed', border: '1px solid #2d323c', borderRadius: 8, padding: '9px 12px', fontSize: 13 }
const saveBtn: React.CSSProperties = { background: 'linear-gradient(135deg,#38bdf8,#0284c7)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }
const branchHeader: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#a5b4fc', padding: '4px 8px', borderInlineStart: '3px solid #3b3f4b', background: '#20242c', borderRadius: 6 }
const branchHeaderActive: React.CSSProperties = { color: '#34d399', borderInlineStart: '3px solid #34d399' }
const verRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#23272f', borderRadius: 6, padding: '6px 10px', marginInlineStart: 12 }
const verRowHead: React.CSSProperties = { border: '1px solid #34d39955', background: '#1c2b25' }
const headPill: React.CSSProperties = { background: '#34d399', color: '#04150f', fontSize: 10, fontWeight: 800, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }
const smallBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const smallBtnOutline: React.CSSProperties = { background: 'none', color: '#fbbf24', border: '1px solid #fbbf2466', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }
const smallTrash: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, opacity: 0.55 }
const iconBtn: React.CSSProperties = { background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }
const busyBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#1f2b3a', border: '1px solid #3b82f6', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: '#cfe3ff' }
const spinner: React.CSSProperties = { width: 14, height: 14, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }
