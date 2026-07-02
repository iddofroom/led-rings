/**
 * Generates TypeScript source that mirrors the Timeline Manager UI (song + timeframes).
 * Output matches the pattern used in src/songs/.
 */

import { getMovementCodeGenEntries } from './movementGenerators'
import type { TimeframeMovement, MovementWindow } from './movementGenerators'

export type AnimationType = 'song' | 'trigger'

export interface Song {
  name: string
  /** Song length in seconds. Total beats = (lengthSeconds / 60) * bpm */
  lengthSeconds: number
  bpm: number
  startOffsetMs?: number
  /** When 'trigger', output uses Animation(bpm, totalTimeSeconds) and trigger(); when 'song', uses Animation(..., startOffsetMs) and startSong(). */
  animationType?: AnimationType
  /** Path or URL to the audio file for timeline playback (e.g. /audio/song.wav). Supported: .wav, .mp3, .ogg, etc. */
  audioFilePath?: string
  /** Detected beat positions in milliseconds. When present, beatToMs uses lookup instead of fixed-BPM formula. Index = beat number, value = ms timestamp. */
  beatTimestampsMs?: number[]
  /** Ring numbers that have a lilum pendant mirroring them. Emits anim.mirrorToLilum([...]) so ring N -> thing lilum${N}. */
  lilumRings?: number[]
}

export type TimeframeCycleEntry =
  | { type: 'cycle'; beatsInCycle: number }
  | { type: 'cycleBeats'; beatsInCycle: number; startBeat: number; endBeat: number }

export interface TimeframeEffectEntry {
  id: string
  effectKey: string
  params?: Record<string, number | boolean | object>
  phase?: number
}

export interface Timeframe {
  id: string
  startTime: number
  endTime: number
  label: string
  color: string
  hasExplicitColor?: boolean
  rings: number[]
  disabled?: boolean
  mapping?: string
  phase?: number
  movement?: TimeframeMovement
  cycles?: TimeframeCycleEntry[]
  effects?: TimeframeEffectEntry[]
  brightnessEffect?: string
  brightnessEffectParams?: Record<string, number | boolean>
  hueEffect?: string
  hueEffectParams?: Record<string, number | boolean>
  motionEffect?: string
  motionEffectParams?: Record<string, number | boolean>
}

function getTimeframeEffects(tf: Timeframe): TimeframeEffectEntry[] {
  if (tf.effects && tf.effects.length > 0) return tf.effects.filter(e => e.effectKey !== '')
  const entries: TimeframeEffectEntry[] = []
  const add = (key: string, params?: Record<string, number | boolean>) => {
    if (key) entries.push({ id: `legacy-${key}`, effectKey: key, params })
  }
  if (tf.brightnessEffect) add(tf.brightnessEffect, tf.brightnessEffectParams)
  if (tf.hueEffect) add(tf.hueEffect, tf.hueEffectParams)
  if (tf.motionEffect) add(tf.motionEffect, tf.motionEffectParams)
  return entries
}

const RINGS_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const RINGS_EVEN = [2, 4, 6, 8, 10, 12]
const RINGS_ODD = [1, 3, 5, 7, 9, 11]
const RINGS_LEFT = [1, 2, 3, 4, 5, 6]
const RINGS_RIGHT = [7, 8, 9, 10, 11, 12]
const RINGS_CENTER = [4, 5, 6, 7, 8, 9]

function sameRings(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.every((v, i) => v === sb[i])
}

function ringsToElementsArg(rings: number[]): string {
  if (sameRings(rings, RINGS_ALL)) return 'all'
  if (sameRings(rings, RINGS_EVEN)) return 'even'
  if (sameRings(rings, RINGS_ODD)) return 'odd'
  if (sameRings(rings, RINGS_LEFT)) return 'left'
  if (sameRings(rings, RINGS_RIGHT)) return 'right'
  if (sameRings(rings, RINGS_CENTER)) return 'center'
  return `[${rings.sort((a, b) => a - b).join(', ')}]`
}

