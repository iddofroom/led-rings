import React, { useState, useRef, useEffect, useCallback, Component } from 'react'
import PlaybackRingsPanel from './components/PlaybackRingsPanel'
import Timeline from './components/Timeline'
import TimeframePanel from './components/TimeframePanel'
import Spectrogram from './components/Spectrogram'
import ComposePanel from './components/ComposePanel'
import LibraryPanel from './components/LibraryPanel'
import LiveConsole from './components/LiveConsole'
import HistoryPanel from './components/HistoryPanel'
import PatternLibrary, { editedTimeframes } from './components/PatternLibrary'
import type { ImportedPattern } from './components/PatternLibrary'
import { library, fileToBase64 } from './lib/library'
import { putAudio, getAudio } from './lib/audioCache'
import { useViewRange } from './hooks/useViewRange'
import { useUndoHistory } from './hooks/useUndoHistory'
import { generateSequenceTs } from './generateSequenceTs'
import { presetToTimeframes, loadAllPresets } from './presets'
import { normalizeMovement } from './movementGenerators'
import type { TimeframeMovement } from './movementGenerators'
import type { PresetMetadata } from './presets'
import SettingsPanel from './components/SettingsPanel'
import { tryReuseHandle, grantPermissionAndGetFile, pickAndRememberAudioFile, supportsFileHandles } from './audioFileHandles'
import './App.css'

const CONTROL_SERVER_URL_STORAGE_KEY = 'kivsee-control-server-url'

/** Shared pill style for the floating action dock (Library / Compose). */
const fabBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, height: 42,
  color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999,
  padding: '0 18px', fontSize: 14, fontWeight: 700, letterSpacing: '0.01em', cursor: 'pointer',
}

export class AppErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App render error', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 600 }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#c00' }}>{this.state.error.message}</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>Check the console for details. Try loading a different file or refresh the page.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12, marginRight: 8, padding: '8px 16px' }}>
            Reload page
          </button>
          <button type="button" onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** cycle(beatsInCycle, cb) — full cycle */
export interface TimeframeCycle {
  type: 'cycle'
  beatsInCycle: number
}

/** cycleBeats(beatsInCycle, startBeat, endBeat, cb) — window within cycle */
export interface TimeframeCycleBeats {
  type: 'cycleBeats'
  beatsInCycle: number
  startBeat: number
  endBeat: number
}

export type TimeframeCycleEntry = TimeframeCycle | TimeframeCycleBeats

/** A single effect slot: one of brightness / hue / motion effect by key */
export interface TimeframeEffectEntry {
  id: string
  effectKey: string
  params?: Record<string, number | boolean | object>
  phase?: number
}

export interface Timeframe {
  id: string
  startTime: number
  endTime: number
  label: string
  color: string
  hasExplicitColor?: boolean // When false, no constColor is emitted (timeframe only has modifiers/motion)
  rings: number[] // Array of ring numbers (1-12) that participate
  disabled?: boolean // When true, timeframe is excluded from playback and export
  mapping?: string // Segment mapping name from segments.json
  phase?: number // Phase intensity — offsets hue/brightness/motion per ring (0 = none)
  /** Movement pattern — distributes the effect across rings over time (accumulate, sweep, dissolve, bounce). */
  movement?: TimeframeMovement
  /** Optional list of cycle/cycleBeats wrapping this timeframe's content (outermost first) */
  cycles?: TimeframeCycleEntry[]
  /** Effect slots (one selector per slot, add more as desired). Replaces legacy brightness/hue/motion fields. */
  effects?: TimeframeEffectEntry[]
  /** Pipeline metadata (from scripts/translate.py): which analyzed section this came from, and its provenance. */
  _section?: number
  _source?: string
  /** @deprecated Use effects[] instead. Kept for load compat. */
  brightnessEffect?: string
  /** @deprecated */
  brightnessEffectParams?: Record<string, number | boolean>
  /** @deprecated */
  hueEffect?: string
  /** @deprecated */
  hueEffectParams?: Record<string, number | boolean>
  /** @deprecated */
  motionEffect?: string
  /** @deprecated */
  motionEffectParams?: Record<string, number | boolean>
}

export type AnimationType = 'song' | 'trigger'

export interface Song {
  name: string
  /** Song length in seconds. Total beats = (lengthSeconds / 60) * bpm */
  lengthSeconds: number
  bpm: number
  startOffsetMs?: number
  /** When pressing Run, start playback at this time (seconds). */
  runStartTimeSeconds?: number
  /** Song = startSong() with offset; Trigger = trigger() one-shot. Affects generated .ts output. */
  animationType?: AnimationType
  /** Path or URL to the audio file for timeline playback (e.g. /audio/song.wav). Supported: .wav, .mp3, .ogg, etc. */
  audioFilePath?: string
  /** Detected beat positions in milliseconds. When present, beatToMs uses lookup instead of fixed-BPM formula. */
  beatTimestampsMs?: number[]
  /** When this song lives in the cloud library, its slug. Drives auto-save + audio resolution. (Client-only.) */
  librarySlug?: string
  /** Custom section-boundary beats added in the Live Console. When set, they define the
   *  sections patterns snap to AND the sections a Recompose regenerates against. */
  sectionLines?: number[]
  /** Pattern ids hidden for THIS song only (curated on the main settings page). */
  hiddenPatterns?: string[]
  /** The song's own animation set (built via "add to song" / "save"). Offered as pads in
   *  the Live Console rail and used as the pool when Recompose runs. */
  animations?: { id: string; name: string; timeframes: Timeframe[] }[]
  /** Ring numbers that have a lilum pendant mirroring them. Emits anim.mirrorToLilum([...]). */
  lilumRings?: number[]
}

const LAST_SONG_STORAGE_KEY = 'timelineManager:lastSong'

/** Returns normalized effects array: from timeframe.effects or built from legacy brightness/hue/motion fields. */
export function getTimeframeEffects(tf: Timeframe): TimeframeEffectEntry[] {
  if (tf.effects && tf.effects.length > 0) return tf.effects
  const entries: TimeframeEffectEntry[] = []
  const add = (key: string, params?: Record<string, number | boolean>) => {
    if (key) entries.push({ id: `legacy-${key}-${entries.length}`, effectKey: key, params })
  }
  if (tf.brightnessEffect) add(tf.brightnessEffect, tf.brightnessEffectParams)
  if (tf.hueEffect) add(tf.hueEffect, tf.hueEffectParams)
  if (tf.motionEffect) add(tf.motionEffect, tf.motionEffectParams)
  return entries
}

function normalizeCycles(cycles: unknown): TimeframeCycleEntry[] | undefined {
  if (!Array.isArray(cycles) || cycles.length === 0) return undefined
  const out: TimeframeCycleEntry[] = []
  for (const c of cycles) {
    if (!c || typeof c !== 'object') continue
    if (c.type === 'cycle' && typeof c.beatsInCycle === 'number' && c.beatsInCycle > 0) {
      out.push({ type: 'cycle', beatsInCycle: c.beatsInCycle })
    } else if (
      c.type === 'cycleBeats' &&
      typeof c.beatsInCycle === 'number' && c.beatsInCycle > 0 &&
      typeof c.startBeat === 'number' &&
      typeof c.endBeat === 'number'
    ) {
      out.push({
        type: 'cycleBeats',
        beatsInCycle: c.beatsInCycle,
        startBeat: c.startBeat,
        endBeat: c.endBeat,
      })
    }
  }
  return out.length ? out : undefined
}

/** Strip client-only fields so the song stored in the library is clean/portable. */
function cleanSongForLibrary(song: Song): Record<string, unknown> {
  const { librarySlug: _slug, ...rest } = song
  return rest
}

/** Fetch an audio URL and cache its bytes in IndexedDB (once) so it re-opens instantly
 *  next launch, even offline. No-op for blob: URLs or if already cached. */
async function ensureAudioCached(key: string, url: string): Promise<void> {
  if (!key || !url || url.startsWith('blob:')) return
  try {
    if (await getAudio(key)) return
    const resp = await fetch(url)
    if (!resp.ok) return
    const blob = await resp.blob()
    if (blob.size > 0) await putAudio(key, blob)
  } catch {}
}

/** Stable-ish serialization of the working state, used as the auto-save change baseline. */
function stableWorkingJson(song: Song, timeframes: Timeframe[]): string {
  try {
    return JSON.stringify({ song: cleanSongForLibrary(song), timeframes })
  } catch {
    return ''
  }
}

export interface AppProps {
  /** Which installation/project this editor session belongs to (scopes all library calls). */
  projectId?: string
  /** What to open on mount: a specific library composition, 'new' for a blank song, or
   *  undefined/null to restore the last local session (standalone use, no shell). */
  initialLoad?: { slug: string; comp: string } | 'new' | null
  /** Back to the song picker (rendered as "← Songs" in the header when provided). */
  onExitToSongs?: () => void
}

