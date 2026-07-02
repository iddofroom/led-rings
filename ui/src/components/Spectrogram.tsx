import React, { useRef, useEffect, useCallback, useState } from 'react'
import { realFftMagnitude } from '../fft'
import './Spectrogram.css'

const FFT_SIZE = 2048
const HOP_SIZE = 512
const SPECTROGRAM_HEIGHT = 256
const DB_FLOOR = -80 // dB floor for magnitude scaling (Audacity default)
const DB_GAIN = 20 // dB gain boost (Audacity default spectrogram gain)
const SAMPLE_RATE = 44100 // assumed sample rate for frequency mapping

/**
 * Piecewise-linear frequency mapping: allocates display space unevenly across
 * frequency bands so the musically-important mid range gets the most room.
 *   0–500 Hz   →  5% of height
 *   500–10 kHz → 80% of height
 *   10–22 kHz  → 15% of height
 * Returns a fraction 0..1 (0 = bottom / 0 Hz, 1 = top / Nyquist).
 */
const FREQ_BANDS: { freqFrac: number; displayFrac: number }[] = [
  { freqFrac: 0, displayFrac: 0 },           // 0 Hz  → bottom
  { freqFrac: 500 / 22050, displayFrac: 0.05 },  // 500 Hz  → 5%
  { freqFrac: 10000 / 22050, displayFrac: 0.85 }, // 10 kHz → 85%
  { freqFrac: 1, displayFrac: 1 },           // Nyquist → top
]
function freqFracToDisplay(freqFrac: number): number {
  for (let i = 0; i < FREQ_BANDS.length - 1; i++) {
    const a = FREQ_BANDS[i], b = FREQ_BANDS[i + 1]
    if (freqFrac <= b.freqFrac) {
      const t = (freqFrac - a.freqFrac) / (b.freqFrac - a.freqFrac)
      return a.displayFrac + t * (b.displayFrac - a.displayFrac)
    }
  }
  return 1
}
function displayFracToFreqFrac(displayFrac: number): number {
  for (let i = 0; i < FREQ_BANDS.length - 1; i++) {
    const a = FREQ_BANDS[i], b = FREQ_BANDS[i + 1]
    if (displayFrac <= b.displayFrac) {
      const t = (displayFrac - a.displayFrac) / (b.displayFrac - a.displayFrac)
      return a.freqFrac + t * (b.freqFrac - a.freqFrac)
    }
  }
  return 1
}

/**
 * Audacity-style spectrogram color gradient.
 * Maps 0..255 magnitude → RGB: black → dark blue → purple → red → orange → yellow → white
 */
function magnitudeToRgb(n: number): { r: number; g: number; b: number } {
  const t = Math.min(1, Math.max(0, n / 255))
  // 6-stop gradient matching Audacity's spectrogram palette
  const stops = [
    { p: 0.0, r: 0, g: 0, b: 0 },       // black (silence)
    { p: 0.16, r: 35, g: 10, b: 90 },     // dark indigo
    { p: 0.33, r: 100, g: 10, b: 120 },   // purple
    { p: 0.5, r: 180, g: 20, b: 30 },     // red
    { p: 0.7, r: 230, g: 140, b: 20 },    // orange
    { p: 0.85, r: 255, g: 230, b: 60 },   // yellow
    { p: 1.0, r: 255, g: 255, b: 255 },   // white (loudest)
  ]
  let i = 0
  while (i < stops.length - 2 && stops[i + 1].p < t) i++
  const a = stops[i], b_ = stops[i + 1]
  const f = (t - a.p) / (b_.p - a.p)
  return {
    r: Math.round(a.r + (b_.r - a.r) * f),
    g: Math.round(a.g + (b_.g - a.g) * f),
    b: Math.round(a.b + (b_.b - a.b) * f),
  }
}

const AXIS_HEIGHT = 36
const Y_AXIS_WIDTH = 48

/** Frequency ticks for the Y-axis (log-scale). */
const FREQ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}
/** Pick a step in whole beats for axis ticks. Step 1 when span ≤ 64 so grid matches timeline zoom. */
function beatAxisStep(rangeBeats: number): number {
  if (rangeBeats <= 0) return 1
  const rough = rangeBeats / 8
  if (rough <= 8) return 1   // span ≤ 64 beats → every beat
  if (rough <= 16) return 2
  if (rough <= 32) return 4
  if (rough <= 64) return 8
  if (rough <= 128) return 16
  if (rough <= 256) return 32
  return 64
}

/** Pick a step in seconds for axis when BPM unknown (fallback). */
function timeAxisStep(rangeSec: number): number {
  if (rangeSec <= 0) return 1
  const rough = rangeSec / 8
  if (rough <= 1) return 1
  if (rough <= 2) return 2
  if (rough <= 5) return 5
  if (rough <= 10) return 10
  if (rough <= 30) return 30
  return 60
}