/** Returns a display label for the rings selection (e.g. "All", "Center") or comma-separated numbers. */
export function ringsToDisplayLabel(rings: number[]): string {
  if (sameRings(rings, RINGS_ALL)) return 'All'
  if (sameRings(rings, RINGS_EVEN)) return 'Even'
  if (sameRings(rings, RINGS_ODD)) return 'Odd'
  if (sameRings(rings, RINGS_LEFT)) return 'Left'
  if (sameRings(rings, RINGS_RIGHT)) return 'Right'
  if (sameRings(rings, RINGS_CENTER)) return 'Center'
  return [...rings].sort((a, b) => a - b).join(', ')
}

const UI_MAPPING_TO_SEGMENT: Record<string, string> = {
  all: 'segment_all',
  arc: 'segment_arc',
  ind: 'segment_ind',
  b1: 'segment_b1',
  b2: 'segment_b2',
  centric: 'segment_centric',
  updown: 'segment_updown',
  rand: 'segment_rand',
}

function mappingToSegment(mapping: string | undefined): string {
  const key = (mapping || 'all').toLowerCase()
  return UI_MAPPING_TO_SEGMENT[key] ?? 'segment_all'
}

/** Hex #rrggbb → { h, s, v } in 0–1 (hue matches TS convention) */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const v = max
  const d = max - min
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h = h / 6
  if (h < 0) h += 1
  return { h, s, v }
}

function formatParamValue(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(4)))
}

/** Serialize a FloatFunction-shaped object to TS source (const_value, linear, sin, steps). */
function formatFloatFunction(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return 'const_value: { value: 1 }'
  const o = obj as Record<string, unknown>
  if (o.const_value && typeof o.const_value === 'object') {
    const v = o.const_value as Record<string, unknown>
    const val = typeof v.value === 'number' ? v.value : 1
    return `const_value: { value: ${formatParamValue(val)} }`
  }
  if (o.linear && typeof o.linear === 'object') {
    const v = o.linear as Record<string, unknown>
    const start = typeof v.start === 'number' ? v.start : 0
    const end = typeof v.end === 'number' ? v.end : 1
    return `linear: { start: ${formatParamValue(start)}, end: ${formatParamValue(end)} }`
  }
  if (o.sin && typeof o.sin === 'object') {
    const v = o.sin as Record<string, unknown>
    const min = typeof v.min === 'number' ? v.min : 0
    const max = typeof v.max === 'number' ? v.max : 1
    const phase = typeof v.phase === 'number' ? v.phase : 0
    const repeats = typeof v.repeats === 'number' ? v.repeats : 1
    return `sin: { min: ${formatParamValue(min)}, max: ${formatParamValue(max)}, phase: ${formatParamValue(phase)}, repeats: ${formatParamValue(repeats)} }`
  }
  if (o.steps && typeof o.steps === 'object') {
    const v = o.steps as Record<string, unknown>
    const num_steps = typeof v.num_steps === 'number' ? v.num_steps : 4
    const diff_per_step = typeof v.diff_per_step === 'number' ? v.diff_per_step : 0.25
    const first_step_value = typeof v.first_step_value === 'number' ? v.first_step_value : 0
    return `steps: { num_steps: ${formatParamValue(num_steps)}, diff_per_step: ${formatParamValue(diff_per_step)}, first_step_value: ${formatParamValue(first_step_value)} }`
  }
  return 'const_value: { value: 1 }'
}

function formatEffectParams(params: Record<string, number | boolean | object> | undefined, schema?: { key: string }[]): string {
  if (!params || Object.keys(params).length === 0) return ''
  const keys = schema ? schema.map((s) => s.key) : Object.keys(params)
  const parts = keys
    .filter((k) => params[k] !== undefined && (typeof params[k] === 'number' || typeof params[k] === 'boolean'))
    .map((k) => `${k}: ${formatParamValue(params[k] as number | boolean)}`)
  if (parts.length === 0) return ''
  return `{ ${parts.join(', ')} }`
}

