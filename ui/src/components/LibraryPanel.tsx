import React, { useCallback, useEffect, useRef, useState } from 'react'
import { library, fileToBase64, type LibrarySongSummary } from '../lib/library'

/**
 * Song library: every uploaded MP3 with its analysis, the AI output, the live working
 * timeline, and saved animations — stored in Cloudflare KV via the Worker. A persistent
 * workbench: load any past song/animation back into the timeline, upload new audio, prune
 * what you don't need.
 */

interface Props {
  onClose: () => void
  activeSlug?: string
  /** Load a saved composition (comp='working' for the live timeline, or an animation slug). */
  onLoadComposition: (slug: string, comp: string) => void | Promise<void>
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

export default function LibraryPanel({ onClose, activeSlug, onLoadComposition }: Props) {
  const [songs, setSongs] = useState<LibrarySongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const list = await library.listSongs()
      setSongs(list)
      // auto-expand the active song
      if (activeSlug) setExpanded((e) => ({ ...e, [activeSlug]: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activeSlug])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setBusy(`Uploading ${file.name}…`)
    setError(null)
    try {
      const name = file.name.replace(/\.[^.]+$/, '')
      // Probe duration client-side (no decode needed for bpm; analysis fills that later)
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
      await library.saveSong({ name, audioFilename: file.name, audioBase64, lengthSeconds })
      setBusy(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  async function load(slug: string, comp: string) {
    setBusy('Loading into timeline…')
    try {
      await onLoadComposition(slug, comp)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  async function del(slug: string, comp?: string, label?: string) {
    if (!window.confirm(comp ? `Delete animation "${label}"?` : `Delete the whole song "${label}" and all its data?`)) return
    setBusy('Deleting…')
    try {
      await library.remove(slug, comp)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>📚 Song library</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => fileRef.current?.click()} style={primaryBtn}>⬆ Upload MP3</button>
            <button onClick={refresh} style={secondaryBtn} title="Refresh">↻</button>
            <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*" onChange={handleUpload} style={{ display: 'none' }} />

        {error && <div style={errorBox}>{error}</div>}
        {busy && (
          <div style={busyBox}>
            <span style={spinner} /> {busy}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#9aa', padding: 24, textAlign: 'center' }}>Loading library…</div>
        ) : songs.length === 0 ? (
          <div style={{ color: '#9aa', padding: 32, textAlign: 'center', lineHeight: 1.6 }}>
            No songs saved yet.<br />
            Upload an MP3 here, or analyze one in 🎵 Compose — it'll be stored automatically with its analysis.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {songs.map((s) => {
              const open = !!expanded[s.slug]
              const isActive = s.slug === activeSlug
              return (
                <div key={s.slug} style={{ ...songCard, ...(isActive ? activeCard : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => setExpanded((e) => ({ ...e, [s.slug]: !open }))} style={chevronBtn}>
                      {open ? '▾' : '▸'}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || s.slug}</span>
                        {isActive && <span style={activePill}>open</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#8a93a3', marginTop: 2 }}>
                        {s.bpm ? `${s.bpm} BPM · ` : ''}
                        {fmtTime(s.lengthSeconds || 0)}
                        {s.hasAudio ? ` · 🎵 ${fmtSize(s.audioSize)}` : ''}
                        {s.hasAnalysis ? ' · 📊 analysis' : ''}
                        {s.compositions.length ? ` · ${s.compositions.length} saved` : ''}
                        {s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ''}
                      </div>
                    </div>
                    {s.hasWorking && (
                      <button onClick={() => load(s.slug, 'working')} style={loadBtn} title="Load the last working timeline">
                        Open ▸
                      </button>
                    )}
                    <button onClick={() => del(s.slug, undefined, s.name || s.slug)} style={trashBtn} title="Delete song">🗑</button>
                  </div>

                  {open && (
                    <div style={{ marginTop: 10, marginLeft: 30, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.hasWorking && (
                        <div style={compRow}>
                          <span style={{ flex: 1 }}>
                            <b>Working timeline</b> <span style={{ color: '#8a93a3', fontSize: 11 }}>(auto-saved)</span>
                          </span>
                          <button onClick={() => load(s.slug, 'working')} style={smallLoadBtn}>Load</button>
                        </div>
                      )}
                      {s.compositions.map((c) => {
                        const badge = methodBadge[c.method || 'manual'] || methodBadge.manual
                        return (
                          <div key={c.slug} style={compRow}>
                            <span style={{ ...badgeStyle, background: badge.bg }}>{badge.label}</span>
                            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.slug}</span>
                            <span style={{ color: '#8a93a3', fontSize: 11 }}>{c.timeframeCount ?? '?'} tf · {fmtDate(c.createdAt)}</span>
                            <button onClick={() => load(s.slug, c.slug)} style={smallLoadBtn}>Load</button>
                            <button onClick={() => del(s.slug, c.slug, c.name || c.slug)} style={smallTrashBtn}>🗑</button>
                          </div>
                        )
                      })}
                      {!s.hasWorking && s.compositions.length === 0 && (
                        <div style={{ color: '#8a93a3', fontSize: 12 }}>No saved animations yet. Open this song, compose, then “Save animation”.</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 12, textAlign: 'center' }}>
          Stored in your Cloudflare library · shared between this machine and leds.iddofroom.co.il
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0009', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: 24 }
const modal: React.CSSProperties = { background: '#1b1e24', color: '#e8eaed', borderRadius: 10, padding: 18, width: 'min(820px, 95vw)', boxShadow: '0 10px 40px #000a', marginTop: 24 }
const songCard: React.CSSProperties = { background: '#23272f', borderRadius: 8, padding: '10px 12px', border: '1px solid #2d323c' }
const activeCard: React.CSSProperties = { border: '1px solid #34d399', boxShadow: '0 0 0 1px #34d39955' }
const compRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#1b1e24', borderRadius: 6, padding: '5px 8px' }
const primaryBtn: React.CSSProperties = { background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }
const secondaryBtn: React.CSSProperties = { background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 11px', cursor: 'pointer' }
const loadBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
const smallLoadBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }
const trashBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.6 }
const smallTrashBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: 0.55 }
const chevronBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#8a93a3', cursor: 'pointer', fontSize: 14, padding: 2 }
const badgeStyle: React.CSSProperties = { color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.03em' }
const activePill: React.CSSProperties = { background: '#34d399', color: '#04150f', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }
const busyBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#1f2b3a', border: '1px solid #3b82f6', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: '#cfe3ff' }
const spinner: React.CSSProperties = { width: 14, height: 14, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }
