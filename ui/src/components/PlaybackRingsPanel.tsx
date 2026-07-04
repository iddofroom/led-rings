import React from 'react'
import { Timeframe } from '../App'
import { isRingActiveAtBeat } from '../movementGenerators'
import RingVisualization from './RingVisualization'
import RingVisualizationCanvas from './RingVisualizationCanvas'
import { computeClockColors } from '../clockPreview'
import { useI18n } from '../lib/i18n'
import './PlaybackRingsPanel.css'

interface PlaybackRingsPanelProps {
  currentTime: number
  timeframes: Timeframe[]
  isPlaying: boolean
  liveMode: boolean
  sendSequenceLoading: boolean
  apiAvailable: boolean
  onPlayPause: () => void
  onStop: () => void
  onSendSequence: () => void
  onLiveModeChange: (value: boolean) => void
  muteAudio?: boolean
  onMuteAudioChange?: (value: boolean) => void
  playbackSpeed: number
  onPlaybackSpeedChange: (speed: number) => void
  useSimSpeed: boolean
  onSimPlayPause: () => void
  runFromSeconds: number
  onRunFromChange: (n: number) => void
  /** Reset Run from to a literal 0s (before beat 0, where the marker can't reach). */
  onResetRunFrom: () => void
  brightness: number
  brightnessConnected: boolean
  onBrightnessChange: (v: number) => void
  /** Open the fullscreen live VJ console instead of the plain fullscreen viz. */
  onOpenLiveConsole?: () => void
  /** Called when the clock preview toggle changes. Lets the parent push an MQTT trigger in Live mode. */
  onClockModeChange?: (active: boolean) => void
}

function getActiveTimeframesAt(time: number, timeframes: Timeframe[]): Timeframe[] {
  return timeframes.filter(
    (tf) => !tf.disabled && time >= tf.startTime && time < tf.endTime
  )
}

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.25
const ZOOM_MAX = 10

const SPEED_MIN = 0.1
const SPEED_MAX = 4.0
const SPEED_STEP = 0.1
const SPEED_TICKS = [0.5, 1.0, 2.0, 3.0, 4.0]