function emitColor(tf: Timeframe, hueOffset = 0): string[] {
  const { h, s, v } = hexToHsv(tf.color)
  const hue = h + hueOffset
  return [`constColor({ hue: ${hue.toFixed(4)}, sat: ${s.toFixed(4)}, val: ${v.toFixed(4)} })`]
}

const BRIGHTNESS_KEYS = new Set(['brightness', 'fadeIn', 'fadeOut', 'fadeInOut', 'fadeOutIn', 'blink', 'pulse', 'fade'])
const HUE_KEYS = new Set(['staticHueShift', 'hueShiftStartToEnd', 'hueShiftSin'])
const MOTION_KEYS = new Set(['snakeHeadMove', 'staticSnake', 'snake', 'snakeHeadSin', 'snakeFillGrow', 'snakeInOut', 'snakeSlowFast', 'snakeTailShrinkGrow', 'snakeHeadSteps'])

const POSITION_KEYS = new Set(['position_brightness', 'position_hue', 'position_saturation'])
const SNAKE_KEYS = new Set(['snake_brightness', 'snake_hue', 'snake_saturation'])
const TIMED_KEYS = new Set(['timed_brightness', 'timed_hue', 'timed_saturation'])

function emitSingleEffect(effectKey: string, params: Record<string, number | boolean | object> | undefined): string[] {
  const p = (params || {}) as Record<string, unknown>
  if (SNAKE_KEYS.has(effectKey)) {
    const head = p.head != null ? formatFloatFunction(p.head) : 'const_value: { value: 0 }'
    const tailLength = p.tail_length != null ? formatFloatFunction(p.tail_length) : 'const_value: { value: 0.5 }'
    const cyclic = p.cyclic === true ? 'true' : 'false'
    const parts = [`head: { ${head} }`, `tail_length: { ${tailLength} }`, `cyclic: ${cyclic}`]
    if (effectKey === 'snake_brightness' || effectKey === 'snake_saturation') {
      if (p.mult_factor_increase != null) parts.push(`mult_factor_increase: { ${formatFloatFunction(p.mult_factor_increase)} }`)
      if (p.mult_factor_decrease != null) parts.push(`mult_factor_decrease: { ${formatFloatFunction(p.mult_factor_decrease)} }`)
    } else {
      if (p.offset_factor != null) parts.push(`offset_factor: { ${formatFloatFunction(p.offset_factor)} }`)
    }
    if ((effectKey === 'snake_brightness' || effectKey === 'snake_saturation') && !p.mult_factor_increase && !p.mult_factor_decrease) return []
    if (effectKey === 'snake_hue' && !p.offset_factor) return []
    return [`addEffect({ ${effectKey}: { ${parts.join(', ')} } })`]
  }
  if (POSITION_KEYS.has(effectKey)) {
    const parts: string[] = []
    if (effectKey === 'position_brightness' || effectKey === 'position_saturation') {
      if (p.mult_factor_increase != null) parts.push(`mult_factor_increase: { ${formatFloatFunction(p.mult_factor_increase)} }`)
      if (p.mult_factor_decrease != null) parts.push(`mult_factor_decrease: { ${formatFloatFunction(p.mult_factor_decrease)} }`)
    } else {
      if (p.offset_factor != null) parts.push(`offset_factor: { ${formatFloatFunction(p.offset_factor)} }`)
    }
    if (parts.length === 0) return []
    return [`addEffect({ ${effectKey}: { ${parts.join(', ')} } })`]
  }
  if (TIMED_KEYS.has(effectKey)) {
    const parts: string[] = []
    if (effectKey === 'timed_brightness' || effectKey === 'timed_saturation') {
      if (p.mult_factor_increase != null) parts.push(`mult_factor_increase: { ${formatFloatFunction(p.mult_factor_increase)} }`)
      if (p.mult_factor_decrease != null) parts.push(`mult_factor_decrease: { ${formatFloatFunction(p.mult_factor_decrease)} }`)
    } else {
      if (p.offset_factor != null) parts.push(`offset_factor: { ${formatFloatFunction(p.offset_factor)} }`)
    }
    if (parts.length === 0) return []
    return [`addEffect({ ${effectKey}: { ${parts.join(', ')} } })`]
  }
  const args = formatEffectParams(params)
  const schemas: Record<string, { key: string }[]> = {
    brightness: [{ key: 'value' }],
    fadeInOut: [{ key: 'high' }],
    fadeOutIn: [{ key: 'low' }],
    blink: [{ key: 'low' }],
    pulse: [{ key: 'low' }, { key: 'staticPhase' }],
    fade: [{ key: 'start' }, { key: 'end' }],
  }
  if (BRIGHTNESS_KEYS.has(effectKey)) {
    const schema = schemas[effectKey]
    const formatted = formatEffectParams(params, schema)
    if (effectKey === 'brightness' && formatted) return [`brightness(${formatted})`]
    if (effectKey === 'fadeIn') return ['fadeIn()']
    if (effectKey === 'fadeOut') return ['fadeOut()']
    if (effectKey === 'fadeInOut') return [formatted ? `fadeInOut(${formatted})` : 'fadeInOut()']
    if (effectKey === 'fadeOutIn') return [formatted ? `fadeOutIn(${formatted})` : 'fadeOutIn()']
    if (effectKey === 'blink') return [formatted ? `blink(${formatted})` : 'blink()']
    if (effectKey === 'pulse') return [formatted ? `pulse(${formatted})` : 'pulse()']
    if (effectKey === 'fade') return [formatted ? `fade(${formatted})` : 'fade()']
  }
  if (HUE_KEYS.has(effectKey)) {
    if (effectKey === 'staticHueShift') return [params?.value !== undefined ? `staticHueShift({ value: ${formatParamValue(params!.value as number)} })` : 'staticHueShift()']
    if (effectKey === 'hueShiftStartToEnd') return [args ? `hueShiftStartToEnd(${args})` : 'hueShiftStartToEnd()']
    if (effectKey === 'hueShiftSin') return [args ? `hueShiftSin(${args})` : 'hueShiftSin()']
  }
  if (MOTION_KEYS.has(effectKey)) {
    if (effectKey === 'snakeFillGrow') {
      const reverse = params?.reverse === true
      return [reverse ? 'snakeFillGrow(true)' : 'snakeFillGrow()']
    }
    if (effectKey === 'snakeInOut') return [args ? `snakeInOut(${args})` : 'snakeInOut()']
    if (effectKey === 'snakeTailShrinkGrow') return ['snakeTailShrinkGrow()']
    if (effectKey === 'snakeHeadMove' || effectKey === 'staticSnake' || effectKey === 'snake' || effectKey === 'snakeHeadSin' || effectKey === 'snakeSlowFast' || effectKey === 'snakeHeadSteps') {
      return [args ? `${effectKey}(${args})` : `${effectKey}()`]
    }
  }
  return []
}

