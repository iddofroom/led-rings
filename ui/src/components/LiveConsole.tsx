import React, { useMemo, useRef, useState } from 'react'
import type { Timeframe, TimeframeEffectEntry } from '../App'
import { isRingActiveAtBeat } from '../movementGenerators'
import RingVisualization from './RingVisualization'
import TimeframePanel from './TimeframePanel'
import { WLED_PALETTES, DEFAULT_PALETTE, paletteById, paletteGradientCss } from '../../../shared/wled-palettes'
import { presetToTimeframes, extractPresetColor } from '../presets'
import type { PresetMetadata } from '../presets'

/**
 * Fullscreen LIVE CONSOLE — a VJ surface for performing the LED show while the song
 * plays. Patterns live in a vertical rail on the left; the right side is a multi-lane
 * timeline (one row for ALL rings + one row per ring 1-12). Drag a pattern pad onto a
 * lane to add/replace a timeframe on those rings — start/end snap to the beat. The
 * timeline zooms (buttons / ctrl+wheel) and a block can be clicked to edit its settings.
 * An ALL-rings pattern shows only on the ALL lane (never duplicated onto every ring).
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
  /** Regenerate the whole composition from the audio analysis (returns when done). */
  onRecompose?: () => Promise<void> | void
  /** Energy/band strip from the analysis (x in beats) for the spectrogram lane. */
  strip?: { beats: number[]; energy: number[]; sub: number[]; low: number[]; mid: number[]; high: number[] } | null
  /** Custom section-boundary beats (white lines) the user added; patterns snap to them. */
  sectionLines?: number[]
  onSectionLinesChange?: (lines: number[]) => void
  /** Curated preset library for THIS song (after per-song + global hides) — shown as pads. */
  presetPads?: PresetMetadata[]
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
const PAT_BY_KEY = new Map(PATTERNS.map((p) => [p.key, p]))
const EFFECT_TO_PATTERN: Record<string, string> = {
  pulse: 'pulse', blink: 'blink', fadeInOut: 'breathe', snake: 'snake',
  hueShiftStartToEnd: 'rainbow', fadeIn: 'fadeIn', fadeOut: 'fadeOut',
}

const RATE_TICKS = [0.25, 0.5, 1, 2, 4, 8]
const ALL_RINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const DT_KEY = 'text/led-pattern'
const LABEL_W = 38 // gutter width for lane labels (px)
const LANE_H = 18
const ZOOM_MIN = 1
const ZOOM_MAX = 40

// Lanes: one ALL row + one row per ring.
const LANES: { key: string; label: string; rings: number[]; ring?: number }[] = [
  { key: 'all', label: 'ALL', rings: ALL_RINGS },
  ...ALL_RINGS.map((r) => ({ key: `r${r}`, label: String(r), rings: [r], ring: r })),
]

