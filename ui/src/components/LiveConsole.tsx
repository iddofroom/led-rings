import React, { useMemo, useState } from 'react'
import type { Timeframe, TimeframeEffectEntry } from '../App'
import { isRingActiveAtBeat } from '../movementGenerators'
import RingVisualization from './RingVisualization'

/**
 * Fullscreen LIVE CONSOLE — a VJ surface for performing the LED show while the song
 * plays. See the rings big, then drag pattern pads onto ALL / a single ring / a song
 * section, tune the pattern rate, scrub the song timeline (with section dividers), and
 * everything pushes to the simulator + (in Live mode) the physical LEDs.
 */

interface SongLike {
  name?: string
  bpm?: number
  lengthSeconds?: number
  beatTimestampsMs?: number[]
}

interface LiveConsoleProps {
  song: SongLike
  timeframes: Timeframe[]
  /** Commit a new timeframe set (checkpointed/undoable in the parent). */
  onApplyTimeframes: (tfs: Timeframe[]) => void
  songLengthBeats: number
  currentTime: number
  isPlaying: boolean
  onPlayPause: () => void
  onStop: () => void
  onSeekBeat: (beat: number) => void
  brightness: number
  brightnessConnected: boolean
  onBrightnessChange: (v: number) => void
  /** True while live edits auto-push to the LEDs (Live mode + control server up). */
  autoSend: boolean
  onClose: () => void
}

// ── Pattern catalog (XLIGHT-style pads) → SAFE timeframe effects ──────────────
interface PatternDef {
  key: string
  label: string
  icon: string
  color: string
  /** Wrap with a cycle of `rate` beats so it repeats in time. */
  cyclic: boolean
  effects: () => Omit<TimeframeEffectEntry, 'id'>[]
}

const PATTERNS: PatternDef[] = [
  { key: 'solid', label: 'Solid', icon: '⬤', color: '#3b82f6', cyclic: false, effects: () => [] },
  { key: 'pulse', label: 'Pulse', icon: '🔆', color: '#f59e0b', cyclic: true, effects: () => [{ effectKey: 'pulse', params: { low: 0.15 } }] },
  { key: 'blink', label: 'Blink', icon: '✦', color: '#ef4444', cyclic: true, effects: () => [{ effectKey: 'blink' }] },
  { key: 'breathe', label: 'Breathe', icon: '◐', color: '#22d3ee', cyclic: true, effects: () => [{ effectKey: 'fadeInOut' }] },
  { key: 'snake', label: 'Snake', icon: '🐍', color: '#10b981', cyclic: true, effects: () => [{ effectKey: 'snake', params: { tailLength: 0.4, cyclic: true } }] },
  { key: 'rainbow', label: 'Rainbow', icon: '🌈', color: '#a855f7', cyclic: true, effects: () => [{ effectKey: 'hueShiftStartToEnd' }] },
  { key: 'fadeIn', label: 'Fade In', icon: '🌅', color: '#84cc16', cyclic: false, effects: () => [{ effectKey: 'fadeIn' }] },
  { key: 'fadeOut', label: 'Fade Out', icon: '🌙', color: '#6366f1', cyclic: false, effects: () => [{ effectKey: 'fadeOut' }] },
]

const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']
const RATE_TICKS = [0.25, 0.5, 1, 2, 4, 8]
const ALL_RINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const DT_KEY = 'text/led-pattern'

