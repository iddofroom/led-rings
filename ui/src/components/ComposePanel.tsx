import React, { useEffect, useMemo, useState } from 'react'
import TasteRulesEditor from './TasteRulesEditor'
import { useI18n } from '../lib/i18n'

/**
 * Compose panel (PHASE 1+2 GUI): analyze an audio file, EAR-CHECK the detected
 * structure against the audio, edit the taste rules, and generate a first-draft
 * composition into the timeline. Talks to the control server:
 *   POST /api/analyze, GET/POST /api/taste-rules, POST /api/translate, GET /api/audio
 */

interface SectionSummary {
  energy: number
  onsetDensity: number
  spectralCentroid: number
  bandEnergy: { sub: number; low: number; mid: number; high: number }
}
interface Section { startMs: number; endMs: number; label: string; confidence: number; bpm: number; summary: SectionSummary }
interface Analysis {
  bpmGlobal: number
  downbeatConfidence: number
  audio: { durationMs: number; peakDbfs: number }
  beatTimestampsMs: number[]
  downbeatTimestampsMs: number[]
  sections: Section[]
  curves: { energy: number[]; timeMs: number[] }
}

interface Props {
  apiBase: string
  song: { audioFilePath?: string; name?: string }
  onLoad: (payload: { song: Record<string, unknown>; timeframes: unknown[] }) => void
  /** Surgically replace one section's timeframes in the live timeline (preserves manual edits elsewhere). */
  onReplaceSection?: (sectionIdx: number, timeframes: unknown[]) => void
  /** Fired after a successful analyze — lets the app archive the song + analysis in the library. */
  onAnalyzed?: (analysis: unknown, audioPath: string) => void
  /** Compose the song from the user's named pattern LIBRARY (a different pattern per part)
   *  instead of the abstract generator patterns. Needs an analysis (for the section split). */
  onComposeFromLibrary?: (analysis: unknown) => boolean | void
  /** Returns the song's already-saved analysis (from this session or the cloud library),
   *  so the same song never has to be analyzed twice. */
  onLoadSavedAnalysis?: () => Promise<unknown | null>
  /** True when the current timeline already holds a composition (this song was composed
   *  before, e.g. loaded from the library) — so the action reads "Recompose". */
  alreadyComposed?: boolean
  onClose: () => void
}

