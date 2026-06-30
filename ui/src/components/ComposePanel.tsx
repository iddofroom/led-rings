import React, { useEffect, useMemo, useState } from 'react'

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
  onClose: () => void
}

const LABEL_COLORS: Record<string, string> = {
  intro: '#9cf', build: '#fd6', drop: '#f66', breakdown: '#6cf',
  chorus: '#fa6', verse: '#ccc', outro: '#aaa',
}
const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export default function ComposePanel({ apiBase, song, onLoad, onClose }: Props) {
  const [audioPath, setAudioPath] = useState(song.audioFilePath || 'ODESZA - A Moment Apart.mp3')
  const [bpmHint, setBpmHint] = useState<string>('')
  const [sectionsK, setSectionsK] = useState<string>('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [rulesText, setRulesText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [useLlm, setUseLlm] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/api/taste-rules`)
      .then((r) => r.json())
      .then((j) => setRulesText(j.content || ''))
      .catch(() => setError('Could not load taste/rules.yaml (is the control server running?)'))
  }, [apiBase])

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
    setError(null); setStatus(null); setBusy('Analyzing audio (this can take ~20s)…')
    try {
      const body: Record<string, unknown> = { audioFilePath: audioPath }
      if (bpmHint && Number(bpmHint) > 0) body.bpm = Number(bpmHint)
      if (sectionsK && Number(sectionsK) >= 2) body.sections = Number(sectionsK)
      const a = await call<Analysis>('/api/analyze', body)
      setAnalysis(a)
      setStatus(`Analyzed: ${a.bpmGlobal} BPM, ${a.sections.length} sections, ${a.beatTimestampsMs.length} beats.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  async function saveRules() {
    setError(null); setBusy('Saving rules…')
    try { await call('/api/taste-rules', { content: rulesText }); setStatus('Saved taste/rules.yaml.') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  async function generate() {
    setError(null)
    setBusy(useLlm ? 'Designing sections with Gemini…' : 'Generating composition…')
    try {
      let a = analysis
      if (!a) { setBusy('Analyzing audio first… (~20s)'); a = await call<Analysis>('/api/analyze', { audioFilePath: audioPath }); setAnalysis(a) }
      setBusy(useLlm
        ? `Asking Gemini to design ${a.sections.length} sections in parallel… (~30–40s)`
        : 'Generating composition…')
      await call('/api/taste-rules', { content: rulesText }) // persist current edits first
      const result = await call<{ song: Record<string, unknown>; timeframes: unknown[] }>('/api/translate', { analysis: a, useLlm })
      setBusy('Loading into timeline…')
      onLoad(result)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }

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
          <h2 style={{ margin: 0, fontSize: 18 }}>🎵 Compose from audio</h2>
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
          <h3 style={h3}>1 · Analyze &amp; ear-check</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={audioPath} onChange={(e) => setAudioPath(e.target.value)} placeholder="audio file (in src/audio, ui/public, or src/songs)"
              style={{ flex: '1 1 280px', padding: 6 }} />
            <input value={bpmHint} onChange={(e) => setBpmHint(e.target.value)} placeholder="BPM hint" style={{ width: 90, padding: 6 }} />
            <input value={sectionsK} onChange={(e) => setSectionsK(e.target.value)} placeholder="#sections" style={{ width: 90, padding: 6 }} />
            <button onClick={analyze} disabled={!!busy} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy && <span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />}
              {busy ? '…' : 'Analyze'}
            </button>
          </div>
          <audio controls src={audioUrl} style={{ width: '100%', marginTop: 8 }} />
          {analysis && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#9aa', marginBottom: 4 }}>
                {analysis.bpmGlobal} BPM · {analysis.beatTimestampsMs.length} beats · {analysis.downbeatTimestampsMs.length} downbeats
                (conf {analysis.downbeatConfidence}) · peak {analysis.audio.peakDbfs} dBFS
              </div>
              {sparkline}
              <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: '#9aa' }}>
                  <th>section</th><th>time</th><th>bpm</th><th style={{ width: '38%' }}>energy</th><th>conf</th>
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
                Play the audio above and check the section boundaries/energy match what you hear. Labels are a heuristic first draft.
              </div>
            </div>
          )}
        </section>

        {/* 2. Taste rules */}
        <section style={card}>
          <h3 style={h3}>2 · Taste rules <span style={{ fontWeight: 400, fontSize: 12, color: '#9aa' }}>(taste/rules.yaml — yours to own)</span></h3>
          <textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} spellCheck={false}
            style={{ width: '100%', height: 220, fontFamily: 'monospace', fontSize: 12, padding: 8, boxSizing: 'border-box' }} />
          <button onClick={saveRules} disabled={!!busy} style={secondaryBtn}>Save rules</button>
          <span style={{ fontSize: 11, color: '#789', marginLeft: 8 }}>Only SAFE-list effects (the file header lists them). Generate persists edits automatically.</span>
        </section>

        {/* 3. Generate */}
        <section style={{ ...card, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}>
          <label style={{ fontSize: 12, color: '#9aa', display: 'flex', alignItems: 'center', gap: 6 }} title="Let Gemini design each section within the SAFE list (needs GEMINI_API_KEY on the control server). Falls back to rules if unavailable.">
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            Use Gemini (LLM)
          </label>
          <button onClick={generate} disabled={!!busy} style={{ ...primaryBtn, fontSize: 15, padding: '10px 20px', opacity: busy ? 0.65 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {busy && <span style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />}
            {busy ? 'Working…' : 'Generate composition → timeline ▸'}
          </button>
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
