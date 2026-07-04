import React, { useCallback, useEffect, useRef, useState } from 'react'
import { mappingApi, deriveThingSegments, Controller, MappedController, MappedLed } from '../lib/mapping'
import { lumaFromRgba, diff, averageLuma, detectBlob } from './detect'

/**
 * Mapping stage: aim the computer camera at the installation, drive each controller
 * to light its LEDs one at a time, detect each lit LED's (x,y) from the camera, and
 * build a per-project position map. See src/mapping (RPi) + cf-worker mapping route.
 */

const PROC_W = 480 // frames are downscaled to this width for detection (speed + fine centroids)
const DEFAULT_CAP = 512

interface Props {
  projectId: string
  projectName: string
  onBack: () => void
}

interface SweepStatus {
  thing: string
  state: 'idle' | 'preparing' | 'sweeping' | 'finishing' | 'done' | 'error'
  index: number
  found: number
  message?: string
}

const CONTROLLER_COLORS = ['#5b8cff', '#ff7a5c', '#38d39f', '#f0c020', '#c07aff', '#ff5c9e', '#5cd0ff', '#a0d020']
const colorFor = (i: number) => CONTROLLER_COLORS[i % CONTROLLER_COLORS.length]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function MappingStage({ projectId, projectName, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const abortRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const [controllers, setControllers] = useState<Controller[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)

  const [statuses, setStatuses] = useState<Record<string, SweepStatus>>({})
  const [map, setMap] = useState<Record<string, MappedController>>({})
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([])

  // Settings
  const [cap, setCap] = useState(DEFAULT_CAP)
  const [settleMs, setSettleMs] = useState(250)
  const [missLimit, setMissLimit] = useState(20)
  const [threshold, setThreshold] = useState(40)
  const [demoMode, setDemoMode] = useState(false)

  const addLog = useCallback((m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 200)), [])

  // Load any previously-saved map for this project.
  useEffect(() => {
    mappingApi
      .loadMap(projectId)
      .then((blob) => {
        if (blob?.controllers?.length) {
          const byThing: Record<string, MappedController> = {}
          for (const c of blob.controllers) byThing[c.thing] = c
          setMap(byThing)
          addLog(`Loaded saved map: ${blob.controllers.length} controller(s), ${blob.controllers.reduce((n, c) => n + c.leds.length, 0)} LEDs`)
        }
      })
      .catch(() => {})
  }, [projectId, addLog])

  // ── Camera ──
  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraOn(true)
    } catch (e: any) {
      setCameraError(e?.message || 'Camera access denied')
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  /** Grab one frame from the video, downscaled to PROC_W, as luma + dimensions. */
  const captureLuma = useCallback((): { luma: Float32Array; w: number; h: number } | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const w = PROC_W
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * PROC_W))
    let canvas = canvasRef.current
    if (!canvas) { canvas = document.createElement('canvas'); canvasRef.current = canvas }
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    return { luma: lumaFromRgba(img.data, w, h), w, h }
  }, [])

  // ── Discovery ──
  const discover = useCallback(async () => {
    setDiscovering(true)
    setDiscoverError(null)
    // Demo mode is fully offline — fabricate controllers without touching the control-server,
    // so the whole flow can be reviewed with no hardware and no Pi running.
    if (demoMode) {
      setControllers([
        { thing: 'ring1', alive: true, lastSeen: Date.now(), numPixels: 144 },
        { thing: 'ring2', alive: true, lastSeen: Date.now(), numPixels: 144 },
      ])
      addLog('Demo: fabricated 2 controllers (no hardware).')
      setDiscovering(false)
      return
    }
    try {
      const res = await mappingApi.discover()
      setControllers(res.controllers)
      addLog(`Discovered ${res.controllers.length} controller(s)${res.connected ? '' : ' (MQTT not connected)'}.`)
    } catch (e: any) {
      setDiscoverError(e?.message || 'Discovery failed')
      addLog(`Discovery failed: ${e?.message || e}`)
    } finally {
      setDiscovering(false)
    }
  }, [demoMode, addLog])

  const setStatus = useCallback((thing: string, patch: Partial<SweepStatus>) => {
    setStatuses((s) => {
      const prev: SweepStatus = s[thing] ?? { thing, state: 'idle', index: 0, found: 0 }
      return { ...s, [thing]: { ...prev, ...patch, thing } }
    })
  }, [])

  // ── Sweep one controller ──
  const sweepController = useCallback(
    async (thing: string) => {
      abortRef.current = false
      const leds: MappedLed[] = []
      let dims = { w: PROC_W, h: Math.round(PROC_W * 0.66) }

      // Demo: fabricate a ring of detections without touching hardware/camera.
      if (demoMode) {
        setStatus(thing, { state: 'sweeping', index: 0, found: 0, message: 'demo sweep' })
        const idx = controllers.findIndex((c) => c.thing === thing)
        const n = 60
        const cx = 0.3 + 0.4 * ((idx + 1) % 2) // offset the two demo controllers
        for (let i = 0; i < n; i++) {
          if (abortRef.current) break
          const a = (i / n) * Math.PI * 2
          leds.push({ index: i, x: cx + 0.18 * Math.cos(a), y: 0.5 + 0.28 * Math.sin(a), b: 0.9 })
          setStatus(thing, { state: 'sweeping', index: i, found: leds.length })
          setMap((m) => ({ ...m, [thing]: { thing, numPixels: n, imageWidth: 1280, imageHeight: 853, capturedAt: Date.now(), leds: [...leds] } }))
          await sleep(30)
        }
        setStatus(thing, { state: 'done', index: leds.length, found: leds.length, message: `${leds.length} LEDs (demo)` })
        addLog(`Demo swept ${thing}: ${leds.length} LEDs`)
        return
      }

      if (!cameraOn) { setStatus(thing, { state: 'error', message: 'Start the camera first' }); return }

      try {
        setStatus(thing, { state: 'preparing', index: 0, found: 0, message: 'preparing (ESP reboots ~10s)…' })
        addLog(`Preparing ${thing} (cap ${cap})…`)
        const prep = await mappingApi.prepare(thing, cap)
        if (!prep.rejoined) addLog(`⚠ ${thing} did not confirm rejoin — continuing anyway`)

        // Baseline: blank, let it settle, average a few dark frames.
        await mappingApi.blank()
        await sleep(Math.max(400, settleMs))
        const baseFrames: Float32Array[] = []
        for (let k = 0; k < 3; k++) { const c = captureLuma(); if (c) { baseFrames.push(c.luma); dims = { w: c.w, h: c.h } } ; await sleep(60) }
        if (baseFrames.length === 0) { setStatus(thing, { state: 'error', message: 'No camera frames' }); return }
        const baseline = averageLuma(baseFrames)

        setStatus(thing, { state: 'sweeping', index: 0, found: 0 })
        let misses = 0
        for (let i = 0; i < cap; i++) {
          if (abortRef.current) { addLog(`Aborted ${thing} at index ${i}`); break }
          await mappingApi.light(thing, i)
          await sleep(settleMs)
          const cap2 = captureLuma()
          if (!cap2) { misses++; continue }
          const det = detectBlob(diff(cap2.luma, baseline), cap2.w, cap2.h, { threshold })
          if (det.found) {
            leds.push({ index: i, x: det.x, y: det.y, b: det.b })
            misses = 0
            setMap((m) => ({ ...m, [thing]: { thing, numPixels: i + 1, imageWidth: cap2.w, imageHeight: cap2.h, capturedAt: Date.now(), leds: [...leds] } }))
          } else {
            misses++
          }
          setStatus(thing, { state: 'sweeping', index: i, found: leds.length, message: `${leds.length} found · ${misses} misses` })
          if (misses >= missLimit) { addLog(`${thing}: ${missLimit} consecutive misses — assuming end of strip at index ${i}`); break }
        }

        setStatus(thing, { state: 'finishing', message: 'restoring geometry…' })
        await mappingApi.blank()
        await mappingApi.finish(thing, 'restore')

        setMap((m) => ({ ...m, [thing]: { thing, numPixels: leds.length, imageWidth: dims.w, imageHeight: dims.h, capturedAt: Date.now(), leds } }))
        setStatus(thing, { state: 'done', index: leds.length, found: leds.length, message: `${leds.length} LEDs mapped` })
        addLog(`Swept ${thing}: ${leds.length} LEDs`)
      } catch (e: any) {
        setStatus(thing, { state: 'error', message: e?.message || String(e) })
        addLog(`Error sweeping ${thing}: ${e?.message || e}`)
        try { await mappingApi.blank(); await mappingApi.finish(thing, 'restore') } catch {}
      }
    },
    [cameraOn, cap, settleMs, missLimit, threshold, demoMode, controllers, captureLuma, setStatus, addLog],
  )

  const sweepAll = useCallback(async () => {
    setRunning(true)
    abortRef.current = false
    for (const c of controllers) {
      if (abortRef.current) break
      await sweepController(c.thing)
    }
    setRunning(false)
  }, [controllers, sweepController])

  const runOne = useCallback(async (thing: string) => { setRunning(true); await sweepController(thing); setRunning(false) }, [sweepController])
  const abort = useCallback(() => { abortRef.current = true }, [])

  const saveMap = useCallback(async () => {
    const controllersOut = Object.values(map).filter((c) => c.leds.length > 0)
    if (controllersOut.length === 0) { addLog('Nothing to save.'); return }
    setSaving(true)
    try {
      const res = await mappingApi.saveMap(controllersOut, projectId)
      setSavedAt(res.updatedAt)
      addLog(`Saved map: ${controllersOut.length} controller(s), ${controllersOut.reduce((n, c) => n + c.leds.length, 0)} LEDs`)
    } catch (e: any) {
      addLog(`Save failed: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }, [map, projectId, addLog])

  const publishGeometry = useCallback(async () => {
    const mapped = Object.values(map).filter((c) => c.leds.length > 0)
    if (mapped.length === 0) { addLog('Nothing to publish.'); return }
    if (!demoMode && !window.confirm(`Publish ${mapped.length} controller(s) to the hardware?\n\nThis REPLACES each controller's geometry with an "all" segment ordered by index, and reboots it. Use this on a new installation — not to re-map an existing one you want to keep.`)) return
    setPublishing(true)
    try {
      for (const c of mapped) {
        const cfg = deriveThingSegments(c)
        await mappingApi.finish(c.thing, 'publish', cfg, demoMode)
        addLog(`Published ${c.thing}: ${cfg.segments[0].pixels.length} px (numberOfPixels ${cfg.numberOfPixels})`)
      }
      addLog(demoMode ? 'Demo: geometry publish simulated.' : 'Geometry published to hardware.')
    } catch (e: any) {
      addLog(`Publish failed: ${e?.message || e}`)
    } finally {
      setPublishing(false)
    }
  }, [map, demoMode, addLog])

  const totalLeds = Object.values(map).reduce((n, c) => n + c.leds.length, 0)
  const controllerIndex = (thing: string) => Math.max(0, controllers.findIndex((c) => c.thing === thing))

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <button style={S.backBtn} onClick={onBack}>← Back</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>🎯 Mapping — {projectName}</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>Aim the camera at the installation, then sweep each controller to learn every LED's position.</div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ textAlign: 'right', fontSize: 13, color: '#8fa0bd' }}>
          {totalLeds} LEDs mapped{savedAt ? ' · saved ✓' : totalLeds ? ' · unsaved' : ''}
        </div>
      </div>

      <div style={S.body}>
        {/* Camera + overlay */}
        <div style={S.cameraCol}>
          <div style={S.videoBox}>
            <video ref={videoRef} style={S.video} playsInline muted />
            {!cameraOn && (
              <div style={S.videoPlaceholder}>
                <button style={S.primaryBtn} onClick={startCamera}>📷 Start camera</button>
                {cameraError && <div style={{ color: '#ff8a8a', marginTop: 10, fontSize: 13 }}>{cameraError}</div>}
                <div style={{ color: '#8fa0bd', marginTop: 10, fontSize: 12, maxWidth: 320, textAlign: 'center' }}>
                  Keep the camera still for the whole session — all controllers are mapped into one frame.
                </div>
              </div>
            )}
            {/* Detected-LED overlay */}
            <svg style={S.overlay} viewBox="0 0 100 100" preserveAspectRatio="none">
              {Object.values(map).flatMap((c) =>
                c.leds.map((l) => (
                  <circle key={`${c.thing}-${l.index}`} cx={l.x * 100} cy={l.y * 100} r={0.7} fill={colorFor(controllerIndex(c.thing))} opacity={0.9} />
                )),
              )}
            </svg>
          </div>
          {cameraOn && <button style={S.ghostBtn} onClick={stopCamera}>Stop camera</button>}
        </div>

        {/* Controls */}
        <div style={S.controlsCol}>
          <section style={S.card}>
            <div style={S.cardTitle}>1 · Controllers</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button style={S.btn} onClick={discover} disabled={discovering}>{discovering ? 'Scanning…' : '🔍 Discover'}</button>
              <label style={S.check}><input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} /> Demo (no hardware)</label>
            </div>
            {discoverError && <div style={{ color: '#ff8a8a', fontSize: 12, marginBottom: 6 }}>{discoverError}</div>}
            {controllers.length === 0 && <div style={{ color: '#8fa0bd', fontSize: 13 }}>No controllers yet. Power the installation, then Discover.</div>}
            {controllers.map((c) => {
              const st = statuses[c.thing]
              const mapped = map[c.thing]?.leds.length || 0
              return (
                <div key={c.thing} style={S.ctlRow}>
                  <span style={{ ...S.dot, background: c.alive ? '#38d39f' : '#66707f' }} />
                  <span style={{ fontWeight: 600 }}>{c.thing}</span>
                  <span style={{ color: '#8fa0bd', fontSize: 12 }}>{c.numPixels != null ? `${c.numPixels}px` : ''}</span>
                  <span style={{ flex: 1 }} />
                  {mapped > 0 && <span style={{ fontSize: 12, color: '#38d39f' }}>{mapped} ✓</span>}
                  {st && st.state !== 'idle' && st.state !== 'done' && <span style={{ fontSize: 12, color: '#f0c020' }}>{st.state} {st.index}</span>}
                  <button style={S.smallBtn} disabled={running} onClick={() => runOne(c.thing)}>Sweep</button>
                </div>
              )
            })}
          </section>

          <section style={S.card}>
            <div style={S.cardTitle}>2 · Run</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.primaryBtn} disabled={running || controllers.length === 0} onClick={sweepAll}>▶ Sweep all</button>
              <button style={S.ghostBtn} disabled={!running} onClick={abort}>■ Stop</button>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Max LEDs (cap)" value={cap} onChange={setCap} min={1} max={1024} />
              <Field label="Settle (ms/LED)" value={settleMs} onChange={setSettleMs} min={40} max={2000} />
              <Field label="Stop after N misses" value={missLimit} onChange={setMissLimit} min={3} max={200} />
              <Field label="Detect threshold" value={threshold} onChange={setThreshold} min={5} max={200} />
            </div>
          </section>

          <section style={S.card}>
            <div style={S.cardTitle}>3 · Save &amp; publish</div>
            <button style={S.primaryBtn} disabled={saving || totalLeds === 0} onClick={saveMap}>{saving ? 'Saving…' : `💾 Save map (${totalLeds} LEDs)`}</button>
            <button style={S.ghostBtn} disabled={publishing || totalLeds === 0} onClick={publishGeometry} title="Write a derived geometry back to the controllers so animations can address them">
              {publishing ? 'Publishing…' : '📡 Publish geometry to hardware'}
            </button>
            <div style={{ fontSize: 12, color: '#8fa0bd' }}>Publishing replaces each controller's geometry and reboots it — for a new installation, not to re-map an existing one.</div>
          </section>

          <section style={{ ...S.card, flex: 1, minHeight: 0 }}>
            <div style={S.cardTitle}>Log</div>
            <div style={S.log}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: '#8fa0bd' }}>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        style={S.input}
      />
    </label>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: '#0f1218', color: '#e8eaed', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid #1e232c', background: '#12161d' },
  backBtn: { background: 'transparent', color: '#8fb4ff', border: '1px solid #2a3140', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
  body: { flex: 1, display: 'flex', gap: 16, padding: 16, minHeight: 0 },
  cameraCol: { flex: '1 1 60%', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  videoBox: { position: 'relative', flex: 1, background: '#000', borderRadius: 14, overflow: 'hidden', border: '1px solid #1e232c', minHeight: 300 },
  video: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  videoPlaceholder: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  controlsCol: { flex: '1 1 40%', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320, maxWidth: 460 },
  card: { background: '#12161d', border: '1px solid #1e232c', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#c7d2e6', textTransform: 'uppercase', letterSpacing: '0.04em' },
  ctlRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #1a1f28' },
  dot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  btn: { background: '#1c2432', color: '#e8eaed', border: '1px solid #2a3140', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' },
  smallBtn: { background: '#1c2432', color: '#e8eaed', border: '1px solid #2a3140', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  primaryBtn: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 },
  ghostBtn: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 10, padding: '9px 14px', cursor: 'pointer' },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8fa0bd', cursor: 'pointer' },
  input: { background: '#0d1016', color: '#e8eaed', border: '1px solid #2a3140', borderRadius: 6, padding: '6px 8px', width: '100%' },
  log: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#9fb0cc', overflowY: 'auto', flex: 1, minHeight: 80, lineHeight: 1.5 },
}