function indentBlock(block: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return block.split('\n').map((line) => prefix + line).join('\n')
}

function wrapWithPhase(lines: string[], phaseValue: number | undefined): string[] {
  if (phaseValue == null || phaseValue <= 0 || lines.length === 0) return lines
  const block = lines.join('\n')
  return [`phase(${formatParamValue(phaseValue)}, () => {
${indentBlock(block, 2)}
});`]
}

type EmitLayer = 'color' | 'modifiers' | 'motion'

function emitInnerContent(tf: Timeframe, layer: EmitLayer, hueOffset?: number): string[] {
  const inner: string[] = []
  if (layer === 'color') {
    // When user checks "No color (modifiers only)", do not emit constColor so the runtime treats this as modifiers on the accumulated result.
    if (tf.hasExplicitColor === false) return []
    if (hueOffset != null) {
      // Phase baked into hue directly (used for movement per-ring blocks)
      inner.push(...emitColor(tf, hueOffset))
    } else {
      inner.push(...wrapWithPhase(emitColor(tf), tf.phase))
    }
  } else {
    const effectEntries = getTimeframeEffects(tf)
    for (const entry of effectEntries) {
      const isMotion = MOTION_KEYS.has(entry.effectKey)
      if (layer === 'motion' && !isMotion) continue
      if (layer === 'modifiers' && isMotion) continue
      const effectLines = emitSingleEffect(entry.effectKey, entry.params)
      inner.push(...wrapWithPhase(effectLines, entry.phase))
    }
  }
  return inner
}