export interface SpectrogramProps {
  audioRef: React.RefObject<HTMLAudioElement | null>
  isPlaying: boolean
  hasAudio: boolean
  /** URL to fetch for pre-computing full-song spectrogram (path or blob URL) */
  audioSrc: string
  /** Current playback time in seconds (for playhead) */
  currentTimeSeconds: number
  /** Total duration in seconds (song length or decoded buffer duration) */
  durationSeconds: number
  /** BPM for showing beat labels under the time axis (seconds → beat = seconds * bpm / 60). */
  bpm?: number
  /** Offset in seconds where beat 0 starts in the audio (startOffsetMs / 1000). */
  beatOffset?: number
  /** Detected beat timestamps in milliseconds. When present, drawn as markers on the spectrogram. */
  beatTimestampsMs?: number[]
  /** Start of visible range in seconds (from unified view range). */
  viewStartSeconds: number
  /** End of visible range in seconds (from unified view range). */
  viewEndSeconds: number
  /** Visible span in beats (for beat grid density). */
  viewSpanBeats: number
  /** Scroll to a start time in seconds. */
  onScrollToSeconds: (seconds: number) => void
  /** Zoom at a cursor position in seconds. */
  onZoomAtSeconds: (direction: 'in' | 'out', anchorSeconds: number, fraction: number) => void
  /** Pan by a delta in seconds. */
  onPanBySeconds: (deltaSeconds: number) => void
  /** When not playing, user clicked the spectrogram at this time (seconds). Seek marker and Run from. */
  onSeekToSeconds?: (seconds: number) => void
  /** When true, edit mode: select beat by click, Add beat button adds at playhead, Remove beat button removes selected; drag still moves. */
  beatEditMode?: boolean
  /** Called when user toggles Edit beats checkbox in spectrogram header. */
  onBeatEditModeChange?: (checked: boolean) => void
  /** Called when user clicks Add beat (adds at current playhead time). */
  onBeatAdd?: (timeMs: number) => void
  /** Called when user clicks Remove beat (removes selected beat index). */
  onBeatRemove?: (beatIndex: number) => void
  /** Called when user moves the beat at index to new time (ms). */
  onBeatMove?: (beatIndex: number, newTimeMs: number) => void
  /** When in beat edit mode, this toolbar is shown in the spectrogram header (detect beats, scope, method, range, etc.). */
  beatDetectControls?: React.ReactNode
  /** Called when the user changes the time-range selection (drag on spectrogram). Used so Play can start at selection start and stop at selection end. */
  onRangeSelectionChange?: (range: { startSec: number; endSec: number } | null) => void
}

