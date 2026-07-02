import React from 'react'

interface RingVisualizationCanvasProps {
  /** precomputedColors[ringNumber (1-12)] = string[144] of rgb colors indexed by pixel index */
  colors: Map<number, string[]>
  /** Big-ring numbers (1-12) that are active; others are dimmed */
  activeRings?: number[]
  /** Zoom level from external buttons (1 = 100%). Combined multiplicatively with internal wheel zoom. */
  zoom?: number
  /** Called when ctrl+wheel changes zoom so parent can sync button state */
  onZoomChange?: (zoom: number) => void
  /** When true, resets pan to center (parent toggles this by bumping a counter) */
  resetPanToken?: number
  /** 'width' (default): square sized to container width (legacy, for small previews).
   *  'box': fit the smaller of container width/height and center — shows all rings without clipping. */
  fit?: 'width' | 'box'
  /** When true, off LEDs render as pure black (no gray outline / no dimmed inactive rings) —
   *  for the live console so unlit pixels look truly off, not like gray dots. */
  darkOff?: boolean
}

/** True when an rgb(a) color is effectively off (near-black). */
function isOffColor(c?: string): boolean {
  if (!c) return true
  const m = c.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return false
  return +m[1] + +m[2] + +m[3] < 12
}

// Base geometry at 680px — all values scale linearly with available size
const BASE = 680
const BASE_OUTER_R = 268
const BASE_PIX_R = 11
const BASE_SUB_R = 57
const BASE_PIX_SIZE = 6

interface PixelPos { cx: number; cy: number; ringIdx: number; pixelIndex: number }

/** Parse "rgb(r,g,b)" and return HSV with H 0-360, S 0-100, V 0-100 */
function rgbStringToHsv(rgb: string): { h: number; s: number; v: number } | null {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (!m) return null
  const r = parseInt(m[1]) / 255
  const g = parseInt(m[2]) / 255
  const b = parseInt(m[3]) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = Math.round(h * 60)
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100)
  const v = Math.round(max * 100)
  return { h, s, v }
}

function buildPixelPositions(size: number, scale: number): PixelPos[] {
  const outerR = BASE_OUTER_R * scale
  const subR = BASE_SUB_R * scale
  const pixR = BASE_PIX_R * scale
  const center = size / 2
  const all: PixelPos[] = []
  for (let bigRingIdx = 0; bigRingIdx < 12; bigRingIdx++) {
    const bigAngle = (bigRingIdx * 30 - 60) * (Math.PI / 180)
    const bigCx = center + outerR * Math.cos(bigAngle)
    const bigCy = center + outerR * Math.sin(bigAngle)
    for (let subRingIdx = 0; subRingIdx < 12; subRingIdx++) {
      // sub-ring 0 at 4 o'clock (60° clockwise from 2 o'clock). 4 o'clock = +30° in screen coords.
      const subAngle = (subRingIdx * 30 + 30) * (Math.PI / 180)
      const subCx = bigCx + subR * Math.cos(subAngle)
      const subCy = bigCy + subR * Math.sin(subAngle)
      for (let posIdx = 0; posIdx < 12; posIdx++) {
        const pixelIndex = subRingIdx * 12 + posIdx
        // Pixel 0 faces the big-ring center: 180° inward from sub-ring 0's position.
        const pixAngle = (210 + subRingIdx * 30 + posIdx * 30) * (Math.PI / 180)
        all.push({
          cx: subCx + pixR * Math.cos(pixAngle),
          cy: subCy + pixR * Math.sin(pixAngle),
          ringIdx: bigRingIdx,
          pixelIndex,
        })
      }
    }
  }
  return all
}

const RingVisualizationCanvas = ({ colors, activeRings, zoom = 1, onZoomChange, resetPanToken, fit = 'width', darkOff = false }: RingVisualizationCanvasProps) => {
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [size, setSize] = React.useState(BASE)
  // pan offset in canvas pixels (before zoom applied)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [tooltip, setTooltip] = React.useState<{ text: string; x: number; y: number; containerW: number; containerH: number } | null>(null)
  // drag state
  const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // Observe wrapper width
  React.useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      // 'box': fit the smaller of width/height so the whole ring cluster is visible and centered.
      const s = fit === 'box' && cr.height > 0 ? Math.min(cr.width, cr.height) : cr.width
      if (s && s > 0) setSize(Math.floor(s))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset pan when parent requests it (e.g. 1:1 zoom reset)
  React.useEffect(() => {
    if (resetPanToken !== undefined) setPan({ x: 0, y: 0 })
  }, [resetPanToken])

  // Clamp pan so the content can never be dragged fully off-screen.
  // At zoom level z, the scaled canvas is size*z. Half the excess is (size*(z-1))/2.
  // We allow panning up to that amount in each direction, plus a small margin.
  function clampPan(x: number, y: number, z: number): { x: number; y: number } {
    const margin = (size * Math.max(0, z - 1)) / 2
    return {
      x: Math.max(-margin, Math.min(margin, x)),
      y: Math.max(-margin, Math.min(margin, y)),
    }
  }

  const scale = size / BASE

  const pixelPositions = React.useMemo(() => buildPixelPositions(size, scale), [size, scale])

  // Draw
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pixelRadius = (BASE_PIX_SIZE * scale) / 2
    ctx.clearRect(0, 0, size, size)

    // Detect theme by reading --text CSS variable from the wrapper element
    const textColor = wrapperRef.current
      ? getComputedStyle(wrapperRef.current).getPropertyValue('--text').trim()
      : ''
    const isLightTheme = textColor.startsWith('#1') // dark text = light theme
    const activeStroke = isLightTheme ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)'
    const inactiveStroke = isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)'

    ctx.save()
    // zoom towards center of canvas, then apply pan
    ctx.translate(size / 2 + pan.x, size / 2 + pan.y)
    ctx.scale(zoom, zoom)
    ctx.translate(-size / 2, -size / 2)

    for (const pos of pixelPositions) {
      const ringNumber = pos.ringIdx + 1
      const isActive = !activeRings || activeRings.length === 0 || activeRings.includes(ringNumber)
      const fill = colors.get(ringNumber)?.[pos.pixelIndex] ?? 'rgb(0,0,0)'

      if (darkOff) {
        // Live look: off LEDs are pure black (no outline); only lit pixels are drawn + ringed.
        if (!isActive || isOffColor(fill)) continue
        ctx.beginPath()
        ctx.arc(pos.cx, pos.cy, pixelRadius, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = activeStroke
        ctx.lineWidth = 1
        ctx.stroke()
        continue
      }

      ctx.beginPath()
      ctx.arc(pos.cx, pos.cy, pixelRadius, 0, Math.PI * 2)
      if (isActive) {
        ctx.strokeStyle = activeStroke
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = fill
        ctx.fill()
      } else {
        ctx.strokeStyle = inactiveStroke
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    ctx.restore()
  }, [colors, activeRings, pixelPositions, size, scale, zoom, pan, darkOff])

  // Ctrl+wheel: zoom towards mouse
  React.useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // mouse position relative to canvas center
      const mx = e.clientX - rect.left - size / 2
      const my = e.clientY - rect.top - size / 2
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.25, Math.min(10, zoom * factor))
      // adjust pan so the point under cursor stays fixed:
      // newPan = mouse - (mouse - pan) * (newZoom / zoom)
      setPan(prev => {
        const nx = mx - (mx - prev.x) * (newZoom / zoom)
        const ny = my - (my - prev.y) * (newZoom / zoom)
        return clampPan(nx, ny, newZoom)
      })
      onZoomChange?.(newZoom)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [size, zoom, onZoomChange])

  // Drag to pan
  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseUp = React.useCallback(() => {
    dragRef.current = null
  }, [])

  // Tooltip: find nearest pixel to mouse
  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle drag
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      // canvas CSS size vs logical size ratio
      const canvas = canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      const ratio = rect ? size / rect.width : 1
      const nx = dragRef.current.panX + dx * ratio
      const ny = dragRef.current.panY + dy * ratio
      setPan(clampPan(nx, ny, zoom))
      setTooltip(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    // transform mouse to canvas-space before zoom+pan
    const mx = mouseX * (size / rect.width)
    const my = mouseY * (size / rect.height)
    const cx = (mx - size / 2 - pan.x) / zoom + size / 2
    const cy = (my - size / 2 - pan.y) / zoom + size / 2

    const pixelRadius = (BASE_PIX_SIZE * scale) / 2
    let nearest: PixelPos | null = null
    let nearestDist = pixelRadius * 2
    for (const p of pixelPositions) {
      const d = Math.hypot(p.cx - cx, p.cy - cy)
      if (d < nearestDist) { nearestDist = d; nearest = p }
    }
    if (nearest) {
      const ringNumber = nearest.ringIdx + 1
      const subRing = Math.floor(nearest.pixelIndex / 12)
      const posInSub = nearest.pixelIndex % 12
      const colorStr = colors.get(ringNumber)?.[nearest.pixelIndex] ?? 'rgb(0,0,0)'
      const hsv = rgbStringToHsv(colorStr)
      const hsvText = hsv ? `H${hsv.h}° S${hsv.s}% V${hsv.v}%` : colorStr
      setTooltip({
        text: `Ring ${ringNumber} · Sub ${subRing} · Pos ${posInSub} · Idx ${nearest.pixelIndex} · ${hsvText}`,
        x: mouseX,
        y: mouseY,
        containerW: rect.width,
        containerH: rect.height,
      })
    } else {
      setTooltip(null)
    }
  }, [pixelPositions, size, scale, zoom, pan, colors])

  const handleMouseLeave = React.useCallback(() => {
    dragRef.current = null
    setTooltip(null)
  }, [])

  return (
    <div
      ref={wrapperRef}
      style={fit === 'box'
        ? { width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        : { width: '100%', aspectRatio: '1', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={fit === 'box'
          ? { display: 'block', width: size, height: size, maxWidth: '100%', maxHeight: '100%', cursor: 'grab' }
          : { display: 'block', width: '100%', height: '100%', cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (() => {
        // Estimate tooltip size: ~7px per char wide, 22px tall
        const estW = tooltip.text.length * 7 + 14
        const estH = 22
        const offset = 14
        const flipX = tooltip.x + offset + estW > tooltip.containerW
        const flipY = tooltip.y + offset + estH > tooltip.containerH
        return (
          <div style={{
            position: 'absolute',
            left: flipX ? tooltip.x - estW - 4 : tooltip.x + offset,
            top: flipY ? tooltip.y - estH - 4 : tooltip.y + offset,
            background: 'rgba(0,0,0,0.88)',
            color: 'white',
            fontSize: 11,
            fontFamily: 'monospace',
            padding: '3px 7px',
            borderRadius: 4,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
            border: '1px solid rgba(255,255,255,0.2)',
          }}>
            {tooltip.text}
          </div>
        )
      })()}
    </div>
  )
}

export default RingVisualizationCanvas