function wrapWithCycles(core: string, cycles: Timeframe['cycles']): string {
  for (let i = (cycles ?? []).length - 1; i >= 0; i--) {
    const c = cycles![i]
    if (c.type === 'cycle') {
      core = `cycle(${c.beatsInCycle}, () => {
${indentBlock(core, 2)}
});`
    } else {
      core = `cycleBeats(${c.beatsInCycle}, ${c.startBeat}, ${c.endBeat}, () => {
${indentBlock(core, 2)}
});`
    }
  }
  return core
}

function emitTimeframeBody(tf: Timeframe, layer: EmitLayer): string | null {
  const segmentId = mappingToSegment(tf.mapping)
  const inner = emitInnerContent(tf, layer)
  if (inner.length === 0) return null

  // Movement: emit separate beats() per ring with per-ring timing
  if (tf.movement) {
    const entries = getMovementCodeGenEntries(tf.startTime, tf.endTime, tf.rings, tf.movement)
    const sortedRings = [...tf.rings].sort((a, b) => a - b)
    const phasePerRing = (layer === 'color' && tf.phase && tf.phase > 0 && tf.hasExplicitColor !== false)
    const blocks: string[] = []
    for (const entry of entries) {
      for (const w of entry.windows) {
        const win = w as MovementWindow
        // holdOff: keep ring off after its turn (Random + retire). Only modifiers layer; skip color/motion.
        if (win.holdOff) {
          if (layer !== 'modifiers') continue
          const effectLines = 'addEffect({ timed_brightness: { mult_factor_decrease: { const_value: { value: 0 } } } })'
          const core = `elements([${entry.ringNum}], () => {
  segment(${segmentId}, () => {
${indentBlock(effectLines, 4)}
  });
});`
          blocks.push(`    beats(${w.start}, ${w.end}, () => {
${indentBlock(core, 6)}
    })`)
          continue
        }
        // When phase is set on a color layer, bake hue offset per ring
        const ringInner = phasePerRing
          ? emitInnerContent(tf, layer, (sortedRings.indexOf(entry.ringNum) / sortedRings.length) * tf.phase!)
          : inner
        const effectLines = ringInner.join('\n')
        let core: string

        if (entry.staggerOffset != null && entry.staggerOffset > 0) {
          // Stagger: wrap content in a cycle with per-ring offset
          const dur = w.end - w.start
          let innerContent = effectLines
          innerContent = wrapWithCycles(innerContent, tf.cycles)
          core = `elements([${entry.ringNum}], () => {
  segment(${segmentId}, () => {
    cycle(${dur}, () => {
      cycleBeats(${dur}, ${entry.staggerOffset}, ${dur}, () => {
${indentBlock(innerContent, 8)}
      });
    });
  });
});`
        } else {
          core = `elements([${entry.ringNum}], () => {
  segment(${segmentId}, () => {
${indentBlock(effectLines, 4)}
  });
});`
          core = wrapWithCycles(core, tf.cycles)
        }

        blocks.push(`    beats(${w.start}, ${w.end}, () => {
${indentBlock(core, 6)}
    })`)
      }
    }
    return blocks.length > 0 ? blocks.join('\n\n') : null
  }

  // No movement: single beats() block with all rings
  const elementsArg = ringsToElementsArg(tf.rings)
  const effectLines = inner.join('\n')
  let core = `elements(${elementsArg}, () => {
  segment(${segmentId}, () => {
${indentBlock(effectLines, 4)}
  });
});`
  core = wrapWithCycles(core, tf.cycles)
  return `    beats(${tf.startTime}, ${tf.endTime}, () => {
${indentBlock(core, 6)}
    })`
}

