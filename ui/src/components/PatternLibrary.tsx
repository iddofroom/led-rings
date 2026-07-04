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
import { useI18n } from '../lib/i18n'
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
  /** Load a pre-generated "all patterns of a category" timeline (the old Preset Browser's Preview All). */
  onLoadCategoryPreview?: (payload: CategoryPreviewPayload) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  background: 'Background', chill: 'Chill', mystery: 'Mystery',
  party: 'Party', psychedelic: 'Psychedelic', imported: 'Imported',
}

/** Fixed display order for known categories; anything else lands after these, alphabetically. */
const CATEGORY_ORDER = ['background', 'chill', 'mystery', 'party', 'psychedelic', 'imported']

interface CategoryPreviewPayload {
  song: Record<string, unknown>
  timeframes: unknown[]
}

const isPresetData = (v: unknown): v is PresetData =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v as object).some((k) => /^ring\d+$/.test(k))

/** Apply a pattern's edits (speed + palette) to its base timeframes — shared by the
 *  preview modal, the card's quick "add to the song" action, and library-based compose. */
export function editedTimeframes(baseTfs: Timeframe[], speed: number, paletteSel: string): Timeframe[] {
  return baseTfs.map((tf, i) => {
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
  })
}

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
  const { t: tr } = useI18n()
  const catLabel = (c: string) =>
    tr({ en: c, he: ({ Background: 'רקע', Chill: 'צ׳יל', Mystery: 'מסתורין', Party: 'מסיבה', Psychedelic: 'פסיכדלי', Imported: 'מיובאות' } as Record<string, string>)[c] ?? c })
  const baseTfs = useMemo(() => presetToTimeframes(preset, 0, bpm), [preset, bpm])
  const [name, setName] = useState(initialName)
  const [speed, setSpeed] = useState(initialSpeed)
  const [paletteSel, setPaletteSel] = useState(initialPalette)
  useEffect(() => { setName(initialName); setSpeed(initialSpeed); setPaletteSel(initialPalette) }, [preset, initialName, initialSpeed, initialPalette])
  const persistEdit = () => onSaveEdit?.(preset.id, { name, speed, paletteId: paletteSel })

  // Apply the live edits (speed + palette) to the previewed/added timeframes.
  const tfs = useMemo(() => editedTimeframes(baseTfs, speed, paletteSel), [baseTfs, speed, paletteSel])

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
            title={tr({ en: 'Pattern name', he: 'שם התבנית' })} style={{ background: '#0d1117', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 8px', fontSize: 15, fontWeight: 700, minWidth: 0, flex: '0 1 240px' }} />
          <span className="pattern-preview-cat">{catLabel(CATEGORY_LABELS[preset.category] || preset.category)}</span>
          <span style={{ flex: 1 }} />
          <button className="pattern-preview-close" onClick={onClose} title={tr({ en: 'Close (Esc)', he: 'סגור (Esc)' })}>✕</button>
        </div>
        <div className="pattern-preview-stage">
          <RingVisualization mapping="all" timeframes={tfs} currentTime={t} globalBrightness={1} darkOff />
        </div>
        {/* Edit: speed + colors */}
        <div style={{ position: 'relative', zIndex: 2, flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', flexWrap: 'wrap', borderTop: '1px solid #2c3645' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ab' }}>
            {tr({ en: 'Speed', he: 'מהירות' })}
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
            {tr({ en: 'Colors', he: 'צבעים' })}
            <select value={paletteSel} onChange={(e) => setPaletteSel(e.target.value)}
              style={{ background: '#0d1117', color: '#e8eef5', border: '1px solid #2c3645', borderRadius: 6, padding: '4px 6px', fontSize: 12, maxWidth: 160 }}>
              <option value="original">{tr({ en: 'Original', he: 'מקורי' })}</option>
              {WLED_PALETTES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="pattern-preview-foot">
          <span className="pattern-preview-summary">{summarizePresetEffects(preset.data) || '—'}</span>
          <span style={{ flex: 1 }} />
          {onSave && (
            <button onClick={() => { persistEdit(); onSave(name, tfs); onClose() }} title={tr({ en: 'Save name + speed + colors on the pattern, and to the song', he: 'שמור שם + מהירות + צבעים על התבנית, וגם לשיר' })}
              style={{ border: '1px solid #34d399', background: 'transparent', color: '#34d399', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>💾 {tr({ en: 'Save', he: 'שמור' })}</button>
          )}
          <button className="pattern-preview-add"
            onClick={() => { persistEdit(); if (onApplyEdited) onApplyEdited(tfs, name); else onApply(preset); onClose() }}>＋ {tr({ en: 'Add to song', he: 'הוסף לשיר' })}</button>
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
  const { t } = useI18n()
  const colors = useMemo(() => colorsOverride ?? extractPresetColors(preset.data), [colorsOverride, preset.data])
  const summary = useMemo(() => summarizePresetEffects(preset.data), [preset.data])
  const [confirming, setConfirming] = useState(false)
  const [added, setAdded] = useState(false)

  return (
    <div className="pattern-card-wrap">
      <div className="preset-card pattern-card" onClick={() => onOpen(preset)} title={t({ en: 'Click to preview', he: 'לחץ לתצוגה מקדימה' })}>
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
          className={`pattern-card-add${added ? ' added' : ''}`}
          title={t({ en: 'Add to the fullscreen patterns (Live Console)', he: 'הוסף לתבניות במסך המלא (קונסולת לייב)' })}
          onClick={(e) => { e.stopPropagation(); onApply(preset); setAdded(true); window.setTimeout(() => setAdded(false), 900) }}
        >{added ? '✓' : '＋'}</button>
        <button
          className="pattern-card-delete"
          title={t({ en: 'Remove this pattern', he: 'הסר תבנית זו' })}
          onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
        >🗑</button>
      </div>

      {confirming && (
        <div className="pattern-card-confirm" onClick={(e) => e.stopPropagation()}>
          <span className="pattern-card-confirm-q">{t({ en: 'Remove', he: 'להסיר את' })} “{preset.displayName}”?</span>
          <button className="pattern-confirm-btn this-song" onClick={() => { setConfirming(false); onHideForSong(preset.id) }}>
            {t({ en: 'This song only', he: 'רק שיר זה' })}
          </button>
          <button className="pattern-confirm-btn all-songs" onClick={() => { setConfirming(false); onHideGlobal(preset.id) }}>
            {t({ en: 'All songs', he: 'כל השירים' })}
          </button>
          <button className="pattern-confirm-btn cancel" onClick={() => setConfirming(false)}>{t({ en: 'Cancel', he: 'ביטול' })}</button>
        </div>
      )}
    </div>
  )
}

const PatternLibrary = ({
  imported, globalHidden, songHidden, songName, bpm,
  onApplyPreset, onApplyEdited, onSavePattern, patternEdits = {}, onSavePatternEdit,
  onHideForSong, onHideGlobal, onRestoreForSong, onRestoreGlobal, onImport, onLoadCategoryPreview,
}: PatternLibraryProps) => {
  const { t } = useI18n()
  const catLabel = (c: string) =>
    t({ en: c, he: ({ Background: 'רקע', Chill: 'צ׳יל', Mystery: 'מסתורין', Party: 'מסיבה', Psychedelic: 'פסיכדלי', Imported: 'מיובאות' } as Record<string, string>)[c] ?? c })
  const [searchTerm, setSearchTerm] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [preview, setPreview] = useState<PresetMetadata | null>(null)
  // Expanded categories. Default: all folded. Searching force-expands.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null)
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

  // Patterns filtered by search, then grouped by category in a fixed, friendly order.
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return visible
    return visible.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
    )
  }, [visible, searchTerm])

  const grouped = useMemo(() => {
    const groups = new Map<string, PresetMetadata[]>()
    for (const p of filtered) {
      const list = groups.get(p.category)
      if (list) list.push(p)
      else groups.set(p.category, [p])
    }
    const known = CATEGORY_ORDER.filter((c) => groups.has(c))
    const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort()
    return [...known, ...rest].map((cat) => ({ cat, presets: groups.get(cat)! }))
  }, [filtered])

  const toggleCategory = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // "Preview All": load the pre-generated all-of-category timeline (from the old Preset Browser).
  const handlePreviewAll = async (cat: string, e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (!onLoadCategoryPreview) return
    const catTitle = cat.charAt(0).toUpperCase() + cat.slice(1)
    setLoadingCategory(cat)
    try {
      const res = await fetch(`/category-previews/All${catTitle}.json`)
      if (!res.ok) throw new Error(`Not found: /category-previews/All${catTitle}.json`)
      const payload = await res.json() as CategoryPreviewPayload
      onLoadCategoryPreview(payload)
    } catch {
      alert(`${t({ en: 'Category preview not generated yet.', he: 'תצוגת הקטגוריה עדיין לא נוצרה.' })}\n${t({ en: 'Run', he: 'הרץ' })}: yarn gen-ui-song ${cat}`)
    } finally {
      setLoadingCategory(null)
    }
  }

  const hiddenEntries = useMemo(() => {
    const out: { preset: PresetMetadata; scope: 'song' | 'global' }[] = []
    for (const id of globalHidden) { const p = byId.get(id); if (p) out.push({ preset: p, scope: 'global' }) }
    for (const id of songHidden) { if (globalSet.has(id)) continue; const p = byId.get(id); if (p) out.push({ preset: p, scope: 'song' }) }
    return out
  }, [globalHidden, songHidden, byId, globalSet])

  // ＋ on a card adds the pattern (with its saved name/speed/colors) to the song's
  // pattern set — the pads in the fullscreen Live Console — NOT onto the timeline.
  const addToSong = (preset: PresetMetadata) => {
    const edit = patternEdits[preset.id] ?? {}
    const base = presetToTimeframes(preset, 0, bpm)
    const tfs = editedTimeframes(base, edit.speed ?? 1, edit.paletteId ?? 'original')
    const name = edit.name ?? preset.displayName
    if (onApplyEdited) onApplyEdited(tfs, name)
    else onSavePattern?.(name, tfs)
  }

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
    if (skipped.length) alert(`${t({ en: 'Skipped', he: 'דולגו' })} ${skipped.length} ${t({ en: 'files that are not valid patterns (JSON with ring1..ring12 keys required):', he: 'קבצים שאינם תבניות תקינות (נדרש JSON עם מפתחות ring1..ring12):' })}\n${skipped.join(', ')}`)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="pattern-library">
      <div className="pattern-library-bar">
        <div className="pattern-library-title">
          <span className="pattern-library-title-main">{t({ en: 'Patterns', he: 'תבניות' })}</span>
          <span className="pattern-library-title-sub">{visible.length} {t({ en: 'available', he: 'זמינות' })} · {songName || t({ en: 'Song', he: 'שיר' })}</span>
        </div>
        <input
          type="text"
          className="preset-browser-search-input pattern-library-search"
          placeholder={t({ en: 'Search patterns…', he: 'חיפוש תבניות…' })}
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
        <button className="pattern-library-import" onClick={() => fileInputRef.current?.click()} title={t({ en: 'Import pattern files (JSON)', he: 'ייבוא קבצי תבניות (JSON)' })}>
          ⬆ {t({ en: 'Import', he: 'ייבוא' })}
        </button>
      </div>

      <div className="pattern-library-scroll">
        {filtered.length === 0 ? (
          <div className="pattern-library-empty">{t({ en: 'No patterns to show. Try importing, or restore hidden ones below.', he: 'אין תבניות להצגה. נסה לייבא, או שחזר תבניות מוסתרות למטה.' })}</div>
        ) : (
          grouped.map(({ cat, presets }) => {
            const isExpanded = expanded.has(cat) || !!searchTerm.trim()
            return (
              <div key={cat} className="preset-browser-category">
                <button
                  className={`preset-browser-category-header ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="preset-browser-category-arrow">{isExpanded ? '▼' : '▶'}</span>
                  <span className="preset-browser-category-name">{catLabel(CATEGORY_LABELS[cat] || cat)}</span>
                  <span className="preset-browser-category-count">{presets.length}</span>
                  {onLoadCategoryPreview && cat !== 'imported' && (
                    <span
                      className="preset-browser-category-preview-all"
                      title={t({ en: `Load all ${catLabel(CATEGORY_LABELS[cat] || cat)} patterns as a timeline`, he: `טען את כל תבניות ${catLabel(CATEGORY_LABELS[cat] || cat)} כציר זמן` })}
                      onClick={(e) => handlePreviewAll(cat, e)}
                    >
                      {loadingCategory === cat ? '...' : t({ en: 'Preview All', he: 'הצג הכול' })}
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="pattern-library-grid">
                    {presets.map((preset) => (
                      <PatternCard
                        key={preset.id}
                        preset={preset}
                        name={patternEdits[preset.id]?.name ?? preset.displayName}
                        colorsOverride={patternEdits[preset.id]?.paletteId && patternEdits[preset.id]!.paletteId !== 'original' ? paletteById(patternEdits[preset.id]!.paletteId!).colors : undefined}
                        onOpen={setPreview}
                        onApply={addToSong}
                        onHideForSong={onHideForSong}
                        onHideGlobal={onHideGlobal}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {hiddenEntries.length > 0 && (
        <div className="pattern-library-hidden">
          <button className="pattern-library-hidden-header" onClick={() => setShowHidden((s) => !s)}>
            <span className="preset-browser-category-arrow">{showHidden ? '▼' : '▶'}</span>
            {t({ en: 'Hidden', he: 'מוסתרות' })} <span className="preset-browser-category-count">{hiddenEntries.length}</span>
          </button>
          {showHidden && (
            <div className="pattern-library-hidden-list">
              {hiddenEntries.map(({ preset, scope }) => (
                <div key={`${scope}:${preset.id}`} className="pattern-hidden-row">
                  <span className="pattern-hidden-name">{preset.displayName}</span>
                  <span className={`pattern-hidden-scope ${scope}`}>{scope === 'global' ? t({ en: 'All songs', he: 'כל השירים' }) : t({ en: 'This song', he: 'שיר זה' })}</span>
                  <button
                    className="pattern-hidden-restore"
                    onClick={() => (scope === 'global' ? onRestoreGlobal(preset.id) : onRestoreForSong(preset.id))}
                  >{t({ en: 'Restore', he: 'שחזר' })}</button>
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
