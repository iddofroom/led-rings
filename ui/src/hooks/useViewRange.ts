import { useState, useCallback, useRef } from 'react'

export interface ViewRangeState {
  startBeat: number
  beatsPerScreen: number
}

export interface ViewRangeActions {
  /** Set the visible start beat (scroll). Clamps to [0, maxBeat - beatsPerScreen]. */
  scrollTo: (startBeat: number) => void
  /** Zoom in or out, anchoring at a specific beat position.
   *  anchorBeat stays at anchorFraction of the screen (0=top/left, 1=bottom/right). */
  zoomAt: (direction: 'in' | 'out', anchorBeat: number, anchorFraction: number) => void
  /** Pan by a delta in beats. */
  panBy: (deltaBeats: number) => void
  /** Auto-scroll to keep a beat visible during playback.
   *  Scrolls so that beat is at targetFraction of the screen (e.g. 0.75). */
  autoScrollTo: (beat: number, targetFraction: number) => void
  /** Restore a saved view (zoom + scroll). Clamps both to valid ranges. */
  setView: (startBeat: number, beatsPerScreen: number) => void
}

const MIN_BEATS_PER_SCREEN = 4
const ZOOM_FACTOR = 2

export function useViewRange(songLengthBeats: number): [ViewRangeState, ViewRangeActions] {
  const [state, setState] = useState<ViewRangeState>({
    startBeat: 0,
    beatsPerScreen: 64,
  })

  const maxBeat = Math.max(songLengthBeats, 4)
  const maxBeatRef = useRef(maxBeat)
  maxBeatRef.current = maxBeat

  const clampStart = useCallback((start: number, bps: number) => {
    const max = maxBeatRef.current
    return Math.max(0, Math.min(max - bps, start))
  }, [])

  const scrollTo = useCallback((startBeat: number) => {
    setState(prev => {
      const clamped = clampStart(startBeat, prev.beatsPerScreen)
      if (Math.abs(clamped - prev.startBeat) < 0.01) return prev
      return { ...prev, startBeat: clamped }
    })
  }, [clampStart])

  const zoomAt = useCallback((direction: 'in' | 'out', anchorBeat: number, anchorFraction: number) => {
    setState(prev => {
      const newBps = direction === 'in'
        ? Math.max(MIN_BEATS_PER_SCREEN, prev.beatsPerScreen / ZOOM_FACTOR)
        : Math.min(maxBeatRef.current, prev.beatsPerScreen * ZOOM_FACTOR)
      if (newBps === prev.beatsPerScreen) return prev
      const newStart = anchorBeat - anchorFraction * newBps
      return { beatsPerScreen: newBps, startBeat: clampStart(newStart, newBps) }
    })
  }, [clampStart])

  const panBy = useCallback((deltaBeats: number) => {
    setState(prev => {
      const newStart = clampStart(prev.startBeat + deltaBeats, prev.beatsPerScreen)
      if (Math.abs(newStart - prev.startBeat) < 0.01) return prev
      return { ...prev, startBeat: newStart }
    })
  }, [clampStart])

  const autoScrollTo = useCallback((beat: number, targetFraction: number) => {
    setState(prev => {
      const currentEnd = prev.startBeat + prev.beatsPerScreen
      const margin = prev.beatsPerScreen * 0.05
      if (beat >= prev.startBeat + margin && beat <= currentEnd - margin) return prev
      const newStart = clampStart(beat - targetFraction * prev.beatsPerScreen, prev.beatsPerScreen)
      if (Math.abs(newStart - prev.startBeat) < 0.5) return prev
      return { ...prev, startBeat: newStart }
    })
  }, [clampStart])

  const setView = useCallback((startBeat: number, beatsPerScreen: number) => {
    setState(() => {
      const bps = Math.max(MIN_BEATS_PER_SCREEN, Math.min(maxBeatRef.current, beatsPerScreen))
      return { beatsPerScreen: bps, startBeat: clampStart(startBeat, bps) }
    })
  }, [clampStart])

  return [state, { scrollTo, zoomAt, panBy, autoScrollTo, setView }]
}
