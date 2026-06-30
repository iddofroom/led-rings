/**
 * PatternLibrary — the song's "general settings" pattern surface (shown on the main
 * page instead of the timeline). Lists every available pattern (the preset library +
 * any imported patterns), lets you apply one to the song, and curate the set:
 *   • 🗑 a pattern → choose "this song only" (per-song hide) or "all songs" (global hide).
 *   • ⬆ Import → load pattern JSON files back in, so a globally-removed pattern is never lost.
 * Hidden patterns are listed at the bottom and can be restored in one click.
 */
import { useMemo, useRef, useState } from 'react'
import { loadAllPresets, extractPresetColors, summarizePresetEffects } from '../presets'
import type { PresetMetadata, PresetData } from '../presets'
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
  onApplyPreset: (preset: PresetMetadata) => void
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

const PatternCard = ({
  preset, onApply, onHideForSong, onHideGlobal,
}: {
  preset: PresetMetadata
  onApply: (p: PresetMetadata) => void
  onHideForSong: (id: string) => void
  onHideGlobal: (id: string) => void
}) => {
  const colors = useMemo(() => extractPresetColors(preset.data), [preset.data])
  const summary = useMemo(() => summarizePresetEffects(preset.data), [preset.data])
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="pattern-card-wrap">
      <div className="preset-card pattern-card" onClick={() => onApply(preset)} title="הוסף את הפאטרן לשיר">
        <div className="preset-card-colors">
          {colors.slice(0, 3).map((c, i) => (
            <div key={i} className="preset-card-color-swatch" style={{ background: c }} />
          ))}
        </div>
        <div className="preset-card-info">
          <span className="preset-card-name">{preset.displayName}</span>
          {summary && <span className="preset-card-effects">{summary}</span>}
        </div>
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
  imported, globalHidden, songHidden, songName,
  onApplyPreset, onHideForSong, onHideGlobal, onRestoreForSong, onRestoreGlobal, onImport,
}: PatternLibraryProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
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
      next.has(cat) ? next.delete(cat) : next.add(cat)
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
    </div>
  )
}

export default PatternLibrary