const PlaybackRingsPanel = ({
  currentTime,
  timeframes,
  isPlaying,
  liveMode,
  sendSequenceLoading,
  apiAvailable,
  onPlayPause,
  onStop,
  onSendSequence,
  onLiveModeChange,
  muteAudio,
  onMuteAudioChange,
  playbackSpeed,
  onPlaybackSpeedChange,
  useSimSpeed,
  onSimPlayPause,
  runFromSeconds,
  onRunFromChange,
  onResetRunFrom,
  brightness,
  brightnessConnected,
  onBrightnessChange,
  onOpenLiveConsole,
  onClockModeChange,
}: PlaybackRingsPanelProps) => {
  const { t } = useI18n()
  const openFullscreen = () => (onOpenLiveConsole ? onOpenLiveConsole() : setFullscreen(true))
  // FPS counter: measure time between renders, keep a rolling window of 30 samples
  const fpsRef = React.useRef<number>(0)
  const lastFrameTime = React.useRef<number>(0)
  const frameTimes = React.useRef<number[]>([])
  const now = performance.now()
  if (lastFrameTime.current > 0) {
    const delta = now - lastFrameTime.current
    frameTimes.current.push(delta)
    if (frameTimes.current.length > 30) frameTimes.current.shift()
    const avg = frameTimes.current.reduce((a, b) => a + b, 0) / frameTimes.current.length
    fpsRef.current = Math.round(1000 / avg)
  }
  lastFrameTime.current = now

  const [zoom, setZoom] = React.useState(1.0)
  const [resetPanToken, setResetPanToken] = React.useState(0)
  const [fullscreen, setFullscreen] = React.useState(false)
  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100))
  const [brightnessInput, setBrightnessInput] = React.useState<string | null>(null)
  React.useEffect(() => { setBrightnessInput(null) }, [brightness])

  // Run-from accepts seconds (153), mm:ss (2:33), or hh:mm:ss (1:02:33).
  // Display preserves the user's chosen format until they type again.
  const formatRunFrom = (sec: number): string => {
    if (sec < 60) return sec % 1 === 0 ? String(sec) : sec.toFixed(1)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const sStr = s % 1 === 0 ? String(Math.floor(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sStr}` : `${m}:${sStr}`
  }
  const parseRunFrom = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed)
    const parts = trimmed.split(':')
    if (parts.length < 2 || parts.length > 3) return null
    const nums = parts.map(p => parseFloat(p))
    if (nums.some(n => isNaN(n) || n < 0)) return null
    return parts.length === 2
      ? nums[0] * 60 + nums[1]
      : nums[0] * 3600 + nums[1] * 60 + nums[2]
  }
  const [runFromInput, setRunFromInput] = React.useState<string | null>(null)
  React.useEffect(() => { setRunFromInput(null) }, [runFromSeconds])

  const [clockMode, setClockMode] = React.useState(false)
  const [clockNow, setClockNow] = React.useState(() => new Date())
  React.useEffect(() => {
    if (!clockMode) return
    setClockNow(new Date())
    const id = setInterval(() => setClockNow(new Date()), 1000 / 30)
    return () => clearInterval(id)
  }, [clockMode])
  const clockColors = React.useMemo(
    () => clockMode ? computeClockColors(clockNow, brightness) : null,
    [clockMode, clockNow, brightness]
  )

  const activeTimeframes = getActiveTimeframesAt(currentTime, timeframes)
  const activeRings = Array.from(new Set(
    activeTimeframes.flatMap(tf =>
      tf.rings.filter(r =>
        isRingActiveAtBeat(tf.startTime, tf.endTime, tf.rings, tf.movement, r, currentTime)
      )
    )
  ))

  return (
    <div className="playback-rings-panel">
      <div className="playback-rings-panel-header">
        <div className="playback-rings-panel-header-top">
          <h2>{t({ en: 'Playback', he: 'השמעה' })}</h2>
          <label className="playback-run-from" title={t({ en: 'Timeline position when you press Run. Accepts seconds (153), mm:ss (2:33), or hh:mm:ss (1:02:33).', he: 'מיקום בציר הזמן בעת לחיצה על הפעל. מקבל שניות (153), mm:ss (2:33), או hh:mm:ss (1:02:33).' })}>
            <span>{t({ en: 'Run from', he: 'הפעל מ־' })}</span>
            <input
              type="text"
              inputMode="decimal"
              value={runFromInput ?? formatRunFrom(runFromSeconds)}
              onChange={(e) => setRunFromInput(e.target.value)}
              onBlur={() => {
                const n = parseRunFrom(runFromInput ?? '')
                if (n !== null) onRunFromChange(n)
                setRunFromInput(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRunFromInput(null)
              }}
              className="playback-run-from-input"
            />
            <button
              type="button"
              className="playback-run-from-reset"
              title={t({ en: 'Reset Run from to 0', he: 'אפס הפעל מ־ ל־0' })}
              aria-label={t({ en: 'Reset Run from to 0', he: 'אפס הפעל מ־ ל־0' })}
              onClick={() => { setRunFromInput(null); onResetRunFrom() }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </label>
          <div className="playback-brightness-group">
            <span className={`playback-brightness-dot${brightnessConnected ? ' connected' : ''}`} title={brightnessConnected ? t({ en: 'MQTT broker connected', he: 'ברוקר MQTT מחובר' }) : t({ en: 'MQTT broker not connected', he: 'ברוקר MQTT לא מחובר' })} />
            <span className="playback-brightness-label">{t({ en: 'Brightness', he: 'בהירות' })}</span>
            <input
              type="range"
              className="playback-brightness-slider"
              min={0}
              max={1}
              step={0.01}
              value={brightness}
              disabled={!brightnessConnected}
              onChange={(e) => onBrightnessChange(parseFloat(e.target.value))}
            />
            <input
              type="number"
              className="playback-brightness-value"
              min={0}
              max={1}
              step={0.01}
              value={brightnessInput ?? brightness.toFixed(2)}
              disabled={!brightnessConnected}
              onChange={(e) => setBrightnessInput(e.target.value)}
              onBlur={() => {
                const n = parseFloat(brightnessInput ?? '')
                if (!isNaN(n)) onBrightnessChange(Math.max(0, Math.min(1, n)))
                setBrightnessInput(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setBrightnessInput(null)
              }}
              title={t({ en: 'Global brightness', he: 'בהירות גלובלית' })}
            />
          </div>
          <div className="playback-rings-panel-time">
            {t({ en: 'Time', he: 'זמן' })}: {currentTime.toFixed(1)}b
          </div>
        </div>
        <div className="playback-rings-panel-controls">
          <button
            className={`playback-mute-btn${muteAudio ? ' muted' : ''}`}
            onClick={() => onMuteAudioChange?.(!muteAudio)}
            title={muteAudio ? t({ en: 'Unmute simulator audio', he: 'בטל השתקת אודיו הסימולטור' }) : t({ en: 'Mute simulator audio (useful in Live mode to avoid echo from device)', he: 'השתק את אודיו הסימולטור (שימושי במצב לייב כדי למנוע הד מההתקן)' })}
          >
            {muteAudio ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
            )}
          </button>
          <button
            className={`playback-ctrl-btn ${isPlaying && !useSimSpeed ? 'playing' : ''}`}
            onClick={onPlayPause}
          >
            {isPlaying && !useSimSpeed ? `⏸ ${t({ en: 'Pause', he: 'השהה' })}` : `▶ ${t({ en: 'Run', he: 'הפעל' })}`}
          </button>
          <button className="playback-ctrl-btn stop" onClick={onStop}>
            ⏹ {t({ en: 'Stop', he: 'עצור' })}
          </button>
          <label className="playback-live-mode" title={t({ en: 'When on, Run also starts the song on the device; Stop sends stop.', he: 'כשפעיל, הפעל מתחיל גם את השיר על ההתקן; עצור שולח עצירה.' })}>
            <input
              type="checkbox"
              checked={liveMode}
              onChange={(e) => onLiveModeChange(e.target.checked)}
            />
            <span>{t({ en: 'Live', he: 'לייב' })}</span>
          </label>
          <button
            className="playback-ctrl-btn send"
            onClick={onSendSequence}
            disabled={sendSequenceLoading || !apiAvailable}
            title={!apiAvailable ? t({ en: 'Control server is not running', he: 'שרת הבקרה אינו פועל' }) : t({ en: 'Send current sequence to LEDs', he: 'שלח את הרצף הנוכחי ללדים' })}
          >
            {sendSequenceLoading ? '…' : t({ en: 'Send to LEDs', he: 'שלח ללדים' })}
          </button>
          <button
            className={`playback-mute-btn playback-clock-btn${clockMode ? ' active' : ''}`}
            onClick={() => {
              setClockMode(m => {
                const next = !m
                onClockModeChange?.(next)
                return next
              })
            }}
            title={t({ en: 'Preview clock mode — shows live time across all 12 rings', he: 'תצוגה מקדימה של מצב שעון — מציג זמן חי על כל 12 הטבעות' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          {!liveMode && (
            <div className="playback-speed-group">
              <div className="playback-speed-divider" />
              <span className="playback-speed-label">{t({ en: 'Speed', he: 'מהירות' })}</span>
              <button
                className={`playback-speed-btn ${isPlaying && useSimSpeed ? 'playing' : ''}`}
                onClick={onSimPlayPause}
                title={t({ en: 'Play/pause at sim speed', he: 'הפעל/השהה במהירות הסימולציה' })}
              >
                {isPlaying && useSimSpeed ? '⏸' : '▶'}
              </button>
              <div className="playback-speed-slider-wrap">
                <input
                  type="range"
                  className="playback-speed-slider"
                  min={SPEED_MIN}
                  max={SPEED_MAX}
                  step={SPEED_STEP}
                  value={playbackSpeed}
                  onChange={(e) => onPlaybackSpeedChange(parseFloat(e.target.value))}
                />
                <div className="playback-speed-ticks">
                  {SPEED_TICKS.map(t => (
                    <div
                      key={t}
                      className={`playback-speed-tick ${t === 1.0 ? 'playback-speed-tick-one' : ''}`}
                      style={{ left: `${((t - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%` }}
                    >
                      <div className="playback-speed-tick-mark" />
                    </div>
                  ))}
                </div>
              </div>
              <input
                type="number"
                className="playback-speed-value"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={playbackSpeed.toFixed(1)}
                onChange={(e) => {
                  const n = parseFloat(e.target.value)
                  if (!isNaN(n)) onPlaybackSpeedChange(Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(n * 10) / 10)))
                }}
                title={t({ en: 'Playback speed', he: 'מהירות השמעה' })}
              />
            </div>
          )}
        </div>
      </div>
      <div className="playback-rings-panel-content">
        {clockMode && clockColors ? (
          <>
            <div className="playback-rings-panel-segment">
              <span className="playback-rings-panel-segment-label">
                {t({ en: 'Clock', he: 'שעון' })} — {clockNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </span>
              <div className="playback-zoom-controls">
                <span className="playback-zoom-label">{t({ en: 'Zoom', he: 'זום' })}</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} title={t({ en: 'Zoom out', he: 'הקטן זום' })}>−</button>
                <span className="playback-zoom-value" title={t({ en: 'Ctrl+scroll over visualizer to zoom', he: 'Ctrl+גלילה מעל התצוגה לזום' })}>{Math.round(zoom * 100)}%</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} title={t({ en: 'Zoom in', he: 'הגדל זום' })}>+</button>
                <button className="playback-zoom-btn" onClick={() => { setZoom(1.0); setResetPanToken(n => n + 1) }} title={t({ en: 'Reset zoom', he: 'אפס זום' })} style={{ fontSize: 10 }}>1:1</button>
                <button className="playback-zoom-btn" onClick={openFullscreen} title={t({ en: 'Open live console (fullscreen)', he: 'פתח קונסולת לייב (מסך מלא)' })} style={{ fontSize: 13 }}>⛶</button>
              </div>
            </div>
            <div className="playback-rings-panel-visualization">
              <RingVisualizationCanvas
                colors={clockColors}
                zoom={zoom}
                onZoomChange={z => setZoom(clampZoom(z))}
                resetPanToken={resetPanToken}
                fit="box"
              />
            </div>
          </>
        ) : activeTimeframes.length > 0 ? (
          <>
            <div className="playback-rings-panel-segment">
              <span className="playback-rings-panel-segment-label">{activeTimeframes.length} {t({ en: `active segment${activeTimeframes.length > 1 ? 's' : ''}`, he: activeTimeframes.length > 1 ? 'מקטעים פעילים' : 'מקטע פעיל' })}</span>
              <span className="playback-rings-panel-segment-range">{activeRings.length} {t({ en: `active ring${activeRings.length > 1 ? 's' : ''}`, he: activeRings.length > 1 ? 'טבעות פעילות' : 'טבעת פעילה' })}</span>
              <div className="playback-zoom-controls">
                <span className="playback-zoom-label">{t({ en: 'Zoom', he: 'זום' })}</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} title={t({ en: 'Zoom out', he: 'הקטן זום' })}>−</button>
                <span className="playback-zoom-value" title={t({ en: 'Ctrl+scroll over visualizer to zoom', he: 'Ctrl+גלילה מעל התצוגה לזום' })}>{Math.round(zoom * 100)}%</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} title={t({ en: 'Zoom in', he: 'הגדל זום' })}>+</button>
                <button className="playback-zoom-btn" onClick={() => { setZoom(1.0); setResetPanToken(n => n + 1) }} title={t({ en: 'Reset zoom', he: 'אפס זום' })} style={{ fontSize: 10 }}>1:1</button>
                <button className="playback-zoom-btn" onClick={openFullscreen} title={t({ en: 'Open live console (fullscreen)', he: 'פתח קונסולת לייב (מסך מלא)' })} style={{ fontSize: 13 }}>⛶</button>
              </div>
            </div>
            <div className="playback-rings-panel-visualization">
              <RingVisualization
                mapping="all"
                activeRings={activeRings}
                timeframes={activeTimeframes}
                currentTime={currentTime}
                zoom={zoom}
                onZoomChange={z => setZoom(clampZoom(z))}
                resetPanToken={resetPanToken}
                globalBrightness={brightness}
              />
            </div>
          </>
        ) : (
          <div className="playback-rings-panel-empty">
            <p>{t({ en: 'No active segment at', he: 'אין מקטע פעיל ב־' })} {currentTime.toFixed(1)}b</p>
            <p className="playback-rings-panel-empty-hint">
                {t({ en: 'Scrub the timeline or press Run to see rings update', he: 'גרור בציר הזמן או לחץ הפעל כדי לראות את הטבעות מתעדכנות' })}
            </p>
          </div>
        )}
      </div>
      {fullscreen && (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0c10', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', color: '#cde3ff', borderBottom: '1px solid #222' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {clockMode ? t({ en: 'Clock preview', he: 'תצוגה מקדימה של שעון' }) : activeTimeframes.length > 0
                ? `${activeTimeframes.length} ${t({ en: `active segment${activeTimeframes.length > 1 ? 's' : ''}`, he: activeTimeframes.length > 1 ? 'מקטעים פעילים' : 'מקטע פעיל' })} · ${activeRings.length} ${t({ en: 'rings', he: 'טבעות' })} · ${currentTime.toFixed(1)}b`
                : t({ en: 'No active segment', he: 'אין מקטע פעיל' })}
            </span>
            <button onClick={() => setFullscreen(false)} style={{ background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>✕ {t({ en: 'Close (Esc)', he: 'סגור (Esc)' })}</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            {clockMode && clockColors ? (
              <RingVisualizationCanvas colors={clockColors} zoom={zoom} onZoomChange={(z) => setZoom(clampZoom(z))} resetPanToken={resetPanToken} fit="box" />
            ) : activeTimeframes.length > 0 ? (
              <RingVisualization mapping="all" activeRings={activeRings} timeframes={activeTimeframes} currentTime={currentTime} zoom={zoom} onZoomChange={(z) => setZoom(clampZoom(z))} resetPanToken={resetPanToken} globalBrightness={brightness} />
            ) : (
              <div style={{ color: '#789' }}>{t({ en: 'No active segment — scrub the timeline or press Run.', he: 'אין מקטע פעיל — גרור בציר הזמן או לחץ הפעל.' })}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PlaybackRingsPanel