export default function Spectrogram({
  audioRef,
  isPlaying,
  hasAudio,
  audioSrc,
  currentTimeSeconds,
  durationSeconds,
  bpm,
  beatOffset = 0,
  beatTimestampsMs,
  viewStartSeconds,
  viewEndSeconds,
  viewSpanBeats,
  onScrollToSeconds,
  onZoomAtSeconds,
  onPanBySeconds,
  onSeekToSeconds,
  beatEditMode = false,
  onBeatEditModeChange,
  onBeatAdd,
  onBeatRemove,
  onBeatMove,
  beatDetectControls,
  onRangeSelectionChange,
}: SpectrogramProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollViewRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScrollRef = useRef(false)
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scrollViewWidth, setScrollViewWidth] = useState(0)
  const paintRef = useRef<() => void>(() => {})
  const spectrogramImageRef = useRef<ImageData | null>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Offscreen canvas for the static background (image + axes + beat markers).
  // Only repainted when view/data changes, not on every currentTimeSeconds tick.
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const decodedDurationRef = useRef(0)
  const decodedSampleRateRef = useRef(SAMPLE_RATE)
  const lastMouseFracRef = useRef(0.5)
  const isHoveredRef = useRef(false)
  const [draggingBeatIndex, setDraggingBeatIndex] = useState<number | null>(null)
  const [dragPreviewMs, setDragPreviewMs] = useState<number | null>(null)
  const [selectedBeatIndex, setSelectedBeatIndex] = useState<number | null>(null)
  const dragPreviewMsRef = useRef<number | null>(null)
  const viewBoundsRef = useRef({ viewStart: 0, viewEnd: 0, viewDuration: 0 })
  const [rangeSelection, setRangeSelection] = useState<{ startSec: number; endSec: number } | null>(null)
  const rangeSelectRef = useRef<{ startSec: number; startClientX: number; active: boolean } | null>(null)
  const didRangeSelectRef = useRef(false)
  /** Duration the spectrogram image covers (decoded audio length, or song length before decode). */
  const imageDuration = decodedDurationRef.current || durationSeconds || 1
  /** Scroll range: at least full song length so user can scroll to end even if audio file is shorter. */
  const rangeDuration = Math.max(imageDuration, durationSeconds || 1)

  // View range directly from props (unified zoom/scroll)
  const viewStart = viewStartSeconds
  const viewEnd = viewEndSeconds
  const viewDuration = Math.max(0.001, viewEnd - viewStart)
  viewBoundsRef.current = { viewStart, viewEnd, viewDuration }

  const visibleSpanBeats = viewSpanBeats

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  const setupPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !canvasRef.current) return true
    if (audioContextRef.current != null) return true
    try {
      // Reuse AudioContext & MediaElementSourceNode cached on the element so that
      // unmounting / remounting the Spectrogram doesn't permanently disconnect audio
      // output (createMediaElementSource can only be called once per element).
      const anyAudio = audio as any
      let ctx: AudioContext = anyAudio.__audioCtx
      let source: MediaElementAudioSourceNode = anyAudio.__audioSrc
      if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        source = ctx.createMediaElementSource(audio)
        anyAudio.__audioCtx = ctx
        anyAudio.__audioSrc = source
      }
      const analyser = ctx.createAnalyser()
      source.disconnect()
      source.connect(analyser)
      analyser.connect(ctx.destination)
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.6
      audioContextRef.current = ctx
      sourceRef.current = source
      analyserRef.current = analyser
      return true
    } catch {
      return false
    }
  }, [audioRef])

  // Build full-song spectrogram from fetched audio
  useEffect(() => {
    if (!hasAudio || !audioSrc?.trim()) {
      spectrogramImageRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const expectedDurationSec = durationSeconds > 0 ? durationSeconds : null

    fetch(audioSrc)
      .then((r) => {
        const contentLength = r.headers.get('Content-Length')
        const expectedBytes = contentLength ? parseInt(contentLength, 10) : null
        return r.arrayBuffer().then((buf) => ({ buf, expectedBytes }))
      })
      .then(({ buf, expectedBytes }) => {
        if (cancelled) return Promise.reject(new Error('cancelled'))
        if (expectedBytes != null && buf.byteLength !== expectedBytes) {
          return Promise.reject(
            new Error(
              `File truncated: received ${buf.byteLength} of ${expectedBytes} bytes. Check network or try a shorter file.`
            )
          )
        }
        // Chrome workaround: decode can fail on large buffers; structuredClone sometimes fixes it
        const toDecode = typeof structuredClone === 'function' ? structuredClone(buf) : buf
        return ctx.decodeAudioData(toDecode)
      })
      .then((buffer) => {
        if (cancelled) return
        const numChannels = buffer.numberOfChannels
        const length = buffer.length
        const channel = buffer.getChannelData(0)
        const mono = numChannels > 1 ? new Float32Array(length) : channel
        if (numChannels > 1) {
          const ch1 = buffer.getChannelData(1)
          for (let i = 0; i < length; i++) mono[i] = (channel[i] + ch1[i]) / 2
        }

        const sampleRate = buffer.sampleRate || SAMPLE_RATE
        const numColumns = Math.max(1, Math.floor((length - FFT_SIZE) / HOP_SIZE) + 1)
        const cols: Float32Array[] = []
        const windowBuf = new Float32Array(FFT_SIZE)
        const numBins = FFT_SIZE / 2 + 1

        // Piecewise-linear frequency mapping (5% low, 80% mid, 15% high)
        const rowBinStart = new Uint32Array(SPECTROGRAM_HEIGHT)
        const rowBinEnd = new Uint32Array(SPECTROGRAM_HEIGHT)
        for (let row = 0; row < SPECTROGRAM_HEIGHT; row++) {
          const dispLo = row / SPECTROGRAM_HEIGHT
          const dispHi = (row + 1) / SPECTROGRAM_HEIGHT
          const freqFracLo = displayFracToFreqFrac(dispLo)
          const freqFracHi = displayFracToFreqFrac(dispHi)
          rowBinStart[row] = Math.max(0, Math.floor(freqFracLo * (numBins - 1)))
          rowBinEnd[row] = Math.min(numBins, Math.ceil(freqFracHi * (numBins - 1)) + 1)
        }

        for (let c = 0; c < numColumns; c++) {
          const start = c * HOP_SIZE
          if (start + FFT_SIZE > length) break
          for (let i = 0; i < FFT_SIZE; i++) windowBuf[i] = mono[start + i]
          const mag = realFftMagnitude(windowBuf, FFT_SIZE)
          const col = new Float32Array(SPECTROGRAM_HEIGHT)
          for (let row = 0; row < SPECTROGRAM_HEIGHT; row++) {
            const bStart = rowBinStart[row]
            const bEnd = rowBinEnd[row]
            let sum = 0
            let count = 0
            for (let b = bStart; b < bEnd && b < numBins; b++) {
              sum += mag[b]
              count++
            }
            const v = count > 0 ? sum / count : 0
            // Normalize to 0..1 (dBFS reference), convert to dB, apply gain, clamp
            const normMag = v / (FFT_SIZE / 2)
            const dB = normMag > 0 ? 20 * Math.log10(normMag) + DB_GAIN : DB_FLOOR
            col[SPECTROGRAM_HEIGHT - 1 - row] = Math.max(DB_FLOOR, Math.min(0, dB))
          }
          cols.push(col)
        }

        // Fixed dBFS range: DB_FLOOR → 0 (black), 0 dBFS → 255 (white)
        const range = -DB_FLOOR // 80 dB

        decodedDurationRef.current = buffer.duration
        decodedSampleRateRef.current = sampleRate
        if (
          expectedDurationSec != null &&
          buffer.duration < expectedDurationSec * 0.99
        ) {
          setError(
            `Only ${buffer.duration.toFixed(1)}s decoded (expected ${expectedDurationSec}s). ` +
              'Browsers often limit decodeAudioData for long files; try splitting the file or use a shorter clip.'
          )
          setLoading(false)
          return
        }
        const w = cols.length
        const h = SPECTROGRAM_HEIGHT
        const imageData = new ImageData(w, h)
        const buf = imageData.data
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const col = cols[px]
            const raw = col ? col[py] : 0
            const norm = Number.isFinite(raw)
              ? Math.round(((raw - DB_FLOOR) / range) * 255)
              : 0
            const mag = Math.max(0, Math.min(255, norm))
            const { r, g, b } = magnitudeToRgb(mag)
            const i = (py * w + px) << 2
            buf[i] = r
            buf[i + 1] = g
            buf[i + 2] = b
            buf[i + 3] = 255
          }
        }
        spectrogramImageRef.current = imageData
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load audio')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (ctx.state !== 'closed') ctx.close().catch(() => {})
    }
  }, [hasAudio, audioSrc])

  // Playback routing (audio -> analyser -> destination)
  useEffect(() => {
    if (!hasAudio) {
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
      // Keep AudioContext & source alive on the audio element so audio output
      // is not permanently disconnected when the Spectrogram unmounts.
      if (sourceRef.current) {
        sourceRef.current.disconnect()
        sourceRef.current.connect(audioContextRef.current!.destination)
      }
      sourceRef.current = null
      audioContextRef.current = null
      return
    }
    setupPlayback()
    return () => {
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect()
        sourceRef.current.connect(audioContextRef.current!.destination)
      }
      sourceRef.current = null
      audioContextRef.current = null
    }
  }, [hasAudio, setupPlayback])

  // Mouse-wheel on spectrogram: plain scroll = pan, Ctrl+scroll = zoom to cursor
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {})
  handleWheelRef.current = (e: WheelEvent) => {
    if (viewDuration <= 0) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll: zoom towards mouse cursor
      const canvas = canvasRef.current
      let frac = 0.5
      let anchorSeconds = (viewStart + viewEnd) / 2
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left - Y_AXIS_WIDTH
        const graphW = rect.width - Y_AXIS_WIDTH
        if (graphW > 0) {
          frac = Math.max(0, Math.min(1, x / graphW))
          anchorSeconds = viewStart + frac * viewDuration
        }
      }
      onZoomAtSeconds(e.deltaY < 0 ? 'in' : 'out', anchorSeconds, frac)
    } else {
      // Plain scroll: pan
      const scrollFraction = 0.15
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      const deltaSec = (delta > 0 ? 1 : -1) * viewDuration * scrollFraction
      onPanBySeconds(deltaSec)
    }
  }
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const handler = (e: WheelEvent) => handleWheelRef.current(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [hasAudio])

  const BEAT_HIT_THRESHOLD_PX = 12

  const getBeatEditStateAtClientX = useCallback((clientX: number) => {
    const canvas = canvasRef.current
    const bounds = viewBoundsRef.current
    if (!canvas || !beatTimestampsMs?.length) return { timeMs: 0, beatIndex: null as number | null }
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left - Y_AXIS_WIDTH
    const graphW = rect.width - Y_AXIS_WIDTH
    if (graphW <= 0) return { timeMs: bounds.viewStart * 1000, beatIndex: null }
    const timeSec = bounds.viewStart + (x / graphW) * bounds.viewDuration
    const timeMs = Math.max(0, timeSec * 1000)
    let nearestIdx = -1
    let nearestDistPx = BEAT_HIT_THRESHOLD_PX + 1
    for (let i = 0; i < beatTimestampsMs.length; i++) {
      const beatSec = beatTimestampsMs[i] / 1000
      if (beatSec < bounds.viewStart || beatSec > bounds.viewEnd) continue
      const beatX = (beatSec - bounds.viewStart) / bounds.viewDuration * graphW
      const distPx = Math.abs(x - beatX)
      if (distPx < nearestDistPx) {
        nearestDistPx = distPx
        nearestIdx = i
      }
    }
    return { timeMs, beatIndex: nearestIdx >= 0 ? nearestIdx : null }
  }, [beatTimestampsMs])

  // Track mouse position over the spectrogram for cursor-aware zoom; in beat edit mode set cursor
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - Y_AXIS_WIDTH
    const graphW = rect.width - Y_AXIS_WIDTH
    if (graphW > 0) lastMouseFracRef.current = Math.max(0, Math.min(1, x / graphW))
    if (beatEditMode) {
      const { beatIndex } = getBeatEditStateAtClientX(e.clientX)
      canvas.style.cursor = beatIndex !== null ? 'pointer' : 'crosshair'
    }
  }, [beatEditMode, getBeatEditStateAtClientX])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didRangeSelectRef.current) {
      didRangeSelectRef.current = false
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const graphW = rect.width - Y_AXIS_WIDTH
    if (graphW <= 0) return

    if (beatEditMode) {
      const { beatIndex } = getBeatEditStateAtClientX(e.clientX)
      if (beatIndex !== null) {
        e.preventDefault()
        setSelectedBeatIndex((prev) => (prev === beatIndex ? null : beatIndex))
        return
      }
    }

    if (!isPlaying && onSeekToSeconds) {
      const bounds = viewBoundsRef.current
      const x = e.clientX - rect.left - Y_AXIS_WIDTH
      const seconds = bounds.viewStart + (x / graphW) * bounds.viewDuration
      onSeekToSeconds(Math.max(0, Math.min(rangeDuration, seconds)))
    }
  }, [beatEditMode, isPlaying, onSeekToSeconds, rangeDuration, getBeatEditStateAtClientX])

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    if (beatEditMode && onBeatMove && beatTimestampsMs?.length) {
      const { beatIndex } = getBeatEditStateAtClientX(e.clientX)
      if (beatIndex !== null) {
        e.preventDefault()
        setDraggingBeatIndex(beatIndex)
        setDragPreviewMs(beatTimestampsMs[beatIndex])
        return
      }
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - Y_AXIS_WIDTH
    const graphW = rect.width - Y_AXIS_WIDTH
    if (graphW <= 0) return
    const bounds = viewBoundsRef.current
    const timeSec = bounds.viewStart + (x / graphW) * bounds.viewDuration
    rangeSelectRef.current = { startSec: Math.max(0, timeSec), startClientX: e.clientX, active: false }
    setRangeSelection(null)
  }, [beatEditMode, onBeatMove, beatTimestampsMs, getBeatEditStateAtClientX])

  const handleCanvasContextMenu = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Beat removal is done via Remove beat button after selecting a line
  }, [])

  // Keyboard zoom: Ctrl+Plus / Ctrl+Minus (only when hovering the spectrogram)
  const onZoomAtSecondsRef = useRef(onZoomAtSeconds)
  onZoomAtSecondsRef.current = onZoomAtSeconds
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onEnter = () => { isHoveredRef.current = true }
    const onLeave = () => { isHoveredRef.current = false }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHoveredRef.current) return
      if (!e.ctrlKey && !e.metaKey) return
      const bounds = viewBoundsRef.current
      const anchorSeconds = bounds.viewStart + lastMouseFracRef.current * bounds.viewDuration
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        onZoomAtSecondsRef.current('in', anchorSeconds, lastMouseFracRef.current)
      } else if (e.key === '-') {
        e.preventDefault()
        onZoomAtSecondsRef.current('out', anchorSeconds, lastMouseFracRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [hasAudio])

  // Esc clears the range selection (so the user can quickly drop a mark).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      setRangeSelection(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Document-level drag handlers for moving a beat
  dragPreviewMsRef.current = dragPreviewMs
  useEffect(() => {
    if (draggingBeatIndex === null) return
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const bounds = viewBoundsRef.current
      const x = e.clientX - rect.left - Y_AXIS_WIDTH
      const graphW = rect.width - Y_AXIS_WIDTH
      if (graphW <= 0) return
      const timeSec = bounds.viewStart + (x / graphW) * bounds.viewDuration
      const ms = Math.max(0, timeSec * 1000)
      dragPreviewMsRef.current = ms
      setDragPreviewMs(ms)
    }
    const onUp = () => {
      const finalMs = dragPreviewMsRef.current
      if (draggingBeatIndex !== null && finalMs !== null && onBeatMove) {
        onBeatMove(draggingBeatIndex, finalMs)
      }
      setDraggingBeatIndex(null)
      setDragPreviewMs(null)
      dragPreviewMsRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [draggingBeatIndex, onBeatMove])

  // Document-level drag handlers for range selection measurement
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rs = rangeSelectRef.current
      if (!rs) return
      if (!rs.active && Math.abs(e.clientX - rs.startClientX) < 3) return
      rs.active = true
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left - Y_AXIS_WIDTH
      const graphW = rect.width - Y_AXIS_WIDTH
      if (graphW <= 0) return
      const bounds = viewBoundsRef.current
      const timeSec = bounds.viewStart + (x / graphW) * bounds.viewDuration
      setRangeSelection({ startSec: rs.startSec, endSec: Math.max(0, timeSec) })
    }
    const onUp = () => {
      const rs = rangeSelectRef.current
      if (rs?.active) didRangeSelectRef.current = true
      rangeSelectRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Notify parent when range selection changes (so Play can use it for section-only playback)
  useEffect(() => {
    onRangeSelectionChange?.(rangeSelection)
  }, [rangeSelection, onRangeSelectionChange])

  // Clear selection when beats array shrinks (e.g. after remove)
  useEffect(() => {
    const len = beatTimestampsMs?.length ?? 0
    if (selectedBeatIndex !== null && selectedBeatIndex >= len) {
      setSelectedBeatIndex(null)
    }
  }, [beatTimestampsMs?.length, selectedBeatIndex])

  // Clear selection when exiting edit beat mode so the beat reverts to normal color
  useEffect(() => {
    if (!beatEditMode) {
      setSelectedBeatIndex(null)
    }
  }, [beatEditMode])

  // Resize canvas to wrapper and repaint (wrapper fills resizable parent height)
  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) return
    const updateSize = () => {
      const w = wrapper.clientWidth
      const h = Math.max(80, wrapper.clientHeight)
      if (w > 0 && canvas.width !== w) canvas.width = w
      if (h > 0 && canvas.height !== h) canvas.height = h
      paintRef.current()
    }
    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [hasAudio])

  // Measure horizontal scroll viewport width
  useEffect(() => {
    const el = scrollViewRef.current
    if (!el) return
    const update = () => setScrollViewWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasAudio])

  const scrollContentWidth = scrollViewWidth > 0 && viewDuration > 0
    ? scrollViewWidth * (rangeDuration / viewDuration)
    : scrollViewWidth
  const scrollMaxLeft = Math.max(0, scrollContentWidth - scrollViewWidth)
  const scrollableDuration = Math.max(0, rangeDuration - viewDuration)

  // Sync horizontal scroll position from unified view range
  useEffect(() => {
    const el = scrollViewRef.current
    if (!el || scrollMaxLeft <= 0 || scrollableDuration <= 0) return
    const target = (viewStart / scrollableDuration) * scrollMaxLeft
    if (Math.abs(el.scrollLeft - target) >= 1) {
      isProgrammaticScrollRef.current = true
      el.scrollLeft = Math.max(0, Math.min(scrollMaxLeft, target))
    }
  }, [viewStart, scrollMaxLeft, scrollableDuration])

  const handleScrollbarScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false
      return
    }
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      scrollDebounceRef.current = null
      const el = scrollViewRef.current
      if (!el || scrollableDuration <= 0 || scrollMaxLeft <= 0 || !onScrollToSeconds) return
      const startSec = (el.scrollLeft / scrollMaxLeft) * scrollableDuration
      onScrollToSeconds(Math.max(0, Math.min(scrollableDuration, startSec)))
    }, 80)
  }, [scrollableDuration, scrollMaxLeft, onScrollToSeconds])

  useEffect(() => () => {
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
  }, [])

  // Paint static background: spectrogram image + Y-axis + X-axis + beat markers
  // Result is stored in bgCanvasRef so paintForeground can blit it cheaply each frame.
  const paintBackground = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = canvas.width
    const height = canvas.height
    const graphLeft = Y_AXIS_WIDTH
    const graphWidth = Math.max(0, width - Y_AXIS_WIDTH)
    const graphHeight = Math.max(0, height - AXIS_HEIGHT)

    // Ensure bgCanvas matches display canvas size
    let bg = bgCanvasRef.current
    if (!bg || bg.width !== width || bg.height !== height) {
      bg = document.createElement('canvas')
      bg.width = width
      bg.height = height
      bgCanvasRef.current = bg
    }
    const ctx = bg.getContext('2d')
    if (!ctx) return

    const img = spectrogramImageRef.current
    if (!img) {
      ctx.fillStyle = 'rgb(18, 22, 32)'
      ctx.fillRect(0, 0, width, height)
      if (loading) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = '14px sans-serif'
        ctx.fillText('Loading spectrogram…', graphLeft + 12, height / 2)
      } else if (error) {
        ctx.fillStyle = 'rgba(255,120,120,0.9)'
        ctx.font = '14px sans-serif'
        ctx.fillText(error, graphLeft + 12, height / 2)
      }
      return
    }

    const duration = decodedDurationRef.current || durationSeconds || 1
    if (duration <= 0) return

    let offscreen = offscreenCanvasRef.current
    if (!offscreen || offscreen.width !== img.width || offscreen.height !== img.height) {
      offscreen = document.createElement('canvas')
      offscreen.width = img.width
      offscreen.height = img.height
      offscreenCanvasRef.current = offscreen
    }
    offscreen.getContext('2d')?.putImageData(img, 0, 0)

    // Clear Y-axis area
    ctx.fillStyle = 'rgb(18, 22, 32)'
    ctx.fillRect(0, 0, graphLeft, height)

    // Draw the slice that matches the visible view; clamp to image bounds when view extends past decoded audio
    const drawStart = Math.max(0, Math.min(viewStart, duration))
    const drawEnd = Math.max(0, Math.min(viewEnd, duration))
    if (drawStart < drawEnd) {
      const srcX = (drawStart / duration) * img.width
      const srcW = ((drawEnd - drawStart) / duration) * img.width
      const destX = graphLeft + ((drawStart - viewStart) / viewDuration) * graphWidth
      const destW = ((drawEnd - drawStart) / viewDuration) * graphWidth
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(offscreen, srcX, 0, srcW, img.height, destX, 0, destW, graphHeight)
    }
    // Fill any part of the view that extends beyond the image (song longer than decoded audio)
    if (viewStart < drawStart) {
      ctx.fillStyle = 'rgb(18, 22, 32)'
      ctx.fillRect(graphLeft, 0, ((drawStart - viewStart) / viewDuration) * graphWidth, graphHeight)
    }
    if (viewEnd > drawEnd) {
      ctx.fillStyle = 'rgb(18, 22, 32)'
      const fillLeft = graphLeft + ((drawEnd - viewStart) / viewDuration) * graphWidth
      ctx.fillRect(fillLeft, 0, graphWidth - (fillLeft - graphLeft), graphHeight)
    }

  }, [
    loading,
    error,
    durationSeconds,
    bpm,
    beatOffset,
    beatTimestampsMs,
    viewStart,
    viewEnd,
    viewDuration,
    visibleSpanBeats,
    beatEditMode,
    dragPreviewMs,
    selectedBeatIndex,
  ])

  // Paint foreground: blit background then draw playhead + range selection overlay.
  // Cheap — called on every currentTimeSeconds tick.
  const paintForeground = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.width
    const height = canvas.height
    const graphLeft = Y_AXIS_WIDTH
    const graphWidth = Math.max(0, width - Y_AXIS_WIDTH)
    const graphHeight = Math.max(0, height - AXIS_HEIGHT)

    // Blit the pre-rendered background (if available, else trigger a full repaint)
    const bg = bgCanvasRef.current
    if (!bg || bg.width !== width || bg.height !== height) {
      paintBackground()
      return
    }
    ctx.drawImage(bg, 0, 0)

    // Playhead
    let playheadX =
      viewDuration > 0
        ? graphLeft + ((currentTimeSeconds - viewStart) / viewDuration) * graphWidth
        : graphLeft
    playheadX = Math.max(graphLeft, Math.min(width, playheadX))
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, graphHeight)
    ctx.stroke()

    // Y-axis: frequency labels (piecewise-linear scale)
    const maxFreq = decodedSampleRateRef.current / 2
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '10px sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    for (const freq of FREQ_TICKS) {
      if (freq <= 0 || freq > maxFreq) continue
      const frac = freqFracToDisplay(freq / maxFreq) // mapped display fraction
      const y = graphHeight * (1 - frac)
      if (y < 4 || y > graphHeight - 4) continue
      ctx.fillText(freqLabel(freq), graphLeft - 6, y)
      ctx.beginPath()
      ctx.moveTo(graphLeft - 3, y)
      ctx.lineTo(graphLeft, y)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Clear X-axis strip so previous labels don't linger when visible range changes
    ctx.fillStyle = 'rgb(18, 22, 32)'
    ctx.fillRect(graphLeft, graphHeight, graphWidth, height - graphHeight)

    // X-axis: beats (primary, whole numbers) and seconds (secondary, may be fractional)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const hasBpm = bpm != null && bpm > 0
    const viewStartBeat = ((viewStart - beatOffset) * bpm!) / 60
    const viewEndBeat = ((viewEnd - beatOffset) * bpm!) / 60
    const viewSpanBeats = Math.max(0.001, viewEndBeat - viewStartBeat)
    // Use timeline's visible beat span for grid density when available, so at max zoom we always see every beat
    const spanForStep = visibleSpanBeats != null && visibleSpanBeats > 0 ? visibleSpanBeats : viewSpanBeats

    if (beatTimestampsMs && beatTimestampsMs.length > 0) {
      // Detected beats: green vertical lines (primary). In beat edit mode draw every beat in view for hit-test.
      let beatsInView = 0
      for (let i = 0; i < beatTimestampsMs.length; i++) {
        const sec = beatTimestampsMs[i] / 1000
        if (sec >= viewStart && sec <= viewEnd) beatsInView++
      }
      const stepBeats = beatEditMode ? 1 : beatAxisStep(beatsInView)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.font = '12px sans-serif'
      for (let i = 0; i < beatTimestampsMs.length; i++) {
        if (i % stepBeats !== 0) continue
        const sec = beatTimestampsMs[i] / 1000
        if (sec < viewStart || sec > viewEnd) continue
        const x = graphLeft + ((sec - viewStart) / viewDuration) * graphWidth
        if (x < graphLeft || x > width) continue
        const isSelected = selectedBeatIndex === i
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, graphHeight)
        ctx.strokeStyle = isSelected ? 'rgba(255, 180, 0, 0.95)' : 'rgba(0, 255, 100, 0.7)'
        ctx.lineWidth = beatEditMode ? (isSelected ? 3.5 : 2.5) : 2
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, graphHeight)
        ctx.lineTo(x, height)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
        if (!beatEditMode || i % Math.max(1, beatAxisStep(beatsInView)) === 0) {
          ctx.fillText(String(i), x, graphHeight + 2)
          const secLabel = sec % 1 === 0 ? `${Math.round(sec)}s` : `${sec.toFixed(2)}s`
          ctx.font = '10px sans-serif'
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
          ctx.fillText(secLabel, x, graphHeight + 16)
          ctx.font = '12px sans-serif'
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        }
      }
      // Drag preview line when moving a beat
      if (dragPreviewMs !== null) {
        const sec = dragPreviewMs / 1000
        if (sec >= viewStart && sec <= viewEnd) {
          const x = graphLeft + ((sec - viewStart) / viewDuration) * graphWidth
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = 'rgba(255, 180, 0, 0.9)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, graphHeight)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
    } else if (hasBpm) {
      // No detected beats: draw white BPM grid through spectrogram + axis below
      const stepBeats = beatAxisStep(spanForStep)
      const firstTickBeat = Math.ceil(viewStartBeat / stepBeats) * stepBeats
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.font = '12px sans-serif'
      for (let beat = firstTickBeat; beat <= viewEndBeat; beat += stepBeats) {
        const x = graphLeft + ((beat - viewStartBeat) / viewSpanBeats) * graphWidth
        if (x < graphLeft || x > width) continue
        // White grid line through full spectrogram height
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, graphHeight)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // Axis tick below spectrogram
        ctx.beginPath()
        ctx.moveTo(x, graphHeight)
        ctx.lineTo(x, height)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillText(String(Math.round(beat)), x, graphHeight + 2)
        const sec = (beat * 60) / bpm! + beatOffset
        const secLabel = sec % 1 === 0 ? `${Math.round(sec)}s` : `${sec.toFixed(2)}s`
        ctx.font = '10px sans-serif'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
        ctx.fillText(secLabel, x, graphHeight + 16)
        ctx.font = '12px sans-serif'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      }
    } else {
      const step = timeAxisStep(viewDuration)
      const firstTick = Math.ceil(viewStart / step) * step
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.font = '12px sans-serif'
      for (let t = firstTick; t <= viewEnd; t += step) {
        const x = graphLeft + ((t - viewStart) / viewDuration) * graphWidth
        if (x < graphLeft || x > width) continue
        ctx.beginPath()
        ctx.moveTo(x, graphHeight)
        ctx.lineTo(x, height)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
        const label = t % 1 === 0 ? `${Math.round(t)}s` : `${t.toFixed(1)}s`
        ctx.fillText(label, x, graphHeight + 2)
      }
    }

    // Range selection overlay and duration label
    if (rangeSelection) {
      const selStart = Math.min(rangeSelection.startSec, rangeSelection.endSec)
      const selEnd = Math.max(rangeSelection.startSec, rangeSelection.endSec)
      const x1 = Math.max(graphLeft, graphLeft + ((selStart - viewStart) / viewDuration) * graphWidth)
      const x2 = Math.min(width, graphLeft + ((selEnd - viewStart) / viewDuration) * graphWidth)
      if (x2 > x1) {
        ctx.fillStyle = 'rgba(70, 160, 255, 0.2)'
        ctx.fillRect(x1, 0, x2 - x1, graphHeight)

        ctx.strokeStyle = 'rgba(70, 160, 255, 0.85)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x1, 0)
        ctx.lineTo(x1, graphHeight)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x2, 0)
        ctx.lineTo(x2, graphHeight)
        ctx.stroke()
        ctx.setLineDash([])

        const selDuration = selEnd - selStart
        const label = `${selDuration.toFixed(3)}s`
        ctx.font = 'bold 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const tw = ctx.measureText(label).width
        const pad = 6
        const lh = 20
        const midX = (x1 + x2) / 2
        const ly = 6
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
        ctx.beginPath()
        ctx.roundRect(midX - tw / 2 - pad, ly, tw + pad * 2, lh, 4)
        ctx.fill()
        ctx.fillStyle = 'rgba(70, 160, 255, 1)'
        ctx.fillText(label, midX, ly + 3)
      }
    }
  }, [currentTimeSeconds, viewStart, viewEnd, viewDuration, rangeSelection, paintBackground])

  // Wire up: repaint background when static deps change, then blit foreground.
  // Foreground-only repaint on currentTimeSeconds ticks.
  const paint = useCallback(() => {
    paintBackground()
    paintForeground()
  }, [paintBackground, paintForeground])

  paintRef.current = paint
  useEffect(() => {
    paintBackground()
  }, [paintBackground])
  useEffect(() => {
    paintForeground()
  }, [paintForeground])

  useEffect(() => {
    if (isPlaying) {
      const ac = audioContextRef.current
      if (ac?.state === 'suspended') ac.resume().catch(() => {})
    }
  }, [isPlaying])

  if (!hasAudio) return null

  const handleRemoveBeat = useCallback(() => {
    if (selectedBeatIndex !== null && onBeatRemove) {
      onBeatRemove(selectedBeatIndex)
      setSelectedBeatIndex(null)
    }
  }, [selectedBeatIndex, onBeatRemove])

  const handleAddBeat = useCallback(() => {
    if (onBeatAdd) onBeatAdd(currentTimeSeconds * 1000)
  }, [onBeatAdd, currentTimeSeconds])

  return (
    <div className="spectrogram-wrapper">
      <div className="spectrogram-header">
        <span className="spectrogram-label">Spectrogram</span>
        <div className="spectrogram-header-right">
          {onBeatEditModeChange != null && (
            <label className="spectrogram-edit-beats-toggle" title="Select beats to remove or move; use Add beat / Remove beat buttons">
              <input
                type="checkbox"
                checked={beatEditMode}
                onChange={(e) => onBeatEditModeChange(e.target.checked)}
              />
              <span>Edit beats</span>
            </label>
          )}
          {beatEditMode && onBeatAdd != null && (
            <button
              type="button"
              className="spectrogram-tool-btn"
              onClick={handleAddBeat}
              title="Add a beat at current playhead position"
            >
              Add beat
            </button>
          )}
          {beatEditMode && onBeatRemove != null && (
            <button
              type="button"
              className="spectrogram-tool-btn"
              onClick={handleRemoveBeat}
              disabled={selectedBeatIndex === null}
              title="Remove the selected beat (click a green line first)"
            >
              Remove beat
            </button>
          )}
          <div className="spectrogram-zoom-controls">
            <button
              type="button"
              className="spectrogram-zoom-btn"
              onClick={() => {
                const playheadFrac = viewDuration > 0
                  ? Math.max(0, Math.min(1, (currentTimeSeconds - viewStart) / viewDuration))
                  : 0.5
                const anchorSec = viewStart + playheadFrac * viewDuration
                onZoomAtSeconds('out', anchorSec, playheadFrac)
              }}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="spectrogram-zoom-btn"
              onClick={() => {
                const playheadFrac = viewDuration > 0
                  ? Math.max(0, Math.min(1, (currentTimeSeconds - viewStart) / viewDuration))
                  : 0.5
                const anchorSec = viewStart + playheadFrac * viewDuration
                onZoomAtSeconds('in', anchorSec, playheadFrac)
              }}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>
      {beatEditMode && beatDetectControls != null && (
        <div className="spectrogram-beat-detect-toolbar">
          {beatDetectControls}
        </div>
      )}
      <div className="spectrogram-canvas-wrap" ref={wrapperRef}>
        <canvas
          ref={canvasRef}
          className="spectrogram-canvas"
          width={800}
          height={180}
          title={beatEditMode ? 'Click a green line to select it; use Remove beat to delete. Drag a line to move. Use Add beat to add at playhead.' : 'Full-song spectrogram with playhead; zooms with timeline. When stopped, click to move marker and Run from.'}
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onClick={handleCanvasClick}
          onContextMenu={handleCanvasContextMenu}
        />
      </div>
      <div
        className="spectrogram-scroll-view"
        ref={scrollViewRef}
        onScroll={handleScrollbarScroll}
      >
        <div
          className="spectrogram-scroll-content"
          style={{ width: Math.max(scrollViewWidth, scrollContentWidth) }}
        />
      </div>
    </div>
  )
}
