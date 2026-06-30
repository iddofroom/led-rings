/**
 * WLED color presets — shared source of truth.
 *
 * The palette data lives in `wled-palettes.json` (language-agnostic, so the Python
 * translator can read the exact same file). This module gives TypeScript consumers a
 * typed view plus small helpers (lookup + gradient CSS for previews).
 *
 * Each palette's `colors` is an ordered set of representative swatches sampled along
 * the original WLED / FastLED gradient (vivid stops first), suitable for a single-color
 * picker. The first palette ("Basic") preserves the Live Console's original swatches.
 */

import data from './wled-palettes.json'

export interface WledPalette {
  id: string
  name: string
  colors: string[]
  /** Palette index in WLED, where known (reference only). */
  wledId?: number
}

export const WLED_PALETTES: WledPalette[] = data.palettes

/** The default palette (Basic) — its swatches match the Live Console's original COLORS. */
export const DEFAULT_PALETTE: WledPalette = WLED_PALETTES[0]

export function paletteById(id: string): WledPalette {
  return WLED_PALETTES.find((p) => p.id === id) ?? DEFAULT_PALETTE
}

/** A horizontal `linear-gradient(...)` string for previewing a palette as a bar. */
export function paletteGradientCss(palette: WledPalette): string {
  const stops = palette.colors
  if (stops.length === 1) return stops[0]
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
