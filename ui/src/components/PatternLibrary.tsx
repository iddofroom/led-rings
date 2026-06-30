/**
 * PatternLibrary — the song's "general settings" pattern surface (shown on the main
 * page instead of the timeline). Lists every available pattern (the preset library +
 * any imported patterns), lets you preview, apply, and curate the set:
 *   • click a card → animated preview of the pattern on the 12 rings ("examine").
 *   • ＋ → add the pattern to the song.
 *   • 🗑 → choose "this song only" (per-song hide) or "all songs" (global hide).
 *   • ⬆ Import → load pattern JSON files back in, so a globally-removed pattern is never lost.
 * Hidden patterns are listed at the bottom and can be restored in one click.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAllPresets, extractPresetColors, summarizePresetEffects, presetToTimeframes } from '../presets'
import type { PresetMetadata, PresetData } from '../presets'
import type { Timeframe } from '../App'
import { WLED_PALETTES, paletteById } from '../../../shared/wled-palettes'
import RingVisualization from './RingVisualization'
import './PresetBrowser.css'
import './PatternLibrary.css'

export interface ImportedPattern {
  id: string
  category: string
  displayName: string
  data: PresetData
}

interface PatternLibraryProps {
  imported: ImportedPattern[]
  /** Pattern ids hidden across ALL songs. */
  globalHidden: string[]
  /** Pattern ids hidden for the CURRENT song only. */
  songHidden: string[]
  songName: string
  /** Song BPM — drives the preview animation tempo. */
  bpm: number
  onApplyPreset: (preset: PresetMetadata) => void
  /** Add an EDITED version of a pattern (renamed / re-sped / recolored) to the song. */
  onApplyEdited?: (timeframes: Timeframe[], name: string) => void
  /** Save the edited pattern into the song's animation set (upsert by name, in place). */
  onSavePattern?: (name: string, tfs: Timeframe[]) => void
  /** Per-pattern edits (name + speed + palette) overriding the preset; persisted by parent. */
  patternEdits?: Record<string, { name?: string; speed?: number; paletteId?: string }>
  onSavePatternEdit?: (id: string, patch: { name?: string; speed?: number; paletteId?: string }) => void
  onHideForSong: (id: string) => void
  onHideGlobal: (id: string) => void
  onRestoreForSong: (id: string) => void
  onRestoreGlobal: (id: string) => void
  onImport: (patterns: ImportedPattern[]) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  background: 'Background', chill: 'Chill', mystery: 'Mystery',
  party: 'Party', psychedelic: 'Psychedelic', imported: 'Imported',
}
const CATEGORY_ORDER = ['background', 'chill', 'mystery', 'party', 'psychedelic', 'imported']

const isPresetData = (v: unknown): v is PresetData =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v as object).some((k) => /^ring\d+$/.test(k))

/** Animated preview of a single pattern on the 12 rings — loops at the song's tempo.
 *  Editable: rename, change speed, recolor (via a palette) before adding to the song. */
const PatternPreview = ({
  preset, bpm, initialName, initialSpeed, initialPalette, onApply, onApplyEdited, onSave, onSaveEdit, onClose,
}: {
  preset: PresetMetadata
  bpm: number
  initialName: string
  initialSpeed: number
  initialPalette: string
  onApply: (p: PresetMetadata) => void
  onApplyEdited?: (tfs: Timeframe[], name: string) => void
  onSave?: (name: string, tfs: Timeframe[]) => void
  onSaveEdit?: (id: string, patch: { name?: string; speed?: number; paletteId?: string }) => void
  onClose: () => void
}) => {
  const baseTfs = useMemo(() => presetToTimeframes(preset, 0, bpm), [preset, bpm])
  const [name, setName] = useState(initialName)
  const [speed, setSpeed] = useState(initialSpeed)
  const [paletteSel, setPaletteSel] = useState(initialPalette)
  useEffect(() => { setName(initialName); setSpeed(initialSpeed); setPaletteSel(initialPalette) }, [preset, initialName, initialSpeed, initialPalette])
  const persistEdit = () => onSaveEdit?.(preset.id, { name, speed, paletteId: paletteSel })

  // Apply the live edits (speed + palette) to the previewed/added timeframes.
  const tfs = useMemo(() => baseTfs.map((tf, i) => {
    const e: Timeframe = { ...tf }
    if (paletteSel !== 'original') {
      const pal = paletteById(paletteSel)
      e.color = pal.colors[i % pal.colors.length]
      e.hasExplicitColor = undefined
    }
    if (speed !== 1 && tf.cycles) {
      e.cycles = tf.cycles.map((c) => ('beatsInCycle' in c ? { ...c, beatsInCycle: Math.max(0.25, +(c.beatsInCycle / speed).toFixed(2)) } : c))
    }
    return e
  }), [baseTfs, speed, paletteSel])

  const loopBeats = useMemo(() => Math.max(1, ...tfs.map((t) => t.endTime)), [tfs])
  const [t, setT] = useState(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    const beatsPerSec = Math.max(0.05, bpm / 60)
    const tick = (ts: number) => {
      if (last) setT((prev) => (prev + ((ts - last) / 1000) * beatsPerSec) % loopBeats)
      last = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loopBeats, bpm])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pattern-preview-overlay" onClick={onClose}>
      <div className="pattern-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pattern-preview-head">
          <input className="pattern-preview-name-input" value={name} onChange={(e) => setName(e.target.value)}
            title="שם הפאטרן" style={{ background: '#0d1117', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 8px', fontSize: 15, fontWeight: 700, minWidth: 0, flex: '0 1 240px' }} />
          <span className="pattern-preview-cat">{CATEGORY_LABELS[preset.category] || preset.category}</span>
          <span style={{ flex: 1 }} />
          <button className="pattern-preview-close" onClick={onClose} title="סגור (Esc)">✕</button>
        </div>
        <div className="pattern-preview-stage">
          <RingVisualization mapping="all" timeframes={tfs} currentTime={t} globalBrightness={1} darkOff />
        </div>
        {/* Edit: speed + colors */}
        <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', flexWrap: 'wrap', borderTop: '1px solid #2c3645' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ab' }}>
            מהירות
            <input type="range" min={0.1} max={8} step={0.05} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} style={{ width: 130, accentColor: '#f59e0b' }} />
            <input type="number" min={0.1} max={16} step={0.05} value={speed}
              onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n > 0) setSpeed(Math.min(16, Math.max(0.1, n))) }}
              style={{ width: 56, background: '#0d1117', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 5, padding: '3px 5px', fontSize: 12 }} />
            <span>×</span>
            {[0.5, 1, 2, 4].map((m) => (
              <button key={m} type="button" onClick={() => setSpeed(m)}
                style={{ border: 'none', borderRadius: 5, padding: '2px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: speed === m ? '#f59e0b' : '#2a3340', color: speed === m ? '#1b1200' : '#cdd' }}>{m}×</button>
            ))}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ab' }}>
            צבעים
            <select value={paletteSel} onChange={(e) => setPaletteSel(e.target.value)}
              style={{ background: '#0d1117', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 6px', fontSize: 12, maxWidth: 160 }}>
              <option value="original">מקורי</option>
              {WLED_PALETTES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="pattern-preview-foot">
          <span className="pattern-preview-summary">{summarizePresetEffects(preset.data) || '—'}</span>
          <span style={{ flex: 1 }} />
          {onSave && (
            <button onClick={() => { persistEdit(); onSave(name, tfs); onClose() }} title="שמור שם + מהירות + צבעים על הפאטרן, וגם לשיר"
              style={{ border: '1px solid #34d399', background: 'transparent', color: '#34d399', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>💾 שמור</button>
          )}
          <button className="pattern-preview-add"
            onClick={() => { persistEdit(); if (onApplyEdited) onApplyEdited(tfs, name); else onApply(preset); onClose() }}>＋ הוסף לשיר</button>
        </div>
      </div>
    </div>
  )
}

const PatternCard = ({
  preset, name, colorsOverride, onOpen, onApply, onHideForSong, onHideGlobal,
}: {
  preset: PresetMetadata
  name: string
  colorsOverride?: string[]
  onOpen: (p: PresetMetadata) => void
  onApply: (p: PresetMetadata) => void
  onHideForSong: (id: string) => void
  onHideGlobal: (id: string) => void
}) => {
  const colors = useMemo(() => colorsOverride ?? extractPresetColors(preset.data), [colorsOverride, preset.data])
  const summary = useMemo(() => summarizePresetEffects(preset.data), [preset.data])
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="pattern-card-wrap">
      <div className="preset-card pattern-card" onClick={() => onOpen(preset)} title="לחץ לתצוגה מקדימה">
        <div className="preset-card-colors">
          {colors.slice(0, 3).map((c, i) => (
            <div key={i} className="preset-card-color-swatch" style={{ background: c }} />
          ))}
        </div>
        <div className="preset-card-info">
          <span className="preset-card-name">{name}</span>
          {summary && <span className="preset-card-effects">{summary}</span>}
        </div>
        <button
          className="pattern-card-add"
          title="הוסף לשיר"
          onClick={(e) => { e.stopPropagation(); onApply(preset) }}
        >＋</button>
        <button
          className="pattern-card-delete"
          title="הסר פאטרן זה"
          onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
        >🗑</button>
      </div>

      {confirming && (
        <div className="pattern-card-confirm" onClick={(e) => e.stopPropagation()}>
          <span className="pattern-card-confirm-q">למחוק את “{preset.displayName}”?</span>
          <button className="pattern-confirm-btn this-song" onClick={() => { setConfirming(false); onHideForSong(preset.id) }}>
            רק לשיר הזה
          </button>
          <button className="pattern-confirm-btn all-songs" onClick={() => { setConfirming(false); onHideGlobal(preset.id) }}>
            לכל השירים
          </button>
          <button className="pattern-confirm-btn cancel" onClick={() => setConfirming(false)}>ביטול</button>
        </div>
      )}
    </div>
  )
}

const PatternLibrary = ({
  imported, globalHidden, songHidden, songName, bpm,
  onApplyPreset, onApplyEdited, onSavePattern, patternEdits = {}, onSavePatternEdit,
  onHideForSong, onHideGlobal, onRestoreForSong, onRestoreGlobal, onImport,
}: PatternLibraryProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [preview, setPreview] = useState<PresetMetadata | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allPatterns = useMemo<PresetMetadata[]>(
    () => [...loadAllPresets(), ...imported],
    [imported],
  )
  const byId = useMemo(() => new Map(allPatterns.map((p) => [p.id, p])), [allPatterns])
  const globalSet = useMemo(() => new Set(globalHidden), [globalHidden])
  const songSet = useMemo(() => new Set(songHidden), [songHidden])

  const visible = useMemo(
    () => allPatterns.filter((p) => !globalSet.has(p.id) && !songSet.has(p.id)),
    [allPatterns, globalSet, songSet],
  )

  const grouped = useMemo(() => {
    const groups: Record<string, PresetMetadata[]> = {}
    const q = searchTerm.trim().toLowerCase()
    for (const p of visible) {
      if (q && !p.displayName.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) continue
      ;(groups[p.category] ??= []).push(p)
    }
    return groups
  }, [visible, searchTerm])

  const orderedCats = useMemo(
    () => [...new Set([...CATEGORY_ORDER, ...Object.keys(grouped)])].filter((c) => grouped[c]?.length),
    [grouped],
  )

  const hiddenEntries = useMemo(() => {
    const out: { preset: PresetMetadata; scope: 'song' | 'global' }[] = []
    for (const id of globalHidden) { const p = byId.get(id); if (p) out.push({ preset: p, scope: 'global' }) }
    for (const id of songHidden) { if (globalSet.has(id)) continue; const p = byId.get(id); if (p) out.push({ preset: p, scope: 'song' }) }
    return out
  }, [globalHidden, songHidden, byId, globalSet])

  const toggleCat = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const out: ImportedPattern[] = []
    const skipped: string[] = []
    for (const f of Array.from(files)) {
      try {
        const json = JSON.parse(await f.text())
        const data: PresetData | null = isPresetData(json)
          ? json
          : isPresetData((json as { data?: unknown })?.data) ? (json as { data: PresetData }).data : null
        if (!data) { skipped.push(f.name); continue }
        const base = f.name.replace(/\.json$/i, '')
        out.push({ id: `imported/${base}`, category: 'imported', displayName: base.replace(/_/g, ' '), data })
      } catch {
        skipped.push(f.name)
      }
    }
    if (out.length) onImport(out)
    if (skipped.length) alert(`דולגו ${skipped.length} קבצים שאינם פאטרן תקין (נדרש JSON עם מפתחות ring1..ring12):\n${skipped.join(', ')}`)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="pattern-library">
      <div className="pattern-library-bar">
        <div className="pattern-library-title">
          <span className="pattern-library-title-main">פאטרנים</span>
          <span className="pattern-library-title-sub">{visible.length} זמינים · {songName || 'שיר'}</span>
        </div>
        <input
          type="text"
          className="preset-browser-search-input pattern-library-search"
          placeholder="חיפוש פאטרן…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button className="pattern-library-import" onClick={() => fileInputRef.current?.click()} title="ייבא קובצי פאטרן (JSON)">
          ⬆ ייבוא
        </button>
      </div>

      <div className="pattern-library-scroll">
        {orderedCats.length === 0 && (
          <div className="pattern-library-empty">אין פאטרנים להצגה. נסה לייבא, או לשחזר מוסתרים למטה.</div>
        )}
        {orderedCats.map((cat) => {
          const list = grouped[cat]
          if (!list || list.length === 0) return null
          const isCollapsed = collapsed.has(cat) && !searchTerm
          return (
            <div key={cat} className="pattern-library-category">
              <button className="preset-browser-category-header" onClick={() => toggleCat(cat)}>
                <span className="preset-browser-category-arrow">{isCollapsed ? '▶' : '▼'}</span>
                <span>{CATEGORY_LABELS[cat] || cat}</span>
                <span className="preset-browser-category-count">{list.length}</span>
              </button>
              {!isCollapsed && (
                <div className="pattern-library-grid">
                  {list.map((preset) => (
                    <PatternCard
                      key={preset.id}
                      preset={preset}
                      name={patternEdits[preset.id]?.name ?? preset.displayName}
                      colorsOverride={patternEdits[preset.id]?.paletteId && patternEdits[preset.id]!.paletteId !== 'original' ? paletteById(patternEdits[preset.id]!.paletteId!).colors : undefined}
                      onOpen={setPreview}
                      onApply={onApplyPreset}
                      onHideForSong={onHideForSong}
                      onHideGlobal={onHideGlobal}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hiddenEntries.length > 0 && (
        <div className="pattern-library-hidden">
          <button className="pattern-library-hidden-header" onClick={() => setShowHidden((s) => !s)}>
            <span className="preset-browser-category-arrow">{showHidden ? '▼' : '▶'}</span>
            מוסתרים <span className="preset-browser-category-count">{hiddenEntries.length}</span>
          </button>
          {showHidden && (
            <div className="pattern-library-hidden-list">
              {hiddenEntries.map(({ preset, scope }) => (
                <div key={`${scope}:${preset.id}`} className="pattern-hidden-row">
                  <span className="pattern-hidden-name">{preset.displayName}</span>
                  <span className={`pattern-hidden-scope ${scope}`}>{scope === 'global' ? 'כל השירים' : 'השיר הזה'}</span>
                  <button
                    className="pattern-hidden-restore"
                    onClick={() => (scope === 'global' ? onRestoreGlobal(preset.id) : onRestoreForSong(preset.id))}
                  >שחזר</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {preview && (
        <PatternPreview preset={preview} bpm={bpm}
          initialName={patternEdits[preview.id]?.name ?? preview.displayName}
          initialSpeed={patternEdits[preview.id]?.speed ?? 1}
          initialPalette={patternEdits[preview.id]?.paletteId ?? 'original'}
          onApply={onApplyPreset} onApplyEdited={onApplyEdited} onSave={onSavePattern} onSaveEdit={onSavePatternEdit} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

export default PatternLibrary
