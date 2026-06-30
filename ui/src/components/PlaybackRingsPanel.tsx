import React from 'react'
import { Timeframe } from '../App'
import { isRingActiveAtBeat } from '../movementGenerators'
import RingVisualization from './RingVisualization'
import RingVisualizationCanvas from './RingVisualizationCanvas'
import { computeClockColors } from '../clockPreview'
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
  brightness: number
  brightnessConnected: boolean
  onBrightnessChange: (v: number) => void
  /** Open the fullscreen live VJ console instead of the plain fullscreen viz. */
  onOpenLiveConsole?: () => void
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
  brightness,
  brightnessConnected,
  onBrightnessChange,
  onOpenLiveConsole,
}: PlaybackRingsPanelProps) => {
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
          <h2>Playback</h2>
          <label className="playback-run-from" title="Timeline position when you press Run">
            <span>Run from</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={runFromSeconds}
              onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n >= 0) onRunFromChange(n) }}
              className="playback-run-from-input"
            />
            <span>sec</span>
          </label>
          <div className="playback-brightness-group">
            <span className={`playback-brightness-dot${brightnessConnected ? ' connected' : ''}`} title={brightnessConnected ? 'MQTT broker connected' : 'MQTT broker not connected'} />
            <span className="playback-brightness-label">Brightness</span>
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
              title="Global brightness"
            />
          </div>
          <div className="playback-rings-panel-time">
            Time: {currentTime.toFixed(1)}b
          </div>
        </div>
        <div className="playback-rings-panel-controls">
          <button
            className={`playback-mute-btn${muteAudio ? ' muted' : ''}`}
            onClick={() => onMuteAudioChange?.(!muteAudio)}
            title={muteAudio ? 'Unmute simulator audio' : 'Mute simulator audio (useful in Live mode to avoid echo from device)'}
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
            {isPlaying && !useSimSpeed ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="playback-ctrl-btn stop" onClick={onStop}>
            ⏹ Stop
          </button>
          <label className="playback-live-mode" title="When on, Run also starts the song on the device; Stop sends stop.">
            <input
              type="checkbox"
              checked={liveMode}
              onChange={(e) => onLiveModeChange(e.target.checked)}
            />
            <span>Live</span>
          </label>
          <button
            className="playback-ctrl-btn send"
            onClick={onSendSequence}
            disabled={sendSequenceLoading || !apiAvailable}
            title={!apiAvailable ? 'Control server is not running' : 'Send current sequence to LEDs'}
          >
            {sendSequenceLoading ? '…' : 'Send to LEDs'}
          </button>
          <button
            className={`playback-mute-btn playback-clock-btn${clockMode ? ' active' : ''}`}
            onClick={() => setClockMode(m => !m)}
            title="Preview clock mode — shows live time across all 12 rings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          {!liveMode && (
            <div className="playback-speed-group">
              <div className="playback-speed-divider" />
              <span className="playback-speed-label">Speed</span>
              <button
                className={`playback-speed-btn ${isPlaying && useSimSpeed ? 'playing' : ''}`}
                onClick={onSimPlayPause}
                title="Play/pause at sim speed"
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
                title="Playback speed"
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
                Clock — {clockNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </span>
              <div className="playback-zoom-controls">
                <span className="playback-zoom-label">Zoom</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
                <span className="playback-zoom-value" title="Ctrl+scroll over visualizer to zoom">{Math.round(zoom * 100)}%</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
                <button className="playback-zoom-btn" onClick={() => { setZoom(1.0); setResetPanToken(t => t + 1) }} title="Reset zoom" style={{ fontSize: 10 }}>1:1</button>
                <button className="playback-zoom-btn" onClick={openFullscreen} title="Open live console (fullscreen)" style={{ fontSize: 13 }}>⛶</button>
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
              <span className="playback-rings-panel-segment-label">{activeTimeframes.length} active segment{activeTimeframes.length > 1 ? 's' : ''}</span>
              <span className="playback-rings-panel-segment-range">{activeRings.length} active ring{activeRings.length > 1 ? 's' : ''}</span>
              <div className="playback-zoom-controls">
                <span className="playback-zoom-label">Zoom</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
                <span className="playback-zoom-value" title="Ctrl+scroll over visualizer to zoom">{Math.round(zoom * 100)}%</span>
                <button className="playback-zoom-btn" onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
                <button className="playback-zoom-btn" onClick={() => { setZoom(1.0); setResetPanToken(t => t + 1) }} title="Reset zoom" style={{ fontSize: 10 }}>1:1</button>
                <button className="playback-zoom-btn" onClick={openFullscreen} title="Open live console (fullscreen)" style={{ fontSize: 13 }}>⛶</button>
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
            <p>No active segment at {currentTime.toFixed(1)}b</p>
            <p className="playback-rings-panel-empty-hint">
                Scrub the timeline or press Run to see rings update
            </p>
          </div>
        )}
      </div>
      {fullscreen && (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0c10', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', color: '#cde3ff', borderBottom: '1px solid #222' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {clockMode ? 'Clock preview' : activeTimeframes.length > 0
                ? `${activeTimeframes.length} active segment${activeTimeframes.length > 1 ? 's' : ''} · ${activeRings.length} rings · ${currentTime.toFixed(1)}b`
                : 'No active segment'}
            </span>
            <button onClick={() => setFullscreen(false)} style={{ background: '#3a3f4b', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>✕ Close (Esc)</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            {clockMode && clockColors ? (
              <RingVisualizationCanvas colors={clockColors} zoom={zoom} onZoomChange={(z) => setZoom(clampZoom(z))} resetPanToken={resetPanToken} fit="box" />
            ) : activeTimeframes.length > 0 ? (
              <RingVisualization mapping="all" activeRings={activeRings} timeframes={activeTimeframes} currentTime={currentTime} zoom={zoom} onZoomChange={(z) => setZoom(clampZoom(z))} resetPanToken={resetPanToken} globalBrightness={brightness} />
            ) : (
              <div style={{ color: '#789' }}>No active segment — scrub the timeline or press Run.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PlaybackRingsPanel
