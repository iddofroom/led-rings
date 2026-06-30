import React from 'react'
import segmentsData from '../segments.json'
import { getPixelColor, getPixelColorMulti, hsvToRgbString } from '../effectPreview'
import type { Timeframe } from '../App'
import { getTimeframeEffects } from '../App'
import { getMovementRingT } from '../movementGenerators'
import RingVisualizationCanvas from './RingVisualizationCanvas'
import './RingVisualization.css'

interface RingVisualizationProps {
  /** Mapping segment name (e.g. "all", "ind", "arc"). Used for the static rainbow preview and for the TimeframePanel mapping illustration. */
  mapping: string
  /** Big-ring numbers (1-12) that are active; rings not in this list are dimmed. Omit to show all. Only used in multi-big-ring mode. */
  activeRings?: number[]
  /** Single timeframe for the mapping preview in TimeframePanel. Legacy single-big-ring mode. */
  timeframe?: Timeframe | null
  /** Multiple active timeframes for the playback preview. When provided, renders all 12 big rings arranged in a circle. */
  timeframes?: Timeframe[]
  /** Current time in beats; with timeframes, used to compute effect phase t in [0,1]. */
  currentTime?: number
  /** Zoom level passed through to RingVisualizationCanvas. */
  zoom?: number
  /** Called when ctrl+wheel changes zoom */
  onZoomChange?: (zoom: number) => void
  /** Bumping this counter tells the canvas to reset its pan to center */
  resetPanToken?: number
  /** Global brightness multiplier 0–1, applied to all rendered pixel values */
  globalBrightness?: number
  /** Render off LEDs as pure black (no gray outline) — for the live console. */
  darkOff?: boolean
}

/** Compute normalized time t in [0,1] for a timeframe at a given currentTime in beats.
 *  When windowOverride is provided, t is computed within that window instead of the full timeframe. */
function computeT(tf: Timeframe, currentTime: number, windowOverride?: { start: number; end: number }): number | null {
  const start = windowOverride ? windowOverride.start : tf.startTime
  const end = windowOverride ? windowOverride.end : tf.endTime
  const duration = end - start
  if (duration <= 0) return 0
  const beatOffset = currentTime - start
  const cycles = tf.cycles ?? []
  if (cycles.length === 0) {
    return Math.max(0, Math.min(1, beatOffset / duration))
  }
  const c = cycles[0]!
  if (c.type === 'cycle') {
    return (beatOffset % c.beatsInCycle) / c.beatsInCycle
  }
  const phase = (beatOffset % c.beatsInCycle) / c.beatsInCycle
  const windowStart = c.startBeat / c.beatsInCycle
  const windowEnd = c.endBeat / c.beatsInCycle
  const windowLen = windowEnd - windowStart
  if (windowLen <= 0) return 0
  if (phase < windowStart || phase > windowEnd) return null
  return (phase - windowStart) / windowLen
}

/** Compute t for a specific big ring, accounting for movement timing.
 *  Returns null if the ring is not active at currentTime per the movement.
 *  When the ring is in a holdOff window (Random + retire), returns { t: 1, holdOff: true } so the preview applies brightness 0. */
function computeRingT(tf: Timeframe, currentTime: number, ringNumber: number): number | { t: number; holdOff?: boolean } | null {
  if (!tf.movement) {
    if (!tf.rings.includes(ringNumber)) return null
    return computeT(tf, currentTime)
  }
  const mt = getMovementRingT(tf.startTime, tf.endTime, tf.rings, tf.movement, ringNumber, currentTime)
  if (!mt) return null
  if (mt.holdOff) return { t: mt.t, holdOff: true }
  return computeT(tf, currentTime, { start: mt.windowStart, end: mt.windowEnd })
}

/** Rainbow gradient fallback used by the static mapping preview. */
function relPosToColor(relPos: number): string {
  const normalized = ((relPos % 1) + 1) % 1
  let r = 0, g = 0, b = 0
  if (normalized < 1/6) {
    const t = normalized * 6
    r = 255; g = Math.round(255 * t); b = 0
  } else if (normalized < 2/6) {
    const t = (normalized - 1/6) * 6
    r = Math.round(255 * (1 - t)); g = 255; b = 0
  } else if (normalized < 3/6) {
    const t = (normalized - 2/6) * 6
    r = 0; g = 255; b = Math.round(255 * t)
  } else if (normalized < 4/6) {
    const t = (normalized - 3/6) * 6
    r = 0; g = Math.round(255 * (1 - t)); b = 255
  } else if (normalized < 5/6) {
    const t = (normalized - 4/6) * 6
    r = Math.round(255 * t); g = 0; b = 255
  } else {
    const t = (normalized - 5/6) * 6
    r = 255; g = 0; b = Math.round(255 * (1 - t))
  }
  return `rgb(${r}, ${g}, ${b})`
}