let _seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(_seq++).toString(36)}`

export default function LiveConsole({
  song, timeframes, onApplyTimeframes, songLengthBeats,
  currentTime, isPlaying, onPlayPause, onStop, onSeekBeat,
  brightness, brightnessConnected, onBrightnessChange, autoSend, onClose,
}: LiveConsoleProps) {
  const [color, setColor] = useState(COLORS[6])
  const [rate, setRate] = useState(2)
  const [armed, setArmed] = useState<string | null>(null) // pad selected by click (apply on target click)
  const [dropHint, setDropHint] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.code === 'Space') { e.preventDefault(); onPlayPause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPlayPause])

  // Sections derived from the composed timeframes' _section tags (with end beats).
  const sections = useMemo(() => {
    const by = new Map<number, { idx: number; label: string; startBeat: number }>()
    for (const t of timeframes) {
      if (typeof t._section !== 'number') continue
      const label = String(t._source || '').split(':')[1] || `part ${t._section}`
      const cur = by.get(t._section)
      if (!cur) by.set(t._section, { idx: t._section, label, startBeat: t.startTime })
      else cur.startBeat = Math.min(cur.startBeat, t.startTime)
    }
    const arr = [...by.values()].sort((a, b) => a.startBeat - b.startBeat)
    if (arr.length === 0) return [{ idx: 0, label: 'whole song', startBeat: 0, endBeat: songLengthBeats }]
    return arr.map((s, i) => ({ ...s, endBeat: i + 1 < arr.length ? arr[i + 1].startBeat : songLengthBeats }))
  }, [timeframes, songLengthBeats])

  const currentSection = useMemo(
    () => sections.find((s) => currentTime >= s.startBeat && currentTime < s.endBeat) ?? sections[0],
    [sections, currentTime],
  )

  const activeTimeframes = useMemo(
    () => timeframes.filter((tf) => !tf.disabled && currentTime >= tf.startTime && currentTime < tf.endTime),
    [timeframes, currentTime],
  )
  const activeRings = useMemo(
    () => Array.from(new Set(activeTimeframes.flatMap((tf) =>
      tf.rings.filter((r) => isRingActiveAtBeat(tf.startTime, tf.endTime, tf.rings, tf.movement, r, currentTime))))),
    [activeTimeframes, currentTime],
  )

  // ── Apply a pattern onto target rings over a beat range ("paint" semantics) ──
  function apply(patternKey: string, rings: number[], range: [number, number], targetLabel: string, opts?: { color?: string; rate?: number }) {
    const pat = PATTERNS.find((p) => p.key === patternKey)
    if (!pat) return
    const [s, e] = range
    if (!(e > s)) return
    // Allow explicit overrides so callers (e.g. Random) don't race React's async color/rate state.
    const useColor = opts?.color ?? color
    const useRate = opts?.rate ?? rate
    const newTf: Timeframe = {
      id: uid('live'),
      startTime: s,
      endTime: e,
      label: `${pat.label} · ${targetLabel}`,
      color: useColor,
      hasExplicitColor: true,
      rings: [...rings].sort((a, b) => a - b),
      mapping: 'all',
      ...(pat.cyclic ? { cycles: [{ type: 'cycle' as const, beatsInCycle: useRate }] } : {}),
      effects: pat.effects().map((ef) => ({ id: uid('ef'), ...ef })),
      ...(currentSection ? { _section: currentSection.idx, _source: `live:${currentSection.label}:${pat.key}` } : {}),
    }
    // Remove the target rings from existing timeframes overlapping the range, drop empties.
    const next: Timeframe[] = []
    for (const tf of timeframes) {
      const overlaps = tf.startTime < e && tf.endTime > s
      if (overlaps && tf.rings.some((r) => rings.includes(r))) {
        const remain = tf.rings.filter((r) => !rings.includes(r))
        if (remain.length) next.push({ ...tf, rings: remain })
      } else next.push(tf)
    }
    next.push(newTf)
    onApplyTimeframes(next)
    setFlash(`${pat.icon} ${pat.label} → ${targetLabel}`)
    window.setTimeout(() => setFlash(null), 1100)
  }

  /** Resolve a drop/click to a pattern key (dragged data, else the armed pad). */
  function patternFrom(e?: React.DragEvent): string | null {
    const dragged = e?.dataTransfer.getData(DT_KEY)
    return dragged || armed
  }
  const sectionRange = (sec: { startBeat: number; endBeat: number }): [number, number] => [sec.startBeat, sec.endBeat]
  const currentRange = (): [number, number] => currentSection ? [currentSection.startBeat, currentSection.endBeat] : [0, songLengthBeats]

  function onDropTo(rings: number[], range: [number, number], label: string) {
    return (e: React.DragEvent) => {
      e.preventDefault()
      setDropHint(null)
      const key = patternFrom(e)
      if (key) apply(key, rings, range, label)
    }
  }
  const allowDrop = (hint: string) => (e: React.DragEvent) => { e.preventDefault(); setDropHint(hint) }

  // Click a pad: arm it AND immediately apply to ALL rings of the current section.
  function onPadClick(key: string) {
    setArmed(key)
    apply(key, ALL_RINGS, currentRange(), `ALL · ${currentSection?.label ?? 'song'}`)
  }

  // 🎲 Random: pick a random pattern (+ color + rate) and replace the current
  // section's pattern across ALL rings. Each press shuffles to a fresh look.
  function onRandomize() {
    const pat = PATTERNS[Math.floor(Math.random() * PATTERNS.length)]
    const c = COLORS[Math.floor(Math.random() * COLORS.length)]
    const rt = RATE_TICKS[Math.floor(Math.random() * RATE_TICKS.length)]
    setColor(c)
    setRate(rt)
    setArmed(pat.key)
    apply(pat.key, ALL_RINGS, currentRange(), `🎲 ${pat.label} · ${currentSection?.label ?? 'song'}`, { color: c, rate: rt })
  }

  const pct = (beat: number) => `${Math.max(0, Math.min(100, (beat / Math.max(1, songLengthBeats)) * 100))}%`
  const fmt = (beats: number) => {
    const bpm = song.bpm || 120
    const sec = (beats / bpm) * 60
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  return (
    <div style={overlay}>
      {/* Top bar */}
      <div style={topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>🎛️ Live Console</span>
          <span style={{ fontSize: 12, color: '#8aa' }}>{song.name || 'Untitled'} · {song.bpm || 120} BPM</span>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: autoSend ? '#064e3b' : '#3a3f4b', color: autoSend ? '#6ee7b7' : '#aaa' }}>
            {autoSend ? '● auto → LEDs' : 'sim only'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#8aa' }}>Brightness</span>
          <input type="range" min={0} max={1} step={0.01} value={brightness} disabled={!brightnessConnected}
            onChange={(e) => onBrightnessChange(parseFloat(e.target.value))} style={{ width: 120, accentColor: '#34d399' }} />
          <button onClick={onClose} style={closeBtn}>✕ Close (Esc)</button>
        </div>
      </div>

      {/* Visualization + ALL drop zone */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 14, gap: 10 }}>
        <div
          style={{ ...vizBox, outline: dropHint === 'all' ? '3px dashed #34d399' : '1px solid #1f2632' }}
          onDragOver={allowDrop('all')} onDragLeave={() => setDropHint(null)}
          onDrop={onDropTo(ALL_RINGS, currentRange(), `ALL · ${currentSection?.label ?? 'song'}`)}
        >
          {activeTimeframes.length > 0 ? (
            <RingVisualization mapping="all" activeRings={activeRings} timeframes={activeTimeframes}
              currentTime={currentTime} globalBrightness={brightness} />
          ) : (
            <div style={{ color: '#566', fontSize: 14 }}>No active segment at {currentTime.toFixed(1)}b — press ▶ or drop a pattern.</div>
          )}
          {flash && <div style={flashPill}>{flash}</div>}
          <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 11, color: '#7a8', fontWeight: 600 }}>
            drop a pattern here = ALL rings · {currentSection?.label ?? 'song'}
          </div>
        </div>

        {/* Drop targets: ALL + each ring */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#8aa', marginRight: 4 }}>Drop on:</span>
          <div
            onDragOver={allowDrop('all-chip')} onDragLeave={() => setDropHint(null)}
            onDrop={onDropTo(ALL_RINGS, currentRange(), `ALL · ${currentSection?.label ?? 'song'}`)}
            onClick={() => armed && apply(armed, ALL_RINGS, currentRange(), `ALL · ${currentSection?.label ?? 'song'}`)}
            title={`Apply to ALL 12 rings (${currentSection?.label ?? 'song'})`}
            style={{
              height: 30, padding: '0 14px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', cursor: armed ? 'pointer' : 'grab',
              background: dropHint === 'all-chip' ? '#34d399' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color: dropHint === 'all-chip' ? '#04150f' : '#fff', border: '1px solid #ffffff33',
            }}>
            ⬤ ALL
          </div>
          <span style={{ fontSize: 11, color: '#566', margin: '0 2px' }}>|</span>
          {ALL_RINGS.map((r) => {
            const on = activeRings.includes(r)
            return (
              <div key={r}
                onDragOver={allowDrop(`ring-${r}`)} onDragLeave={() => setDropHint(null)}
                onDrop={onDropTo([r], currentRange(), `Ring ${r}`)}
                onClick={() => armed && apply(armed, [r], currentRange(), `Ring ${r}`)}
                title={`Apply to ring ${r} (${currentSection?.label ?? 'song'})`}
                style={{
                  width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, cursor: armed ? 'pointer' : 'grab',
                  background: dropHint === `ring-${r}` ? '#34d399' : on ? '#1d4ed8' : '#222a36',
                  color: dropHint === `ring-${r}` ? '#04150f' : '#cdd', border: '1px solid #2c3645',
                }}>
                {r}
              </div>
            )
          })}
        </div>
      </div>

      {/* Controls: pads + rate + color */}
      <div style={dock}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
          {PATTERNS.map((p) => (
            <div key={p.key} draggable
              onDragStart={(e) => { e.dataTransfer.setData(DT_KEY, p.key); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => onPadClick(p.key)}
              title={`Drag onto ALL / a ring / a section — or click to apply to ALL of "${currentSection?.label ?? 'song'}"`}
              style={{ ...pad, outline: armed === p.key ? '2px solid #34d399' : '1px solid #2c3645', background: `linear-gradient(160deg, ${p.color}22, #1b2230)` }}>
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{p.label}</span>
            </div>
          ))}
          {/* 🎲 Random — swap the current pattern for a random one (pattern + color + rate). */}
          <div
            onClick={onRandomize}
            title={`Random pattern — replace the current pattern of "${currentSection?.label ?? 'song'}" with a random one`}
            style={{ ...pad, cursor: 'pointer', outline: '1px solid #f59e0b88', background: 'linear-gradient(160deg, #f59e0b33, #2a1f10)' }}>
            <span style={{ fontSize: 20 }}>🎲</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>Random</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          {/* Rate */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 320px' }}>
            <span style={{ fontSize: 12, color: '#8aa', whiteSpace: 'nowrap' }}>Pattern rate</span>
            <input type="range" min={0.25} max={8} step={0.25} value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))} style={{ flex: 1, accentColor: '#f59e0b' }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {RATE_TICKS.map((t) => (
                <button key={t} onClick={() => setRate(t)}
                  style={{ ...miniBtn, background: rate === t ? '#f59e0b' : '#2a3340', color: rate === t ? '#1b1200' : '#cdd' }}>
                  {t < 1 ? `1/${1 / t}` : t}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: '#778', whiteSpace: 'nowrap' }}>{rate}b/cycle</span>
          </div>
          {/* Color */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8aa' }}>Color</span>
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} title={c}
                style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
                  border: color === c ? '2px solid #fff' : '1px solid #0006', boxShadow: color === c ? '0 0 0 2px #34d399' : 'none' }} />
            ))}
          </div>
        </div>
      </div>

      {/* Transport + song timeline with section dividers (drop target) */}
      <div style={transport}>
        <button onClick={onPlayPause} style={{ ...transportBtn, background: isPlaying ? '#b45309' : '#10b981' }}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={onStop} style={{ ...transportBtn, background: '#3a3f4b' }}>⏹</button>
        <span style={{ fontSize: 12, color: '#9ab', width: 86, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(currentTime)} / {fmt(songLengthBeats)}
        </span>
        <div
          style={timelineTrack}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            onSeekBeat(Math.max(0, Math.min(songLengthBeats, frac * songLengthBeats)))
          }}
        >
          {/* section blocks (each a drop target) */}
          {sections.map((sec) => {
            const left = (sec.startBeat / Math.max(1, songLengthBeats)) * 100
            const width = ((sec.endBeat - sec.startBeat) / Math.max(1, songLengthBeats)) * 100
            const isCur = sec.idx === currentSection?.idx
            return (
              <div key={sec.idx}
                onDragOver={allowDrop(`sec-${sec.idx}`)} onDragLeave={() => setDropHint(null)}
                onDrop={(e) => { e.stopPropagation(); onDropTo(ALL_RINGS, sectionRange(sec), `${sec.label}`)(e) }}
                onClick={(e) => { if (armed) { e.stopPropagation(); apply(armed, ALL_RINGS, sectionRange(sec), sec.label) } }}
                title={`${sec.label} — drop a pattern to fill this section`}
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`,
                  borderLeft: '1px solid rgba(255,255,255,0.25)',
                  background: dropHint === `sec-${sec.idx}` ? 'rgba(52,211,153,0.35)' : isCur ? 'rgba(59,130,246,0.16)' : 'transparent',
                  boxSizing: 'border-box', overflow: 'hidden',
                }}>
                <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{sec.label}</span>
              </div>
            )
          })}
          {/* playhead */}
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: pct(currentTime), width: 2, background: '#ef4444', boxShadow: '0 0 6px #ef4444', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: -5, left: -5, width: 12, height: 12, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0a0c10', zIndex: 2100, display: 'flex', flexDirection: 'column', color: '#e8eef5' }
const topbar: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #1b2230' }
const closeBtn: React.CSSProperties = { background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const vizBox: React.CSSProperties = { position: 'relative', flex: 1, minHeight: 0, borderRadius: 12, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const flashPill: React.CSSProperties = { position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: '#064e3b', color: '#6ee7b7', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700 }
const dock: React.CSSProperties = { padding: '10px 16px', borderTop: '1px solid #1b2230', background: '#0d1117' }
const pad: React.CSSProperties = { width: 78, height: 64, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'grab', userSelect: 'none' }
const miniBtn: React.CSSProperties = { border: 'none', borderRadius: 5, padding: '3px 7px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const transport: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid #1b2230' }
const transportBtn: React.CSSProperties = { color: '#fff', border: 'none', borderRadius: 8, width: 44, height: 36, fontSize: 16, cursor: 'pointer' }
const timelineTrack: React.CSSProperties = { position: 'relative', flex: 1, height: 34, background: '#161c26', borderRadius: 8, cursor: 'pointer', overflow: 'hidden' }