function App({ projectId = 'rings', initialLoad, onExitToSongs }: AppProps = {}) {
  const snapToBeat = (beat: number): number => {
    return Math.round(beat / 4) * 4
  }

  /** Convert beat position to audio seconds (accounts for startOffsetMs and detected beats). */
  const beatsToAudioSec = (beats: number, s: Song): number => {
    const ts = s.beatTimestampsMs
    if (ts && ts.length > 0) {
      const maxIdx = ts.length - 1
      // Average ms per beat from first few intervals, fallback to bpm
      const sampleCount = Math.min(8, maxIdx)
      const beatMs = sampleCount > 0 ? ts[sampleCount] / sampleCount : 60000 / s.bpm
      if (beats <= 0) return Math.max(0, (ts[0] + beats * beatMs) / 1000)
      if (beats >= maxIdx) {
        const avgMs = maxIdx > 0 ? ts[maxIdx] / maxIdx : 60000 / s.bpm
        return (ts[maxIdx] + (beats - maxIdx) * avgMs) / 1000
      }
      const floor = Math.floor(beats)
      const ceil = Math.ceil(beats)
      const ms = floor === ceil ? ts[floor] : ts[floor] + (beats - floor) * (ts[ceil] - ts[floor])
      return ms / 1000
    }
    return (beats / s.bpm) * 60 + (s.startOffsetMs ?? 0) / 1000
  }

  /** Convert audio seconds to beat position (accounts for startOffsetMs and detected beats). */
  const audioSecToBeats = (sec: number, s: Song): number => {
    const ts = s.beatTimestampsMs
    if (ts && ts.length > 0) {
      const ms = sec * 1000
      if (ms <= ts[0]) {
        // Extrapolate before first beat using average of first few intervals
        const sampleCount = Math.min(8, ts.length - 1)
        const beatMs = sampleCount > 0 ? ts[sampleCount] / sampleCount : 60000 / s.bpm
        return (ms - ts[0]) / beatMs  // negative when ms < ts[0]
      }
      if (ms >= ts[ts.length - 1]) {
        const maxIdx = ts.length - 1
        const avgMs = maxIdx > 0 ? ts[maxIdx] / maxIdx : 60000 / s.bpm
        return maxIdx + (ms - ts[maxIdx]) / avgMs
      }
      // Binary search for surrounding beats
      let lo = 0, hi = ts.length - 1
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1
        if (ts[mid] <= ms) lo = mid; else hi = mid
      }
      const range = ts[hi] - ts[lo]
      return range > 0 ? lo + (ms - ts[lo]) / range : lo
    }
    return ((sec - (s.startOffsetMs ?? 0) / 1000) / 60) * s.bpm
  }

  // Ensure we don't overwrite saved state before we've tried loading it
  const hasLoadedInitialStateRef = useRef(false)

  const [song, setSong] = useState<Song>({
    name: 'New Song',
    lengthSeconds: 32,
    bpm: 120,
    startOffsetMs: 0,
    animationType: 'song',
  })

  const {
    value: timeframes, setValue: setTimeframes,
    setValueSilent: setTimeframesSilent, checkpoint: checkpointTimeframes,
    undo: undoTimeframes, redo: redoTimeframes,
  } = useUndoHistory<Timeframe[]>([]) // Start empty: a true first open shows a clean timeline; the last-opened project is restored from localStorage on mount (see below).

  const [focusedTimeframeId, setFocusedTimeframeId] = useState<string | null>(null)
  const [selectedTimeframeIds, setSelectedTimeframeIds] = useState<Set<string>>(new Set())
  const [clipboardTimeframe, setClipboardTimeframe] = useState<Timeframe | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0) // Current time in beats
  /** When true, next Run starts from runStartTimeSeconds; when false, next Run resumes from currentTime (after Pause). */
  const [nextRunFromStart, setNextRunFromStart] = useState(true)
  const [liveMode, setLiveMode] = useState(false)
  const [muteAudio, setMuteAudio] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  /** When true, playback uses playbackSpeed (sim speed button); when false (regular Run), always 1×. */
  const [useSimSpeed, setUseSimSpeed] = useState(false)
  const useSimSpeedRef = useRef(false)
  const playbackSpeedRef = useRef(1.0)
  /** Control-server URL, editable at runtime via Settings (no rebuild needed to point at a different machine). */
  const [apiBase, setApiBaseState] = useState(
    () => localStorage.getItem(CONTROL_SERVER_URL_STORAGE_KEY) ?? (import.meta as any).env?.VITE_API_URL ?? ''
  )
  const setApiBase = useCallback((value: string) => {
    const trimmed = value.trim()
    setApiBaseState(trimmed)
    if (trimmed) localStorage.setItem(CONTROL_SERVER_URL_STORAGE_KEY, trimmed)
    else localStorage.removeItem(CONTROL_SERVER_URL_STORAGE_KEY)
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** A stored audio file handle exists but needs a fresh permission grant (must happen from a user gesture). */
  const [audioReconnectHandle, setAudioReconnectHandle] = useState<any>(null)
  const [controlServerAvailable, setControlServerAvailable] = useState(false)
  const [sendSequenceLoading, setSendSequenceLoading] = useState(false)
  const [brightness, setBrightnessState] = useState(1.0)
  const [brightnessConnected, setBrightnessConnected] = useState(false)
  const [detectBeatsLoading, setDetectBeatsLoading] = useState(false)
  const [detectBeatsProgress, setDetectBeatsProgress] = useState<string | null>(null)
  const [detectBeatsScope, setDetectBeatsScope] = useState<'full' | 'range'>('full')
  const [detectBeatsMethod, setDetectBeatsMethod] = useState<'onset' | 'beats'>('onset')
  const [rangeStartSec, setRangeStartSec] = useState(0)
  const [rangeEndSec, setRangeEndSec] = useState(60)
  /** Optional BPM for range-only detection; empty = use song BPM. Helps variable-BPM songs. */
  const [rangeBpm, setRangeBpm] = useState<number | ''>('')
  /** For range + onset: fill a full beat grid from estimated BPM (fixes sparse every-2nd-beat). */
  const [rangeFillGrid, setRangeFillGrid] = useState(false)
  const [beatEditMode, setBeatEditMode] = useState(false)
  /** When user is editing a numeric field, allow empty string; commit validated value on blur. */
  const [numericEdit, setNumericEdit] = useState<{ field: string; value: string } | null>(null)
  const playbackIntervalRef = React.useRef<NodeJS.Timeout | null>(null)
  /** Spectrogram time-range selection (drag on spectrogram). When set and user presses Play, only that section plays then stops. */
  const spectrogramRangeRef = React.useRef<{ startSec: number; endSec: number } | null>(null)
  /** When set, playback stops when reaching this time (seconds). Cleared on stop. */
  const playbackRangeEndSecRef = React.useRef<number | null>(null)
  const appContentRef = React.useRef<HTMLDivElement>(null)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const audioBlobUrlRef = React.useRef<string | null>(null)
  const audioFileInputRef = React.useRef<HTMLInputElement>(null)
  const savedDirHandleRef = React.useRef<any>(null)
  /** Effective audio URL for spectrogram fetch (path or blob URL). */
  const [effectiveAudioSrc, setEffectiveAudioSrc] = useState('')
  const songLengthBeats = Math.max(1,
    song.beatTimestampsMs && song.beatTimestampsMs.length > 0
      ? audioSecToBeats(song.lengthSeconds, song)
      : (song.lengthSeconds * song.bpm) / 60
  )
  const [viewRange, viewActions] = useViewRange(songLengthBeats)
  const { startBeat: viewStartBeat, beatsPerScreen } = viewRange
  const viewEndBeat = viewStartBeat + beatsPerScreen

  // A view (zoom + scroll) restored from a saved file must be applied after the
  // loaded song's length has propagated to songLengthBeats; otherwise setView
  // clamps against the previous (default) song length and truncates the view.
  // The nonce bumps whenever a load requests a restore, so the effect re-runs
  // even when the new song's length matches the current one.
  const [pendingView, setPendingView] = useState<{ startBeat: number; beatsPerScreen: number; nonce: number } | null>(null)
  useEffect(() => {
    if (!pendingView) return
    viewActions.setView(pendingView.startBeat, pendingView.beatsPerScreen)
    setPendingView(null)
  }, [pendingView, songLengthBeats, viewActions])

  // Resizable panel widths (px) — default responsively so the timeline never collapses
  // and the right panel is never clipped on smaller screens (user can still drag-resize).
  const _vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const [playbackPanelWidth, setPlaybackPanelWidth] = useState(() => Math.round(Math.min(720, Math.max(380, _vw * 0.42))))
  const [detailsPanelWidth, setDetailsPanelWidth] = useState(() => Math.round(Math.min(350, Math.max(280, _vw * 0.24))))
  const [spectrogramHeight, setSpectrogramHeight] = useState(180)
  const [spectrogramOpen, setSpectrogramOpen] = useState(true)
  const [headerHeight, setHeaderHeight] = useState(56)
  const [lightTheme, setLightTheme] = useState(() => localStorage.getItem('kivsee-theme') === 'light')
  const [resizing, setResizing] = useState<'playback' | 'details' | 'spectrogram' | 'header' | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showLiveConsole, setShowLiveConsole] = useState(false)
  // Main-screen body: 'patterns' shows the pattern library + settings; 'timeline' shows the
  // inline horizontal timeline editor (+ details panel). The fullscreen Live Console is separate.
  const [mainView, setMainView] = useState<'patterns' | 'timeline'>('timeline')
  // Floating action dock starts collapsed (a single ☰ button) so it never covers the workspace.
  const [dockOpen, setDockOpen] = useState(false)
  // The main page is the song settings + pattern library. The full-screen "Song Editor"
  // (Live Console) is the primary timeline/editing workspace, opened from the top button.
  // Pattern-library curation. Per-song hides live on the song (song.hiddenPatterns);
  // global hides + imported patterns persist in localStorage across songs.
  const [globalHiddenPatterns, setGlobalHiddenPatterns] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('kivsee:patternsHiddenGlobal') || '[]'); return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : [] } catch { return [] }
  })
  const [importedPatterns, setImportedPatterns] = useState<ImportedPattern[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('kivsee:patternsImported') || '[]'); return Array.isArray(v) ? (v as ImportedPattern[]) : [] } catch { return [] }
  })
  // Per-pattern edits (name + speed + palette) overriding the preset's defaults, applied
  // across the library so renames/recolors/speed stick. Persisted in localStorage.
  const [patternEdits, setPatternEdits] = useState<Record<string, { name?: string; speed?: number; paletteId?: string }>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('kivsee:patternEdits') || 'null')
      if (raw && typeof raw === 'object') return raw
      const old = JSON.parse(localStorage.getItem('kivsee:patternNames') || '{}') // migrate name-only overrides
      const migrated: Record<string, { name?: string }> = {}
      for (const k of Object.keys(old)) migrated[k] = { name: old[k] }
      return migrated
    } catch { return {} }
  })
  useEffect(() => { try { localStorage.setItem('kivsee:patternEdits', JSON.stringify(patternEdits)) } catch {} }, [patternEdits])
  const savePatternEdit = (id: string, patch: { name?: string; speed?: number; paletteId?: string }) =>
    setPatternEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }))
  const [showHistory, setShowHistory] = useState(false)
  const liveSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [liveStrip, setLiveStrip] = useState<{ beats: number[]; energy: number[]; sub: number[]; low: number[]; mid: number[]; high: number[] } | null>(null)
  // Cloud-library auto-save status, shown next to the floating actions.
  const [librarySaveState, setLibrarySaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Git-like version history: which branch we commit to + the version the working timeline
  // descends from (HEAD). Persisted in localStorage and the cloud working buffer.
  const [currentBranch, setCurrentBranch] = useState<string>('main')
  const [headVerId, setHeadVerId] = useState<string | null>(null)
  const lastSavedWorkingRef = useRef<string>('')
  const lastSavedMetaRef = useRef<string>('')
  const lastAnalysisRef = useRef<unknown>(null)
  const headerRef = React.useRef<HTMLDivElement>(null)
  const spectrogramContainerRef = React.useRef<HTMLDivElement>(null)

  // Periodically check if control server is reachable
  useEffect(() => {
    if (!apiBase) return
    const check = () => {
      fetch(`${apiBase}/api/audio?path=_ping`, { method: 'HEAD' })
        .then(() => setControlServerAvailable(true))
        .catch(() => setControlServerAvailable(false))
    }
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [apiBase])

  // Poll brightness from control server every 2 s; reset to defaults when server is down
  useEffect(() => {
    if (!apiBase) return
    const poll = () => {
      if (!controlServerAvailable) {
        setBrightnessConnected(false)
        setBrightnessState(1.0)
        return
      }
      fetch(`${apiBase}/api/brightness`)
        .then(r => r.json())
        .then((data: { value: number; connected: boolean }) => {
          setBrightnessState(data.value)
          setBrightnessConnected(data.connected)
        })
        .catch(() => {
          setBrightnessConnected(false)
          setBrightnessState(1.0)
        })
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [controlServerAvailable, apiBase])

  const songRef = useRef(song)
  songRef.current = song
  useSimSpeedRef.current = useSimSpeed
  playbackSpeedRef.current = playbackSpeed

  // Apply playback speed to audio element whenever speed or play state changes
  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.playbackRate = (isPlaying && useSimSpeed) ? playbackSpeed : 1.0
  }, [isPlaying, useSimSpeed, playbackSpeed])

  // Unified auto-scroll during playback
  useEffect(() => {
    if (!isPlaying) return
    viewActions.autoScrollTo(currentTime, 0.75)
  }, [currentTime, isPlaying, viewActions])

  // Stable callbacks for Spectrogram (convert seconds → beats then call viewActions)
  const onScrollToSeconds = useCallback((sec: number) => {
    viewActions.scrollTo(audioSecToBeats(sec, songRef.current))
  }, [viewActions])
  const onZoomAtSeconds = useCallback((dir: 'in' | 'out', anchorSec: number, frac: number) => {
    viewActions.zoomAt(dir, audioSecToBeats(anchorSec, songRef.current), frac)
  }, [viewActions])
  const viewStartBeatRef = useRef(viewStartBeat)
  viewStartBeatRef.current = viewStartBeat
  const beatsPerScreenRef = useRef(beatsPerScreen)
  beatsPerScreenRef.current = beatsPerScreen
  const onPanBySeconds = useCallback((deltaSec: number) => {
    const s = songRef.current
    const currentCenterBeat = viewStartBeatRef.current + beatsPerScreenRef.current / 2
    const currentCenterSec = beatsToAudioSec(currentCenterBeat, s)
    const newCenterBeat = audioSecToBeats(currentCenterSec + deltaSec, s)
    viewActions.panBy(newCenterBeat - currentCenterBeat)
  }, [viewActions])

  useEffect(() => {
    if (!resizing) return
    const minPlayback = 240
    const maxPlayback = 900
    const minDetails = 240
    const maxDetails = 600
    const minSpectrogram = 80
    const maxSpectrogram = 500
    const onMove = (e: MouseEvent) => {
      if (resizing === 'header') {
        const el = headerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const h = e.clientY - rect.top
        setHeaderHeight(Math.round(Math.min(120, Math.max(40, h))))
        return
      }
      if (resizing === 'spectrogram') {
        const el = spectrogramContainerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const h = e.clientY - rect.top
        setSpectrogramHeight(Math.round(Math.min(maxSpectrogram, Math.max(minSpectrogram, h))))
        return
      }
      const el = appContentRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      if (resizing === 'playback') {
        const w = Math.round(Math.min(maxPlayback, Math.max(minPlayback, x)))
        setPlaybackPanelWidth(w)
      } else {
        const rightEdge = rect.width
        const w = Math.round(Math.min(maxDetails, Math.max(minDetails, rightEdge - x)))
        setDetailsPanelWidth(w)
      }
    }
    const onUp = () => setResizing(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  const clampTimeframeUpdates = (updates: Partial<Timeframe>) => {
    if (updates.endTime !== undefined) {
      updates.endTime = Math.min(updates.endTime, songLengthBeats)
    }
    if (updates.startTime !== undefined) {
      updates.startTime = Math.max(0, updates.startTime)
    }
    return updates
  }

  const updateTimeframe = (id: string, updates: Partial<Timeframe>) => {
    const clamped = clampTimeframeUpdates(updates)
    setTimeframes(timeframes.map(tf =>
      tf.id === id ? { ...tf, ...clamped } : tf
    ))
  }

  const updateTimeframeSilent = (id: string, updates: Partial<Timeframe>) => {
    const clamped = clampTimeframeUpdates(updates)
    setTimeframesSilent(prev => prev.map(tf =>
      tf.id === id ? { ...tf, ...clamped } : tf
    ))
  }

  const updateTimeframesSilentBatch = (batch: Map<string, Partial<Timeframe>>) => {
    setTimeframesSilent(prev => prev.map(tf => {
      const u = batch.get(tf.id)
      return u ? { ...tf, ...clampTimeframeUpdates(u) } : tf
    }))
  }

  const addTimeframeFromDrag = (startTime: number, endTime: number) => {
    const clampedStart = Math.max(0, Math.min(startTime, endTime))
    const clampedEnd = Math.min(songLengthBeats, Math.max(startTime, endTime))
    if (clampedEnd <= clampedStart) return
    const newTimeframe: Timeframe = {
      id: Date.now().toString(),
      startTime: clampedStart,
      endTime: clampedEnd,
      label: `Timeframe ${timeframes.length + 1}`,
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      rings: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      mapping: 'all'
    }
    setTimeframes([...timeframes, newTimeframe])
  }

  const handleCurrentTimeChange = (time: number) => {
    setCurrentTime(time)
    setNextRunFromStart(false)
    const audio = audioRef.current
    const isSongWithAudio = song.animationType === 'song' && song.audioFilePath && audio
    if (isSongWithAudio && isPlaying) {
      audio.currentTime = Math.max(0, beatsToAudioSec(time, song))
    }
  }

  const handlePanelUpdate = (updates: Partial<Timeframe>) => {
    if (focusedTimeframeId) {
      updateTimeframe(focusedTimeframeId, updates)
    }
  }

  const focusedTimeframe = timeframes.find(tf => tf.id === focusedTimeframeId) || null

  const deleteTimeframe = (id: string) => {
    setTimeframes(timeframes.filter(tf => tf.id !== id))
    setSelectedTimeframeIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (focusedTimeframeId === id) {
      setFocusedTimeframeId(null)
    }
  }

  const addTimeframe = () => {
    const start = snapToBeat(currentTime)
    const end = Math.min(snapToBeat(start + 4), songLengthBeats)
    if (end <= start) return
    const newTimeframe: Timeframe = {
      id: Date.now().toString(),
      startTime: start,
      endTime: end,
      label: `Timeframe ${timeframes.length + 1}`,
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      rings: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      mapping: 'all'
    }
    setTimeframes([...timeframes, newTimeframe])
  }

  const deleteSelectedTimeframes = () => {
    if (selectedTimeframeIds.size === 0) return
    setTimeframes(timeframes.filter(tf => !selectedTimeframeIds.has(tf.id)))
    setSelectedTimeframeIds(new Set())
    setFocusedTimeframeId(null)
  }

  const copyTimeframe = (id: string) => {
    const source = timeframes.find(tf => tf.id === id)
    if (!source) return
    setClipboardTimeframe(JSON.parse(JSON.stringify(source)))
  }

  const pasteTimeframe = (beatPosition: number) => {
    if (!clipboardTimeframe) return
    const duration = clipboardTimeframe.endTime - clipboardTimeframe.startTime
    if (beatPosition + duration > songLengthBeats) return  // would exceed song length
    const cloned: Timeframe = JSON.parse(JSON.stringify(clipboardTimeframe))
    cloned.id = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    cloned.startTime = beatPosition
    cloned.endTime = beatPosition + duration
    cloned.label = cloned.label.endsWith(' (copy)') ? cloned.label : `${cloned.label} (copy)`
    if (cloned.effects) {
      cloned.effects = cloned.effects.map(e => ({
        ...e,
        id: `${e.id}-${Math.random().toString(36).slice(2, 6)}`
      }))
    }
    setTimeframes(prev => [...prev, cloned])
    setFocusedTimeframeId(cloned.id)
    setClipboardTimeframe(null)
  }

  // ── Pattern-library curation (main settings page) ──
  useEffect(() => { try { localStorage.setItem('kivsee:patternsHiddenGlobal', JSON.stringify(globalHiddenPatterns)) } catch {} }, [globalHiddenPatterns])
  useEffect(() => { try { localStorage.setItem('kivsee:patternsImported', JSON.stringify(importedPatterns)) } catch {} }, [importedPatterns])
  const hidePatternForSong = (id: string) =>
    setSong((s) => ({ ...s, hiddenPatterns: Array.from(new Set([...(s.hiddenPatterns ?? []), id])) }))
  const restorePatternForSong = (id: string) =>
    setSong((s) => ({ ...s, hiddenPatterns: (s.hiddenPatterns ?? []).filter((x) => x !== id) }))
  const hidePatternGlobal = (id: string) =>
    setGlobalHiddenPatterns((prev) => (prev.includes(id) ? prev : [...prev, id]))
  const restorePatternGlobal = (id: string) =>
    setGlobalHiddenPatterns((prev) => prev.filter((x) => x !== id))
  const importPatterns = (patterns: ImportedPattern[]) => {
    setImportedPatterns((prev) => {
      const m = new Map(prev.map((p) => [p.id, p]))
      for (const p of patterns) m.set(p.id, p)
      return Array.from(m.values())
    })
    // Re-importing un-hides globally, so a removed pattern truly returns.
    const ids = new Set(patterns.map((p) => p.id))
    setGlobalHiddenPatterns((prev) => prev.filter((x) => !ids.has(x)))
  }
  /** The song's curated pattern set: all presets + imports, minus global & per-song hides.
   *  Drives both the settings-page grid and the Live Console pads. */
  const curatedPatterns = React.useMemo<PresetMetadata[]>(() => {
    const all: PresetMetadata[] = [...loadAllPresets(), ...importedPatterns]
    const hidden = new Set([...globalHiddenPatterns, ...(song.hiddenPatterns ?? [])])
    return all.filter((p) => !hidden.has(p.id))
  }, [importedPatterns, globalHiddenPatterns, song.hiddenPatterns])

  // Same list, but showing the name the user gave each pattern — for the Live Console rail.
  const libraryPads = React.useMemo<PresetMetadata[]>(
    () => curatedPatterns.map((p) => (patternEdits[p.id]?.name ? { ...p, displayName: patternEdits[p.id]!.name! } : p)),
    [curatedPatterns, patternEdits],
  )

  const addTimeframesFromPreset = (preset: PresetMetadata) => {
    const snappedBeat = Math.round(currentTime)
    const newTimeframes = presetToTimeframes(preset, snappedBeat, song.bpm)
      .filter(tf => tf.endTime <= songLengthBeats)
    if (newTimeframes.length > 0) {
      setTimeframes(prev => [...prev, ...newTimeframes])
      setFocusedTimeframeId(newTimeframes[0].id)
    }
  }


  /** Add/replace an animation in THIS SONG's animation set (upsert by name — so "save"
   *  replaces the existing one in place instead of piling up duplicates). */
  const upsertSongAnimation = (name: string, tfs: Timeframe[]) => {
    const nm = (name || '').trim() || 'animation'
    setSong((prev) => {
      const list = (prev.animations || []).filter((a) => a.name !== nm)
      return { ...prev, animations: [{ id: `anim-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, name: nm, timeframes: tfs }, ...list] }
    })
  }
  const removeSongAnimation = (id: string) => setSong((prev) => ({ ...prev, animations: (prev.animations || []).filter((a) => a.id !== id) }))

  // Playback controls
  const handlePlayPause = () => {
    const audio = audioRef.current
    const isSongWithAudio = song.animationType === 'song' && song.audioFilePath && audio

    if (isPlaying) {
      // Pause: stop playback; next Run will resume from current position
      if (isSongWithAudio) audio.pause()
      if (liveMode && apiBase) {
        fetch(`${apiBase}/api/stop`, { method: 'POST' }).catch((err) =>
          console.error('Live stop failed', err)
        )
      }
      setNextRunFromStart(false)
      setIsPlaying(false)
    } else {
      // Run: if spectrogram range is selected, play only that section; else if nextRunFromStart, jump to runStartTimeSeconds; otherwise resume from currentTime
      const range = spectrogramRangeRef.current
      const rangeStart = range ? Math.min(range.startSec, range.endSec) : 0
      const rangeEnd = range ? Math.max(range.startSec, range.endSec) : 0
      const useRange = range && rangeStart < rangeEnd
      let startSec: number
      if (useRange) {
        startSec = Math.max(0, rangeStart)
        playbackRangeEndSecRef.current = Math.max(startSec, rangeEnd)
        const startBeats = audioSecToBeats(startSec, song)
        setCurrentTime(Math.max(0, Math.min(songLengthBeats, startBeats)))
      } else {
        playbackRangeEndSecRef.current = null
        startSec = nextRunFromStart
          ? (song.runStartTimeSeconds ?? 0)
          : beatsToAudioSec(currentTime, song)
      }
      if (nextRunFromStart && !useRange) {
        const start = song.runStartTimeSeconds ?? 0
        const startBeats = audioSecToBeats(start, song)
        setCurrentTime(Math.max(0, Math.min(songLengthBeats, startBeats)))
        if (isSongWithAudio) {
          audio.currentTime = Math.max(0, start)
          audio.play().catch(() => {})
        }
        setNextRunFromStart(false)
      } else {
        if (isSongWithAudio) {
          audio.currentTime = Math.max(0, startSec)
          audio.play().catch(() => {})
        }
      }
      if (liveMode && apiBase) {
        const name = (song.name || 'sequence').trim() || 'sequence'
        if (song.animationType === 'trigger') {
          fetch(`${apiBase}/api/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggerName: name, startOffsetSeconds: startSec }),
          }).catch((err) => console.error('Live trigger failed', err))
        } else {
          fetch(`${apiBase}/api/start-song`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songName: name, startOffsetSeconds: startSec }),
          }).catch((err) => console.error('Live start-song failed', err))
        }
      }
      setIsPlaying(true)
    }
  }

  /** Sim-speed play/pause: same as handlePlayPause but marks useSimSpeed = true so speed applies. */
  const handleSimPlayPause = () => {
    if (!isPlaying) setUseSimSpeed(true)
    else if (useSimSpeed) setUseSimSpeed(false) // pausing sim play → clear flag
    handlePlayPause()
  }

  // Space bar toggles Run / Pause, Escape clears clipboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (e.code === 'Escape') {
        setClipboardTimeframe(null)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !inInput) {
        e.preventDefault()
        if (e.shiftKey) {
          redoTimeframes()
        } else {
          undoTimeframes()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY' && !inInput) {
        e.preventDefault()
        redoTimeframes()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && !inInput && focusedTimeframeId) {
        e.preventDefault()
        copyTimeframe(focusedTimeframeId)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !inInput && clipboardTimeframe) {
        e.preventDefault()
        pasteTimeframe(Math.round(currentTime))
        return
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && !inInput && selectedTimeframeIds.size > 0) {
        e.preventDefault()
        deleteSelectedTimeframes()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA' && !inInput) {
        e.preventDefault()
        setSelectedTimeframeIds(new Set(timeframes.map(tf => tf.id)))
        return
      }
      if (e.code === 'Space' && !e.repeat) {
        if (inInput) return
        e.preventDefault()
        handlePlayPause()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  // Sync mute state to audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muteAudio
  }, [muteAudio])

  // Clean up stale selection IDs after undo/redo/load
  useEffect(() => {
    const ids = new Set(timeframes.map(tf => tf.id))
    setSelectedTimeframeIds(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [timeframes])

  const handleStop = () => {
    const audio = audioRef.current
    const isSongWithAudio = song.animationType === 'song' && song.audioFilePath && audio
    if (isSongWithAudio) {
      audio.pause()
      audio.currentTime = Math.max(0, song.runStartTimeSeconds ?? 0)
    }
    if (liveMode && apiBase) {
      fetch(`${apiBase}/api/stop`, { method: 'POST' }).catch((err) =>
        console.error('Live stop failed', err)
      )
    }
    setIsPlaying(false)
    setUseSimSpeed(false)
    setNextRunFromStart(true) // Next Run will start from runStartTimeSeconds
    const startBeats = audioSecToBeats(song.runStartTimeSeconds ?? 0, song)
    const clamped = Math.max(0, Math.min(songLengthBeats, startBeats))
    setCurrentTime(clamped)
  }

  /** Write just the generated .ts to src/songs/ via the control server. No JSON export,
   *  no directory picker, no browser download — safe to call automatically (auto-send). */
  const saveTsToServer = async () => {
    if (!apiBase) return
    const safeName = (song.name || 'song').trim() || 'song'
    const tsCode = generateSequenceTs(song, timeframes)
    try {
      const resp = await fetch(`${apiBase}/api/save-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `src/songs/${safeName}.ts`, content: tsCode }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        console.error('Failed to save TS file via server:', err)
      }
    } catch (e) {
      console.warn('Control server unavailable, skipping TS save:', e)
    }
  }

  const handleSendSequence = async () => {
    if (!apiBase) {
      console.warn('No control server configured (set one in Settings); cannot send sequence')
      return
    }
    setSendSequenceLoading(true)
    try {
      // Write the TS to the server (NO JSON download), then execute the saved TS file
      await saveTsToServer()
      const safeName = (song.name || 'song').trim() || 'song'
      const filePath = `src/songs/${safeName}.ts`
      const res = await fetch(`${apiBase}/api/send-sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, sendOnly: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    } catch (err) {
      console.error('Send sequence failed', err)
    } finally {
      setSendSequenceLoading(false)
    }
  }

  const mergeBeatTimestamps = (arrays: number[][], dedupeMs = 20): number[] => {
    const combined = arrays.flat().sort((a, b) => a - b)
    if (combined.length === 0) return []
    const out: number[] = [combined[0]]
    for (let i = 1; i < combined.length; i++) {
      if (combined[i] - out[out.length - 1] > dedupeMs) out.push(combined[i])
    }
    return out
  }

  /** Props for numeric inputs: allow empty while editing, commit validated value on blur. */
  const numericInputProps = (
    field: string,
    modelValue: number,
    defaultVal: number,
    min: number,
    parseAs: 'int' | 'float',
    onCommit: (n: number) => void,
    max?: number
  ) => {
    const isEditing = numericEdit?.field === field
    const clamp = (n: number) => {
      const v = Math.max(min, n)
      return max != null ? Math.min(max, v) : v
    }
    return {
      value: isEditing ? numericEdit!.value : String(modelValue),
      onFocus: () => setNumericEdit({ field, value: String(modelValue) }),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setNumericEdit((prev) => (prev?.field === field ? { ...prev, value: e.target.value } : null)),
      onBlur: () => {
        if (numericEdit?.field !== field) return
        const raw = numericEdit.value.trim()
        const parsed = parseAs === 'int' ? parseInt(raw, 10) : parseFloat(raw)
        const num = raw === '' || isNaN(parsed) ? defaultVal : clamp(parsed)
        onCommit(num)
        setNumericEdit(null)
      },
    }
  }

  const handleDetectBeats = async () => {
    if (!apiBase || !song.audioFilePath?.trim()) return
    setDetectBeatsLoading(true)
    setDetectBeatsProgress(null)
    try {
      if (detectBeatsScope === 'full') {
        setDetectBeatsProgress('Detecting…')
        const res = await fetch(`${apiBase}/api/detect-beats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFilePath: song.audioFilePath,
            bpm: song.bpm || undefined,
            method: detectBeatsMethod,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.beatTimestampsMs && Array.isArray(data.beatTimestampsMs)) {
          handleSongChange({ beatTimestampsMs: data.beatTimestampsMs.map((ms: number) => Math.round(ms)) })
        }
      } else if (detectBeatsScope === 'range') {
        const startSec = Math.max(0, Math.min(rangeStartSec, song.lengthSeconds - 0.1))
        const endSec = Math.max(startSec + 0.1, Math.min(rangeEndSec, song.lengthSeconds))
        const startMs = startSec * 1000
        const endMs = endSec * 1000
        const inRange = (ms: number) => ms >= startMs && ms <= endMs
        const existing = song.beatTimestampsMs ?? []
        const kept = existing.filter((ms) => !inRange(ms))
        // Clear beats in range immediately so the spectrogram updates (green lines removed)
        handleSongChange({ beatTimestampsMs: kept.length ? kept : undefined })
        setDetectBeatsProgress('Detecting range…')
        const bpmForRange = typeof rangeBpm === 'number' && rangeBpm > 0 ? rangeBpm : (song.bpm || undefined)
        const res = await fetch(`${apiBase}/api/detect-beats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFilePath: song.audioFilePath,
            bpm: bpmForRange,
            method: detectBeatsMethod,
            startSec,
            endSec,
            fillGrid: rangeFillGrid,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.beatTimestampsMs && Array.isArray(data.beatTimestampsMs)) {
          const rounded = data.beatTimestampsMs.map((ms: number) => Math.round(ms))
          const merged = mergeBeatTimestamps([kept, rounded])
          handleSongChange({ beatTimestampsMs: merged.length ? merged : undefined })
        }
      }
    } catch (err) {
      console.error('Beat detection failed', err)
    } finally {
      setDetectBeatsLoading(false)
      setDetectBeatsProgress(null)
    }
  }

  const handleLoadTimeframes = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      try {
        const text = await file.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch (parseErr) {
          console.error('Failed to parse JSON', parseErr)
          alert('Invalid JSON file. Check the console for details.')
          return
        }
        if (!parsed || typeof parsed !== 'object') {
          alert('Invalid file: expected a JSON object or array.')
          return
        }

        // Support: raw array (timeframes only), { timeframes: [...] }, or { song, timeframes }
        const maybeArray = Array.isArray(parsed) ? parsed : (parsed as { timeframes?: unknown }).timeframes

        let loadedSong: Song | null = null
        if ((parsed as { song?: unknown }).song && typeof (parsed as { song: unknown }).song === 'object') {
          loadedSong = normalizeLoadedSong((parsed as { song: Record<string, unknown> }).song)
          setSong(loadedSong)
        }

        if (Array.isArray(maybeArray)) {
          const mapped: Timeframe[] = maybeArray
            .filter((item: any) => item && typeof item === 'object')
            .map((item: any, idx: number) => {
              const effects = Array.isArray(item.effects)
                ? item.effects
                    .filter((e: any) => e && typeof e === 'object' && typeof e.effectKey === 'string')
                    .map((e: any) => ({
                      id: e.id && typeof e.id === 'string' ? e.id : `eff-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
                      effectKey: e.effectKey,
                      params: e.params && typeof e.params === 'object' ? e.params as Record<string, number | boolean | object> : undefined,
                      phase: typeof e.phase === 'number' ? e.phase : undefined,
                    }))
                : undefined
              const legacy = {
                brightnessEffect: item.brightnessEffect,
                brightnessEffectParams: item.brightnessEffectParams && typeof item.brightnessEffectParams === 'object' ? item.brightnessEffectParams as Record<string, number | boolean> : undefined,
                hueEffect: item.hueEffect,
                hueEffectParams: item.hueEffectParams && typeof item.hueEffectParams === 'object' ? item.hueEffectParams as Record<string, number | boolean> : undefined,
                motionEffect: item.motionEffect,
                motionEffectParams: item.motionEffectParams && typeof item.motionEffectParams === 'object' ? item.motionEffectParams as Record<string, number | boolean> : undefined,
              }
              let startTime = Number(item.startTime)
              let endTime = Number(item.endTime)
              if (!Number.isFinite(startTime)) startTime = 0
              if (!Number.isFinite(endTime)) endTime = startTime + 4
              if (endTime <= startTime) endTime = startTime + 4
              let rings = Array.isArray(item.rings) ? item.rings.map((r: any) => Number(r)).filter((n: number) => !isNaN(n) && n >= 1 && n <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
              if (rings.length === 0) rings = [1]
              return {
                id: item.id?.toString() ?? `tf-${Date.now()}-${idx}`,
                startTime,
                endTime,
                label: typeof item.label === 'string' ? item.label : `Timeframe ${idx + 1}`,
                color: typeof item.color === 'string' ? item.color : '#3b82f6',
                hasExplicitColor: item.hasExplicitColor !== false ? undefined : false,
                rings,
                mapping: item.mapping,
                phase: typeof item.phase === 'number' ? item.phase : undefined,
                movement: normalizeMovement(item.movement),
                cycles: normalizeCycles(item.cycles),
                ...(effects && effects.length > 0 ? { effects } : legacy),
              }
            })
          setTimeframes(mapped)
        } else if (!(parsed as { song?: unknown }).song) {
          console.error('Invalid file format: expected array of timeframes or { song, timeframes }')
          alert('Invalid file format: expected array of timeframes or { song, timeframes }.')
          return
        }
        // If we have song but no timeframes array, leave timeframes unchanged

        setFocusedTimeframeId(null)
        // Place the marker at the saved "run from" time so reopening lands where
        // the next Run will start, rather than always snapping to beat 0.
        {
          const songForMarker = loadedSong ?? song
          const runFromSec = Math.max(0, songForMarker.runStartTimeSeconds ?? 0)
          setCurrentTime(audioSecToBeats(runFromSec, songForMarker))
        }

        // Restore window sizes if present (same min/max as resize logic)
        const minPlayback = 240
        const maxPlayback = 900
        const minDetails = 240
        const maxDetails = 600
        const minSpectrogram = 80
        const maxSpectrogram = 500
        const ws = (parsed as { windowSizes?: { playbackPanelWidth?: number; detailsPanelWidth?: number; spectrogramHeight?: number; headerHeight?: number } }).windowSizes
        if (ws && typeof ws === 'object') {
          if (typeof ws.playbackPanelWidth === 'number') {
            setPlaybackPanelWidth(Math.round(Math.min(maxPlayback, Math.max(minPlayback, ws.playbackPanelWidth))))
          }
          if (typeof ws.detailsPanelWidth === 'number') {
            setDetailsPanelWidth(Math.round(Math.min(maxDetails, Math.max(minDetails, ws.detailsPanelWidth))))
          }
          if (typeof ws.spectrogramHeight === 'number') {
            setSpectrogramHeight(Math.round(Math.min(maxSpectrogram, Math.max(minSpectrogram, ws.spectrogramHeight))))
          }
          if (typeof ws.headerHeight === 'number') {
            setHeaderHeight(Math.round(Math.min(120, Math.max(40, ws.headerHeight))))
          }
        }

        const spectrogramOpenVal = (parsed as { spectrogramOpen?: unknown }).spectrogramOpen
        if (typeof spectrogramOpenVal === 'boolean') {
          setSpectrogramOpen(spectrogramOpenVal)
        }

        const view = (parsed as { view?: { startBeat?: unknown; beatsPerScreen?: unknown } }).view
        if (view && typeof view === 'object' && typeof view.startBeat === 'number' && typeof view.beatsPerScreen === 'number') {
          setPendingView({ startBeat: view.startBeat, beatsPerScreen: view.beatsPerScreen, nonce: Date.now() })
        }

        const theme = (parsed as { theme?: unknown }).theme
        if (theme === 'light' || theme === 'dark') {
          setLightTheme(theme === 'light')
        } else {
          setLightTheme(false)
        }
      } catch (err) {
        console.error('Failed to load file', err)
        alert(`Failed to load file: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    input.click()
  }

  const handleImportTs = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ts'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      try {
        const songCode = await file.text()
        const res = await fetch(`${apiBase}/api/parse-song`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songCode, fileName: file.name }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

        // Save a backup of the original .ts before it gets overwritten on next save
        if (apiBase) {
          const baseName = file.name.replace(/\.ts$/, '')
          fetch(`${apiBase}/api/save-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: `src/songs/${baseName}.original.ts`, content: songCode }),
          }).catch(() => {})
        }

        if (data.song && typeof data.song === 'object') {
          const s = normalizeLoadedSong(data.song as Record<string, unknown>)
          setSong(s)
        }

        if (Array.isArray(data.timeframes)) {
          const mapped: Timeframe[] = data.timeframes
            .filter((item: any) => item && typeof item === 'object')
            .map((item: any, idx: number) => {
              const effects = Array.isArray(item.effects)
                ? item.effects
                    .filter((e: any) => e && typeof e === 'object' && typeof e.effectKey === 'string')
                    .map((e: any) => ({
                      id: e.id && typeof e.id === 'string' ? e.id : `eff-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
                      effectKey: e.effectKey,
                      params: e.params && typeof e.params === 'object' ? e.params as Record<string, number | boolean | object> : undefined,
                      phase: typeof e.phase === 'number' ? e.phase : undefined,
                    }))
                : undefined
              return {
                id: item.id?.toString() ?? `tf-${Date.now()}-${idx}`,
                startTime: Number(item.startTime) || 0,
                endTime: Number(item.endTime) || 0,
                label: typeof item.label === 'string' ? item.label : `Timeframe ${idx + 1}`,
                color: typeof item.color === 'string' ? item.color : '#3b82f6',
                hasExplicitColor: item.hasExplicitColor !== false ? undefined : false,
                rings: Array.isArray(item.rings) ? item.rings.map((r: any) => Number(r)).filter((n: number) => !isNaN(n)) : [1,2,3,4,5,6,7,8,9,10,11,12],
                mapping: item.mapping,
                phase: typeof item.phase === 'number' ? item.phase : undefined,
                movement: normalizeMovement(item.movement),
                cycles: normalizeCycles(item.cycles),
                ...(effects && effects.length > 0 ? { effects } : {}),
              }
            })
          setTimeframes(mapped)
        }

        setFocusedTimeframeId(null)
        setCurrentTime(0)
      } catch (err) {
        console.error('Failed to import .ts song file', err)
        alert(`Import failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    input.click()
  }
  const handleSaveTimeframes = async () => {
    const payload = {
      song,
      timeframes: timeframes.map(tf => {
        const effects = tf.effects?.filter(e => e.effectKey !== '')
        return {
          ...tf,
          effects: effects && effects.length > 0 ? effects : undefined,
        }
      }),
      windowSizes: {
        playbackPanelWidth,
        detailsPanelWidth,
        spectrogramHeight,
        headerHeight,
      },
      spectrogramOpen,
      view: { startBeat: Math.round(viewStartBeat * 100) / 100, beatsPerScreen },
      theme: lightTheme ? 'light' : 'dark',
    }
    const dataStr = JSON.stringify(payload, null, 2)
    const safeName = (song.name || 'song').trim() || 'song'

    const downloadFile = (content: string, filename: string, mimeType: string) => {
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }

    // Save JSON: let user pick folder (or download as fallback)
    const anyWindow = window as any
    if (anyWindow.showDirectoryPicker) {
      try {
        let dirHandle = savedDirHandleRef.current
        if (dirHandle) {
          const perm = await dirHandle.queryPermission({ mode: 'readwrite' })
          if (perm !== 'granted') {
            const requested = await dirHandle.requestPermission({ mode: 'readwrite' })
            if (requested !== 'granted') dirHandle = null
          }
        }
        if (!dirHandle) {
          dirHandle = await anyWindow.showDirectoryPicker({ mode: 'readwrite' })
        }
        savedDirHandleRef.current = dirHandle
        const jsonFile = await dirHandle.getFileHandle(`${safeName}.json`, { create: true })
        const jsonWritable = await jsonFile.createWritable()
        await jsonWritable.write(dataStr)
        await jsonWritable.close()
      } catch {
        // User cancelled or error – fall back to download
        downloadFile(dataStr, `${safeName}.json`, 'application/json')
      }
    } else {
      downloadFile(dataStr, `${safeName}.json`, 'application/json')
    }

    // Save TS to src/songs/ via control-server (server-only, no download)
    await saveTsToServer()
  }

  // Normalize loaded song to use lengthSeconds/runStartTimeSeconds (support old lengthBeats/runStartTimeBeats)
  const normalizeLoadedSong = (s: Record<string, unknown>): Song => {
    const bpm = Math.max(1, Number(s.bpm) || 120)
    const lengthSeconds =
      s.lengthSeconds != null
        ? Math.max(0.1, Number(s.lengthSeconds))
        : (Math.max(1, Number(s.lengthBeats) || 64) / bpm) * 60
    const runStartTimeSeconds =
      s.runStartTimeSeconds != null
        ? Math.max(0, Number(s.runStartTimeSeconds))
        : s.runStartTimeBeats != null
          ? (Number(s.runStartTimeBeats) / bpm) * 60
          : undefined
    return {
      name: typeof s.name === 'string' ? s.name : 'New Song',
      lengthSeconds,
      bpm,
      startOffsetMs: Math.max(0, Number(s.startOffsetMs) || 0),
      runStartTimeSeconds,
      animationType: (s.animationType === 'trigger' ? 'trigger' : 'song') as AnimationType,
      audioFilePath: typeof s.audioFilePath === 'string' ? s.audioFilePath : undefined,
      beatTimestampsMs: Array.isArray(s.beatTimestampsMs) ? s.beatTimestampsMs as number[] : undefined,
      librarySlug: typeof s.librarySlug === 'string' ? s.librarySlug : undefined,
      sectionLines: Array.isArray(s.sectionLines) ? (s.sectionLines as number[]).filter((n) => typeof n === 'number') : undefined,
      hiddenPatterns: Array.isArray(s.hiddenPatterns) ? (s.hiddenPatterns as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
      animations: Array.isArray(s.animations) ? (s.animations as Song['animations']) : undefined,
      lilumRings: Array.isArray(s.lilumRings)
        ? (s.lilumRings as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 12)
        : undefined,
    }
  }

  const loadCategoryPreview = (
    payload: { song: Record<string, unknown>; timeframes: unknown[] },
    opts?: { librarySlug?: string; suppressAutosave?: boolean },
  ) => {
    const incoming = normalizeLoadedSong(payload.song)
    // Preserve the current library association + audio when the incoming payload omits them
    // (e.g. a fresh Compose result carries no librarySlug — it's still the same song).
    const s: Song = { ...incoming }
    if (opts?.librarySlug) s.librarySlug = opts.librarySlug
    else if (!s.librarySlug) s.librarySlug = song.librarySlug
    if (!s.audioFilePath) s.audioFilePath = song.audioFilePath
    if (!s.beatTimestampsMs) s.beatTimestampsMs = song.beatTimestampsMs
    setSong(s)
    const mapped: Timeframe[] = (payload.timeframes as any[])
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any, idx: number) => {
        const effects = Array.isArray(item.effects)
          ? item.effects
              .filter((e: any) => e && typeof e === 'object' && typeof e.effectKey === 'string')
              .map((e: any) => ({
                id: e.id && typeof e.id === 'string' ? e.id : `eff-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
                effectKey: e.effectKey,
                params: e.params && typeof e.params === 'object' ? e.params as Record<string, number | boolean | object> : undefined,
                phase: typeof e.phase === 'number' ? e.phase : undefined,
              }))
          : undefined
        let startTime = Number(item.startTime)
        let endTime = Number(item.endTime)
        if (!Number.isFinite(startTime)) startTime = 0
        if (!Number.isFinite(endTime)) endTime = startTime + 4
        if (endTime <= startTime) endTime = startTime + 4
        let rings = Array.isArray(item.rings) ? item.rings.map((r: any) => Number(r)).filter((n: number) => !isNaN(n) && n >= 1 && n <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        if (rings.length === 0) rings = [1]
        return {
          id: item.id?.toString() ?? `tf-${Date.now()}-${idx}`,
          startTime,
          endTime,
          label: typeof item.label === 'string' ? item.label : `Timeframe ${idx + 1}`,
          color: typeof item.color === 'string' ? item.color : '#3b82f6',
          hasExplicitColor: item.hasExplicitColor !== false ? undefined : false,
          rings,
          mapping: item.mapping,
          phase: typeof item.phase === 'number' ? item.phase : undefined,
          movement: normalizeMovement(item.movement),
          cycles: normalizeCycles(item.cycles),
          ...(effects && effects.length > 0 ? { effects } : {}),
          ...(typeof item._section === 'number' ? { _section: item._section } : {}),
          ...(typeof item._source === 'string' ? { _source: item._source } : {}),
        } as Timeframe
      })
    setTimeframes(mapped)
    setFocusedTimeframeId(null)
    setCurrentTime(0)
    // When loading an already-saved working timeline, prime the autosave baseline so we
    // don't immediately re-write identical data back to the library.
    if (opts?.suppressAutosave) {
      lastSavedWorkingRef.current = stableWorkingJson(s, mapped)
    }
  }

  // ── Cloud song library ────────────────────────────────────────────────────
  const metaSnapshot = (s: Song) =>
    JSON.stringify([s.name, s.bpm, s.lengthSeconds, s.startOffsetMs, s.animationType, s.audioFilePath, s.beatTimestampsMs?.length])

  /** Fetch an audio URL (or the resolved current source) as base64 for upload to the library. */
  const fetchAudioBase64 = async (url?: string): Promise<{ base64: string; contentType: string } | null> => {
    const src = url || effectiveAudioSrc || audioBlobUrlRef.current || ''
    if (!src) return null
    try {
      const resp = await fetch(src)
      if (!resp.ok) return null
      const blob = await resp.blob()
      if (blob.size === 0) return null
      return { base64: await fileToBase64(blob), contentType: blob.type || 'audio/mpeg' }
    } catch {
      return null
    }
  }

  /** Ensure a song exists in the library (creating + uploading audio on first save).
   *  Returns its slug. Reads from `songOverride` when given so it isn't bitten by stale state. */
  const ensureSongInLibrary = async (opts?: {
    analysis?: unknown
    forceAudio?: boolean
    songOverride?: Song
    audioUrl?: string
  }): Promise<string | null> => {
    const s = opts?.songOverride ?? song
    const name = s.name?.trim() || 'Untitled'
    setLibrarySaveState('saving')
    try {
      const existingSlug = s.librarySlug
      let audio: { base64: string; contentType: string } | null = null
      if (!existingSlug || opts?.forceAudio) audio = await fetchAudioBase64(opts?.audioUrl)
      const res = await library.saveSong({
        slug: existingSlug,
        name,
        bpm: s.bpm,
        lengthSeconds: s.lengthSeconds,
        startOffsetMs: s.startOffsetMs,
        animationType: s.animationType,
        audioFilename: s.audioFilePath || (audio ? `${name}.mp3` : undefined),
        audioBase64: audio?.base64,
        audioContentType: audio?.contentType,
        beatTimestampsMs: s.beatTimestampsMs,
        analysis: opts?.analysis,
      }, projectId)
      const slug = res.slug
      if (slug !== existingSlug) setSong((prev) => ({ ...prev, librarySlug: slug }))
      lastSavedMetaRef.current = metaSnapshot({ ...s, librarySlug: slug })
      setLibrarySaveState('saved')
      return slug
    } catch (e) {
      console.warn('ensureSongInLibrary failed', e)
      setLibrarySaveState('error')
      return null
    }
  }

  /** Called by ComposePanel after a successful analyze: park the song + its analysis in the library. */
  const handleComposeAnalyzed = (analysis: unknown, audioPath: string) => {
    lastAnalysisRef.current = analysis
    const beatTimestampsMs = (analysis as { beatTimestampsMs?: number[] })?.beatTimestampsMs
    const bpm = (analysis as { bpmGlobal?: number })?.bpmGlobal
    // Align the app's song with what was actually analyzed, then archive THAT (no stale state).
    const merged: Song = { ...song }
    if (audioPath && audioPath !== song.audioFilePath) {
      merged.audioFilePath = audioPath
      if (!song.name || song.name === 'New Song') merged.name = audioPath.replace(/\.[^.]+$/, '').replace(/^.*[\\/]/, '')
    }
    if (Array.isArray(beatTimestampsMs) && beatTimestampsMs.length) merged.beatTimestampsMs = beatTimestampsMs
    if (typeof bpm === 'number' && bpm > 0) merged.bpm = bpm
    setSong(merged)
    const audioUrl = audioPath && apiBase ? `${apiBase}/api/audio?path=${encodeURIComponent(audioPath)}` : undefined
    void ensureSongInLibrary({ analysis, songOverride: merged, audioUrl })
  }

  /** Build a sections[] array from custom section-line beats (for Recompose). Each region
   *  inherits the label of the analysis section under its midpoint, so taste rules still apply. */
  const buildCustomSections = (analysis: any, lines: number[]): any[] => {
    const orig: any[] = analysis?.sections || []
    const bounds = [0, ...lines.filter((b) => b > 0 && b < songLengthBeats), songLengthBeats].sort((a, b) => a - b)
    const uniq = [...new Set(bounds.map((b) => Math.round(b)))]
    const defSummary = orig[0]?.summary || { energy: 0.5, energyAbs: 0, onsetDensity: 0, spectralCentroid: 0, bandEnergy: { sub: 0, low: 0, mid: 0, high: 0 } }
    const out: any[] = []
    for (let i = 0; i < uniq.length - 1; i++) {
      const sB = uniq[i], eB = uniq[i + 1]
      if (eB <= sB) continue
      const startMs = Math.round(beatsToAudioSec(sB, song) * 1000)
      const endMs = Math.round(beatsToAudioSec(eB, song) * 1000)
      const midMs = (startMs + endMs) / 2
      const host = orig.find((s) => midMs >= s.startMs && midMs < s.endMs)
      out.push({ startMs, endMs, label: host?.label || 'verse', confidence: 1, bpm: analysis?.bpmGlobal || song.bpm, summary: host?.summary || defSummary })
    }
    return out
  }

  /** Regenerate the whole composition from the cached/library analysis (used by the Live Console).
   *  When custom section lines exist, regenerate against THOSE boundaries. */
  /** Client-side recompose: tile the song's OWN animations across its sections
   *  (custom section lines if set, else the analysis sections). No server needed. */
  // Compose the song from the WHOLE pattern library (all named patterns, minus hidden):
  // split into sections (custom lines or analysis), assign a DIFFERENT pattern to each part
  // (avoiding back-to-back repeats) and tile it across that part. This is the default compose.
  const recomposeFromLibrary = (): boolean => {
    const pool = curatedPatterns
    if (!pool.length) return false
    let ranges: [number, number][] = []
    const lines = (song.sectionLines || []).filter((b) => b > 0 && b < songLengthBeats).sort((a, b) => a - b)
    if (lines.length) {
      const bounds = [0, ...lines, songLengthBeats]
      for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] > bounds[i]) ranges.push([bounds[i], bounds[i + 1]])
    } else {
      const secs = (lastAnalysisRef.current as { sections?: { startMs: number; endMs: number }[] } | null)?.sections
      if (Array.isArray(secs) && secs.length) {
        ranges = secs.map((sec) => [audioSecToBeats(sec.startMs / 1000, song), audioSecToBeats(sec.endMs / 1000, song)] as [number, number]).filter(([a, b]) => b > a)
      }
    }
    if (!ranges.length) ranges = [[0, songLengthBeats]]
    const out: Timeframe[] = []
    let prevId: string | null = null
    ranges.forEach(([s, e], idx) => {
      // A DIFFERENT pattern per part — pick at random but never repeat the previous section's.
      let choices = pool.filter((p) => p.id !== prevId)
      if (!choices.length) choices = pool
      const preset = choices[Math.floor(Math.random() * choices.length)]
      prevId = preset.id
      const edit = patternEdits[preset.id] ?? {}
      const tfs = editedTimeframes(presetToTimeframes(preset, 0, song.bpm), edit.speed ?? 1, edit.paletteId ?? 'original')
      if (!tfs.length) return
      const name = edit.name ?? preset.displayName
      const min = Math.min(...tfs.map((t) => t.startTime))
      const max = Math.max(...tfs.map((t) => t.endTime))
      const len = Math.max(0.5, max - min)
      let r = 0
      while (s + r * len < e - 0.01 && r < 256) {
        const offset = s + r * len - min
        for (const t of tfs) {
          const st = +(t.startTime + offset).toFixed(3)
          const en = Math.min(e, +(t.endTime + offset).toFixed(3))
          if (en > st && st < songLengthBeats) out.push({ ...t, id: `rc-${idx}-${r}-${out.length}`, startTime: st, endTime: en, _section: idx, _source: `lib:seg ${idx + 1}:${name}` })
        }
        r++
      }
    })
    if (out.length) { setTimeframes(out); setFocusedTimeframeId(null); setCurrentTime(0) }
    return true
  }

  const recomposeCurrent = async () => {
    // Default: build the song from the whole pattern library, a different pattern per section.
    if (recomposeFromLibrary()) return
    if (!apiBase) { window.alert('Control server is not running.'); return }
    let analysis = lastAnalysisRef.current
    if (!analysis && song.librarySlug) {
      try { analysis = await library.getAnalysis(song.librarySlug, projectId) } catch {}
    }
    if (!analysis) { window.alert('No analysis yet — open 🎵 Compose and Analyze the song first.'); return }
    const lines = song.sectionLines
    const a = lines && lines.length ? { ...analysis, sections: buildCustomSections(analysis, lines) } : analysis
    try {
      const r = await fetch(`${apiBase}/api/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis: a, useLlm: true }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as any).error || `translate ${r.status}`) }
      const result = await r.json()
      loadCategoryPreview(result, { librarySlug: song.librarySlug })
    } catch (e) {
      window.alert('Recompose failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Build the energy/band strip for the Live Console from the cached/library analysis.
  useEffect(() => {
    if (!showLiveConsole) return
    let cancelled = false
    ;(async () => {
      let a: any = lastAnalysisRef.current
      if (!a && song.librarySlug) { try { a = await library.getAnalysis(song.librarySlug, projectId) } catch {} }
      const c = a?.curves
      if (!c?.timeMs?.length || !c.energy?.length) { if (!cancelled) setLiveStrip(null); return }
      const n = c.timeMs.length
      const step = Math.max(1, Math.floor(n / 320))
      const beats: number[] = [], energy: number[] = [], sub: number[] = [], low: number[] = [], mid: number[] = [], high: number[] = []
      for (let i = 0; i < n; i += step) {
        beats.push(audioSecToBeats(c.timeMs[i] / 1000, song))
        energy.push(c.energy[i] ?? 0)
        sub.push(c.bandEnergy?.sub?.[i] ?? 0)
        low.push(c.bandEnergy?.low?.[i] ?? 0)
        mid.push(c.bandEnergy?.mid?.[i] ?? 0)
        high.push(c.bandEnergy?.high?.[i] ?? 0)
      }
      if (!cancelled) setLiveStrip({ beats, energy, sub, low, mid, high })
    })()
    return () => { cancelled = true }
  }, [showLiveConsole, song.librarySlug])

  /** Save the current timeline as a named animation snapshot. */
  const saveCurrentAnimation = async () => {
    const name = window.prompt('Name this animation:', `${song.name || 'animation'} ${new Date().toTimeString().slice(0, 5)}`)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    setLibrarySaveState('saving')
    try {
      let slug = song.librarySlug
      if (!slug) slug = (await ensureSongInLibrary({ forceAudio: true })) || undefined
      if (!slug) throw new Error('Could not create the song entry')
      await library.saveComposition({
        slug,
        name: trimmed,
        method: 'manual',
        song: cleanSongForLibrary(song),
        timeframes,
      }, projectId)
      setLibrarySaveState('saved')
    } catch (e) {
      setLibrarySaveState('error')
      window.alert('Save animation failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  /** Load a saved composition (working timeline or a named animation) from the library. */
  const loadCompositionFromLibrary = async (slug: string, comp: string) => {
    // "fresh" — open a song that has no saved working timeline yet: load its meta
    // (name/bpm/length/audio) into an empty timeline so it can be worked on from scratch.
    if (comp === 'fresh') {
      const m = (await library.getSong(slug, projectId)).meta
      loadCategoryPreview({
        song: {
          name: m?.name, bpm: m?.bpm, lengthSeconds: m?.lengthSeconds,
          startOffsetMs: m?.startOffsetMs, animationType: m?.animationType,
          audioFilePath: m?.audioFilename, beatTimestampsMs: m?.beatTimestampsMs,
          librarySlug: slug,
        },
        timeframes: [],
      }, { librarySlug: slug, suppressAutosave: true })
      setCurrentBranch('main')
      setHeadVerId(null)
      return
    }
    const payload = await library.getComposition(slug, comp, projectId)
    loadCategoryPreview(payload as { song: Record<string, unknown>; timeframes: unknown[] }, {
      librarySlug: slug,
      suppressAutosave: comp === 'working',
    })
    if (comp === 'working') {
      // The working buffer records the branch + HEAD it descends from — restore that context.
      setCurrentBranch(typeof payload.branch === 'string' ? payload.branch : 'main')
      setHeadVerId(typeof payload.headVerId === 'string' ? payload.headVerId : null)
    }
  }

  // Manual save only. The working timeline no longer auto-saves to the cloud on every
  // keystroke (it overwrote constantly and was hard to trust). localStorage still mirrors
  // the working state locally so a reload restores it; the cloud is written only by an
  // explicit Save / branch, which records an immutable version in the song's history.

  /** Persist song meta to the library when it changed (best-effort, alongside a Save). */
  const persistSongMeta = async (slug: string) => {
    const metaSnap = metaSnapshot(song)
    if (metaSnap === lastSavedMetaRef.current) return
    try {
      await library.saveSong({
        slug, name: song.name, bpm: song.bpm, lengthSeconds: song.lengthSeconds,
        startOffsetMs: song.startOffsetMs, animationType: song.animationType,
        audioFilename: song.audioFilePath, beatTimestampsMs: song.beatTimestampsMs,
      }, projectId)
      lastSavedMetaRef.current = metaSnap
    } catch (e) {
      console.warn('meta save failed', e)
    }
  }

  /** Save the current timeline as a new immutable version on the current branch. */
  const saveVersion = async (label?: string): Promise<string | null> => {
    setLibrarySaveState('saving')
    try {
      let slug = song.librarySlug
      if (!slug) slug = (await ensureSongInLibrary({ forceAudio: true })) || undefined
      if (!slug) throw new Error('Could not create the song entry')
      const res = await library.saveVersion({
        slug, song: cleanSongForLibrary(song), timeframes,
        parentId: headVerId, branch: currentBranch, label: label?.trim() || undefined,
      }, projectId)
      await persistSongMeta(slug)
      setHeadVerId(res.id)
      setCurrentBranch(res.branch || currentBranch)
      lastSavedWorkingRef.current = stableWorkingJson(song, timeframes)
      setLibrarySaveState('saved')
      return res.id
    } catch (e) {
      console.warn('saveVersion failed', e)
      setLibrarySaveState('error')
      window.alert('Save failed: ' + (e instanceof Error ? e.message : String(e)))
      return null
    }
  }

  /** Load a version's timeline back into the workspace; HEAD + branch follow it. */
  const loadVersion = async (id: string) => {
    const slug = song.librarySlug
    if (!slug) return
    const v = await library.getVersion(slug, id, projectId)
    loadCategoryPreview(v as { song: Record<string, unknown>; timeframes: unknown[] }, { librarySlug: slug, suppressAutosave: true })
    setHeadVerId(v.id)
    setCurrentBranch(v.branch || 'main')
  }

  /** Branch off an existing version: check it out and switch to a new branch name. The
   *  next Save commits there with that version as its parent. */
  const branchFromVersion = async (id: string, name: string) => {
    const slug = song.librarySlug
    if (!slug) return
    const branch = name.trim()
    if (!branch) return
    const v = await library.getVersion(slug, id, projectId)
    loadCategoryPreview(v as { song: Record<string, unknown>; timeframes: unknown[] }, { librarySlug: slug, suppressAutosave: true })
    setHeadVerId(id)
    setCurrentBranch(branch)
  }

  // While the Live Console is open, push the (edited) sequence to the LEDs automatically,
  // debounced so rapid live tweaks coalesce into one send.
  useEffect(() => {
    if (!showLiveConsole || !apiBase || !controlServerAvailable) return
    if (liveSendTimerRef.current) clearTimeout(liveSendTimerRef.current)
    liveSendTimerRef.current = setTimeout(() => { void handleSendSequence() }, 700)
    return () => {
      if (liveSendTimerRef.current) clearTimeout(liveSendTimerRef.current)
    }
  }, [timeframes, showLiveConsole])

  /** Surgically replace one analyzed section's timeframes in the LIVE timeline,
   *  preserving manual edits to other sections (used by the Compose per-part reroll). */
  const replaceSection = (sectionIdx: number, rawTimeframes: unknown[]) => {
    const mapped: Timeframe[] = (rawTimeframes as any[])
      .filter((item) => item && typeof item === 'object')
      .map((item: any, idx: number) => {
        const effects = Array.isArray(item.effects)
          ? item.effects.filter((e: any) => e && typeof e.effectKey === 'string').map((e: any) => ({
              id: typeof e.id === 'string' ? e.id : `eff-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
              effectKey: e.effectKey,
              params: e.params && typeof e.params === 'object' ? e.params : undefined,
              phase: typeof e.phase === 'number' ? e.phase : undefined,
            }))
          : undefined
        let startTime = Number(item.startTime); let endTime = Number(item.endTime)
        if (!Number.isFinite(startTime)) startTime = 0
        if (!Number.isFinite(endTime) || endTime <= startTime) endTime = startTime + 4
        let rings = Array.isArray(item.rings) ? item.rings.map((r: any) => Number(r)).filter((n: number) => n >= 1 && n <= 12) : [...Array(12)].map((_, i) => i + 1)
        if (rings.length === 0) rings = [1]
        return {
          id: item.id?.toString() ?? `tf-${Date.now()}-${idx}`,
          startTime, endTime,
          label: typeof item.label === 'string' ? item.label : `Timeframe ${idx + 1}`,
          color: typeof item.color === 'string' ? item.color : '#3b82f6',
          hasExplicitColor: item.hasExplicitColor !== false ? undefined : false,
          rings, mapping: item.mapping,
          cycles: normalizeCycles(item.cycles),
          ...(effects && effects.length > 0 ? { effects } : {}),
          _section: sectionIdx,
          ...(typeof item._source === 'string' ? { _source: item._source } : {}),
        } as Timeframe
      })
    // Keep manual edits in this section sacred; only replace the auto-generated ones.
    setTimeframes(prev => [...prev.filter(t => t._section !== sectionIdx || t._source === 'manual'), ...mapped].sort((a, b) => a.startTime - b.startTime))
    setFocusedTimeframeId(null)
  }

  // Autoload last song and window sizes on startup
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_SONG_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        song?: Record<string, unknown>
        timeframes?: Timeframe[]
        currentBranch?: string
        headVerId?: string | null
        windowSizes?: { playbackPanelWidth?: number; detailsPanelWidth?: number; spectrogramHeight?: number }
        spectrogramOpen?: boolean
        view?: { startBeat?: number; beatsPerScreen?: number }
      }
      // When the project/song shell drives what to open (initialLoad), skip restoring the
      // last local song here — the initial-load effect below opens the chosen song instead.
      // Window sizes / view / spectrogram prefs are still restored unconditionally.
      if (!initialLoad) {
        let restoredSong: Song | null = null
        if (parsed.song && typeof parsed.song === 'object') {
          restoredSong = normalizeLoadedSong(parsed.song)
          setSong(restoredSong)
          setCurrentTime(audioSecToBeats(Math.max(0, restoredSong.runStartTimeSeconds ?? 0), restoredSong))
        }
        if (parsed.timeframes && Array.isArray(parsed.timeframes) && parsed.timeframes.length > 0) {
          setTimeframes(parsed.timeframes)
        }
        if (typeof parsed.currentBranch === 'string') setCurrentBranch(parsed.currentBranch)
        if (typeof parsed.headVerId === 'string') setHeadVerId(parsed.headVerId)
        // If the restored song is a library song, prime the autosave baseline so we don't
        // immediately re-write the (unchanged) working timeline to the cloud on every load.
        if (restoredSong?.librarySlug) {
          lastSavedWorkingRef.current = stableWorkingJson(restoredSong, (parsed.timeframes as Timeframe[]) || [])
          lastSavedMetaRef.current = metaSnapshot(restoredSong)
        }
      }
      const minPlayback = 240, maxPlayback = 900, minDetails = 240, maxDetails = 600, minSpectrogram = 80, maxSpectrogram = 500
      const ws = parsed.windowSizes
      if (ws && typeof ws === 'object') {
        if (typeof ws.playbackPanelWidth === 'number') {
          setPlaybackPanelWidth(Math.round(Math.min(maxPlayback, Math.max(minPlayback, ws.playbackPanelWidth))))
        }
        if (typeof ws.detailsPanelWidth === 'number') {
          setDetailsPanelWidth(Math.round(Math.min(maxDetails, Math.max(minDetails, ws.detailsPanelWidth))))
        }
        if (typeof (ws as Record<string, unknown>).headerHeight === 'number') {
          setHeaderHeight(Math.round(Math.min(120, Math.max(40, (ws as Record<string, unknown>).headerHeight as number))))
        }
        if (typeof ws.spectrogramHeight === 'number') {
          setSpectrogramHeight(Math.round(Math.min(maxSpectrogram, Math.max(minSpectrogram, ws.spectrogramHeight))))
        }
      }
      if (typeof parsed.spectrogramOpen === 'boolean') {
        setSpectrogramOpen(parsed.spectrogramOpen)
      }
      if (parsed.view && typeof parsed.view.startBeat === 'number' && typeof parsed.view.beatsPerScreen === 'number') {
        setPendingView({ startBeat: parsed.view.startBeat, beatsPerScreen: parsed.view.beatsPerScreen, nonce: Date.now() })
      }
    } catch {
      // Ignore corrupted data
    } finally {
      // When the shell drives the open (initialLoad), the initial-load effect below flips this
      // once it has actually applied the chosen song — so a failed load can't let the persist
      // effect overwrite the local working mirror with a blank timeline.
      if (!initialLoad) hasLoadedInitialStateRef.current = true
    }
  }, [])

  // Shell-driven initial open: when the project/song picker chose a song (or "new"), open it
  // on mount, overriding the local last-session restore above. App is remounted (keyed) per
  // open, so this runs once for each chosen song.
  useEffect(() => {
    if (initialLoad === undefined || initialLoad === null) return
    const markLoaded = () => { hasLoadedInitialStateRef.current = true }
    if (initialLoad === 'new') {
      setSong({ name: 'New Song', lengthSeconds: 32, bpm: 120, startOffsetMs: 0, animationType: 'song' })
      setTimeframes([])
      setCurrentBranch('main')
      setHeadVerId(null)
      setCurrentTime(0)
      markLoaded()
      return
    }
    const { slug, comp } = initialLoad
    // Prefer the local working mirror when it's for this exact song: the cloud working buffer
    // only updates on Save, so the mirror (written on every edit by the persist effect below)
    // is what makes uncommitted edits survive a reload or a Songs→reopen round-trip. A named
    // composition is always an explicit choice, so it always loads from the cloud.
    if (comp === 'working' || comp === 'fresh') {
      try {
        const raw = window.localStorage.getItem(LAST_SONG_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { song?: Record<string, unknown>; timeframes?: Timeframe[]; currentBranch?: string; headVerId?: string | null }
          if (parsed?.song && (parsed.song as { librarySlug?: string }).librarySlug === slug && Array.isArray(parsed.timeframes) && parsed.timeframes.length > 0) {
            const restored = normalizeLoadedSong(parsed.song)
            setSong(restored)
            setTimeframes(parsed.timeframes)
            if (typeof parsed.currentBranch === 'string') setCurrentBranch(parsed.currentBranch)
            if (typeof parsed.headVerId === 'string') setHeadVerId(parsed.headVerId)
            lastSavedWorkingRef.current = stableWorkingJson(restored, parsed.timeframes)
            setCurrentTime(audioSecToBeats(Math.max(0, restored.runStartTimeSeconds ?? 0), restored))
            markLoaded()
            return
          }
        }
      } catch {}
    }
    // Otherwise load from the cloud. On failure, warn and bounce back to the song list — leaving
    // hasLoaded false so the persist effect can't overwrite the local mirror with a blank.
    loadCompositionFromLibrary(slug, comp)
      .then(markLoaded)
      .catch((e) => {
        window.alert('Failed to open song: ' + (e instanceof Error ? e.message : String(e)))
        onExitToSongs?.()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Back to the song list. The working timeline no longer auto-saves to the cloud, and opening
   *  a *different* song overwrites the local mirror — so warn before leaving with uncommitted
   *  edits. Reopening the SAME song still restores them (mirror-prefer above). */
  const exitToSongs = () => {
    if (!onExitToSongs) return
    const dirty = timeframes.length > 0 && stableWorkingJson(song, timeframes) !== lastSavedWorkingRef.current
    if (dirty && !window.confirm('You have unsaved timeline changes. Opening a different song will discard them — use 💾 Save / 🕘 History to keep them. Leave anyway?')) return
    onExitToSongs()
  }

  // Persist last worked-on song, timeframes, and window sizes;
  // only after we've attempted to load any existing data.
  useEffect(() => {
    if (!hasLoadedInitialStateRef.current) return
    try {
      const payload = JSON.stringify({
        song,
        timeframes,
        currentBranch,
        headVerId,
        windowSizes: { playbackPanelWidth, detailsPanelWidth, spectrogramHeight, headerHeight },
        spectrogramOpen,
        view: { startBeat: Math.round(viewStartBeat * 100) / 100, beatsPerScreen },
      })
      window.localStorage.setItem(LAST_SONG_STORAGE_KEY, payload)
    } catch {
      // Ignore persistence errors
    }
  }, [song, timeframes, currentBranch, headVerId, playbackPanelWidth, detailsPanelWidth, spectrogramHeight, headerHeight, spectrogramOpen, viewStartBeat, beatsPerScreen])

  // Layered audio resolution: Vite public → control-server → prompt user to upload
  const resolveAudioSrc = React.useCallback(async (audioFilePath: string) => {
    if (!audioFilePath) return ''
    // If we have a blob URL, use it directly
    if (audioBlobUrlRef.current) return audioBlobUrlRef.current
    // 1. Try Vite public dir (no server needed — serves ui/public/ at root in dev)
    try {
      const publicResp = await fetch(`/${encodeURIComponent(audioFilePath)}`, { method: 'HEAD' })
      if (publicResp.ok) return `/${encodeURIComponent(audioFilePath)}`
    } catch {}
    // 2. Try control-server
    if (apiBase) {
      try {
        const serverUrl = `${apiBase}/api/audio?path=${encodeURIComponent(audioFilePath)}`
        const serverResp = await fetch(serverUrl, { method: 'HEAD' })
        if (serverResp.ok) return serverUrl
      } catch {}
    }
    // 3. Reuse a previously-picked local file via its remembered handle (no server, no re-prompt)
    const reuse = await tryReuseHandle(audioFilePath)
    if (reuse && reuse.status === 'resolved') {
      const blobUrl = URL.createObjectURL(reuse.file)
      audioBlobUrlRef.current = blobUrl
      setAudioReconnectHandle(null)
      return blobUrl
    }
    if (reuse && reuse.status === 'needs-permission') {
      // Permission must be re-granted from a user gesture; surface a "Reconnect" button instead of prompting here.
      setAudioReconnectHandle(reuse.handle)
      return ''
    }
    // 4. Prompt user to select the file
    return new Promise<string>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.wav,.mp3,audio/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve(''); return }
        if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
        const blobUrl = URL.createObjectURL(file)
        audioBlobUrlRef.current = blobUrl
        if (audioRef.current) audioRef.current.src = blobUrl
        void putAudio(audioFilePath, file) // cache so it re-opens on next launch
        // Upload to ui/public/ via control-server if available
        if (apiBase) {
          try {
            const buf = await file.arrayBuffer()
            const bytes = new Uint8Array(buf)
            let binary = ''
            for (let i = 0; i < bytes.length; i += 8192) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
            }
            const base64 = btoa(binary)
            await fetch(`${apiBase}/api/upload-audio`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: audioFilePath, data: base64 }),
            })
          } catch (e) {
            console.warn('Failed to upload audio to server:', e)
          }
        }
        resolve(blobUrl)
      }
      input.oncancel = () => resolve('')
      input.click()
    })
  }, [apiBase])

  // Keep spectrogram audio URL in sync: blob from Browse, the cloud library copy, or a resolved path.
  useEffect(() => {
    if (song.animationType !== 'song') { setEffectiveAudioSrc(''); return }
    if (audioBlobUrlRef.current) { setEffectiveAudioSrc(audioBlobUrlRef.current); return }
    const audioPath = song.audioFilePath?.trim()
    const slug = song.librarySlug
    let cancelled = false
    ;(async () => {
      // 1. Local IndexedDB cache — re-open the exact MP3 the user last loaded (instant,
      //    no server/network needed). This is what makes "the last song" come back on launch.
      if (audioPath) {
        const cached = await getAudio(audioPath)
        if (!cancelled && cached) {
          const url = URL.createObjectURL(cached)
          audioBlobUrlRef.current = url
          setEffectiveAudioSrc(url)
          return
        }
      }
      // 2. The cloud library copy when this song lives there (works local + remote).
      if (slug) {
        try {
          const r = await fetch(library.audioUrl(slug, projectId), { method: 'HEAD' })
          if (!cancelled && r.ok) { setEffectiveAudioSrc(library.audioUrl(slug, projectId)); void ensureAudioCached(audioPath || slug, library.audioUrl(slug, projectId)); return }
        } catch {}
      }
      // 3. ui/public, control server, or prompt.
      if (!audioPath) { if (!cancelled) setEffectiveAudioSrc(''); return }
      const src = await resolveAudioSrc(audioPath)
      if (!cancelled) {
        setEffectiveAudioSrc(src)
        if (src && !src.startsWith('blob:')) void ensureAudioCached(audioPath, src) // cache for instant offline re-open
      }
    })()
    return () => { cancelled = true }
  }, [song.animationType, song.audioFilePath, song.librarySlug, resolveAudioSrc])

  // Keep audio element src in sync with resolved audio URL
  useEffect(() => {
    if (song.animationType !== 'song') {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      return
    }
    if (!effectiveAudioSrc) {
      if (audioRef.current) audioRef.current.src = ''
      return
    }
    if (!audioRef.current) audioRef.current = new Audio()
    if (audioRef.current.src !== effectiveAudioSrc) {
      audioRef.current.src = effectiveAudioSrc
    }
    audioRef.current.loop = false
  }, [song.animationType, effectiveAudioSrc])

  // Playback animation: use audio time when available (so Run from and timeline stay in sync), else use interval.
  // Stop at song length (same as pressing Stop) or at spectrogram range end (section play).
  useEffect(() => {
    const audio = audioRef.current
    const useAudio = isPlaying && song.animationType === 'song' && song.audioFilePath && audio
    const runStartSec = song.runStartTimeSeconds ?? 0
    const runStartBeats = audioSecToBeats(runStartSec, song)
    const maxTime = songLengthBeats

    const performStop = (finalBeat?: number) => {
      if (audio && song.animationType === 'song' && song.audioFilePath) {
        audio.pause()
        if (finalBeat != null) {
          audio.currentTime = Math.max(0, beatsToAudioSec(finalBeat, song))
        } else {
          audio.currentTime = Math.max(0, runStartSec)
        }
      }
      if (liveMode && apiBase) {
        fetch(`${apiBase}/api/stop`, { method: 'POST' }).catch((err) =>
          console.error('Live stop failed', err)
        )
      }
      setIsPlaying(false)
      setNextRunFromStart(true)
      playbackRangeEndSecRef.current = null
      setCurrentTime(finalBeat != null ? Math.max(0, Math.min(maxTime, finalBeat)) : Math.max(0, Math.min(maxTime, runStartBeats)))
    }

    if (useAudio) {
      let rafId: number
      let lastUpdateMs = 0
      const FRAME_MS = 1000 / 30  // 30 fps cap
      const syncFromAudio = (nowMs: number) => {
        if (!audioRef.current) return
        const sec = audioRef.current.currentTime
        const endSec = playbackRangeEndSecRef.current
        if (endSec != null && sec >= endSec) {
          cancelAnimationFrame(rafId)
          const endBeat = audioSecToBeats(endSec, song)
          performStop(Math.max(0, Math.min(maxTime, endBeat)))
          return
        }
        const beats = audioSecToBeats(sec, song)
        if (beats >= maxTime || audioRef.current.ended) {
          cancelAnimationFrame(rafId)
          performStop()
          return
        }
        if (nowMs - lastUpdateMs >= FRAME_MS) {
          lastUpdateMs = nowMs
          setCurrentTime(beats)
        }
        rafId = requestAnimationFrame(syncFromAudio)
      }
      rafId = requestAnimationFrame(syncFromAudio)
      return () => cancelAnimationFrame(rafId)
    }

    if (isPlaying) {
      playbackIntervalRef.current = setInterval(() => {
        setCurrentTime(prev => {
          const speed = useSimSpeedRef.current ? playbackSpeedRef.current : 1.0
          const next = prev + 0.1 * speed
          const endSec = playbackRangeEndSecRef.current
          if (endSec != null && beatsToAudioSec(next, song) >= endSec) {
            const endBeat = audioSecToBeats(endSec, song)
            queueMicrotask(() => {
              if (playbackIntervalRef.current) {
                clearInterval(playbackIntervalRef.current)
                playbackIntervalRef.current = null
              }
              performStop(Math.max(0, Math.min(maxTime, endBeat)))
            })
            return Math.max(0, Math.min(maxTime, endBeat))
          }
          if (next >= maxTime) {
            queueMicrotask(() => {
              if (playbackIntervalRef.current) {
                clearInterval(playbackIntervalRef.current)
                playbackIntervalRef.current = null
              }
              performStop()
            })
            return Math.max(0, Math.min(maxTime, runStartBeats))
          }
          return next
        })
      }, 50)
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }
  }, [isPlaying, song.animationType, song.audioFilePath, song.bpm, song.lengthSeconds, song.runStartTimeSeconds, songLengthBeats, liveMode, apiBase])

  // Clamp current time if song length shrinks
  useEffect(() => {
    if (currentTime > songLengthBeats) {
      setCurrentTime(songLengthBeats)
    }
  }, [songLengthBeats, currentTime])

  const handleSongChange = (updates: Partial<Song>) => {
    setSong(prev => ({
      ...prev,
      ...updates,
    }))
  }

  const handleSeekToBeat = (beat: number) => {
    const clamped = Math.max(0, Math.min(songLengthBeats, beat))
    setCurrentTime(clamped)
    const sec = beatsToAudioSec(clamped, song)
    handleSongChange({ runStartTimeSeconds: sec })
    setNextRunFromStart(true)
    const audio = audioRef.current
    if (song.animationType === 'song' && song.audioFilePath && audio && isPlaying) {
      audio.currentTime = Math.max(0, sec)
    }
  }

  // When beats are added or removed, every reference to a beat number across the project
  // (timeframe startTime/endTime, playhead currentTime) needs to shift so it still points at
  // the same moment in audio. Without this, e.g. adding a beat at index 30 would silently
  // misalign every timeframe whose endpoints were at beat 30 or later.
  // Rule: insert at index N → values >= N shift by +1; remove at index N → values > N shift by −1.
  const shiftBeatRefs = (delta: number, threshold: number) => {
    const adjust = (v: number) => (delta > 0 ? (v >= threshold ? v + delta : v) : (v > threshold ? v + delta : v))
    setTimeframes(prev => prev.map(tf => ({
      ...tf,
      startTime: adjust(tf.startTime),
      endTime: adjust(tf.endTime),
    })))
    setCurrentTime(t => adjust(t))
  }

  const handleBeatAdd = useCallback((timeMs: number) => {
    const rounded = Math.round(timeMs)
    const cur = song.beatTimestampsMs ?? []
    const next = [...cur, rounded].sort((a, b) => a - b)
    const insertIndex = next.indexOf(rounded)
    handleSongChange({ beatTimestampsMs: next })
    shiftBeatRefs(+1, insertIndex)
  }, [song.beatTimestampsMs])

  const handleBeatRemove = useCallback((beatIndex: number) => {
    const cur = song.beatTimestampsMs
    if (!cur || beatIndex < 0 || beatIndex >= cur.length) return
    const next = cur.filter((_, i) => i !== beatIndex)
    handleSongChange({ beatTimestampsMs: next.length ? next : undefined })
    shiftBeatRefs(-1, beatIndex)
  }, [song.beatTimestampsMs])

  const handleBeatMove = useCallback((beatIndex: number, newTimeMs: number) => {
    const cur = song.beatTimestampsMs
    if (!cur || beatIndex < 0 || beatIndex >= cur.length) return
    const next = [...cur]
    next[beatIndex] = Math.round(newTimeMs)
    next.sort((a, b) => a - b)
    handleSongChange({ beatTimestampsMs: next })
  }, [song.beatTimestampsMs])

  const handleAudioFilePathChange = (value: string) => {
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
    handleSongChange({ audioFilePath: value || undefined })
  }

  const handleBrowseAudio = async () => {
    setAudioReconnectHandle(null)
    if (supportsFileHandles()) {
      // Persists a reusable handle, so this same file reopens silently next time.
      const picked = await pickAndRememberAudioFile()
      if (picked) {
        if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
        const blobUrl = URL.createObjectURL(picked.file)
        audioBlobUrlRef.current = blobUrl
        setEffectiveAudioSrc(blobUrl)
        handleSongChange({ audioFilePath: picked.name })
        if (audioRef.current) audioRef.current.src = blobUrl
        return
      }
    }
    // Unsupported browser (e.g. Firefox/Safari) — falls back to a one-off picker, no persistence.
    audioFileInputRef.current?.click()
  }

  const handleAudioFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
    const blobUrl = URL.createObjectURL(file)
    audioBlobUrlRef.current = blobUrl
    setEffectiveAudioSrc(blobUrl)
    handleSongChange({ audioFilePath: file.name })
    if (audioRef.current) audioRef.current.src = blobUrl
    void putAudio(file.name, file) // cache so this exact MP3 re-opens on next launch
  }

  const handleReconnectAudio = async () => {
    if (!audioReconnectHandle) return
    const file = await grantPermissionAndGetFile(audioReconnectHandle)
    setAudioReconnectHandle(null)
    if (!file) return
    if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
    const blobUrl = URL.createObjectURL(file)
    audioBlobUrlRef.current = blobUrl
    setEffectiveAudioSrc(blobUrl)
    if (audioRef.current) audioRef.current.src = blobUrl
  }

  return (
    <div className={`app${resizing ? ' app-resizing' : ''}${resizing === 'spectrogram' ? ' app-resizing-spectrogram' : ''}${resizing === 'header' ? ' app-resizing-header' : ''}${lightTheme ? ' theme-light' : ''}`}>
      <div className="app-header" ref={headerRef} style={{ height: headerHeight }}>
        {onExitToSongs && (
          <button type="button" className="secondary-button" onClick={exitToSongs} title="Back to the song list" style={{ marginRight: 8, whiteSpace: 'nowrap' }}>← Songs</button>
        )}
        <h1 className="app-header-title">KivSee Time Simulator</h1>
        <input
          type="text"
          className="song-name-input"
          value={song.name}
          onChange={(e) => handleSongChange({ name: e.target.value })}
          placeholder="Song name"
        />
        <label className="song-meta-field" title="Song = startSong() with offset; Trigger = one-shot trigger()">
          <span>Type</span>
          <select
            className="song-meta-input"
            value={song.animationType ?? 'song'}
            onChange={(e) => handleSongChange({ animationType: e.target.value === 'trigger' ? 'trigger' : 'song' })}
          >
            <option value="song">Song</option>
            <option value="trigger">Trigger</option>
          </select>
        </label>
        {song.animationType === 'song' && (
          <label className="song-meta-field song-meta-field-audio" title="Browsers cannot read full disk paths. Use a path relative to the app (e.g. /audio/song.wav) or Browse.">
            <span>Audio</span>
            <input
              type="text"
              className="song-meta-input song-meta-input-audio"
              value={song.audioFilePath ?? ''}
              onChange={(e) => handleAudioFilePathChange(e.target.value)}
              placeholder="/audio/song.wav"
            />
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.m4a"
              className="song-audio-file-input"
              onChange={handleAudioFileSelected}
            />
            <button
              type="button"
              className="secondary-button song-browse-button"
              onClick={handleBrowseAudio}
            >
              Browse…
            </button>
            {audioReconnectHandle && (
              <button
                type="button"
                className="secondary-button song-browse-button song-reconnect-button"
                onClick={handleReconnectAudio}
                title="Re-grant access to the previously selected audio file"
              >
                Reconnect audio
              </button>
            )}
          </label>
        )}
        <label className="song-meta-field">
          <span>Length</span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            className="song-meta-input"
            {...numericInputProps('lengthSeconds', song.lengthSeconds, 1, 0.1, 'float', (n) => handleSongChange({ lengthSeconds: n }))}
          />
          <span className="song-meta-suffix">sec</span>
        </label>
        <label className="song-meta-field">
          <span>BPM</span>
          <input
            type="number"
            min={1}
            step={1}
            className="song-meta-input song-meta-input-short"
            {...numericInputProps('bpm', song.bpm, 120, 1, 'int', (n) => handleSongChange({ bpm: n }))}
          />
        </label>
        <label className="song-meta-field">
          <span>Offset</span>
          <input
            type="number"
            min={0}
            step={1}
            className="song-meta-input song-meta-input-short"
            {...numericInputProps('startOffsetMs', song.startOffsetMs ?? 0, 0, 0, 'int', (n) => handleSongChange({ startOffsetMs: n }))}
          />
          <span className="song-meta-suffix">ms</span>
        </label>
        <label className="song-meta-field">
          <span>Lilum rings</span>
          <input
            type="text"
            className="song-meta-input"
            placeholder="e.g. 1, 2"
            title="Ring numbers with a lilum pendant. Each N mirrors ring N onto thing lilumN."
            value={(song.lilumRings ?? []).join(', ')}
            onChange={(e) => {
              const rings = e.target.value
                .split(',')
                .map((t) => Number(t.trim()))
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12)
              handleSongChange({ lilumRings: rings.length > 0 ? rings : undefined })
            }}
          />
        </label>
        <div className="app-header-actions">
          <button
            type="button"
            role="switch"
            aria-checked={lightTheme}
            aria-label={lightTheme ? 'Switch to dark theme' : 'Switch to light theme'}
            title={lightTheme ? 'Switch to dark theme' : 'Switch to light theme'}
            className={`app-theme-switch${lightTheme ? ' is-light' : ''}`}
            onClick={() => {
              const next = !lightTheme
              setLightTheme(next)
              localStorage.setItem('kivsee-theme', next ? 'light' : 'dark')
            }}
          >
            <svg className="app-theme-switch-icon app-theme-switch-icon-sun" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
            <svg className="app-theme-switch-icon app-theme-switch-icon-moon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <span className="app-theme-switch-knob" aria-hidden="true" />
          </button>
          <button className="secondary-button" onClick={addTimeframe}>+ Add</button>
          <button className="secondary-button" onClick={handleLoadTimeframes}>Load</button>
          <button className="secondary-button" onClick={handleImportTs} disabled={!apiBase} title={!apiBase ? 'Set a control server URL in Settings first' : 'Import a .ts song file'}>Import .ts</button>
          <button className="secondary-button" onClick={handleSaveTimeframes}>Save</button>
          <button className="secondary-button" onClick={() => void saveCurrentAnimation()} title="Save the current timeline as an animation in the library">💾 Save animation</button>
          <button
            type="button"
            className={`secondary-button app-settings-button${apiBase ? (controlServerAvailable ? ' is-connected' : ' is-disconnected') : ''}`}
            onClick={() => setSettingsOpen(true)}
            title={!apiBase ? 'No control server configured' : controlServerAvailable ? 'Control server connected' : 'Control server configured but unreachable'}
          >
            {apiBase && <span className="app-settings-dot" aria-hidden="true" />}
            ⚙ Settings
          </button>
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel
          value={apiBase}
          connected={controlServerAvailable}
          onSave={(value) => { setApiBase(value); setSettingsOpen(false) }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {showCompose && (
        <ComposePanel
          apiBase={apiBase}
          song={song}
          onLoad={loadCategoryPreview}
          onReplaceSection={replaceSection}
          onAnalyzed={handleComposeAnalyzed}
          onComposeFromLibrary={(a) => {
            lastAnalysisRef.current = a
            const ok = recomposeFromLibrary()
            if (ok) { setShowCompose(false); setShowLiveConsole(true) } // show the result in the editor
            return ok
          }}
          onLoadSavedAnalysis={async () =>
            lastAnalysisRef.current ?? (song.librarySlug ? await library.getAnalysis(song.librarySlug, projectId).catch(() => null) : null)
          }
          alreadyComposed={timeframes.some((tf) => typeof tf._section === 'number')}
          onClose={() => setShowCompose(false)}
        />
      )}
      {showLibrary && (
        <LibraryPanel
          projectId={projectId}
          activeSlug={song.librarySlug}
          onLoadComposition={loadCompositionFromLibrary}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showHistory && (
        <HistoryPanel
          projectId={projectId}
          slug={song.librarySlug}
          songName={song.name}
          currentBranch={currentBranch}
          headVerId={headVerId}
          onSave={saveVersion}
          onLoadVersion={loadVersion}
          onBranch={branchFromVersion}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showLiveConsole && (
        <LiveConsole
          song={song}
          timeframes={timeframes}
          onApplyTimeframes={(tfs) => setTimeframes(tfs)}
          songLengthBeats={songLengthBeats}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onSeekBeat={handleSeekToBeat}
          brightness={brightness}
          brightnessConnected={brightnessConnected}
          onBrightnessChange={(v) => {
            setBrightnessState(v)
            fetch(`${apiBase}/api/brightness`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: v }),
            }).catch(() => {})
          }}
          autoSend={controlServerAvailable}
          onRecompose={recomposeCurrent}
          strip={liveStrip}
          sectionLines={song.sectionLines || []}
          onSectionLinesChange={(lines) => handleSongChange({ sectionLines: lines })}
          songAnimations={song.animations || []}
          onRemoveAnimation={removeSongAnimation}
          presetPads={libraryPads}
          onClose={() => setShowLiveConsole(false)}
        />
      )}
      {/* Floating action dock — always above the workspace, never clipped by the header. */}
      <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 950, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        {librarySaveState !== 'idle' && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
            padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
            background: librarySaveState === 'error' ? '#7f1d1d' : '#0f172acc',
            color: librarySaveState === 'error' ? '#fecaca' : '#cbd5e1',
            border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}>
            {librarySaveState === 'saving'
              ? '☁️ Saving…'
              : librarySaveState === 'error'
                ? '⚠️ Save failed'
                : `✓ Saved · ${currentBranch}`}
          </div>
        )}
        {dockOpen && (
          <>
            <button
              type="button"
              onClick={() => void saveVersion()}
              title={`Save a new version on branch "${currentBranch}"`}
              style={{ ...fabBase, background: 'linear-gradient(135deg,#38bdf8 0%,#0284c7 100%)', boxShadow: '0 4px 14px rgba(2,132,199,0.45)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>💾</span> Save
            </button>
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              title="Version history and branches"
              style={{ ...fabBase, background: 'linear-gradient(135deg,#fbbf24 0%,#d97706 100%)', boxShadow: '0 4px 14px rgba(217,119,6,0.45)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>🕘</span> History
            </button>
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              title="Song library: saved songs, analyses, and animations"
              style={{ ...fabBase, background: 'linear-gradient(135deg,#818cf8 0%,#6366f1 100%)', boxShadow: '0 4px 14px rgba(99,102,241,0.45)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>📚</span> Library
            </button>
            <button
              type="button"
              onClick={() => setShowCompose(true)}
              disabled={!apiBase}
              title={!apiBase ? 'Run the control server (VITE_API_URL)' : 'Compose from a song: analysis + taste rules → timeline'}
              style={{
                ...fabBase,
                background: apiBase ? 'linear-gradient(135deg,#34d399 0%,#10b981 100%)' : '#6b7280',
                cursor: apiBase ? 'pointer' : 'not-allowed',
                boxShadow: '0 6px 18px rgba(16,185,129,0.5)', fontSize: 15, padding: '0 22px', height: 46,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>🎵</span> Compose
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          title={dockOpen ? 'Close' : 'Actions: Save / History / Library / Compose'}
          style={{ ...fabBase, background: dockOpen ? 'rgba(15,23,42,0.92)' : 'linear-gradient(135deg,#475569 0%,#1e293b 100%)', boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{dockOpen ? '✕' : '☰'}</span> {dockOpen ? 'Close' : 'Actions'}
        </button>
      </div>
      <div
        className="app-resize-handle app-resize-handle-header"
        onMouseDown={() => setResizing('header')}
        title="Drag to resize header"
      />
      {song.animationType === 'song' && !!(song.audioFilePath?.trim()) && (
        <div className="app-spectrogram-bar">
          <button
            className="app-spectrogram-toggle"
            onClick={() => setSpectrogramOpen(o => !o)}
            title={spectrogramOpen ? 'Collapse spectrogram' : 'Expand spectrogram'}
          >
            {spectrogramOpen ? '▾ Spectrogram' : '▸ Spectrogram'}
          </button>
        </div>
      )}
      {song.animationType === 'song' && !!(song.audioFilePath?.trim()) && (
        <div
          className="app-spectrogram-full"
          ref={spectrogramContainerRef}
          style={{ height: spectrogramHeight, display: spectrogramOpen ? undefined : 'none' }}
        >
          <Spectrogram
            audioRef={audioRef}
            isPlaying={isPlaying}
            hasAudio
            audioSrc={effectiveAudioSrc}
            currentTimeSeconds={beatsToAudioSec(currentTime, song)}
            durationSeconds={song.lengthSeconds}
            bpm={song.bpm}
            beatOffset={(song.startOffsetMs ?? 0) / 1000}
            beatTimestampsMs={song.beatTimestampsMs}
            viewStartSeconds={beatsToAudioSec(viewStartBeat, song)}
            viewEndSeconds={
              viewEndBeat >= songLengthBeats - 0.01
                ? Math.max(beatsToAudioSec(viewEndBeat, song), song.lengthSeconds)
                : beatsToAudioSec(viewEndBeat, song)
            }
            viewSpanBeats={beatsPerScreen}
            onScrollToSeconds={onScrollToSeconds}
            onZoomAtSeconds={onZoomAtSeconds}
            onPanBySeconds={onPanBySeconds}
            onSeekToSeconds={(seconds) => handleSeekToBeat(audioSecToBeats(seconds, song))}
            beatEditMode={beatEditMode}
            onBeatEditModeChange={setBeatEditMode}
            onBeatAdd={handleBeatAdd}
            onBeatRemove={handleBeatRemove}
            onBeatMove={handleBeatMove}
            onRangeSelectionChange={(r) => { spectrogramRangeRef.current = r }}
            beatDetectControls={(
              <div className="spectrogram-beat-detect-inner">
                <button
                  type="button"
                  className="spectrogram-beat-detect-btn"
                  onClick={handleDetectBeats}
                  disabled={
                    detectBeatsLoading ||
                    !controlServerAvailable ||
                    !song.audioFilePath?.trim() ||
                    (detectBeatsScope === 'range' && rangeStartSec >= rangeEndSec)
                  }
                  title={
                    !controlServerAvailable
                      ? 'Control server is not running'
                      : !song.audioFilePath?.trim()
                        ? 'Set audio file path first'
                        : detectBeatsScope === 'range' && rangeStartSec >= rangeEndSec
                          ? 'From time must be less than To time'
                          : 'Run beat detection (requires Python + librosa)'
                  }
                >
                  {detectBeatsLoading ? (detectBeatsProgress ?? 'Detecting…') : 'Detect Beats'}
                </button>
                <div className="spectrogram-beat-detect-row">
                  <select
                    className="spectrogram-beat-detect-select"
                    value={detectBeatsScope}
                    onChange={(e) => setDetectBeatsScope(e.target.value as 'full' | 'range')}
                    title="Full song or time range"
                  >
                    <option value="full">Full song</option>
                    <option value="range">Range</option>
                  </select>
                  <select
                    className="spectrogram-beat-detect-select"
                    value={detectBeatsMethod}
                    onChange={(e) => setDetectBeatsMethod(e.target.value as 'onset' | 'beats')}
                    title="Onset = variable tempo; Beats = constant tempo grid with BPM hint"
                  >
                    <option value="onset">Onset</option>
                    <option value="beats">Beats</option>
                  </select>
                  {song.beatTimestampsMs && song.beatTimestampsMs.length > 0 && (
                    <span className="spectrogram-beat-detect-status" title="Click to clear detected beats and revert to fixed BPM">
                      {song.beatTimestampsMs.length} beats
                      <button
                        type="button"
                        className="spectrogram-beat-detect-clear"
                        onClick={() => handleSongChange({ beatTimestampsMs: undefined })}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                {detectBeatsScope === 'range' && (
                  <div className="spectrogram-beat-detect-range-row">
                    <label className="spectrogram-beat-detect-label">
                      <span>From</span>
                      <input
                        type="number"
                        min={0}
                        max={song.lengthSeconds}
                        step={0.1}
                        className="spectrogram-beat-detect-input"
                        {...numericInputProps('rangeStartSec', rangeStartSec, 0, 0, 'float', setRangeStartSec, song.lengthSeconds)}
                      />
                      <span className="spectrogram-beat-detect-suffix">s</span>
                    </label>
                    <label className="spectrogram-beat-detect-label">
                      <span>To</span>
                      <input
                        type="number"
                        min={0}
                        max={song.lengthSeconds}
                        step={0.1}
                        className="spectrogram-beat-detect-input"
                        {...numericInputProps('rangeEndSec', rangeEndSec, song.lengthSeconds, 0, 'float', setRangeEndSec, song.lengthSeconds)}
                      />
                      <span className="spectrogram-beat-detect-suffix">s</span>
                    </label>
                    <label className="spectrogram-beat-detect-label" title="Override BPM for this range (variable-BPM songs). Leave empty to use song BPM.">
                      <span>BPM</span>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        step={1}
                        className="spectrogram-beat-detect-input"
                        placeholder={String(song.bpm || 120)}
                        value={rangeBpm === '' ? '' : rangeBpm}
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          setRangeBpm(v === '' ? '' : Math.max(1, Math.min(300, parseInt(v, 10) || 1)))
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v === '') setRangeBpm('')
                        }}
                      />
                    </label>
                    <label className="spectrogram-beat-detect-label" title="Build a full beat grid from onsets (fixes detection that only hits every 2nd/3rd beat).">
                      <input
                        type="checkbox"
                        checked={rangeFillGrid}
                        onChange={(e) => setRangeFillGrid(e.target.checked)}
                      />
                      <span>Fill grid</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          />
        </div>
      )}
      {song.animationType === 'song' && !!(song.audioFilePath?.trim()) && spectrogramOpen && (
        <div className="app-resize-handle app-resize-handle-spectrogram" onMouseDown={() => setResizing('spectrogram')} title="Drag to resize spectrogram" />
      )}
      <div className="app-content" ref={appContentRef}>
        <div
          className="app-playback-wrapper"
          style={{ width: playbackPanelWidth, minWidth: playbackPanelWidth }}
        >
          <PlaybackRingsPanel
            currentTime={currentTime}
            timeframes={timeframes}
            isPlaying={isPlaying}
            liveMode={liveMode}
            sendSequenceLoading={sendSequenceLoading}
            apiAvailable={controlServerAvailable}
            onPlayPause={handlePlayPause}
            onStop={handleStop}
            onSendSequence={handleSendSequence}
            onLiveModeChange={setLiveMode}
            muteAudio={muteAudio}
            onMuteAudioChange={setMuteAudio}
            playbackSpeed={playbackSpeed}
            onPlaybackSpeedChange={setPlaybackSpeed}
            useSimSpeed={useSimSpeed}
            onSimPlayPause={handleSimPlayPause}
            runFromSeconds={song.runStartTimeSeconds ?? 0}
            onRunFromChange={(n) => handleSeekToBeat(audioSecToBeats(n, song))}
            onResetRunFrom={() => {
              // Run from a literal 0s — earlier than beat 0 when there's an audio
              // offset, a position the clamped marker can't otherwise reach.
              handleSongChange({ runStartTimeSeconds: 0 })
              setNextRunFromStart(true)
              setCurrentTime(0)
              const audio = audioRef.current
              if (song.animationType === 'song' && song.audioFilePath && audio && isPlaying) {
                audio.currentTime = 0
              }
            }}
            brightness={brightness}
            brightnessConnected={brightnessConnected}
            onBrightnessChange={(v) => {
              setBrightnessState(v)
              fetch(`${apiBase}/api/brightness`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: v }),
              }).catch(() => {})
            }}
            onOpenLiveConsole={() => setShowLiveConsole(true)}
            onClockModeChange={(active) => {
              if (!liveMode || !apiBase) return
              if (active) {
                fetch(`${apiBase}/api/mqtt-trigger`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ triggerName: 'clock' }),
                }).catch((err) => console.error('Live clock trigger failed', err))
              } else {
                fetch(`${apiBase}/api/stop`, { method: 'POST' }).catch((err) =>
                  console.error('Live stop failed', err)
                )
              }
            }}
          />
        </div>
        <div
          className="app-resize-handle app-resize-handle-playback"
          onMouseDown={() => setResizing('playback')}
          title="Drag to resize Playback panel"
        />
        <div className="app-main" style={{ flexDirection: 'column' }}>
          <div className="app-main-view-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {/* Main-view switch: patterns/settings (Iddo) ↔ inline horizontal timeline (Oren). */}
            <div style={{ display: 'inline-flex', gap: 4, background: 'var(--surface-2, rgba(0,0,0,0.15))', padding: 3, borderRadius: 10 }}>
              <button
                onClick={() => setMainView('patterns')}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none',
                  color: '#fff',
                  background: mainView === 'patterns' ? 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)' : 'transparent',
                  opacity: mainView === 'patterns' ? 1 : 0.6,
                }}
              >⚙ Patterns</button>
              <button
                onClick={() => setMainView('timeline')}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none',
                  color: '#fff',
                  background: mainView === 'timeline' ? 'linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%)' : 'transparent',
                  opacity: mainView === 'timeline' ? 1 : 0.6,
                }}
              >📊 Timeline</button>
            </div>
            <span style={{ flex: 1 }} />
            {(song.audioFilePath || song.librarySlug || timeframes.length > 0) ? (
              <button
                onClick={() => setShowLiveConsole(true)}
                title="Open the fullscreen song editor — timeline, patterns, and live control"
                style={{
                  padding: '9px 22px', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  border: 'none', color: '#fff',
                  background: 'linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)',
                  boxShadow: '0 2px 14px rgba(245,158,11,0.4)',
                }}
              >🎬 Song Editor · Fullscreen</button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Load a song from the library to open the song editor</span>
            )}
          </div>
          {mainView === 'patterns' ? (
            <div className="app-main-timeline-wrap">
              <PatternLibrary
                imported={importedPatterns}
                globalHidden={globalHiddenPatterns}
                songHidden={song.hiddenPatterns ?? []}
                songName={song.name}
                bpm={song.bpm}
                onApplyPreset={addTimeframesFromPreset}
                onApplyEdited={(tfs, name) => upsertSongAnimation(name, tfs)}
                onSavePattern={(name, tfs) => upsertSongAnimation(name, tfs)}
                patternEdits={patternEdits}
                onSavePatternEdit={savePatternEdit}
                onHideForSong={hidePatternForSong}
                onHideGlobal={hidePatternGlobal}
                onRestoreForSong={restorePatternForSong}
                onRestoreGlobal={restorePatternGlobal}
                onImport={importPatterns}
                onLoadCategoryPreview={loadCategoryPreview}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
              <div className="app-main-timeline-wrap" style={{ flex: 1, minWidth: 0 }}>
                <Timeline
                  timeframes={timeframes}
                  songLengthBeats={songLengthBeats}
                  bpm={song.bpm}
                  onUpdate={updateTimeframe}
                  onUpdateSilent={updateTimeframeSilent}
                  onUpdateSilentBatch={updateTimeframesSilentBatch}
                  onCheckpoint={checkpointTimeframes}
                  onDelete={deleteTimeframe}
                  onAdd={addTimeframeFromDrag}
                  onCopy={copyTimeframe}
                  onPaste={pasteTimeframe}
                  hasClipboard={clipboardTimeframe !== null}
                  focusedTimeframeId={focusedTimeframeId}
                  onFocusedTimeframeChange={setFocusedTimeframeId}
                  selectedTimeframeIds={selectedTimeframeIds}
                  onSelectedTimeframeIdsChange={setSelectedTimeframeIds}
                  currentTime={currentTime}
                  onCurrentTimeChange={handleCurrentTimeChange}
                  viewStartBeat={viewStartBeat}
                  beatsPerScreen={beatsPerScreen}
                  onScrollTo={viewActions.scrollTo}
                  onZoomAt={viewActions.zoomAt}
                  onPanBy={viewActions.panBy}
                  onSeekToBeat={handleSeekToBeat}
                  beatTimestampsMs={song.beatTimestampsMs}
                />
              </div>
              {/* Details panel only when a timeframe is selected — otherwise the timeline gets the full width. */}
              {focusedTimeframe && (
                <>
                  <div
                    className="app-resize-handle app-resize-handle-details"
                    onMouseDown={() => setResizing('details')}
                    title="Drag to resize Details panel"
                  />
                  <div
                    className="app-details-wrapper"
                    style={{ width: detailsPanelWidth, minWidth: detailsPanelWidth }}
                  >
                    <TimeframePanel
                      timeframe={focusedTimeframe}
                      onUpdate={handlePanelUpdate}
                      onClose={() => setFocusedTimeframeId(null)}
                      songLengthBeats={songLengthBeats}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