const LABEL_COLORS: Record<string, string> = {
  intro: '#9cf', build: '#fd6', drop: '#f66', breakdown: '#6cf',
  chorus: '#fa6', verse: '#ccc', outro: '#aaa',
}
const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export default function ComposePanel({ apiBase, song, onLoad, onReplaceSection, onAnalyzed, onComposeFromLibrary, onLoadSavedAnalysis, alreadyComposed, onClose }: Props) {
  // Aliased to `tr` — this component uses `t` as the timeframe var in several .map/.filter/for loops.
  const { t: tr } = useI18n()
  const [audioPath, setAudioPath] = useState(song.audioFilePath || 'ODESZA - A Moment Apart.mp3')
  const [bpmHint, setBpmHint] = useState<string>('')
  const [sectionsK, setSectionsK] = useState<string>('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [rulesText, setRulesText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  // Always compose with Gemini (the control server falls back to rules if the key is missing).
  const useLlm = true
  const [composed, setComposed] = useState<{ song: Record<string, unknown>; timeframes: any[] } | null>(null)
  const [rerolling, setRerolling] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/taste-rules`)
      .then((r) => r.json())
      .then((j) => setRulesText(j.content || ''))
      .catch(() => setError(tr({ en: 'Could not load taste/rules.yaml (is the control server running?)', he: 'לא ניתן לטעון את taste/rules.yaml (האם שרת הבקרה פועל?)' })))
  }, [apiBase])

  // Reuse the song's saved analysis if it already has one — no need to re-analyze the
  // same song every time you open Compose. (Falls through to manual Analyze if there's none.)
  useEffect(() => {
    if (!onLoadSavedAnalysis) return
    let cancelled = false
    onLoadSavedAnalysis()
      .then((a) => {
        if (cancelled || !a) return
        const an = a as Analysis
        if (Array.isArray(an.sections) && an.sections.length) {
          setAnalysis(an)
          setStatus(tr({ en: 'Loaded the song’s saved analysis — no need to re-analyze.', he: 'נטען הניתוח השמור של השיר — אין צורך לנתח מחדש.' }))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // mount-only: load once when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const audioUrl = `${apiBase}/api/audio?path=${encodeURIComponent(audioPath)}`

  async function call<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${apiBase}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error((j as any).error || `${path} failed (${r.status})${(j as any).stderr ? ': ' + (j as any).stderr : ''}`)
    }
    return r.json()
  }

  async function analyze() {
    setError(null); setStatus(null); setBusy(tr({ en: 'Analyzing audio (this can take ~20s)…', he: 'מנתח אודיו (יכול לקחת ~20 שניות)…' }))
    try {
      const body: Record<string, unknown> = { audioFilePath: audioPath }
      if (bpmHint && Number(bpmHint) > 0) body.bpm = Number(bpmHint)
      if (sectionsK && Number(sectionsK) >= 2) body.sections = Number(sectionsK)
      const a = await call<Analysis>('/api/analyze', body)
      setAnalysis(a)
      setStatus(`${tr({ en: 'Analyzed:', he: 'נותח:' })} ${a.bpmGlobal} BPM, ${a.sections.length} ${tr({ en: 'sections', he: 'מקטעים' })}, ${a.beatTimestampsMs.length} ${tr({ en: 'beats', he: 'ביטים' })}.`)
      onAnalyzed?.(a, audioPath)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  async function saveRules() {
    setError(null); setBusy(tr({ en: 'Saving rules…', he: 'שומר חוקים…' }))
    try { await call('/api/taste-rules', { content: rulesText }); setStatus(tr({ en: 'Saved taste/rules.yaml.', he: 'נשמר taste/rules.yaml.' })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  async function generate() {
    setError(null)
    setBusy(useLlm ? tr({ en: 'Designing sections with Gemini…', he: 'מעצב מקטעים עם Gemini…' }) : tr({ en: 'Generating composition…', he: 'מייצר הרכב…' }))
    try {
      let a = analysis
      if (!a) { setBusy(tr({ en: 'Analyzing audio first… (~20s)', he: 'קודם מנתח אודיו… (~20 שניות)' })); a = await call<Analysis>('/api/analyze', { audioFilePath: audioPath }); setAnalysis(a) }
      setBusy(useLlm
        ? `${tr({ en: 'Asking Gemini to design', he: 'מבקש מ־Gemini לעצב' })} ${a.sections.length} ${tr({ en: 'sections in parallel… (~30–40s)', he: 'מקטעים במקביל… (~30–40 שניות)' })}`
        : tr({ en: 'Generating composition…', he: 'מייצר הרכב…' }))
      await call('/api/taste-rules', { content: rulesText }) // persist current edits first
      const result = await call<{ song: Record<string, unknown>; timeframes: any[] }>('/api/translate', { analysis: a, useLlm })
      setBusy(tr({ en: 'Loading into timeline…', he: 'טוען לציר הזמן…' }))
      setComposed(result)
      onLoad(result)
      setStatus(`${tr({ en: 'Loaded', he: 'נטענו' })} ${result.timeframes.length} ${tr({ en: 'timeframes into the timeline. Reroll any part below.', he: 'טיימפריימים לציר הזמן. גלגל מחדש כל חלק למטה.' })}`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  /** Compose from the user's named pattern LIBRARY — a different pattern per part.
   *  Needs an analysis (to split the song into parts); re-click for another mix. */
  function composeFromMyPatterns() {
    if (!onComposeFromLibrary) return
    if (!analysis) { setError(tr({ en: 'Analyze the song first so it can be split into parts.', he: 'נתח קודם את השיר כדי שאפשר יהיה לפצל אותו לחלקים.' })); return }
    setError(null)
    const ok = onComposeFromLibrary(analysis)
    setStatus(ok === false
      ? tr({ en: 'No patterns available — add some in the library first.', he: 'אין תבניות זמינות — הוסף כמה בספרייה קודם.' })
      : tr({ en: 'Composed from your pattern library — a different pattern per part. Click again for another mix.', he: 'הולחן מספריית התבניות שלך — תבנית שונה לכל חלק. לחץ שוב לערבוב נוסף.' }))
  }

  /** Reroll ONE section's pattern: re-translate just that section and swap its
   *  timeframes into the current composition (live timeline update). */
  async function rerollSection(idx: number) {
    if (!analysis || !composed) return
    setError(null); setRerolling(idx)
    try {
      const res = await call<{ timeframes: any[] }>('/api/translate', { analysis, section: idx, useLlm })
      const fresh = (res.timeframes || []).map((t) => ({ ...t, _section: idx }))
      // keep the panel's section list in sync
      setComposed({
        song: composed.song,
        timeframes: [...composed.timeframes.filter((t) => t._section !== idx), ...fresh]
          .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)),
      })
      // surgically update ONLY this section in the live timeline (preserves manual edits elsewhere)
      if (onReplaceSection) onReplaceSection(idx, fresh)
      else onLoad({ song: composed.song, timeframes: [...composed.timeframes.filter((t) => t._section !== idx), ...fresh] })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRerolling(null) }
  }

  /** Group the composed timeframes by section for the per-part reroll list. */
  const sectionRows = (() => {
    if (!composed) return []
    const by = new Map<number, { label: string; pattern: string; count: number; start: number }>()
    for (const t of composed.timeframes) {
      const idx = t._section ?? -1
      if (idx < 0) continue
      const src = String(t._source || '')
      const parts = src.split(':')
      const label = parts[1] || (analysis?.sections[idx]?.label ?? `${tr({ en: 'part', he: 'חלק' })} ${idx}`)
      const pattern = parts[2] || '—'
      const cur = by.get(idx)
      if (!cur) by.set(idx, { label, pattern, count: 1, start: t.startTime ?? 0 })
      else { cur.count++; cur.start = Math.min(cur.start, t.startTime ?? 0) }
    }
    return [...by.entries()].map(([idx, v]) => ({ idx, ...v })).sort((a, b) => a.start - b.start)
  })()

  const sparkline = useMemo(() => {
    if (!analysis) return null
    const E = analysis.curves.energy, W = 760, H = 64
    const step = Math.max(1, Math.ceil(E.length / W))
    const pts: string[] = []
    for (let i = 0; i < E.length; i += step) pts.push(`${(i / (E.length - 1)) * W},${H - E[i] * H}`)
    const dur = analysis.audio.durationMs
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 64, display: 'block', background: '#1118' }}>
        {analysis.sections.map((s, i) => (
          <rect key={i} x={(s.startMs / dur) * W} y={0} width={((s.endMs - s.startMs) / dur) * W} height={H}
            fill={LABEL_COLORS[s.label] || '#888'} opacity={0.18} />
        ))}
        <polyline points={pts.join(' ')} fill="none" stroke="#e25" strokeWidth={1} />
        {analysis.downbeatTimestampsMs.map((d, i) => (
          <line key={i} x1={(d / dur) * W} x2={(d / dur) * W} y1={H - 8} y2={H} stroke="#3a3" strokeWidth={0.5} />
        ))}
      </svg>
    )
  }, [analysis])

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>🎵 {tr({ en: 'Compose from audio', he: 'הלחנה מאודיו' })}</h2>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
        <style>{`@keyframes composeSpin{to{transform:rotate(360deg)}}@keyframes composePulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
        {error && <div style={{ background: '#c0222a', color: '#fff', padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 13 }}>{error}</div>}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1f2b3a', border: '1px solid #3b82f6', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
            <span style={{ width: 18, height: 18, border: '3px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#cfe3ff', animation: 'composePulse 1.6s ease-in-out infinite' }}>{busy}</span>
          </div>
        )}
        {!busy && status && <div style={{ color: '#3c9', fontSize: 13, marginBottom: 8 }}>{status}</div>}

        {/* 1. Analyze + ear-check */}
        <section style={card}>
          <h3 style={h3}>1 · {tr({ en: 'Analyze & ear-check', he: 'נתח ובדיקת אוזן' })}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={audioPath} onChange={(e) => setAudioPath(e.target.value)} placeholder={tr({ en: 'audio file (in src/audio, ui/public, or src/songs)', he: 'קובץ אודיו (ב־src/audio, ui/public, או src/songs)' })}
              style={{ flex: '1 1 280px', padding: 6 }} />
            <input value={bpmHint} onChange={(e) => setBpmHint(e.target.value)} placeholder={tr({ en: 'BPM hint', he: 'רמז BPM' })} style={{ width: 90, padding: 6 }} />
            <input value={sectionsK} onChange={(e) => setSectionsK(e.target.value)} placeholder={tr({ en: '#sections', he: 'מס׳ מקטעים' })} style={{ width: 90, padding: 6 }} />
            <button onClick={analyze} disabled={!!busy} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy && <span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />}
              {busy ? '…' : tr({ en: 'Analyze', he: 'נתח' })}
            </button>
          </div>
          <audio controls src={audioUrl} style={{ width: '100%', marginTop: 8 }} />
          {analysis && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#9aa', marginBottom: 4 }}>
                {analysis.bpmGlobal} BPM · {analysis.beatTimestampsMs.length} {tr({ en: 'beats', he: 'ביטים' })} · {analysis.downbeatTimestampsMs.length} {tr({ en: 'downbeats', he: 'דאונביטים' })}
                ({tr({ en: 'conf', he: 'ביטחון' })} {analysis.downbeatConfidence}) · {tr({ en: 'peak', he: 'שיא' })} {analysis.audio.peakDbfs} dBFS
              </div>
              {sparkline}
              <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: '#9aa' }}>
                  <th>{tr({ en: 'section', he: 'מקטע' })}</th><th>{tr({ en: 'time', he: 'זמן' })}</th><th>bpm</th><th style={{ width: '38%' }}>{tr({ en: 'energy', he: 'אנרגיה' })}</th><th>{tr({ en: 'conf', he: 'ביטחון' })}</th>
                </tr></thead>
                <tbody>
                  {analysis.sections.map((s, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #3334' }}>
                      <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: LABEL_COLORS[s.label] || '#888', marginRight: 6 }} />{s.label}</td>
                      <td>{fmtTime(s.startMs)}–{fmtTime(s.endMs)}</td>
                      <td>{s.bpm || '—'}</td>
                      <td><div style={{ background: '#e25', height: 8, borderRadius: 4, width: `${Math.round(s.summary.energy * 100)}%` }} /></td>
                      <td>{s.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: '#789', marginTop: 4 }}>
                {tr({ en: 'Play the audio above and check the section boundaries/energy match what you hear. Labels are a heuristic first draft.', he: 'נגן את האודיו למעלה ובדוק שגבולות המקטעים/האנרגיה תואמים למה שאתה שומע. התוויות הן טיוטה ראשונית היוריסטית.' })}
              </div>
            </div>
          )}
        </section>

        {/* 2. Taste rules */}
        <section style={card}>
          <h3 style={h3}>2 · {tr({ en: 'Taste rules', he: 'חוקי טעם' })} <span style={{ fontWeight: 400, fontSize: 12, color: '#9aa' }}>{tr({ en: '(taste/rules.yaml — yours to own)', he: '(taste/rules.yaml — שלך לגמרי)' })}</span></h3>
          <TasteRulesEditor value={rulesText} onChange={setRulesText} />
          <div style={{ marginTop: 10 }}>
            <button onClick={saveRules} disabled={!!busy} style={secondaryBtn}>{tr({ en: 'Save rules', he: 'שמור חוקים' })}</button>
            <span style={{ fontSize: 11, color: '#789', marginLeft: 8 }}>{tr({ en: 'Generate persists edits automatically.', he: 'ייצור שומר את העריכות אוטומטית.' })}</span>
          </div>
        </section>

        {/* 3. Generate */}
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {onComposeFromLibrary && (
              <button onClick={composeFromMyPatterns} disabled={!!busy || !analysis}
                title={analysis ? tr({ en: 'Fill each part of the song with a DIFFERENT pattern from your library', he: 'מלא כל חלק בשיר בתבנית שונה מהספרייה שלך' }) : tr({ en: 'Analyze the song first', he: 'נתח קודם את השיר' })}
                style={{ ...primaryBtn, background: 'linear-gradient(135deg,#10b981 0%,#059669 100%)', fontSize: 15, padding: '10px 20px', opacity: (busy || !analysis) ? 0.6 : 1 }}>
                🎨 {composed || alreadyComposed ? tr({ en: 'Recompose from my patterns', he: 'הרכב מחדש מהתבניות שלי' }) : tr({ en: 'Compose from my patterns → timeline ▸', he: 'הלחן מהתבניות שלי → ציר הזמן ▸' })}
              </button>
            )}
            <span style={{ fontSize: 11, color: '#9aa', display: 'inline-flex', alignItems: 'center', gap: 5 }} title={tr({ en: 'Alternative: design each section from the abstract generator patterns (build-up, sweep, pulse…) with Gemini.', he: 'חלופה: עצב כל מקטע מתבניות המחולל המופשטות (build-up, sweep, pulse…) עם Gemini.' })}>
              ✨ Gemini
            </span>
            <button onClick={generate} disabled={!!busy} style={{ ...secondaryBtn, fontSize: 13, opacity: busy ? 0.65 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {busy && <span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />}
              {busy ? tr({ en: 'Working…', he: 'עובד…' }) : (composed || alreadyComposed ? tr({ en: '↻ Recompose (Gemini)', he: '↻ הרכב מחדש (Gemini)' }) : tr({ en: 'Generate (Gemini)', he: 'ייצר (Gemini)' }))}
            </button>
          </div>

          {/* Per-part reroll — switch the pattern of one section at a time (live). */}
          {composed && sectionRows.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid #3a3f4b', paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: '#9aa', marginBottom: 6 }}>
                {tr({ en: 'Reroll any part to switch its pattern (updates the timeline live):', he: 'גלגל מחדש כל חלק כדי להחליף את התבנית שלו (מעדכן את ציר הזמן בזמן אמת):' })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {sectionRows.map((r) => (
                  <div key={r.idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: LABEL_COLORS[r.label] || '#888', flexShrink: 0 }} />
                    <span style={{ width: 78, color: '#cde' }}>{r.label}</span>
                    <span style={{ flex: 1, color: '#9aa' }}>{r.pattern} <span style={{ color: '#667' }}>({r.count} tf)</span></span>
                    <button onClick={() => rerollSection(r.idx)} disabled={rerolling !== null || !!busy}
                      style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      title={tr({ en: 'Generate a different pattern for this part', he: 'ייצר תבנית שונה לחלק זה' })}>
                      {rerolling === r.idx
                        ? <span style={{ width: 11, height: 11, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />
                        : '🔀'} {tr({ en: 'reroll', he: 'גלגל מחדש' })}
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'right', marginTop: 10 }}>
                <button onClick={onClose} style={{ ...primaryBtn, padding: '8px 18px' }}>{tr({ en: 'Done', he: 'סיום' })} ✓</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0009', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: 24 }
const modal: React.CSSProperties = { background: '#1b1e24', color: '#e8eaed', borderRadius: 10, padding: 18, width: 'min(860px, 95vw)', boxShadow: '0 10px 40px #000a', marginTop: 24 }
const card: React.CSSProperties = { background: '#23272f', borderRadius: 8, padding: 12, marginBottom: 12 }
const h3: React.CSSProperties = { margin: '0 0 8px', fontSize: 14 }
const primaryBtn: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }
