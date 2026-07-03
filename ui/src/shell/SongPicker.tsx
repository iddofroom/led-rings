import React, { useCallback, useEffect, useRef, useState } from 'react'
import { library, fileToBase64, type LibrarySongSummary } from '../lib/library'

/**
 * Second screen: pick a song within the chosen installation (or start a new one). Scoped to
 * projectId — every library call carries it, so each installation has an isolated song list.
 * Mirrors LibraryPanel's list, promoted to a full-screen picker with a "new song" action.
 */

interface Props {
  projectId: string
  projectName: string
  /** Open a song: comp = 'working' | 'fresh' | an animation slug. */
  onOpenSong: (slug: string, comp: string) => void
  /** Start a brand-new blank song (no library entry yet). */
  onNewSong: () => void
  onBack: () => void
}

const fmtTime = (sec: number) =>
  sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '—'
const fmtSize = (b?: number) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : '')
const fmtDate = (ms?: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString()} ${d.toTimeString().slice(0, 5)}`
}
const methodBadge: Record<string, { label: string; bg: string }> = {
  gemini: { label: 'AI', bg: '#7c5cff' },
  rules: { label: 'rules', bg: '#3b82f6' },
  manual: { label: 'manual', bg: '#4b5563' },
}

export default function SongPicker({ projectId, projectName, onOpenSong, onNewSong, onBack }: Props) {
  const [songs, setSongs] = useState<LibrarySongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setSongs(await library.listSongs(projectId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // KV `list` is eventually consistent — refresh now, then again shortly after a write.
  const refreshSoon = useCallback(() => { void refresh(); setTimeout(() => void refresh(), 2000) }, [refresh])

  useEffect(() => { setLoading(true); void refresh() }, [refresh])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setBusy(`Uploading ${file.name}…`)
    setError(null)
    try {
      const name = file.name.replace(/\.[^.]+$/, '')
      let lengthSeconds = 0
      try {
        lengthSeconds = await new Promise<number>((resolve) => {
          const a = new Audio()
          a.preload = 'metadata'
          a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0)
          a.onerror = () => resolve(0)
          a.src = URL.createObjectURL(file)
        })
      } catch {}
      const audioBase64 = await fileToBase64(file)
      await library.saveSong({ name, audioFilename: file.name, audioBase64, lengthSeconds }, projectId)
      setBusy(null)
      refreshSoon()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  async function del(slug: string, comp?: string, label?: string) {
    if (!window.confirm(comp ? `Delete animation "${label}"?` : `Delete the whole song "${label}" and all its data?`)) return
    setBusy('Deleting…')
    try {
      await library.remove(slug, comp, projectId)
      refreshSoon()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <button onClick={onBack} style={backBtn}>← Installations</button>
          <h1 style={{ fontSize: 24, margin: 0, flex: 1 }}>{projectName}</h1>
          <button onClick={() => fileRef.current?.click()} style={secondaryBtn}>⬆ Upload MP3</button>
          <button onClick={onNewSong} style={primaryBtn}>＋ New song</button>
        </div>
        <p style={{ color: '#8a93a3', margin: '0 0 20px' }}>Open a saved song, upload an MP3, or start fresh.</p>
        <input ref={fileRef} type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*" onChange={handleUpload} style={{ display: 'none' }} />

        {error && <div style={errorBox}>{error}</div>}
        {busy && <div style={busyBox}><span style={spinner} /> {busy}</div>}

        {loading ? (
          <div style={{ color: '#9aa', padding: 40, textAlign: 'center' }}>Loading songs…</div>
        ) : songs.length === 0 ? (
          <div style={{ color: '#9aa', padding: 40, textAlign: 'center', lineHeight: 1.6 }}>
            No songs in this installation yet.<br />
            Upload an MP3, or press <b>＋ New song</b> to start from scratch.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {songs.map((s) => {
              const open = !!expanded[s.slug]
              const comps = s.compositions ?? []
              return (
                <div key={s.slug} style={songCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => setExpanded((e) => ({ ...e, [s.slug]: !open }))} style={chevronBtn}>{open ? '▾' : '▸'}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || s.slug}</div>
                      <div style={{ fontSize: 11, color: '#8a93a3', marginTop: 2 }}>
                        {s.bpm ? `${s.bpm} BPM · ` : ''}{fmtTime(s.lengthSeconds || 0)}
                        {s.hasAudio ? ` · 🎵 ${fmtSize(s.audioSize)}` : ''}
                        {s.hasAnalysis ? ' · 📊 analysis' : ''}
                        {comps.length ? ` · ${comps.length} saved` : ''}
                        {s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenSong(s.slug, s.hasWorking ? 'working' : 'fresh')}
                      style={loadBtn}
                      title={s.hasWorking ? 'Open the last working timeline' : 'Open this song with an empty timeline'}
                    >
                      Open ▸
                    </button>
                    <button onClick={() => del(s.slug, undefined, s.name || s.slug)} style={trashBtn} title="Delete song">🗑</button>
                  </div>

                  {open && (
                    <div style={{ marginTop: 10, marginLeft: 30, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.hasWorking && (
                        <div style={compRow}>
                          <span style={{ flex: 1 }}><b>Working timeline</b></span>
                          <button onClick={() => onOpenSong(s.slug, 'working')} style={smallLoadBtn}>Open</button>
                        </div>
                      )}
                      {comps.map((c) => {
                        const badge = methodBadge[c.method || 'manual'] || methodBadge.manual
                        return (
                          <div key={c.slug} style={compRow}>
                            <span style={{ ...badgeStyle, background: badge.bg }}>{badge.label}</span>
                            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.slug}</span>
                            <span style={{ color: '#8a93a3', fontSize: 11 }}>{c.timeframeCount ?? '?'} tf · {fmtDate(c.createdAt)}</span>
                            <button onClick={() => onOpenSong(s.slug, c.slug)} style={smallLoadBtn}>Open</button>
                            <button onClick={() => del(s.slug, c.slug, c.name || c.slug)} style={smallTrashBtn}>🗑</button>
                          </div>
                        )
                      })}
                      {!s.hasWorking && s.compositions.length === 0 && (
                        <div style={{ color: '#8a93a3', fontSize: 12 }}>No saved animations yet. Open this song and compose.</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { flex: 1, padding: '28px 20px', overflowY: 'auto' }
const songCard: React.CSSProperties = { background: '#1b1f27', borderRadius: 8, padding: '10px 12px', border: '1px solid #2a303b' }
const compRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#12161d', borderRadius: 6, padding: '5px 8px' }
const primaryBtn: React.CSSProperties = { background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }
const secondaryBtn: React.CSSProperties = { background: '#2a303b', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }
const backBtn: React.CSSProperties = { background: 'none', color: '#9aa7bd', border: '1px solid #2a303b', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }
const loadBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
const smallLoadBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }
const trashBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.6 }
const smallTrashBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: 0.55 }
const chevronBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#8a93a3', cursor: 'pointer', fontSize: 14, padding: 2 }
const badgeStyle: React.CSSProperties = { color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.03em' }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }
const busyBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#1f2b3a', border: '1px solid #3b82f6', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#cfe3ff' }
const spinner: React.CSSProperties = { width: 14, height: 14, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }
