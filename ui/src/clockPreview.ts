/**
 * Clock preview: mirrors the ESP32 ClockEffect logic for the UI simulator.
 *
 * Each of the 12 "big rings" (controllers ring1–ring12) decides its role
 * based on the current hour (12h) and minute:
 *   ringIndex < hour12  → hour ring: half brightness, blue hue
 *   ringIndex === hour12 → minute ring: full brightness, orange hue, fractional fill by minute
 *   ringIndex > hour12  → off
 *
 * All active pixels pulse once per second (sin over the sub-second fraction).
 *
 * Pixel layout: the "all" segment maps relPos 0→1 linearly across all 144
 * pixels. Ring N (1-based) occupies relPos [(N-1)/12, N/12].
 */


function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r: number, g: number, b: number
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    default: r = v; g = p; b = q; break
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function hsvToRgbString(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v)
  return `rgb(${r},${g},${b})`
}

/**
 * Compute pixel colors for all 12 big rings at the given time.
 * Returns a Map<ringNumber (1-based), string[144]> matching RingVisualizationCanvas's format.
 */
export function computeClockColors(
  now: Date,
  globalBrightness: number
): Map<number, string[]> {
  const hour12 = now.getHours() % 12         // 0–11 (noon/midnight = 0)
  const minute  = now.getMinutes()             // 0–59
  const ms      = now.getSeconds() * 1000 + now.getMilliseconds()

  // Pulse: sin over 2-second period, range [0.5, 1.0]
  const relCycle = (ms % 2000) / 2000
  const pulse  = 0.5 + 0.5 * Math.sin(relCycle * 2 * Math.PI - Math.PI / 2)
  const pulseBrightness = 0.5 + 0.5 * pulse  // [0.5, 1.0]

  const colors = new Map<number, string[]>()

  for (let ringNumber = 1; ringNumber <= 12; ringNumber++) {
    const arr = new Array<string>(144)

    const minuteRing = hour12 + 1  // rings 1..hour12 are hour rings, hour12+1 is minute ring

    if (ringNumber > minuteRing) {
      arr.fill('rgb(0,0,0)')
      colors.set(ringNumber, arr)
      continue
    }

    if (ringNumber < minuteRing) {
      // Hour ring: hue = 1.0 / ringNumber, half brightness pulsing
      const hue = ringNumber / 12
      const brightness = 0.5 * pulseBrightness * globalBrightness
      const color = hsvToRgbString(hue, 1, brightness)
      arr.fill(color)
      colors.set(ringNumber, arr)
      continue
    }

    // ringNumber === minuteRing
    // 12 sub-rings × 5 minutes each = 60 minutes total.
    // Full sub-rings = floor(minute / 5), partial pixels = (minute % 5) / 5 * 12.
    const fullSubRings      = Math.floor(minute / 5)
    const partialPixels     = Math.round((minute % 5) / 5 * 12)
    const fillPixels        = fullSubRings * 12 + partialPixels
    const brightness        = 1.0 * pulseBrightness * globalBrightness

    // Snake: sweeps cyclically through sub-ring fullSubRings (in fill order) over the 2-second pulse period
    const SNAKE_TAIL        = 3
    const snakeFillStart    = fullSubRings * 12  // start of snake sub-ring in fill order
    const headPos           = relCycle * 12  // 0.0 → 12.0

    // Fill order starts at sub-ring 9 (1 o'clock) and walks counter-clockwise around the face.
    // Map fill-order index f → actual pixel index i.
    arr.fill('rgb(0,0,0)')
    const fillSubToPixelSub = (sub: number) => (sub + 9) % 12
    for (let f = 0; f < 144; f++) {
      const fillSub = Math.floor(f / 12)
      const pos     = f % 12
      const i       = fillSubToPixelSub(fillSub) * 12 + pos
      if (f < fillPixels) {
        const hue = f / 143
        arr[i] = hsvToRgbString(hue, 1, brightness)
      } else if (f >= snakeFillStart && f < snakeFillStart + 12) {
        const snakePos = f - snakeFillStart
        const dist     = ((headPos - snakePos) % 12 + 12) % 12
        if (dist <= SNAKE_TAIL) {
          const snakeBrightness = (1 - dist / SNAKE_TAIL) * brightness
          const hue = f / 143
          arr[i] = hsvToRgbString(hue, 1, snakeBrightness)
        }
      }
    }
    colors.set(ringNumber, arr)
  }

  return colors
}
