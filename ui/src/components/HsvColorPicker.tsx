import React, { useRef, useCallback, useEffect } from 'react'
import './HsvColorPicker.css'

interface Hsv { h: number; s: number; v: number }

/** Convert HSV (h 0-360, s 0-1, v 0-1) to hex string */
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(val * 255).toString(16).padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

/** Convert hex to HSV (h 0-360, s 0-1, v 0-1) */
function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}

interface HsvColorPickerProps {
  value: string   // hex color
  onChange: (hex: string) => void
}

const SV_SIZE = 200  // px, square gradient
const HUE_HEIGHT = 16

const HsvColorPicker = ({ value, onChange }: HsvColorPickerProps) => {
  const hsv = hexToHsv(value || '#ff0000')

  const svCanvasRef = useRef<HTMLCanvasElement>(null)
  const hueCanvasRef = useRef<HTMLCanvasElement>(null)
  const draggingSv = useRef(false)
  const draggingHue = useRef(false)

  // Draw SV gradient for current hue
  useEffect(() => {
    const canvas = svCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // White → pure hue (horizontal)
    const hGrad = ctx.createLinearGradient(0, 0, SV_SIZE, 0)
    hGrad.addColorStop(0, 'white')
    hGrad.addColorStop(1, `hsl(${hsv.h}, 100%, 50%)`)
    ctx.fillStyle = hGrad
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE)
    // Transparent → black (vertical overlay)
    const vGrad = ctx.createLinearGradient(0, 0, 0, SV_SIZE)
    vGrad.addColorStop(0, 'transparent')
    vGrad.addColorStop(1, 'black')
    ctx.fillStyle = vGrad
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE)
  }, [hsv.h])

  // Draw hue bar
  useEffect(() => {
    const canvas = hueCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, SV_SIZE, 0)
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, SV_SIZE, HUE_HEIGHT)
  }, [])

  const pickSv = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = svCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / SV_SIZE))
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / SV_SIZE))
    onChange(hsvToHex(hsv.h, s, v))
  }, [hsv.h, onChange])

  const pickHue = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = hueCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / SV_SIZE) * 360))
    onChange(hsvToHex(h, hsv.s, hsv.v))
  }, [hsv.s, hsv.v, onChange])

  // Mouse drag handlers attached to window during drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingSv.current) pickSv(e)
      if (draggingHue.current) pickHue(e)
    }
    const onUp = () => { draggingSv.current = false; draggingHue.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [pickSv, pickHue])

  const handleNumericInput = (channel: 'h' | 's' | 'v', raw: string) => {
    const n = parseFloat(raw)
    if (isNaN(n)) return
    const next = { ...hsv }
    if (channel === 'h') next.h = Math.max(0, Math.min(360, n))
    else if (channel === 's') next.s = Math.max(0, Math.min(100, n)) / 100
    else next.v = Math.max(0, Math.min(100, n)) / 100
    onChange(hsvToHex(next.h, next.s, next.v))
  }

  const handleHexInput = (raw: string) => {
    const trimmed = raw.trim()
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) onChange(withHash.toLowerCase())
  }

  // Cursor position in SV square
  const cursorX = hsv.s * SV_SIZE
  const cursorY = (1 - hsv.v) * SV_SIZE
  // Cursor position on hue bar
  const hueCursorX = (hsv.h / 360) * SV_SIZE

  return (
    <div className="hsv-picker">
      {/* SV square */}
      <div className="hsv-picker-sv-wrap">
        <canvas
          ref={svCanvasRef}
          width={SV_SIZE}
          height={SV_SIZE}
          className="hsv-picker-sv"
          onMouseDown={(e) => { draggingSv.current = true; pickSv(e) }}
        />
        <div
          className="hsv-picker-sv-cursor"
          style={{ left: cursorX, top: cursorY }}
        />
      </div>

      {/* Hue bar */}
      <div className="hsv-picker-hue-wrap">
        <canvas
          ref={hueCanvasRef}
          width={SV_SIZE}
          height={HUE_HEIGHT}
          className="hsv-picker-hue"
          onMouseDown={(e) => { draggingHue.current = true; pickHue(e) }}
        />
        <div
          className="hsv-picker-hue-cursor"
          style={{ left: hueCursorX }}
        />
      </div>

      {/* Numeric inputs */}
      <div className="hsv-picker-inputs">
        <label className="hsv-picker-input-group">
          <span>H</span>
          <input
            type="number" min={0} max={360} step={1}
            value={Math.round(hsv.h)}
            onChange={(e) => handleNumericInput('h', e.target.value)}
          />
          <span className="hsv-picker-unit">°</span>
        </label>
        <label className="hsv-picker-input-group">
          <span>S</span>
          <input
            type="number" min={0} max={100} step={1}
            value={Math.round(hsv.s * 100)}
            onChange={(e) => handleNumericInput('s', e.target.value)}
          />
          <span className="hsv-picker-unit">%</span>
        </label>
        <label className="hsv-picker-input-group">
          <span>V</span>
          <input
            type="number" min={0} max={100} step={1}
            value={Math.round(hsv.v * 100)}
            onChange={(e) => handleNumericInput('v', e.target.value)}
          />
          <span className="hsv-picker-unit">%</span>
        </label>
      </div>

      <label className="hsv-picker-input-group hsv-picker-hex-group">
        <span>Hex</span>
        <input
          type="text"
          spellCheck={false}
          value={value}
          onChange={(e) => handleHexInput(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          title="Copy or paste hex color (e.g. #ff8800)"
        />
      </label>
    </div>
  )
}

export default HsvColorPicker