type PixelSlot = { index: number; relPos: number } | null

/** Render one big ring as a 12x12 grid of ring pixels. Each pixel is placed by CSS
 *  using --ring-index (sub-ring 0-11) and --pixel-index (position within sub-ring 0-11). */
const BigRing = ({
  slots,
  pixelColor,
  pixelTitle,
}: {
  slots: PixelSlot[][]
  pixelColor: (pixel: { index: number; relPos: number }, subRingIndex: number, positionInSubRing: number) => string
  pixelTitle?: (pixel: { index: number; relPos: number }, subRingIndex: number, positionInSubRing: number) => string
}) => {
  return (
    <>
      {slots.map((subRingPixels, subRingIndex) => (
        <div
          key={subRingIndex}
          className="small-ring"
          style={{ '--ring-index': subRingIndex } as React.CSSProperties}
        >
          {subRingPixels.map((pixel, positionInSubRing) => {
            if (!pixel) return null
            const color = pixelColor(pixel, subRingIndex, positionInSubRing)
            return (
              <div
                key={pixel.index}
                className="ring-pixel"
                style={{
                  backgroundColor: color,
                  color: color,
                  '--pixel-index': positionInSubRing,
                  '--ring-index': subRingIndex,
                } as React.CSSProperties}
                title={pixelTitle ? pixelTitle(pixel, subRingIndex, positionInSubRing) : undefined}
              />
            )
          })}
        </div>
      ))}
    </>
  )
}

const RingVisualization = ({
  mapping,
  activeRings,
  timeframe,
  timeframes,
  currentTime,
  zoom,
  onZoomChange,
  resetPanToken,
  globalBrightness = 1,
  darkOff = false,
}: RingVisualizationProps) => {
  // Multi-big-ring playback mode when a timeframes array is provided.
  const multiMode = Boolean(timeframes && currentTime !== undefined)
  const singleTf = timeframe && !timeframes ? timeframe : null
  const singleTfHasEffects = Boolean(
    singleTf && currentTime !== undefined && getTimeframeEffects(singleTf).some(e => e.effectKey !== '')
  )

  // Pre-build per-segment relPos lookup: segmentName → Map<pixelIndex, relPos>
  const segmentRelPosMap = React.useMemo(() => {
    const map = new Map<string, Map<number, number>>()
    for (const seg of segmentsData.segments) {
      const pixelMap = new Map<number, number>()
      for (const p of seg.pixels) {
        pixelMap.set(p.index, p.relPos)
      }
      map.set(seg.name, pixelMap)
    }
    return map
  }, [])

  /** Returns relPos for a pixel in a specific mapping segment, or null if the pixel isn't in it.
   *  This matches the C++ renderer which reads relativePositionInSegment directly from the thing's segments map. */
  const getRelPosForMapping = React.useCallback((pixelIndex: number, mappingName: string): number | null => {
    return segmentRelPosMap.get(mappingName)?.get(pixelIndex) ?? null
  }, [segmentRelPosMap])

  // Build a big-ring-number → active timeframes lookup. Used in multi mode.
  const ringToTimeframes = React.useMemo(() => {
    const map: Map<number, Timeframe[]> = new Map()
    if (!multiMode) return map
    for (const tf of timeframes!) {
      for (const ring of tf.rings) {
        if (computeRingT(tf, currentTime!, ring) != null) {
          const arr = map.get(ring)
          if (arr) arr.push(tf)
          else map.set(ring, [tf])
        }
      }
    }
    return map
  }, [multiMode, timeframes, currentTime])

  // Pre-compute all pixel colors for multi mode. Keyed on timeframes + currentTime so
  // React only recomputes when something actually changed. Avoids 1728 per-pixel
  // closure + effect-scan calls inside render.
  const precomputedColors = React.useMemo(() => {
    if (!multiMode) return null
    // pixelColors[ringNumber] = array of 144 rgb strings indexed by pixel index
    const pixelColors = new Map<number, string[]>()
    for (let bigRingIdx = 0; bigRingIdx < 12; bigRingIdx++) {
      const ringNumber = bigRingIdx + 1
      const ringTfs = ringToTimeframes.get(ringNumber)
      const colors: string[] = new Array(144)
      if (!ringTfs || ringTfs.length === 0) {
        colors.fill('rgb(0,0,0)')
      } else {
        // Pre-compute ringT for each timeframe once (same for all pixels in this ring)
        const ringTfWithT: Array<{ tf: Timeframe; tVal: number; holdOff: boolean; mapping: string }> = []
        for (const tf of ringTfs) {
          const ringT = computeRingT(tf, currentTime!, ringNumber)
          if (ringT == null) continue
          const tVal = typeof ringT === 'number' ? ringT : ringT.t
          const holdOff = typeof ringT === 'object' && ringT.holdOff === true
          ringTfWithT.push({ tf, tVal, holdOff, mapping: tf.mapping || 'all' })
        }
        for (let pixelIndex = 0; pixelIndex < 144; pixelIndex++) {
          if (ringTfWithT.length === 0) { colors[pixelIndex] = 'rgb(0,0,0)'; continue }
          const tfWithT: Array<{ timeframe: Timeframe; t: number; relPos: number; holdOff?: boolean }> = []
          for (const { tf, tVal, holdOff, mapping } of ringTfWithT) {
            const rp = getRelPosForMapping(pixelIndex, mapping)
            if (rp == null) continue
            tfWithT.push({ timeframe: tf, t: tVal, relPos: rp, holdOff })
          }
          if (tfWithT.length === 0) { colors[pixelIndex] = 'rgb(0,0,0)'; continue }
          const hsv = tfWithT.length === 1
            ? getPixelColor(tfWithT[0].relPos, tfWithT[0].t, tfWithT[0].timeframe, bigRingIdx, tfWithT[0].holdOff)
            : getPixelColorMulti(tfWithT, bigRingIdx)
          colors[pixelIndex] = hsvToRgbString(hsv.h, hsv.s, hsv.v * globalBrightness)
        }
      }
      pixelColors.set(ringNumber, colors)
    }
    return pixelColors
  }, [multiMode, ringToTimeframes, currentTime, getRelPosForMapping, globalBrightness])

  // Build the 12x12 pixel slot grid for single-mode CSS layout.
  // sub-ring i, position j → pixel index i*12 + j, only pixels in the chosen mapping segment.
  const layoutSlots: PixelSlot[][] = React.useMemo(() => {
    const slots: PixelSlot[][] = Array.from({ length: 12 }, () => new Array(12).fill(null))
    const sourceSeg = segmentsData.segments.find(s => s.name === mapping)
    if (!sourceSeg) return slots
    for (const p of sourceSeg.pixels) {
      const sub = Math.floor(p.index / 12)
      const pos = p.index % 12
      if (sub < 12 && pos < 12) {
        slots[sub][pos] = { index: p.index, relPos: p.relPos }
      }
    }
    return slots
  }, [mapping])

  // --- Multi-big-ring playback mode: canvas rendering ---
  if (multiMode) {
    return (
      <div className="ring-visualization ring-visualization-multi">
        <RingVisualizationCanvas
          colors={precomputedColors ?? new Map()}
          activeRings={activeRings}
          zoom={zoom}
          onZoomChange={onZoomChange}
          resetPanToken={resetPanToken}
          fit="box"
          darkOff={darkOff}
        />
      </div>
    )
  }

  // --- Single big-ring mode (TimeframePanel mapping preview) ---
  // Uses the rainbow gradient over the chosen mapping, or single-timeframe effect preview.
  const singleT = singleTf && currentTime !== undefined ? (computeT(singleTf, currentTime) ?? 0) : 0
  const singlePixelColor = (pixel: { index: number; relPos: number }, subRingIndex: number): string => {
    if (singleTfHasEffects && singleTf) {
      const tfMapping = singleTf.mapping || 'all'
      const tfRelPos = getRelPosForMapping(pixel.index, tfMapping)
      if (tfRelPos == null) return 'rgb(0, 0, 0)'
      const ringT = computeRingT(singleTf, currentTime!, subRingIndex + 1)
      const tVal = ringT == null ? singleT : (typeof ringT === 'number' ? ringT : ringT.t)
      const holdOff = typeof ringT === 'object' && ringT?.holdOff === true
      const hsv = getPixelColor(tfRelPos, tVal, singleTf, subRingIndex, holdOff)
      return hsvToRgbString(hsv.h, hsv.s, hsv.v)
    }
    return relPosToColor(pixel.relPos)
  }

  // In single mode the mapping segment may be missing (unknown name) — render nothing.
  if (!segmentsData.segments.find(s => s.name === mapping)) return null

  return (
    <div className="ring-visualization">
      <div className="rings-container">
        <BigRing
          slots={layoutSlots}
          pixelColor={singlePixelColor}
          pixelTitle={(pixel, sub, pos) => `Sub-ring ${sub}, pos ${pos}, index ${pixel.index}, relPos ${pixel.relPos.toFixed(3)}`}
        />
      </div>
    </div>
  )
}

export default RingVisualization