let _seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(_seq++).toString(36)}`

const isAllRings = (tf: Timeframe) => tf.rings.length >= ALL_RINGS.length
const rateOf = (tf: Timeframe) => tf.cycles?.find((c) => 'beatsInCycle' in c)?.beatsInCycle ?? null
function patternKeyOf(tf: Timeframe): string {
  const fromSource = String(tf._source || '').split(':')[2]
  if (fromSource && PAT_BY_KEY.has(fromSource)) return fromSource
  const ek = tf.effects?.find((e) => e.effectKey && e.effectKey !== 'timed_brightness')?.effectKey
  return (ek && EFFECT_TO_PATTERN[ek]) || 'solid'
}

// Fade in/out as a `timed_brightness` envelope — multiplies with the pattern's own
// brightness (so a Pulse can also fade in), and round-trips (SAFE timed_* + linear/sin).
const FADE_IN_FUNC = { linear: { start: 0, end: 1 } }
const FADE_OUT_FUNC = { linear: { start: 1, end: 0 } }
const FADE_INOUT_FUNC = { sin: { min: 0, max: 1, phase: 0, repeats: 0.5 } }
function fadeEffect(fadeIn: boolean, fadeOut: boolean): Omit<TimeframeEffectEntry, 'id'> | null {
  const fn = fadeIn && fadeOut ? FADE_INOUT_FUNC : fadeIn ? FADE_IN_FUNC : fadeOut ? FADE_OUT_FUNC : null
  return fn ? { effectKey: 'timed_brightness', params: { mult_factor_decrease: fn } } : null
}
function fadeOf(tf: Timeframe): { fadeIn: boolean; fadeOut: boolean } {
  const t = tf.effects?.find((e) => e.effectKey === 'timed_brightness')
  const f = (t?.params as any)?.mult_factor_decrease
  if (f?.sin) return { fadeIn: true, fadeOut: true }
  if (f?.linear) {
    const { start, end } = f.linear
    if (end > start) return { fadeIn: true, fadeOut: false }
    if (start > end) return { fadeIn: false, fadeOut: true }
  }
  return { fadeIn: false, fadeOut: false }
}
function withFade(tf: Timeframe, fadeIn: boolean, fadeOut: boolean): Timeframe {
  const base = (tf.effects ?? []).filter((e) => e.effectKey !== 'timed_brightness')
  const fe = fadeEffect(fadeIn, fadeOut)
  return { ...tf, effects: fe ? [...base, { id: uid('ef'), ...fe }] : base }
}
/** Re-skin a block with a pattern + rate, preserving its color and any fade envelope. */
function withPattern(tf: Timeframe, patKey: string, rt: number): Timeframe {
  const pat = PAT_BY_KEY.get(patKey) ?? PATTERNS[0]
  const f = fadeOf(tf)
  const fe = fadeEffect(f.fadeIn, f.fadeOut)
  const effects = [...pat.effects().map((ef) => ({ id: uid('ef'), ...ef })), ...(fe ? [{ id: uid('ef'), ...fe }] : [])]
  return {
    ...tf,
    cycles: pat.cyclic ? [{ type: 'cycle' as const, beatsInCycle: rt }] : undefined,
    effects,
    _source: tf._section != null ? `live:${String(tf._source || '').split(':')[1] || 'live'}:${pat.key}` : tf._source,
  }
}

export default function LiveConsole({
  song, timeframes, onApplyTimeframes, songLengthBeats,
  currentTime, isPlaying, onPlayPause, onStop, onSeekBeat,
  brightness, brightnessConnected, onBrightnessChange, autoSend, onRecompose,
  strip, sectionLines = [], onSectionLinesChange, presetPads = [], onClose,
}: LiveConsoleProps) {
  const [paletteId, setPaletteId] = useState(DEFAULT_PALETTE.id)
  const palette = paletteById(paletteId)
  const [color, setColor] = useState(DEFAULT_PALETTE.colors[6])
  const [rate, setRate] = useState(2)

  // Switch the active WLED palette. Move the paint colour into the new palette (its mid,
  // most-representative swatch) unless the current colour is already part of it, so the
  // next stroke immediately reflects the chosen palette.
  function selectPalette(id: string) {
    const p = paletteById(id)
    setPaletteId(p.id)
    if (!p.colors.includes(color)) setColor(p.colors[Math.floor(p.colors.length / 2)] ?? p.colors[0])
  }
  const [armed, setArmed] = useState<string | null>(null) // pad selected by click (apply on lane click)
  const [padSearch, setPadSearch] = useState('') // filter for the song's preset pads
  const presetById = useMemo(() => new Map(presetPads.map((p) => [p.id, p])), [presetPads])
  const [dropPreview, setDropPreview] = useState<{ laneKey: string; start: number; end: number } | null>(null)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const [gridBeats, setGridBeats] = useState(0) // 0 = off; else snap-line spacing in beats
  const [recomposing, setRecomposing] = useState(false)
  const panMovedRef = useRef(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false) // full per-property editor for the selected block
  const [resizeDraft, setResizeDraft] = useState<{ id: string; edge: 'start' | 'end'; startTime: number; endTime: number } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; beat: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        if (inField) return // let the focused editor field keep Esc (don't tear the panel down)
        if (showAdvanced) setShowAdvanced(false)
        else if (selectedId) setSelectedId(null)
        else onClose()
      } else if (e.code === 'Space' && !inField) { e.preventDefault(); onPlayPause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPlayPause, selectedId, showAdvanced])

  const snap = (beat: number) => Math.max(0, Math.min(songLengthBeats, Math.round(beat)))
  const pct = (beat: number) => `${Math.max(0, Math.min(100, (beat / Math.max(1, songLengthBeats)) * 100))}%`

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

  // Custom section lines (drawn on the spectrogram) override the compose-derived sections:
  // they define what patterns snap to, gap-fill against, and what Recompose regenerates over.
  const effSections = useMemo(() => {
    if (!sectionLines.length) return sections
    const uniq = [...new Set([0, ...sectionLines.filter((b) => b > 0 && b < songLengthBeats).map((b) => Math.round(b)), Math.round(songLengthBeats)])].sort((a, b) => a - b)
    const out: { idx: number; label: string; startBeat: number; endBeat: number }[] = []
    for (let i = 0; i < uniq.length - 1; i++) {
      if (uniq[i + 1] <= uniq[i]) continue
      const mid = (uniq[i] + uniq[i + 1]) / 2
      const host = sections.find((s) => mid >= s.startBeat && mid < s.endBeat)
      out.push({ idx: out.length, label: host?.label || `seg ${out.length + 1}`, startBeat: uniq[i], endBeat: uniq[i + 1] })
    }
    return out.length ? out : sections
  }, [sectionLines, sections, songLengthBeats])

  const sectionAtBeat = (beat: number) =>
    effSections.find((s) => beat >= s.startBeat && beat < s.endBeat)
      ?? effSections[effSections.length - 1]
      ?? { idx: 0, label: 'song', startBeat: 0, endBeat: songLengthBeats }
  const currentSection = useMemo(() => sectionAtBeat(currentTime), [effSections, currentTime])

  const activeTimeframes = useMemo(
    () => timeframes.filter((tf) => !tf.disabled && currentTime >= tf.startTime && currentTime < tf.endTime),
    [timeframes, currentTime],
  )
  const activeRings = useMemo(
    () => Array.from(new Set(activeTimeframes.flatMap((tf) =>
      tf.rings.filter((r) => isRingActiveAtBeat(tf.startTime, tf.endTime, tf.rings, tf.movement, r, currentTime))))),
    [activeTimeframes, currentTime],
  )
  const selectedTf = useMemo(() => timeframes.find((t) => t.id === selectedId) || null, [timeframes, selectedId])

  // Close the advanced (full-options) editor when its block goes away (deleted / deselected).
  React.useEffect(() => { if (!selectedTf) setShowAdvanced(false) }, [selectedTf])

  // Soft beat-snap for edge dragging: snap hard to section boundaries, then to the nearest
  // whole beat when close, otherwise free at 0.05-beat resolution.
  const softSnap = (beat: number) => {
    beat = Math.max(0, Math.min(songLengthBeats, beat))
    for (const s of sections) {
      if (Math.abs(beat - s.startBeat) < 0.5) return s.startBeat
      if (Math.abs(beat - s.endBeat) < 0.5) return s.endBeat
    }
    // Snap to the beat-grid lines when the grid is on.
    if (gridBeats > 0) {
      const g = Math.round(beat / gridBeats) * gridBeats
      if (Math.abs(beat - g) < Math.max(0.3, gridBeats * 0.3)) return Math.max(0, Math.min(songLengthBeats, g))
    }
    const nearest = Math.round(beat)
    if (Math.abs(beat - nearest) < 0.3) return nearest
    return Math.round(beat * 20) / 20
  }

  // Drag a block edge to resize start/end (live preview via resizeDraft, commit on mouseup).
  React.useEffect(() => {
    if (!resizeDraft) return
    const onMove = (e: MouseEvent) => {
      const rect = innerRef.current?.getBoundingClientRect()
      if (!rect) return
      const beat = softSnap(((e.clientX - rect.left) / Math.max(1, rect.width)) * songLengthBeats)
      setResizeDraft((d) => {
        if (!d) return d
        return d.edge === 'start'
          ? { ...d, startTime: Math.max(0, Math.min(beat, d.endTime - 0.25)) }
          : { ...d, endTime: Math.min(songLengthBeats, Math.max(beat, d.startTime + 0.25)) }
      })
    }
    const onUp = () => {
      setResizeDraft((d) => {
        if (d) onApplyTimeframes(timeframes.map((t) => (t.id === d.id ? { ...t, startTime: d.startTime, endTime: d.endTime } : t)))
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeDraft?.id, resizeDraft?.edge, timeframes, songLengthBeats, sections])

  function startResize(tf: Timeframe, edge: 'start' | 'end', e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault()
    setSelectedId(tf.id)
    setResizeDraft({ id: tf.id, edge, startTime: tf.startTime, endTime: tf.endTime })
  }

  // ── Apply a pattern onto target rings over a beat range ("paint" semantics) ──
  function apply(patternKey: string, rings: number[], range: [number, number], targetLabel: string, opts?: { color?: string; rate?: number }) {
    const pat = PAT_BY_KEY.get(patternKey)
    if (!pat) return
    let s = snap(range[0])
    let e = snap(range[1])
    if (!(e > s)) e = Math.min(songLengthBeats, s + 1)
    if (!(e > s)) { s = Math.max(0, e - 1) }
    const useColor = opts?.color ?? color
    const useRate = opts?.rate ?? rate
    const sec = sectionAtBeat(s)
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
      ...(sec ? { _section: sec.idx, _source: `live:${sec.label}:${pat.key}` } : {}),
    }
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
    setSelectedId(newTf.id)
    setFlash(`${pat.icon} ${pat.label} → ${targetLabel}`)
    window.setTimeout(() => setFlash(null), 1100)
  }

  // ── Apply a full preset (from the song's pattern library) onto target rings ──
  function applyPreset(preset: PresetMetadata, rings: number[], range: [number, number], targetLabel: string) {
    let s = snap(range[0])
    let e = snap(range[1])
    if (!(e > s)) e = Math.min(songLengthBeats, s + 1)
    if (!(e > s)) { s = Math.max(0, e - 1) }
    const converted = presetToTimeframes(preset, s, song.bpm || 120)
    if (converted.length === 0) return
    const sec = sectionAtBeat(s)
    const sortedRings = [...rings].sort((a, b) => a - b)
    const newTfs: Timeframe[] = converted.map((tf) => ({
      ...tf,
      id: uid('live'),
      startTime: s,
      endTime: e,
      rings: sortedRings,
      ...(sec ? { _section: sec.idx, _source: `live:${sec.label}:preset` } : {}),
    }))
    const next: Timeframe[] = []
    for (const tf of timeframes) {
      const overlaps = tf.startTime < e && tf.endTime > s
      if (overlaps && tf.rings.some((r) => rings.includes(r))) {
        const remain = tf.rings.filter((r) => !rings.includes(r))
        if (remain.length) next.push({ ...tf, rings: remain })
      } else next.push(tf)
    }
    next.push(...newTfs)
    onApplyTimeframes(next)
    setSelectedId(newTfs[0].id)
    setFlash(`🎨 ${preset.displayName} → ${targetLabel}`)
    window.setTimeout(() => setFlash(null), 1100)
  }

  // Dispatch a pad key: "preset:<id>" → applyPreset, else a built-in pattern.
  function applyKey(key: string, rings: number[], range: [number, number], targetLabel: string) {
    if (key.startsWith('preset:')) {
      const p = presetById.get(key.slice('preset:'.length))
      if (p) applyPreset(p, rings, range, targetLabel)
    } else {
      apply(key, rings, range, targetLabel)
    }
  }

  // ── Edit an existing block (the click-to-edit panel) ──
  function patchSelected(patch: { color?: string; rate?: number; patternKey?: string }) {
    if (!selectedTf) return
    const baseKey = patch.patternKey ?? patternKeyOf(selectedTf)
    const pat = PAT_BY_KEY.get(baseKey) ?? PATTERNS[0]
    const useColor = patch.color ?? selectedTf.color
    const useRate = patch.rate ?? rateOf(selectedTf) ?? rate
    const updated: Timeframe = {
      ...selectedTf,
      color: useColor,
      hasExplicitColor: true,
      label: `${pat.label}${selectedTf.label.includes('·') ? ' · ' + selectedTf.label.split('·').slice(1).join('·').trim() : ''}`,
      cycles: pat.cyclic ? [{ type: 'cycle' as const, beatsInCycle: useRate }] : undefined,
      effects: pat.effects().map((ef) => ({ id: uid('ef'), ...ef })),
      _source: selectedTf._section != null
        ? `live:${String(selectedTf._source || '').split(':')[1] || sectionAtBeat(selectedTf.startTime).label}:${pat.key}`
        : selectedTf._source,
    }
    onApplyTimeframes(timeframes.map((t) => (t.id === selectedTf.id ? updated : t)))
  }
  function deleteSelected() {
    if (!selectedTf) return
    onApplyTimeframes(timeframes.filter((t) => t.id !== selectedTf.id))
    setSelectedId(null)
  }
  function nudgeSelected(deltaStart: number, deltaEnd: number) {
    if (!selectedTf) return
    const s = snap(selectedTf.startTime + deltaStart)
    const e = snap(selectedTf.endTime + deltaEnd)
    if (e <= s) return
    onApplyTimeframes(timeframes.map((t) => (t.id === selectedTf.id ? { ...t, startTime: s, endTime: e } : t)))
  }
  function setSelectedFade(fadeIn: boolean, fadeOut: boolean) {
    if (!selectedTf) return
    onApplyTimeframes(timeframes.map((t) => (t.id === selectedTf.id ? withFade(t, fadeIn, fadeOut) : t)))
  }

  // Full per-property edit of the selected block (the "All options" drawer reuses the same
  // TimeframePanel editor as the main app, so every original option — color/HSV, cycle,
  // effects + params, movement, mapping, rings, phase — is available here too).
  function updateSelectedAdvanced(updates: Partial<Timeframe>) {
    if (!selectedTf) return
    const u: Partial<Timeframe> = { ...updates }
    if (u.startTime != null) u.startTime = Math.max(0, u.startTime)
    if (u.endTime != null) u.endTime = Math.min(songLengthBeats, u.endTime)
    onApplyTimeframes(timeframes.map((t) => (t.id === selectedTf.id ? { ...t, ...u } : t)))
  }

  // Apply a mutation to EVERY live block in one click (used by the "→ all" controls).
  function applyToAll(mut: (tf: Timeframe) => Timeframe, label: string) {
    onApplyTimeframes(timeframes.map((t) => (t.disabled ? t : mut(t))))
    setFlash(label); window.setTimeout(() => setFlash(null), 1100)
  }

  // ── Custom section lines (added from the spectrogram right-click menu) ──
  function addLineAt(beat: number) {
    if (!onSectionLinesChange) return
    const b = Math.round(Math.max(1, Math.min(songLengthBeats - 1, beat)))
    if (sectionLines.some((x) => Math.abs(x - b) < 0.5)) return
    onSectionLinesChange([...sectionLines, b].sort((a, c) => a - c))
    setFlash(`＋ line @ ${b}b`); window.setTimeout(() => setFlash(null), 900)
  }
  function addGridLines(interval: number) {
    if (!onSectionLinesChange || interval <= 0) return
    const set = new Set(sectionLines.map((b) => Math.round(b)))
    for (let b = interval; b < songLengthBeats; b += interval) set.add(Math.round(b))
    onSectionLinesChange([...set].sort((a, c) => a - c))
    setFlash(`＋ lines every ${interval}b`); window.setTimeout(() => setFlash(null), 900)
  }
  function removeLineNear(beat: number) {
    if (!onSectionLinesChange || !sectionLines.length) return
    const closest = sectionLines.reduce((best, x) => (Math.abs(x - beat) < Math.abs(best - beat) ? x : best), sectionLines[0])
    if (Math.abs(closest - beat) < 2) onSectionLinesChange(sectionLines.filter((x) => x !== closest))
  }

  function onRandomize() {
    const pat = PATTERNS[Math.floor(Math.random() * PATTERNS.length)]
    const c = palette.colors[Math.floor(Math.random() * palette.colors.length)]
    const rt = RATE_TICKS[Math.floor(Math.random() * RATE_TICKS.length)]
    setColor(c); setRate(rt); setArmed(pat.key)
    apply(pat.key, ALL_RINGS, [currentSection.startBeat, currentSection.endBeat], `🎲 ${currentSection?.label ?? 'song'}`, { color: c, rate: rt })
  }

  const xToBeat = (e: React.DragEvent | React.MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width)
    return Math.max(0, Math.min(songLengthBeats, frac * songLengthBeats))
  }

  function onLaneDrop(lane: { key: string; label: string; rings: number[] }) {
    return (e: React.DragEvent) => {
      e.preventDefault(); setDropPreview(null)
      const key = e.dataTransfer.getData(DT_KEY) || armed
      if (!key) return
      const beat = xToBeat(e, e.currentTarget as HTMLElement)
      applyKey(key, lane.rings, gapAt(lane, beat), `${lane.label} · ${sectionAtBeat(beat).label}`)
    }
  }
  // Hover preview: highlight only the gap the pattern would fill (not the whole lane).
  function onLaneDragOver(lane: { key: string; ring?: number }) {
    return (e: React.DragEvent) => {
      e.preventDefault()
      const beat = xToBeat(e, e.currentTarget as HTMLElement)
      const [s, en] = gapAt(lane, beat)
      setDropPreview({ laneKey: lane.key, start: s, end: en })
    }
  }
  function onLaneClick(lane: { key: string; label: string; rings: number[] }) {
    return (e: React.MouseEvent) => {
      if (panMovedRef.current) return // this was a pan-drag, not a click
      const beat = xToBeat(e, e.currentTarget as HTMLElement)
      if (armed) {
        applyKey(armed, lane.rings, gapAt(lane, beat), `${lane.label} · ${sectionAtBeat(beat).label}`)
      } else {
        setSelectedId(null)
        onSeekBeat(beat)
      }
    }
  }

  // Grab empty timeline space (when zoomed in) to pan the view left/right.
  function onTrackMouseDown(e: React.MouseEvent) {
    if (armed || e.button !== 0 || e.target !== e.currentTarget) return
    const el = scrollRef.current
    if (!el || zoom <= 1) return
    const startX = e.clientX
    const startScroll = el.scrollLeft
    panMovedRef.current = false
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      if (Math.abs(dx) > 3) panMovedRef.current = true
      el.scrollLeft = startScroll - dx
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTimeout(() => { panMovedRef.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // An ALL-rings pattern shows ONLY on the ALL lane; ring lanes show partial patterns only.
  const blocksFor = (lane: { key: string; ring?: number }) =>
    timeframes.filter((tf) => !tf.disabled && (lane.key === 'all' ? isAllRings(tf) : (tf.rings.includes(lane.ring!) && !isAllRings(tf))))

  // The empty gap at `beat` within a lane: bounded by section dividers (white lines) and
  // the lane's existing blocks. Dropping fills only this gap (between the previous block's
  // end and the next divider), instead of overwriting the whole section. If the drop lands
  // inside an existing block, that block's own range is returned (replace it).
  function gapAt(lane: { key: string; ring?: number }, beat: number): [number, number] {
    const sec = sectionAtBeat(beat)
    let left = sec.startBeat
    let right = sec.endBeat
    for (const tf of blocksFor(lane)) {
      if (tf.startTime <= beat && tf.endTime > beat) return [tf.startTime, tf.endTime]
      if (tf.endTime <= beat && tf.endTime > left) left = tf.endTime
      if (tf.startTime > beat && tf.startTime < right) right = tf.startTime
    }
    return [left, right]
  }

  // ── Zoom ──
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100))
  function zoomAt(factor: number, clientX?: number) {
    const el = scrollRef.current
    const next = clampZoom(zoom * factor)
    if (!el) { setZoom(next); return }
    const rect = el.getBoundingClientRect()
    const anchorX = clientX != null ? clientX - rect.left : rect.width / 2
    const frac = (el.scrollLeft + anchorX) / Math.max(1, el.scrollWidth)
    setZoom(next)
    requestAnimationFrame(() => {
      const e2 = scrollRef.current
      if (e2) e2.scrollLeft = frac * e2.scrollWidth - anchorX
    })
  }
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey) return
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX)
  }

  const fmt = (beats: number) => {
    const bpm = song.bpm || 120
    const sec = (beats / bpm) * 60
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  const innerW: React.CSSProperties = { position: 'relative', width: `${zoom * 100}%`, minWidth: '100%' }

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
          {armed && <span style={{ fontSize: 11, color: '#34d399' }}>armed: {PAT_BY_KEY.get(armed)?.label} — click a lane or drag onto the timeline</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onRecompose && (
            <button
              onClick={async () => { setRecomposing(true); try { await onRecompose() } finally { setRecomposing(false) } }}
              disabled={recomposing}
              title="Regenerate the whole composition from the audio analysis"
              style={{ ...closeBtn, background: '#7c3aed', opacity: recomposing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {recomposing && <span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'composeSpin 0.8s linear infinite' }} />}
              {recomposing ? 'Recomposing…' : '↻ Recompose'}
            </button>
          )}
          <span style={{ fontSize: 12, color: '#8aa' }}>Brightness</span>
          <input type="range" min={0} max={1} step={0.01} value={brightness} disabled={!brightnessConnected}
            onChange={(e) => onBrightnessChange(parseFloat(e.target.value))} style={{ width: 120, accentColor: '#34d399' }} />
          <button onClick={onClose} style={closeBtn}>✕ Close (Esc)</button>
        </div>
      </div>

      {/* Body: pattern rail (left) + viz & multi-lane timeline (right) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* ── Left rail ── */}
        <div style={rail}>
          <div style={railLabel}>Patterns</div>
          {PATTERNS.map((p) => (
            <div key={p.key} draggable
              onDragStart={(e) => { e.dataTransfer.setData(DT_KEY, p.key); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => setArmed((cur) => (cur === p.key ? null : p.key))}
              title={`Drag onto a lane, or click to arm then click a lane`}
              style={{ ...padV, outline: armed === p.key ? '2px solid #34d399' : '1px solid #2c3645', background: `linear-gradient(160deg, ${p.color}22, #1b2230)` }}>
              <span style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{p.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</span>
            </div>
          ))}
          <div onClick={onRandomize}
            title={`Random pattern → replace the current section (${currentSection?.label ?? 'song'}) on ALL rings`}
            style={{ ...padV, cursor: 'pointer', outline: '1px solid #f59e0b88', background: 'linear-gradient(160deg, #f59e0b33, #2a1f10)' }}>
            <span style={{ fontSize: 18, width: 22, textAlign: 'center' }}>🎲</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>Random</span>
          </div>

          {presetPads.length > 0 && (
            <>
              <div style={railDivider} />
              <div style={railLabel}>פאטרני השיר · {presetPads.length}</div>
              <input
                value={padSearch}
                onChange={(e) => setPadSearch(e.target.value)}
                placeholder="חיפוש…"
                style={{ width: '100%', boxSizing: 'border-box', background: '#1b2230', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 8px', fontSize: 12, marginBottom: 2 }}
              />
              {presetPads
                .filter((p) => !padSearch.trim() || p.displayName.toLowerCase().includes(padSearch.trim().toLowerCase()))
                .map((p) => {
                  const k = `preset:${p.id}`
                  const c = extractPresetColor(p.data)
                  return (
                    <div key={p.id} draggable
                      onDragStart={(e) => { e.dataTransfer.setData(DT_KEY, k); e.dataTransfer.effectAllowed = 'copy' }}
                      onClick={() => setArmed((cur) => (cur === k ? null : k))}
                      title={`${p.displayName} — גרור ללֵיין, או לחץ לחימוש ואז לחץ על לֵיין`}
                      style={{ ...padV, height: 32, outline: armed === k ? '2px solid #34d399' : '1px solid #2c3645', background: `linear-gradient(160deg, ${c}33, #1b2230)` }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</span>
                    </div>
                  )
                })}
            </>
          )}

          <div style={railDivider} />
          <div style={railLabel}>Rate · {rate}b/cycle</div>
          <input type="range" min={0.25} max={16} step={0.05} value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            title="Beats per cycle for new patterns (lower = faster)"
            style={{ width: '100%', accentColor: '#f59e0b' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {RATE_TICKS.map((t) => (
              <button key={t} onClick={() => setRate(t)}
                style={{ ...miniBtn, background: rate === t ? '#f59e0b' : '#2a3340', color: rate === t ? '#1b1200' : '#cdd' }}>
                {t < 1 ? `1/${1 / t}` : t}
              </button>
            ))}
          </div>

          <div style={railDivider} />
          <div style={railLabel}>Palette · WLED</div>
          <select value={paletteId} onChange={(e) => selectPalette(e.target.value)} title="WLED color palette" style={paletteSelect}>
            {WLED_PALETTES.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div title={palette.name} style={{ height: 12, borderRadius: 6, background: paletteGradientCss(palette), border: '1px solid #0006' }} />
          <div style={{ ...railLabel, marginTop: 4 }}>Color</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {palette.colors.map((c) => (
              <button key={c} onClick={() => setColor(c)} title={c}
                style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
                  border: color === c ? '2px solid #fff' : '1px solid #0006', boxShadow: color === c ? '0 0 0 2px #34d399' : 'none' }} />
            ))}
          </div>
        </div>

        {/* ── Right: compact viz + lanes ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
          <div style={timelineCollapsed ? { ...vizBox, flex: 1 } : vizBox}>
            {activeTimeframes.length > 0 ? (
              <RingVisualization mapping="all" activeRings={activeRings} timeframes={activeTimeframes}
                currentTime={currentTime} globalBrightness={brightness} darkOff />
            ) : (
              <div style={{ color: '#566', fontSize: 14 }}>No active segment at {currentTime.toFixed(1)}b — press ▶ or drop a pattern onto a lane.</div>
            )}
            {flash && <div style={flashPill}>{flash}</div>}
          </div>

          {/* Multi-lane timeline */}
          <div style={timelineCollapsed ? { ...lanesWrap, flex: '0 0 auto' } : lanesWrap}>
            {/* Header: collapse toggle + zoom controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: timelineCollapsed ? 0 : 6 }}>
              <button style={{ ...zoomBtn, width: 22 }} onClick={() => setTimelineCollapsed((c) => !c)}
                title={timelineCollapsed ? 'Expand timeline' : 'Collapse timeline — bigger LEDs'}>
                {timelineCollapsed ? '▸' : '▾'}
              </button>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#667', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Timeline</span>
              <span style={{ flex: 1 }} />
              {!timelineCollapsed && (
                <>
                  <span style={{ fontSize: 10, color: '#778' }}>grid</span>
                  {[0, 1, 2, 4, 8, 16].map((g) => (
                    <button key={g} onClick={() => setGridBeats(g)}
                      title={g === 0 ? 'No beat grid' : `Snap lines every ${g} beat${g > 1 ? 's' : ''}`}
                      style={{ ...zoomBtn, width: 'auto', padding: '0 6px', background: gridBeats === g ? '#6366f1' : '#2a3340', color: gridBeats === g ? '#fff' : '#cdd' }}>
                      {g === 0 ? 'off' : g}
                    </button>
                  ))}
                  <span style={{ width: 8 }} />
                  <span style={{ fontSize: 10, color: '#778' }}>ctrl+scroll to zoom · drag empty to pan</span>
                  <button style={zoomBtn} onClick={() => zoomAt(1 / 1.5)} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
                  <span style={{ fontSize: 11, color: '#9ab', width: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                  <button style={zoomBtn} onClick={() => zoomAt(1.5)} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
                  <button style={{ ...zoomBtn, width: 'auto', padding: '0 8px' }} onClick={() => { setZoom(1); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }} title="Fit whole song">1:1</button>
                </>
              )}
            </div>

            {!timelineCollapsed && (
            <div style={{ display: 'flex' }}>
              {/* Fixed label column */}
              <div style={{ width: LABEL_W, flexShrink: 0 }}>
                <div style={{ height: LANE_H, fontSize: 9, color: '#667', textAlign: 'center', lineHeight: `${LANE_H}px` }}>beat</div>
                {LANES.map((lane) => (
                  <div key={lane.key} style={{ height: LANE_H, lineHeight: `${LANE_H}px`, fontSize: 10, fontWeight: lane.key === 'all' ? 800 : 600, color: lane.key === 'all' ? '#a5b4fc' : '#8aa', textAlign: 'center' }}>
                    {lane.label}
                  </div>
                ))}
              </div>

              {/* Scrollable track column */}
              <div ref={scrollRef} onWheel={onWheel}
                style={{ flex: 1, minWidth: 0, overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden' }}>
                <div ref={innerRef} style={innerW}>
                  {/* spectrogram strip (analysis energy + bands) — right-click to add beat lines */}
                  {strip && strip.beats.length > 1 && (
                    <div style={{ position: 'relative', height: 40, marginBottom: 3, borderRadius: 4, overflow: 'hidden', cursor: 'context-menu' }}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, beat: xToBeat(e, e.currentTarget as HTMLElement) }) }}
                      onClick={(e) => { setSelectedId(null); onSeekBeat(xToBeat(e, e.currentTarget as HTMLElement)) }}
                      title="Right-click to add beat lines that patterns snap to">
                      <svg width="100%" height={40} viewBox={`0 0 ${Math.max(1, songLengthBeats)} 100`} preserveAspectRatio="none" style={{ display: 'block', background: '#0b0f17' }}>
                        <polygon points={`0,100 ${strip.beats.map((b, i) => `${b},${100 - (strip.energy[i] || 0) * 100}`).join(' ')} ${songLengthBeats},100`} fill="rgba(255,255,255,0.10)" />
                        {([['sub', '#3b82f6'], ['low', '#22c55e'], ['mid', '#f59e0b'], ['high', '#ef4444']] as const).map(([band, col]) => (
                          <polyline key={band} points={strip.beats.map((b, i) => `${b},${100 - (strip[band][i] || 0) * 100}`).join(' ')} fill="none" stroke={col} strokeWidth={1} opacity={0.65} vectorEffect="non-scaling-stroke" />
                        ))}
                      </svg>
                      {effSections.map((sec, i) => (
                        <span key={i} style={{ position: 'absolute', left: pct(sec.startBeat), top: 1, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', whiteSpace: 'nowrap', pointerEvents: 'none', textShadow: '0 1px 2px #000' }}>{sec.label}</span>
                      ))}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(currentTime), width: 2, background: '#ef4444', pointerEvents: 'none' }} />
                    </div>
                  )}
                  {/* ruler */}
                  <div style={{ position: 'relative', height: LANE_H, cursor: 'pointer' }}
                    onClick={(e) => { setSelectedId(null); onSeekBeat(xToBeat(e, e.currentTarget as HTMLElement)) }}>
                    {effSections.map((sec, i) => (
                      <span key={i} style={{ position: 'absolute', left: pct(sec.startBeat), top: 3, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                        {sec.label}
                      </span>
                    ))}
                  </div>

                  {/* lane tracks */}
                  {LANES.map((lane) => (
                    <div key={lane.key} style={{ height: LANE_H, display: 'flex', alignItems: 'center' }}>
                      <div
                        onDragOver={onLaneDragOver(lane)}
                        onDragLeave={() => setDropPreview((cur) => (cur?.laneKey === lane.key ? null : cur))}
                        onDrop={onLaneDrop(lane)}
                        onMouseDown={onTrackMouseDown}
                        onClick={onLaneClick(lane)}
                        title={`${lane.label} — drag a pattern here (or click while a pad is armed). Click a block to edit it.`}
                        style={{
                          position: 'relative', flex: 1, height: 15, borderRadius: 4, cursor: armed ? 'copy' : zoom > 1 ? 'grab' : 'pointer',
                          background: lane.key === 'all' ? '#171d29' : '#12161f',
                          outline: '1px solid #1c2330',
                        }}>
                        {/* gap drop preview — highlights only the segment the pattern will fill */}
                        {dropPreview?.laneKey === lane.key && dropPreview.end > dropPreview.start && (
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(dropPreview.start), width: `calc(${pct(dropPreview.end)} - ${pct(dropPreview.start)})`, background: 'rgba(52,211,153,0.35)', border: '1px dashed #34d399', borderRadius: 3, pointerEvents: 'none' }} />
                        )}
                        {blocksFor(lane).map((tf) => {
                          const sel = tf.id === selectedId
                          const dr = resizeDraft?.id === tf.id ? resizeDraft : null
                          const s0 = dr ? dr.startTime : tf.startTime
                          const e0 = dr ? dr.endTime : tf.endTime
                          return (
                            <div key={tf.id} title={`${tf.label} — double-click to play from its start`}
                              onClick={(e) => { e.stopPropagation(); if (armed) { onLaneClick(lane)(e) } else setSelectedId(tf.id) }}
                              onDoubleClick={(e) => { e.stopPropagation(); setSelectedId(tf.id); onSeekBeat(tf.startTime); if (!isPlaying) onPlayPause() }}
                              style={{
                                position: 'absolute', top: 1, bottom: 1, left: pct(s0),
                                width: `calc(${pct(e0)} - ${pct(s0)})`,
                                background: tf.color, opacity: sel ? 1 : 0.85, borderRadius: 3,
                                border: sel ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
                                boxShadow: sel ? '0 0 0 2px #34d399' : 'none',
                                boxSizing: 'border-box', overflow: 'visible', cursor: 'pointer',
                              }}>
                              {/* edge resize handles */}
                              <div onMouseDown={(e) => startResize(tf, 'start', e)} title="Drag to move start (snaps to beat)"
                                style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: sel ? 'rgba(255,255,255,0.5)' : 'transparent', borderRadius: 2 }} />
                              <div onMouseDown={(e) => startResize(tf, 'end', e)} title="Drag to move end (snaps to beat)"
                                style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: sel ? 'rgba(255,255,255,0.5)' : 'transparent', borderRadius: 2 }} />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {/* overlay: beat grid + section dividers + playhead, spanning all rows */}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {gridBeats > 0 && Array.from({ length: Math.floor(songLengthBeats / gridBeats) + 1 }, (_, i) => i * gridBeats).map((b) => (
                      <div key={`g${b}`} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(b), width: 1, background: 'rgba(255,255,255,0.12)' }} />
                    ))}
                    {effSections.slice(1).map((sec, i) => (
                      <div key={`s${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(sec.startBeat), width: 1, background: 'rgba(255,255,255,0.18)' }} />
                    ))}
                    {/* custom section lines — brighter, so they stand out from compose dividers */}
                    {sectionLines.map((b, i) => (
                      <div key={`c${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(b), width: 1.5, background: 'rgba(255,255,255,0.75)' }} />
                    ))}
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(currentTime), width: 2, background: '#ef4444', boxShadow: '0 0 6px #ef4444' }}>
                      <div style={{ position: 'absolute', top: -3, left: -5, width: 12, height: 12, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>

        {/* ── Advanced "All options" drawer: the full editor for the selected block ── */}
        {showAdvanced && selectedTf && (
          <div style={advancedDrawer}>
            <TimeframePanel
              timeframe={selectedTf}
              onUpdate={updateSelectedAdvanced}
              onClose={() => setShowAdvanced(false)}
              songLengthBeats={songLengthBeats}
            />
          </div>
        )}
      </div>

      {/* Selected-block editor */}
      {selectedTf && (
        <div style={editor}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Edit block</span>
            <span style={{ fontSize: 11, color: '#8aa' }}>
              {isAllRings(selectedTf) ? 'ALL rings' : `ring${selectedTf.rings.length > 1 ? 's' : ''} ${selectedTf.rings.join(',')}`} · {fmt(selectedTf.startTime)}→{fmt(selectedTf.endTime)} ({selectedTf.endTime - selectedTf.startTime}b)
            </span>
            <span style={{ flex: 1 }} />
            <button
              style={{ ...miniBtn, background: showAdvanced ? '#6366f1' : '#3730a3', color: '#fff' }}
              onClick={() => setShowAdvanced((v) => !v)}
              title="Full editor — color/HSV, cycle &amp; repeat, effects + params, movement, mapping, rings, phase (same options as the main panel)">
              {showAdvanced ? '⚙ Hide options' : '⚙ All options'}
            </button>
            <button style={{ ...miniBtn, background: '#7f1d1d', color: '#fecaca' }} onClick={deleteSelected}>🗑 Delete</button>
            <button style={{ ...miniBtn, background: '#2a3340', color: '#cdd' }} onClick={() => { setShowAdvanced(false); setSelectedId(null) }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={editLbl}>Pattern</span>
              {PATTERNS.map((p) => {
                const on = patternKeyOf(selectedTf) === p.key
                return (
                  <button key={p.key} title={p.label} onClick={() => patchSelected({ patternKey: p.key })}
                    style={{ ...miniBtn, fontSize: 14, padding: '2px 6px', background: on ? '#34d399' : '#2a3340', color: on ? '#04150f' : '#cdd' }}>
                    {p.icon}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={editLbl}>Color</span>
              {palette.colors.map((c) => (
                <button key={c} onClick={() => patchSelected({ color: c })}
                  style={{ width: 20, height: 20, borderRadius: 5, background: c, cursor: 'pointer',
                    border: selectedTf.color === c ? '2px solid #fff' : '1px solid #0006' }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={editLbl}>Speed</span>
              <input type="range" min={0.25} max={16} step={0.05} value={rateOf(selectedTf) ?? rate}
                onChange={(e) => patchSelected({ rate: parseFloat(e.target.value) })}
                title="Beats per cycle for this block (lower = faster)"
                style={{ width: 120, accentColor: '#f59e0b' }} />
              <span style={{ fontSize: 11, color: '#9ab', width: 56, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{(rateOf(selectedTf) ?? rate)}b/cyc</span>
              {RATE_TICKS.map((t) => {
                const on = rateOf(selectedTf) === t
                return (
                  <button key={t} onClick={() => patchSelected({ rate: t })}
                    style={{ ...miniBtn, background: on ? '#f59e0b' : '#2a3340', color: on ? '#1b1200' : '#cdd' }}>
                    {t < 1 ? `1/${1 / t}` : t}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={editLbl}>Trim</span>
              <button style={miniBtn} onClick={() => nudgeSelected(-1, 0)} title="start −1b">⟸</button>
              <button style={miniBtn} onClick={() => nudgeSelected(1, 0)} title="start +1b">⟹</button>
              <span style={{ color: '#566', fontSize: 10 }}>|</span>
              <button style={miniBtn} onClick={() => nudgeSelected(0, -1)} title="end −1b">⟜</button>
              <button style={miniBtn} onClick={() => nudgeSelected(0, 1)} title="end +1b">⟞</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={editLbl}>Fade</span>
              {(() => {
                const f = fadeOf(selectedTf)
                return (
                  <>
                    <button style={{ ...miniBtn, background: f.fadeIn ? '#34d399' : '#2a3340', color: f.fadeIn ? '#04150f' : '#cdd' }}
                      onClick={() => setSelectedFade(!f.fadeIn, f.fadeOut)} title="Fade brightness in over the block">In</button>
                    <button style={{ ...miniBtn, background: f.fadeOut ? '#34d399' : '#2a3340', color: f.fadeOut ? '#04150f' : '#cdd' }}
                      onClick={() => setSelectedFade(f.fadeIn, !f.fadeOut)} title="Fade brightness out over the block">Out</button>
                  </>
                )
              })()}
            </div>
          </div>
          {/* One-click changes to EVERY block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap', borderTop: '1px solid #1b2230', paddingTop: 8 }}>
            <span style={{ ...editLbl, fontWeight: 700 }}>Apply to ALL blocks:</span>
            <button style={miniBtn} onClick={() => applyToAll((t) => withFade(t, true, fadeOf(t).fadeOut), 'Fade in → all')}>＋Fade in</button>
            <button style={miniBtn} onClick={() => applyToAll((t) => withFade(t, fadeOf(t).fadeIn, true), 'Fade out → all')}>＋Fade out</button>
            <button style={miniBtn} onClick={() => applyToAll((t) => withFade(t, false, false), 'No fades → all')}>No fades</button>
            <span style={{ color: '#566', fontSize: 10 }}>|</span>
            <button style={miniBtn} onClick={() => applyToAll((t) => ({ ...t, color: selectedTf.color, hasExplicitColor: true }), 'Color → all')}>This color</button>
            <button style={miniBtn} onClick={() => applyToAll((t) => withPattern(t, patternKeyOf(selectedTf), rateOf(selectedTf) ?? rate), 'Pattern → all')}>This pattern</button>
          </div>
        </div>
      )}

      {/* Right-click "add beat lines" menu (from the spectrogram) */}
      {ctxMenu && (
        <>
          <div onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} style={{ position: 'fixed', inset: 0, zIndex: 2200 }} />
          <div style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 260), zIndex: 2201, background: '#1b2230', border: '1px solid #2c3645', borderRadius: 8, padding: 6, boxShadow: '0 10px 30px #000b', minWidth: 200 }}>
            <div style={{ fontSize: 10, color: '#778', padding: '2px 8px 6px', fontWeight: 700 }}>≈ beat {Math.round(ctxMenu.beat)} · add white snap-lines</div>
            <button style={ctxItem} onClick={() => { addLineAt(ctxMenu.beat); setCtxMenu(null) }}>＋ Line here</button>
            {[1, 2, 4, 8, 16].map((n) => (
              <button key={n} style={ctxItem} onClick={() => { addGridLines(n); setCtxMenu(null) }}>＋ Lines every {n} beat{n > 1 ? 's' : ''}</button>
            ))}
            <div style={{ height: 1, background: '#2c3645', margin: '4px 0' }} />
            <button style={ctxItem} onClick={() => { removeLineNear(ctxMenu.beat); setCtxMenu(null) }}>－ Remove nearest line</button>
            <button style={{ ...ctxItem, color: '#fca5a5' }} onClick={() => { onSectionLinesChange?.([]); setCtxMenu(null) }}>🗑 Clear all lines</button>
          </div>
        </>
      )}

      {/* Transport */}
      <div style={transport}>
        <button onClick={onPlayPause} style={{ ...transportBtn, background: isPlaying ? '#b45309' : '#10b981' }}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={onStop} style={{ ...transportBtn, background: '#3a3f4b' }}>⏹</button>
        <span style={{ fontSize: 12, color: '#9ab', width: 96, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(currentTime)} / {fmt(songLengthBeats)}
        </span>
        <span style={{ fontSize: 11, color: '#667' }}>
          {currentTime.toFixed(1)}b · {currentSection?.label ?? 'song'}
        </span>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0a0c10', zIndex: 2100, display: 'flex', flexDirection: 'column', color: '#e8eef5' }
const topbar: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #1b2230' }
const closeBtn: React.CSSProperties = { background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const rail: React.CSSProperties = { width: 156, flexShrink: 0, borderRight: '1px solid #1b2230', background: '#0d1117', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }
const railLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#667', textTransform: 'uppercase', letterSpacing: '0.06em' }
const paletteSelect: React.CSSProperties = { width: '100%', background: '#1b2230', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const railDivider: React.CSSProperties = { height: 1, background: '#1b2230', margin: '6px 0' }
const padV: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 40, borderRadius: 8, padding: '0 10px', cursor: 'grab', userSelect: 'none', boxSizing: 'border-box' }
const vizBox: React.CSSProperties = { position: 'relative', flex: '0 0 38%', minHeight: 120, borderRadius: 12, background: '#0d1117', border: '1px solid #1f2632', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const flashPill: React.CSSProperties = { position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: '#064e3b', color: '#6ee7b7', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700 }
const lanesWrap: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', background: '#0d1117', border: '1px solid #1f2632', borderRadius: 12, padding: '8px 12px' }
const miniBtn: React.CSSProperties = { border: 'none', borderRadius: 5, padding: '3px 7px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#2a3340', color: '#cdd' }
const zoomBtn: React.CSSProperties = { border: 'none', borderRadius: 5, width: 22, height: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#2a3340', color: '#cdd' }
const transport: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid #1b2230' }
const transportBtn: React.CSSProperties = { color: '#fff', border: 'none', borderRadius: 8, width: 44, height: 36, fontSize: 16, cursor: 'pointer' }
const editor: React.CSSProperties = { borderTop: '1px solid #1b2230', background: '#11161f', padding: '10px 16px' }
const editLbl: React.CSSProperties = { fontSize: 11, color: '#8aa', marginRight: 2 }
const ctxItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#e8eef5', fontSize: 12, padding: '5px 8px', borderRadius: 5, cursor: 'pointer' }
// Right-hand drawer that hosts the full TimeframePanel inside the fullscreen console.
const advancedDrawer: React.CSSProperties = { flexShrink: 0, height: '100%', display: 'flex', borderLeft: '1px solid #1b2230', background: '#0d1117' }