/** Emits an `anim.mirrorToLilum([...]);` line (indented 2) when rings are set,
 *  else an empty string. ring N -> thing lilum${N}; see src/lilum/segments.ts. */
function mirrorToLilumCall(rings: number[] | undefined): string {
  if (!rings || rings.length === 0) return ''
  const sorted = [...new Set(rings)].sort((a, b) => a - b)
  return `  anim.mirrorToLilum([${sorted.join(', ')}]);\n`
}

function toIdentifier(name: string): string {
  const safe = (name || 'sequence').trim() || 'sequence'
  const camel = safe.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^a-zA-Z]/, '')
  const id = camel ? camel : 'sequence'
  return id.charAt(0).toLowerCase() + id.slice(1)
}

export function generateSequenceTs(song: Song, timeframes: Timeframe[], importPrefix = '..'): string {
  const enabledTimeframes = timeframes.filter(tf => !tf.disabled)
  const safeName = (song.name || 'sequence').trim() || 'sequence'
  const totalTimeSeconds = song.lengthSeconds
  const startOffsetMs = song.startOffsetMs ?? 0
  const animationType = song.animationType ?? 'song'

  let bodyBlocks: string
  if (enabledTimeframes.length === 0) {
    bodyBlocks = '    // Empty: add beats() blocks and content here.'
  } else {
    const colorBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'color')).filter(Boolean) as string[]
    const modifierBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'modifiers')).filter(Boolean) as string[]
    const motionBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'motion')).filter(Boolean) as string[]
    bodyBlocks = [...colorBlocks, ...modifierBlocks, ...motionBlocks].join('\n\n')
  }

  const escapedName = safeName.replace(/"/g, '\\"')
  const isTrigger = animationType === 'trigger'

  const startSongName = (() => {
    const path = song.audioFilePath?.trim()
    if (!path) return escapedName
    const base = path.replace(/^.*[/\\]/, '')
    const withoutExt = base.replace(/\.[^.]+$/, '') || base
    return withoutExt.replace(/"/g, '\\"')
  })()

  const beatTimestampsArg = !isTrigger && song.beatTimestampsMs && song.beatTimestampsMs.length > 0
    ? `, ${JSON.stringify(song.beatTimestampsMs)}`
    : ''
  const animationCtor = `new Animation("${escapedName}", ${song.bpm}, ${totalTimeSeconds.toFixed(2)}, ${startOffsetMs}${beatTimestampsArg})`
  const mirrorCall = mirrorToLilumCall(song.lilumRings)
  const runCall = isTrigger
    ? `await trigger("${escapedName}"${startOffsetMs > 0 ? `, ${startOffsetMs / 1000}` : ''});`
    : `await startSong("${startSongName}", 0);`
  const fnName = toIdentifier(safeName)

  return `// Generated from Timeline Manager.
import { sendSequence } from "${importPrefix}/services/sequence";
import { startSong, trigger } from "${importPrefix}/services/trigger";
import { Animation } from "${importPrefix}/animation/animation";
import { beats, cycle, cycleBeats } from "${importPrefix}/time/time";
import { phase } from "${importPrefix}/phase/phase";
import { constColor, noColor } from "${importPrefix}/effects/coloring";
import { addEffect } from "${importPrefix}/effects/effect";
import {
  blink,
  brightness,
  fade,
  fadeIn,
  fadeInOut,
  fadeOut,
  fadeOutIn,
  pulse,
} from "${importPrefix}/effects/brightness";
import { elements, segment } from "${importPrefix}/objects/elements";
import {
  all,
  center,
  even,
  left,
  odd,
  right,
  segment_all,
  segment_arc,
  segment_b1,
  segment_b2,
  segment_centric,
  segment_ind,
  segment_rand,
  segment_updown,
} from "${importPrefix}/objects/ring-elements";
import {
  snake,
  snakeFillGrow,
  snakeHeadMove,
  snakeHeadSin,
  snakeInOut,
  snakeSlowFast,
  snakeTailShrinkGrow,
  snakeHeadSteps,
  staticSnake,
} from "${importPrefix}/effects/motion";
import { hueShiftSin, hueShiftStartToEnd, staticHueShift } from "${importPrefix}/effects/hue";

const ${fnName} = async () => {
  const anim = ${animationCtor};
  anim.sync(() => {
${bodyBlocks}
  });

${mirrorCall}  console.log("sending sequence");
  await sendSequence("${escapedName}", anim.getSequence());
  if (!process.env.SEND_ONLY) {
    ${runCall}
  }
};

(async () => {
  await ${fnName}();
})();
`
}

/** Generates TS that only builds the animation and writes { triggerName, sequence } to process.env.TMP_SEQUENCE_OUT (for control-server send-sequence). */
export function generateSequenceRunnerTs(song: Song, timeframes: Timeframe[]): string {
  const enabledTimeframes = timeframes.filter(tf => !tf.disabled)
  const safeName = (song.name || 'sequence').trim() || 'sequence'
  const totalTimeSeconds = song.lengthSeconds
  const startOffsetMs = song.startOffsetMs ?? 0
  const animationType = song.animationType ?? 'song'

  let bodyBlocks: string
  if (enabledTimeframes.length === 0) {
    bodyBlocks = '    // Empty: add beats() blocks and content here.'
  } else {
    const colorBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'color')).filter(Boolean) as string[]
    const modifierBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'modifiers')).filter(Boolean) as string[]
    const motionBlocks = enabledTimeframes.map(tf => emitTimeframeBody(tf, 'motion')).filter(Boolean) as string[]
    bodyBlocks = [...colorBlocks, ...modifierBlocks, ...motionBlocks].join('\n\n')
  }
  const escapedName = safeName.replace(/"/g, '\\"')
  const isTrigger = animationType === 'trigger'
  const beatTimestampsArg = !isTrigger && song.beatTimestampsMs && song.beatTimestampsMs.length > 0
    ? `, ${JSON.stringify(song.beatTimestampsMs)}`
    : ''
  const animationCtor = `new Animation("${escapedName}", ${song.bpm}, ${totalTimeSeconds.toFixed(2)}, ${startOffsetMs}${beatTimestampsArg})`
  const mirrorCall = mirrorToLilumCall(song.lilumRings)
  const fnName = toIdentifier(safeName)
  return `// Runner: builds sequence and writes to TMP_SEQUENCE_OUT.
import * as fs from "fs";
import { Animation } from "./animation/animation";
import { beats, cycle, cycleBeats } from "./time/time";
import { phase } from "./phase/phase";
import { constColor, noColor } from "./effects/coloring";
import { addEffect } from "./effects/effect";
import {
  blink,
  brightness,
  fade,
  fadeIn,
  fadeInOut,
  fadeOut,
  fadeOutIn,
  pulse,
} from "./effects/brightness";
import { elements, segment } from "./objects/elements";
import {
  all,
  center,
  even,
  left,
  odd,
  right,
  segment_all,
  segment_arc,
  segment_b1,
  segment_b2,
  segment_centric,
  segment_ind,
  segment_rand,
  segment_updown,
} from "./objects/ring-elements";
import {
  snake,
  snakeFillGrow,
  snakeHeadMove,
  snakeHeadSin,
  snakeInOut,
  snakeSlowFast,
  snakeTailShrinkGrow,
  snakeHeadSteps,
  staticSnake,
} from "./effects/motion";
import { hueShiftSin, hueShiftStartToEnd, staticHueShift } from "./effects/hue";

const ${fnName} = async () => {
  const anim = ${animationCtor};
  anim.sync(() => {
${bodyBlocks}
  });
${mirrorCall}  const outPath = process.env.TMP_SEQUENCE_OUT || ".tmp-sequence-out.json";
  fs.writeFileSync(outPath, JSON.stringify({ triggerName: "${escapedName}", sequence: anim.getSequence() }));
};

(async () => {
  await ${fnName}();
})();
`
}
