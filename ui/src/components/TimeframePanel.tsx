import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Timeframe, TimeframeCycleEntry, TimeframeCycleBeats, getTimeframeEffects, TimeframeEffectEntry } from '../App'
import { MOVEMENT_TYPES, MOVEMENT_DIRECTIONS, defaultBeatsPerRing } from '../movementGenerators'
import type { MovementType, MovementDirection } from '../movementGenerators'
import segmentsData from '../segments.json'
import RingVisualization from './RingVisualization'
import HsvColorPicker from './HsvColorPicker'
import { WLED_PALETTES, DEFAULT_PALETTE, paletteById } from '../../../shared/wled-palettes'
import { useI18n } from '../lib/i18n'
import './TimeframePanel.css'

// Hebrew for data-driven labels (effect names, float-function kinds, effect/movement
// param labels, movement descriptions). Keyed by the English display string so the
// machine values (effectKey / param key / union ids) stay byte-for-byte unchanged;
// only the visible label is translated at its render site.
const HE_LABEL: Record<string, string> = {
  // Effect names
  'Position Brightness': 'בהירות לפי מיקום',
  'Position Hue': 'גוון לפי מיקום',
  'Position Saturation': 'רוויה לפי מיקום',
  'Timed Brightness': 'בהירות לפי זמן',
  'Timed Hue': 'גוון לפי זמן',
  'Timed Saturation': 'רוויה לפי זמן',
  'Snake Brightness': 'בהירות נחש',
  'Snake Hue': 'גוון נחש',
  'Snake Saturation': 'רוויה נחש',
  'Brightness': 'בהירות',
  'Fade In': 'דהייה פנימה',
  'Fade Out': 'דהייה החוצה',
  'Fade In Out': 'דהייה פנימה והחוצה',
  'Fade Out In': 'דהייה החוצה ופנימה',
  'Blink': 'הבהוב',
  'Pulse': 'פעימה',
  'Fade': 'דהייה',
  'Static Hue Shift': 'הסטת גוון קבועה',
  'Hue Shift Start To End': 'הסטת גוון מהתחלה לסוף',
  'Hue Shift Sin': 'הסטת גוון סינוס',
  'Snake Head Move': 'תנועת ראש נחש',
  'Static Snake': 'נחש קבוע',
  'Snake': 'נחש',
  'Snake Head Sin': 'ראש נחש סינוס',
  'Snake Fill Grow': 'מילוי נחש גדל',
  'Snake In Out': 'נחש פנימה והחוצה',
  'Snake Slow Fast': 'נחש איטי־מהיר',
  'Snake Tail Shrink Grow': 'זנב נחש מתכווץ־גדל',
  'Snake Head Steps': 'צעדי ראש נחש',
  // Effect categories (optgroup labels)
  'Position': 'מיקום',
  'Timed': 'מתוזמן',
  'Motion': 'תנועה',
  'Hue': 'גוון',
  // Float-function kinds
  'Const': 'קבוע',
  'Linear': 'ליניארי',
  'Sin': 'סינוס',
  'Steps': 'צעדים',
  // Float-function params
  'Value': 'ערך',
  'Start': 'התחלה',
  'End': 'סיום',
  'Min': 'מינימום',
  'Max': 'מקסימום',
  'Phase': 'פאזה',
  'Repeats': 'חזרות',
  'Diff per step': 'הפרש לכל צעד',
  'First value': 'ערך ראשון',
  // Effect params
  'High': 'גבוה',
  'Low': 'נמוך',
  'Static phase': 'פאזה קבועה',
  'Amount': 'כמות',
  'Tail': 'זנב',
  'Tail length': 'אורך זנב',
  'Cyclic': 'מחזורי',
  'Reverse': 'הפוך',
  'Increase (by position)': 'הגברה (לפי מיקום)',
  'Decrease (by position)': 'הפחתה (לפי מיקום)',
  'Offset (by position)': 'היסט (לפי מיקום)',
  'Increase (by time)': 'הגברה (לפי זמן)',
  'Decrease (by time)': 'הפחתה (לפי זמן)',
  'Offset (by time)': 'היסט (לפי זמן)',
  'Head (time)': 'ראש (זמן)',
  'Increase (along snake)': 'הגברה (לאורך הנחש)',
  'Decrease (along snake)': 'הפחתה (לאורך הנחש)',
  'Offset (along snake)': 'היסט (לאורך הנחש)',
  // Movement types
  'Spread': 'פיזור',
  'Sweep': 'סריקה',
  'Stagger': 'מדורג',
  'Random': 'אקראי',
  // Movement descriptions
  'Rings activate progressively; all stay on until the end.': 'הטבעות נדלקות בהדרגה; כולן נשארות דולקות עד הסוף.',
  'One ring (or group) at a time, moving across.': 'טבעת אחת (או קבוצה) בכל פעם, נעה לרוחב.',
  'All rings play the same effect, wave-shifted in time.': 'כל הטבעות מנגנות את אותו אפקט, מוסטות בזמן כמו גל.',
  'Rings activate in random order (one at a time, like sweep).': 'הטבעות נדלקות בסדר אקראי (אחת בכל פעם, כמו סריקה).',
  // Movement extra params
  'Retire (diamond)': 'פרישה (יהלום)',
  'Bounce (ping-pong)': 'קפיצה (הלוך־ושוב)',
  'Retire (stay off after fade)': 'פרישה (נשאר כבוי אחרי דהייה)',
  'Accumulate (stay on after fade)': 'צבירה (נשאר דולק אחרי דהייה)',
  // Movement directions
  'Center → Out': 'מרכז → חוץ',
  'Edges → In': 'קצוות → פנים',
  'Opposite pairs →': 'זוגות נגדיים →',
  'Opposite pairs ←': 'זוגות נגדיים ←',
  'Custom order…': 'סדר מותאם…',
}

// Effect options by category (brightness.ts, hue.ts, motion.ts — coloring removed)
const BRIGHTNESS_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(none)' },
  { value: 'brightness', label: 'Brightness' },
  { value: 'fadeIn', label: 'Fade In' },
  { value: 'fadeOut', label: 'Fade Out' },
  { value: 'fadeInOut', label: 'Fade In Out' },
  { value: 'fadeOutIn', label: 'Fade Out In' },
  { value: 'blink', label: 'Blink' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'fade', label: 'Fade' },
]

const HUE_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(none)' },
  { value: 'staticHueShift', label: 'Static Hue Shift' },
  { value: 'hueShiftStartToEnd', label: 'Hue Shift Start To End' },
  { value: 'hueShiftSin', label: 'Hue Shift Sin' },
]

const MOTION_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(none)' },
  { value: 'snakeHeadMove', label: 'Snake Head Move' },
  { value: 'staticSnake', label: 'Static Snake' },
  { value: 'snake', label: 'Snake' },
  { value: 'snakeHeadSin', label: 'Snake Head Sin' },
  { value: 'snakeFillGrow', label: 'Snake Fill Grow' },
  { value: 'snakeInOut', label: 'Snake In Out' },
  { value: 'snakeSlowFast', label: 'Snake Slow Fast' },
  { value: 'snakeTailShrinkGrow', label: 'Snake Tail Shrink Grow' },
  { value: 'snakeHeadSteps', label: 'Snake Head Steps' },
]

const POSITION_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: 'position_brightness', label: 'Position Brightness' },
  { value: 'position_hue', label: 'Position Hue' },
  { value: 'position_saturation', label: 'Position Saturation' },
]

const SNAKE_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: 'snake_brightness', label: 'Snake Brightness' },
  { value: 'snake_hue', label: 'Snake Hue' },
  { value: 'snake_saturation', label: 'Snake Saturation' },
]

const TIMED_EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: 'timed_brightness', label: 'Timed Brightness' },
  { value: 'timed_hue', label: 'Timed Hue' },
  { value: 'timed_saturation', label: 'Timed Saturation' },
]

// Single combined list for one selector: (none) then Position / Timed / Snake / Brightness / Hue / Motion groups
type EffectCategory = 'Brightness' | 'Hue' | 'Motion' | 'Position' | 'Snake' | 'Timed' | null
const ALL_EFFECT_OPTIONS: { value: string; label: string; category: EffectCategory }[] = [
  { value: '', label: '(none)', category: null },
  ...POSITION_EFFECT_OPTIONS.map(o => ({ ...o, category: 'Position' as const })),
  ...TIMED_EFFECT_OPTIONS.map(o => ({ ...o, category: 'Timed' as const })),
  ...SNAKE_EFFECT_OPTIONS.map(o => ({ ...o, category: 'Snake' as const })),
  ...BRIGHTNESS_EFFECT_OPTIONS.filter(o => o.value).map(o => ({ ...o, category: 'Brightness' as const })),
  ...HUE_EFFECT_OPTIONS.filter(o => o.value).map(o => ({ ...o, category: 'Hue' as const })),
  ...MOTION_EFFECT_OPTIONS.filter(o => o.value).map(o => ({ ...o, category: 'Motion' as const })),
]

// FloatFunction kinds and their parameter definitions (for UI and codegen)
export type FloatFunctionKind = 'const_value' | 'linear' | 'sin' | 'steps'
type FloatFunctionParamDef = { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; step?: number }

const FLOAT_FUNCTION_KINDS: { value: FloatFunctionKind; label: string }[] = [
  { value: 'const_value', label: 'Const' },
  { value: 'linear', label: 'Linear' },
  { value: 'sin', label: 'Sin' },
  { value: 'steps', label: 'Steps' },
]

const FLOAT_FUNCTION_KIND_PARAMS: Record<FloatFunctionKind, FloatFunctionParamDef[]> = {
  const_value: [{ key: 'value', label: 'Value', type: 'number', default: 1, min: 0, max: 2, step: 0.01 }],
  linear: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 2, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 2, step: 0.01 },
  ],
  sin: [
    { key: 'min', label: 'Min', type: 'number', default: 0, min: 0, max: 2, step: 0.01 },
    { key: 'max', label: 'Max', type: 'number', default: 1, min: 0, max: 2, step: 0.01 },
    { key: 'phase', label: 'Phase', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'repeats', label: 'Repeats', type: 'number', default: 1, min: 0.25, max: 16, step: 0.25 },
  ],
  steps: [
    { key: 'num_steps', label: 'Steps', type: 'number', default: 4, min: 1, max: 32, step: 1 },
    { key: 'diff_per_step', label: 'Diff per step', type: 'number', default: 0.25, min: -2, max: 2, step: 0.01 },
    { key: 'first_step_value', label: 'First value', type: 'number', default: 0, min: 0, max: 2, step: 0.01 },
  ],
}

export type FloatFunctionValue = {
  const_value?: { value: number }
  linear?: { start: number; end: number }
  sin?: { min: number; max: number; phase: number; repeats: number }
  steps?: { num_steps: number; diff_per_step: number; first_step_value: number }
}

function defaultFloatFunction(kind: FloatFunctionKind): FloatFunctionValue {
  const params = FLOAT_FUNCTION_KIND_PARAMS[kind]
  const obj: Record<string, number> = {}
  params.forEach(p => { obj[p.key] = p.default })
  return { [kind]: obj } as FloatFunctionValue
}

function getFloatFunctionKind(f: FloatFunctionValue | undefined): FloatFunctionKind {
  if (!f) return 'const_value'
  if (f.const_value) return 'const_value'
  if (f.linear) return 'linear'
  if (f.sin) return 'sin'
  if (f.steps) return 'steps'
  return 'const_value'
}

/** Effects that have "one of" increase OR decrease: show single mode selector + one FloatFunction editor. */
const EFFECT_ONE_OF_INCREASE_DECREASE = new Set([
  'position_brightness', 'position_saturation', 'timed_brightness', 'timed_saturation',
  'snake_brightness', 'snake_saturation',
])
/** Snake effects need head/tail_length/cyclic preserved when updating increase/decrease. */
const SNAKE_EFFECT_KEYS = new Set(['snake_brightness', 'snake_hue', 'snake_saturation'])
const INCREASE_KEY = 'mult_factor_increase'
const DECREASE_KEY = 'mult_factor_decrease'

/** Visible default: decrease from 1 to 0 (linear). */
const DEFAULT_DECREASE_LINEAR: FloatFunctionValue = { linear: { start: 1, end: 0 } }
/** Visible default: head moves 0→1 over time. */
const DEFAULT_HEAD_LINEAR: FloatFunctionValue = { linear: { start: 0, end: 1 } }

/** Build default params for an effect (including FloatFunction defaults for Position/Timed/Snake). */
function getDefaultEffectParams(effectKey: string): Record<string, number | boolean | FloatFunctionValue> | undefined {
  const schema = EFFECT_PARAM_SCHEMAS[effectKey]
  if (!schema) return undefined
  const acc: Record<string, number | boolean | FloatFunctionValue> = {}
  const optionalFloatKeys = schema.filter(d => d.type === 'floatFunction' && d.optional).map(d => d.key)
  for (const def of schema) {
    if (def.type === 'floatFunction') {
      if (!def.optional) {
        // Single required float (e.g. position_hue offset_factor): use visible default
        if ((effectKey === 'position_hue' || effectKey === 'timed_hue') && def.key === 'offset_factor') {
          acc[def.key] = { const_value: { value: 0.5 } }
        } else if (SNAKE_EFFECT_KEYS.has(effectKey) && def.key === 'head') {
          acc[def.key] = DEFAULT_HEAD_LINEAR
        } else if (SNAKE_EFFECT_KEYS.has(effectKey) && def.key === 'tail_length') {
          acc[def.key] = { const_value: { value: 0.5 } }
        } else {
          acc[def.key] = defaultFloatFunction('const_value')
        }
      } else if (optionalFloatKeys.length >= 2 && def.key === optionalFloatKeys[optionalFloatKeys.length - 1]) {
        // Default only the last of the optional pair so exactly one is set; use visible default for position/timed/snake
        const useDecreaseLinear = ['position_brightness', 'position_saturation', 'timed_brightness', 'timed_saturation', 'snake_brightness', 'snake_saturation'].includes(effectKey)
        acc[def.key] = useDecreaseLinear ? DEFAULT_DECREASE_LINEAR : defaultFloatFunction('const_value')
      }
    } else if (def.default !== undefined) {
      acc[def.key] = def.default as number | boolean
    }
  }
  return Object.keys(acc).length ? acc : undefined
}

// Parameter definitions per effect
type EffectParamDef = {
  key: string
  label: string
  type: 'number' | 'boolean' | 'floatFunction'
  default?: number | boolean
  min?: number
  max?: number
  step?: number
  /** For floatFunction: at least one of increase/decrease or single offset must be set */
  optional?: boolean
}

const EFFECT_PARAM_SCHEMAS: Record<string, EffectParamDef[]> = {
  brightness: [{ key: 'value', label: 'Value', type: 'number', default: 1, min: 0, max: 1, step: 0.01 }],
  fadeInOut: [{ key: 'high', label: 'High', type: 'number', default: 1, min: 0, max: 1, step: 0.01 }],
  fadeOutIn: [{ key: 'low', label: 'Low', type: 'number', default: 0, min: 0, max: 1, step: 0.01 }],
  blink: [{ key: 'low', label: 'Low', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 }],
  pulse: [
    { key: 'low', label: 'Low', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: 'staticPhase', label: 'Static phase', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
  ],
  fade: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  staticHueShift: [{ key: 'value', label: 'Value', type: 'number', default: 0, min: 0, max: 1, step: 0.01 }],
  hueShiftStartToEnd: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  hueShiftSin: [{ key: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 }],
  snakeHeadMove: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'tail', label: 'Tail', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
  ],
  staticSnake: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  snake: [
    { key: 'tailLength', label: 'Tail length', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
    { key: 'cyclic', label: 'Cyclic', type: 'boolean', default: false },
    { key: 'reverse', label: 'Reverse', type: 'boolean', default: false },
  ],
  snakeHeadSin: [
    { key: 'tailLength', label: 'Tail length', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
    { key: 'cyclic', label: 'Cyclic', type: 'boolean', default: false },
  ],
  snakeFillGrow: [{ key: 'reverse', label: 'Reverse', type: 'boolean', default: false }],
  snakeInOut: [
    { key: 'start', label: 'Start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'end', label: 'End', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  snakeSlowFast: [{ key: 'tailLength', label: 'Tail length', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 }],
  snakeHeadSteps: [
    { key: 'steps', label: 'Steps', type: 'number', default: 4, min: 1, max: 32, step: 1 },
    { key: 'tailLength', label: 'Tail length', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
  ],
  // Position effects: params are FloatFunctions (by position in segment)
  position_brightness: [
    { key: 'mult_factor_increase', label: 'Increase (by position)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (by position)', type: 'floatFunction', optional: true },
  ],
  position_hue: [
    { key: 'offset_factor', label: 'Offset (by position)', type: 'floatFunction' },
  ],
  position_saturation: [
    { key: 'mult_factor_increase', label: 'Increase (by position)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (by position)', type: 'floatFunction', optional: true },
  ],
  // Timed effects: params are FloatFunctions (by time)
  timed_brightness: [
    { key: 'mult_factor_increase', label: 'Increase (by time)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (by time)', type: 'floatFunction', optional: true },
  ],
  timed_hue: [
    { key: 'offset_factor', label: 'Offset (by time)', type: 'floatFunction' },
  ],
  timed_saturation: [
    { key: 'mult_factor_increase', label: 'Increase (by time)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (by time)', type: 'floatFunction', optional: true },
  ],
  // Snake effects: head/tail along segment, params by position in snake
  snake_brightness: [
    { key: 'head', label: 'Head (time)', type: 'floatFunction' },
    { key: 'tail_length', label: 'Tail length', type: 'floatFunction' },
    { key: 'cyclic', label: 'Cyclic', type: 'boolean', default: false },
    { key: 'mult_factor_increase', label: 'Increase (along snake)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (along snake)', type: 'floatFunction', optional: true },
  ],
  snake_hue: [
    { key: 'head', label: 'Head (time)', type: 'floatFunction' },
    { key: 'tail_length', label: 'Tail length', type: 'floatFunction' },
    { key: 'cyclic', label: 'Cyclic', type: 'boolean', default: false },
    { key: 'offset_factor', label: 'Offset (along snake)', type: 'floatFunction' },
  ],
  snake_saturation: [
    { key: 'head', label: 'Head (time)', type: 'floatFunction' },
    { key: 'tail_length', label: 'Tail length', type: 'floatFunction' },
    { key: 'cyclic', label: 'Cyclic', type: 'boolean', default: false },
    { key: 'mult_factor_increase', label: 'Increase (along snake)', type: 'floatFunction', optional: true },
    { key: 'mult_factor_decrease', label: 'Decrease (along snake)', type: 'floatFunction', optional: true },
  ],
}



/** Convert hex color to HSV. Returns h in [0,360], s and v in [0,100]. */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
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
  return {
    h: Math.round(h * 60),
    s: Math.round(max === 0 ? 0 : (d / max) * 100),
    v: Math.round(max * 100),
  }
}

interface TimeframePanelProps {
  timeframe: Timeframe | null
  onUpdate: (updates: Partial<Timeframe>) => void
  onClose: () => void
  songLengthBeats?: number
}

const TimeframePanel = ({ timeframe, onUpdate, onClose, songLengthBeats }: TimeframePanelProps) => {
  const { t } = useI18n()
  // Translate a data-driven English display label via HE_LABEL (falls back to English).
  const trLabel = (label: string) => t({ en: label, he: HE_LABEL[label] ?? label })
  const [editingField, setEditingField] = useState<'label' | 'startTime' | 'endTime' | null>(null)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [panelPaletteId, setPanelPaletteId] = useState(DEFAULT_PALETTE.id)
  const panelPalette = paletteById(panelPaletteId)
  const colorPickerRef = React.useRef<HTMLDivElement>(null)
  const openColorPicker = useCallback(() => setColorPickerOpen(true), [])

  // Close picker when clicking outside
  useEffect(() => {
    if (!colorPickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [colorPickerOpen])
  const [tempStartTime, setTempStartTime] = useState<string>('')
  const [tempEndTime, setTempEndTime] = useState<string>('')

  // Raw text for the custom ring-order input. Kept local so partial input
  // (e.g. a trailing comma) isn't stripped on each keystroke. Re-synced from
  // the stored order only when the focused timeframe changes — NOT on every
  // edit, which would clobber in-progress typing.
  const [ringOrderText, setRingOrderText] = useState<string>('')
  useEffect(() => {
    setRingOrderText((timeframe?.movement?.customOrder ?? []).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe?.id])

  // Extract segment names from segments.json, filtering out numeric indices (0-11)
  const segmentNames = useMemo(() => {
    return segmentsData.segments
      .map((segment: { name: string }) => segment.name)
      .filter((name: string) => {
        // Filter out numeric strings (0-11)
        const num = parseInt(name, 10)
        return isNaN(num) || num < 0 || num > 11
      })
  }, [])

  if (!timeframe) {
    return (
      <div className="timeframe-panel">
        <div className="timeframe-panel-empty">
          <p>{t({ en: 'Select a timeframe to view and edit its properties', he: 'בחר מסגרת זמן כדי לצפות ולערוך את מאפייניה' })}</p>
        </div>
      </div>
    )
  }

  const handleInputChange = (
    field: 'label' | 'startTime' | 'endTime' | 'color',
    value: string | number,
  ) => {
    if (field === 'label' || field === 'color') {
      onUpdate({ [field]: value as string })
    } else if (field === 'startTime') {
      // Store raw input value while typing
      setTempStartTime(value as string)
    } else if (field === 'endTime') {
      // Store raw input value while typing
      setTempEndTime(value as string)
    }
  }

  const handleBlur = () => {
    // Apply value without snapping - allow any beat value
    if (editingField === 'startTime' && tempStartTime !== '') {
      const numValue = parseFloat(tempStartTime)
      if (!isNaN(numValue) && numValue >= 0) {
        onUpdate({ startTime: numValue })
      }
      setTempStartTime('')
    } else if (editingField === 'endTime' && tempEndTime !== '') {
      const numValue = parseFloat(tempEndTime)
      const maxEnd = songLengthBeats ?? Infinity
      if (!isNaN(numValue) && numValue > timeframe.startTime && numValue <= maxEnd) {
        onUpdate({ endTime: numValue })
      }
      setTempEndTime('')
    }
    setEditingField(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur()
    }
  }

  const handleStartTimeFocus = () => {
    setEditingField('startTime')
    setTempStartTime(timeframe.startTime.toString())
  }

  const handleEndTimeFocus = () => {
    setEditingField('endTime')
    setTempEndTime(timeframe.endTime.toString())
  }

  const duration = timeframe.endTime - timeframe.startTime

  return (
    <div className="timeframe-panel">
      <div className="timeframe-panel-header">
        <h2>{t({ en: 'Timeframe Details', he: 'פרטי מסגרת זמן' })}</h2>
        <button
          className="timeframe-panel-delete"
          onClick={onClose}
          title={t({ en: 'Close details', he: 'סגור פרטים' })}
        >
          ×
        </button>
      </div>

      <div className="timeframe-panel-content">
        <div className="timeframe-panel-section">
          <label className="timeframe-panel-label">{t({ en: 'Label', he: 'תווית' })}</label>
          {editingField === 'label' ? (
            <input
              type="text"
              value={timeframe.label}
              onChange={(e) => handleInputChange('label', e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="timeframe-panel-input"
              autoFocus
            />
          ) : (
            <div
              className="timeframe-panel-value editable"
              onClick={() => setEditingField('label')}
            >
              {timeframe.label}
            </div>
          )}
        </div>

        <div className="timeframe-panel-section">
          <label className="timeframe-panel-checkbox-label">
            <input
              type="checkbox"
              checked={!timeframe.disabled}
              onChange={(e) => onUpdate({ disabled: !e.target.checked })}
              className="timeframe-panel-checkbox"
            />
            <span>{t({ en: 'Enabled', he: 'מופעל' })}</span>
          </label>
        </div>

        <div className="timeframe-panel-section">
          <label className="timeframe-panel-label">{t({ en: 'Time Range', he: 'טווח זמן' })}</label>
          <div className="timeframe-panel-time-row">
            {editingField === 'startTime' ? (
              <input
                type="number"
                value={tempStartTime}
                onChange={(e) => handleInputChange('startTime', e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="timeframe-panel-input-small"
                autoFocus
                step="1"
                min="0"
              />
            ) : (
              <div
                className="timeframe-panel-time-value editable"
                onClick={handleStartTimeFocus}
              >
                {timeframe.startTime}b
              </div>
            )}
            <span className="timeframe-panel-time-separator">→</span>
            {editingField === 'endTime' ? (
              <input
                type="number"
                value={tempEndTime}
                onChange={(e) => handleInputChange('endTime', e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="timeframe-panel-input-small"
                autoFocus
                step="1"
                min={timeframe.startTime + 4}
                max={songLengthBeats}
              />
            ) : (
              <div
                className="timeframe-panel-time-value editable"
                onClick={handleEndTimeFocus}
              >
                {timeframe.endTime}b
              </div>
            )}
            <span className="timeframe-panel-duration">({duration}b)</span>
          </div>

          {/* Cycles: only one cycle or cycleBeats per timeframe (hardware doesn't support nesting) */}
          <div className="timeframe-panel-cycles">
            <label className="timeframe-panel-label" title={t({ en: 'Repeat the effect within the timeframe. Only one cycle per timeframe is supported.', he: 'חזור על האפקט בתוך מסגרת הזמן. נתמך מחזור אחד בלבד לכל מסגרת זמן.' })}>{t({ en: 'Cycle', he: 'מחזור' })}</label>
            <div className="timeframe-panel-cycles-list">
              {(timeframe.cycles ?? []).map((entry, idx) => (
                <div key={idx} className="timeframe-panel-cycle-row">
                  <span className="timeframe-panel-cycle-type" title={entry.type === 'cycle'
                    ? t({ en: 'Repeat the full effect every N beats', he: 'חזור על האפקט המלא כל N ביטים' })
                    : t({ en: 'Repeat the effect every N beats, but only play the window from startBeat to endBeat within each cycle', he: 'חזור על האפקט כל N ביטים, אך נגן רק את החלון מ־startBeat עד endBeat בכל מחזור' })}
                  >{entry.type === 'cycle' ? 'cycle' : 'cycleBeats'}</span>
                  {entry.type === 'cycle' ? (
                    <>
                      <label className="timeframe-panel-cycle-param" title={t({ en: 'Number of beats per repetition', he: 'מספר ביטים לכל חזרה' })}>
                        <span>beatsInCycle</span>
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={entry.beatsInCycle}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) {
                              const clamped = Math.max(0, v)
                              const next = [...(timeframe.cycles ?? [])]
                              next[idx] = { ...entry, beatsInCycle: clamped }
                              onUpdate({ cycles: next })
                            }
                          }}
                          className={'timeframe-panel-input-small' + (entry.beatsInCycle === 0 ? ' input-error' : '')}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="timeframe-panel-cycle-param" title={t({ en: 'Number of beats per repetition', he: 'מספר ביטים לכל חזרה' })}>
                        <span>beatsInCycle</span>
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={entry.beatsInCycle}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) {
                              const clamped = Math.max(0, v)
                              const next = [...(timeframe.cycles ?? [])]
                              next[idx] = { ...entry, beatsInCycle: clamped }
                              onUpdate({ cycles: next })
                            }
                          }}
                          className={'timeframe-panel-input-small' + (entry.beatsInCycle === 0 ? ' input-error' : '')}
                        />
                      </label>
                      <label className="timeframe-panel-cycle-param" title={t({ en: 'Start of the active window within each cycle (in beats)', he: 'תחילת החלון הפעיל בכל מחזור (בביטים)' })}>
                        <span>startBeat</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={entry.startBeat}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) {
                              const next = [...(timeframe.cycles ?? [])]
                              next[idx] = { ...entry, startBeat: v }
                              onUpdate({ cycles: next })
                            }
                          }}
                          className="timeframe-panel-input-small"
                        />
                      </label>
                      <label className="timeframe-panel-cycle-param" title={t({ en: 'End of the active window within each cycle (in beats)', he: 'סוף החלון הפעיל בכל מחזור (בביטים)' })}>
                        <span>endBeat</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={entry.endBeat}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) {
                              const next = [...(timeframe.cycles ?? [])]
                              next[idx] = { ...entry, endBeat: v }
                              onUpdate({ cycles: next })
                            }
                          }}
                          className="timeframe-panel-input-small"
                        />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className="timeframe-panel-cycle-remove"
                    onClick={() => {
                      const next = (timeframe.cycles ?? []).filter((_, i) => i !== idx)
                      onUpdate({ cycles: next.length ? next : undefined })
                    }}
                    title={t({ en: 'Remove', he: 'הסר' })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {(timeframe.cycles ?? []).length === 0 && (
              <div className="timeframe-panel-cycles-actions">
                <button
                  type="button"
                  className="timeframe-panel-cycle-add"
                  onClick={() => {
                    onUpdate({ cycles: [{ type: 'cycle', beatsInCycle: 1 } as TimeframeCycleEntry] })
                  }}
                  title={t({ en: 'Repeat the full effect every N beats', he: 'חזור על האפקט המלא כל N ביטים' })}
                >
                  + cycle
                </button>
                <button
                  type="button"
                  className="timeframe-panel-cycle-add"
                  onClick={() => {
                    onUpdate({ cycles: [{ type: 'cycleBeats', beatsInCycle: 1, startBeat: 0, endBeat: 0.5 } as TimeframeCycleBeats] })
                  }}
                  title={t({ en: 'Repeat every N beats, playing only a window within each cycle', he: 'חזור כל N ביטים, נגן רק חלון בתוך כל מחזור' })}
                >
                  + cycleBeats
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="timeframe-panel-section">
          <label className="timeframe-panel-label">{t({ en: 'Color', he: 'צבע' })}</label>
          <div className="timeframe-panel-color-row">
            <div className="timeframe-panel-color-picker-anchor" ref={colorPickerRef}>
              <div
                className="timeframe-panel-color-preview"
                style={{ backgroundColor: timeframe.color }}
                onClick={openColorPicker}
              />
              {colorPickerOpen && (
                <div className="timeframe-panel-color-popover">
                  <HsvColorPicker
                    value={timeframe.color || '#3b82f6'}
                    onChange={(hex) => onUpdate({ color: hex })}
                  />
                </div>
              )}
            </div>
            {(() => {
              const { h, s, v } = hexToHsv(timeframe.color || '#000000')
              const hex = (timeframe.color || '#000000').toLowerCase()
              return (
                <div className="timeframe-panel-color-hsv">
                  <span className="timeframe-panel-color-hsv-item" onClick={openColorPicker}><span className="timeframe-panel-color-hsv-label">H</span>{h}°</span>
                  <span className="timeframe-panel-color-hsv-item" onClick={openColorPicker}><span className="timeframe-panel-color-hsv-label">S</span>{s}%</span>
                  <span className="timeframe-panel-color-hsv-item" onClick={openColorPicker}><span className="timeframe-panel-color-hsv-label">V</span>{v}%</span>
                  <span
                    className="timeframe-panel-color-hsv-hex"
                    title={t({ en: 'Click to copy hex color', he: 'לחץ להעתקת צבע hex' })}
                    onClick={() => { navigator.clipboard?.writeText(hex).catch(() => {}) }}
                  >
                    {hex}
                  </span>
                </div>
              )
            })()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <select value={panelPaletteId} onChange={(e) => setPanelPaletteId(e.target.value)} title={t({ en: 'Pick a colour palette, then click a swatch', he: 'בחר פלטת צבעים, ואז לחץ על דוגמית' })}
              style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 6, padding: '4px 6px', fontSize: 12, maxWidth: 150 }}>
              {WLED_PALETTES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {panelPalette.colors.map((c, i) => (
                <button key={`${c}-${i}`} type="button" title={c} onClick={() => onUpdate({ color: c, hasExplicitColor: undefined })}
                  style={{ width: 20, height: 20, borderRadius: 5, background: c, cursor: 'pointer', border: (timeframe.color || '').toLowerCase() === c.toLowerCase() ? '2px solid #fff' : '1px solid #0006' }} />
              ))}
            </div>
          </div>
          <label className="timeframe-panel-checkbox-label" title={t({ en: 'When checked, this timeframe does not contribute color (no constColor). Only its effects (e.g. brightness, hue shift) apply on top of underlying layers. Timeline shows gray.', he: 'כשמסומן, מסגרת זמן זו אינה תורמת צבע (ללא constColor). רק האפקטים שלה (למשל בהירות, הסטת גוון) מוחלים מעל השכבות שמתחת. ציר הזמן מוצג באפור.' })}>
            <input
              type="checkbox"
              className="timeframe-panel-checkbox"
              checked={timeframe.hasExplicitColor === false}
              onChange={(e) => onUpdate({ hasExplicitColor: e.target.checked ? false : undefined })}
            />
            <span>{t({ en: 'No color (modifiers only)', he: 'ללא צבע (משנים בלבד)' })}</span>
          </label>
          <div className="timeframe-panel-phase-row">
            <label className="timeframe-panel-phase-label">{t({ en: 'Color Phase', he: 'פאזת צבע' })}</label>
            <input
              type="number"
              value={timeframe.phase ?? ''}
              min={0}
              max={12}
              step={0.1}
              placeholder="0"
              onChange={(e) => {
                const val = e.target.value
                if (val === '') {
                  onUpdate({ phase: undefined })
                } else {
                  const num = parseFloat(val)
                  if (!isNaN(num)) onUpdate({ phase: num })
                }
              }}
              className="timeframe-panel-input-small"
            />
            <span className="timeframe-panel-phase-hint">{t({ en: 'Offsets base hue per ring', he: 'מסיט את גוון הבסיס לכל טבעת' })}</span>
          </div>
        </div>

        <div className="timeframe-panel-section">
          <label className="timeframe-panel-label">{t({ en: 'Rings', he: 'טבעות' })}</label>
          <div className="timeframe-panel-rings">
            <div className="timeframe-panel-rings-grid">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(ring => (
                <button
                  key={ring}
                  className={`timeframe-panel-ring-button ${timeframe.rings.includes(ring) ? 'active' : ''}`}
                  onClick={() => {
                    const newRings = timeframe.rings.includes(ring)
                      ? timeframe.rings.filter(r => r !== ring)
                      : [...timeframe.rings, ring].sort((a, b) => a - b)
                    onUpdate({ rings: newRings })
                  }}
                  title={`${t({ en: 'Ring', he: 'טבעת' })} ${ring}`}
                >
                  {ring}
                </button>
              ))}
            </div>
            <div className="timeframe-panel-rings-quick-select">
              <button onClick={() => onUpdate({ rings: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })}>{t({ en: 'All', he: 'הכול' })}</button>
              <button onClick={() => onUpdate({ rings: [2, 4, 6, 8, 10, 12] })}>{t({ en: 'Even', he: 'זוגיות' })}</button>
              <button onClick={() => onUpdate({ rings: [1, 3, 5, 7, 9, 11] })}>{t({ en: 'Odd', he: 'אי־זוגיות' })}</button>
              <button onClick={() => onUpdate({ rings: [1, 2, 3, 4, 5, 6] })}>{t({ en: 'Left', he: 'שמאל' })}</button>
              <button onClick={() => onUpdate({ rings: [7, 8, 9, 10, 11, 12] })}>{t({ en: 'Right', he: 'ימין' })}</button>
              <button onClick={() => onUpdate({ rings: [4, 5, 6, 7, 8, 9] })}>{t({ en: 'Center', he: 'מרכז' })}</button>
            </div>
          </div>
        </div>

        <div className="timeframe-panel-section timeframe-panel-effects-section">
          <label className="timeframe-panel-label">{t({ en: 'Effects', he: 'אפקטים' })}</label>
          {(() => {
            const effects = getTimeframeEffects(timeframe)
            const displayList: TimeframeEffectEntry[] = effects.length > 0
              ? effects
              : [{ id: 'placeholder', effectKey: '', params: undefined }]
            const genId = () => `eff-${Date.now()}-${Math.random().toString(36).slice(2)}`

            const setEffects = (next: TimeframeEffectEntry[]) => {
              const toSave = next.filter(e => e.effectKey !== '')
              onUpdate({ effects: toSave.length > 0 ? toSave : undefined })
            }

            return (
              <>
                <div className="timeframe-panel-effects-list">
                  {displayList.map((entry, idx) => (
                    <div key={entry.id} className="timeframe-panel-effect-row">
                      <div className="timeframe-panel-effect-row-head">
                        <select
                        value={entry.effectKey}
                        onChange={(e) => {
                          const value = e.target.value
                          if (entry.id === 'placeholder') {
                            if (value) {
                              const params = getDefaultEffectParams(value) as Record<string, number | boolean> | undefined
                              setEffects([{ id: genId(), effectKey: value, params }])
                            }
                            return
                          }
                          if (!value) {
                            setEffects(effects.filter((_, i) => i !== idx))
                            return
                          }
                          const params = getDefaultEffectParams(value) as Record<string, number | boolean> | undefined
                          const next = effects.map((e, i) => i === idx ? { ...e, effectKey: value, params } : e)
                          setEffects(next)
                        }}
                        className="timeframe-panel-select"
                      >
                        <option value="">{t({ en: '(none)', he: '(ללא)' })}</option>
                        {(['Position', 'Timed', 'Snake', 'Brightness', 'Hue', 'Motion'] as const).map(cat => (
                          <optgroup key={cat} label={trLabel(cat)}>
                            {ALL_EFFECT_OPTIONS.filter(o => o.category === cat).map(opt => (
                              <option key={opt.value} value={opt.value}>{trLabel(opt.label)}</option>
                            ))}
                          </optgroup>
                        ))}
                        </select>
                        {entry.id !== 'placeholder' && entry.effectKey && (
                          <div className="timeframe-panel-effect-phase">
                            <label className="timeframe-panel-effect-phase-label">{t({ en: 'Phase', he: 'פאזה' })}</label>
                            <input
                              type="number"
                              value={entry.phase ?? ''}
                              min={0}
                              max={12}
                              step={0.1}
                              placeholder="0"
                              onChange={(e) => {
                                const val = e.target.value
                                const phase = val === '' ? undefined : parseFloat(val)
                                if (val !== '' && isNaN(phase!)) return
                                const next = effects.map((ex, i) => i === idx ? { ...ex, phase } : ex)
                                setEffects(next)
                              }}
                              className="timeframe-panel-effect-phase-input"
                            />
                          </div>
                        )}
                        {entry.id !== 'placeholder' && (
                          <button
                            type="button"
                            className="timeframe-panel-effect-remove"
                            onClick={() => setEffects(effects.filter((_, i) => i !== idx))}
                            title={t({ en: 'Remove effect', he: 'הסר אפקט' })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {entry.effectKey && EFFECT_PARAM_SCHEMAS[entry.effectKey] && (
                        <div className="timeframe-panel-effect-params">
                          {EFFECT_ONE_OF_INCREASE_DECREASE.has(entry.effectKey) ? (
                            (() => {
                              const isSnake = SNAKE_EFFECT_KEYS.has(entry.effectKey)
                              const currentKey = entry.params?.[INCREASE_KEY] != null ? INCREASE_KEY : DECREASE_KEY
                              const fVal = (entry.params?.[currentKey] as FloatFunctionValue | undefined)
                              const kind = getFloatFunctionKind(fVal)
                              const kindParams = FLOAT_FUNCTION_KIND_PARAMS[kind]
                              const currentObj = (fVal?.[kind] ?? kindParams.reduce((a, p) => ({ ...a, [p.key]: p.default }), {} as Record<string, number>)) as Record<string, number>
                              const mergeParams = (update: Record<string, unknown>) =>
                                isSnake ? { ...(entry.params || {}), ...update } : update
                              return (
                                <>
                                  {isSnake && (() => {
                                    const headVal = (entry.params?.head as FloatFunctionValue | undefined)
                                    const tailVal = (entry.params?.tail_length as FloatFunctionValue | undefined)
                                    const headKind = getFloatFunctionKind(headVal)
                                    const tailKind = getFloatFunctionKind(tailVal)
                                    const headParams = FLOAT_FUNCTION_KIND_PARAMS[headKind]
                                    const tailParams = FLOAT_FUNCTION_KIND_PARAMS[tailKind]
                                    const headObj = (headVal?.[headKind] ?? headParams.reduce((a, p) => ({ ...a, [p.key]: p.default }), {} as Record<string, number>)) as Record<string, number>
                                    const tailObj = (tailVal?.[tailKind] ?? tailParams.reduce((a, p) => ({ ...a, [p.key]: p.default }), {} as Record<string, number>)) as Record<string, number>
                                    return (
                                      <>
                                        <div className="timeframe-panel-float-function-block">
                                          <div className="timeframe-panel-effect-param-row">
                                            <label className="timeframe-panel-effect-param-label">{trLabel('Head (time)')}</label>
                                            <select
                                              value={headKind}
                                              onChange={(e) => {
                                                const newKind = e.target.value as FloatFunctionKind
                                                const nextParams = mergeParams({ head: defaultFloatFunction(newKind) }) as Record<string, number | boolean | FloatFunctionValue>
                                                if (entry.id === 'placeholder') return
                                                const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                                setEffects(next)
                                              }}
                                              className="timeframe-panel-select timeframe-panel-select-small"
                                            >
                                              {FLOAT_FUNCTION_KINDS.map(k => (
                                                <option key={k.value} value={k.value}>{trLabel(k.label)}</option>
                                              ))}
                                            </select>
                                          </div>
                                          {headParams.map(pDef => (
                                            <div key={pDef.key} className="timeframe-panel-effect-param-row timeframe-panel-effect-param-row-indent">
                                              <label className="timeframe-panel-effect-param-label">{trLabel(pDef.label)}</label>
                                              <input
                                                type="number"
                                                value={typeof headObj[pDef.key] === 'number' ? headObj[pDef.key] : pDef.default}
                                                min={pDef.min}
                                                max={pDef.max}
                                                step={pDef.step}
                                                onChange={(e) => {
                                                  const num = parseFloat(e.target.value)
                                                  if (isNaN(num)) return
                                                  const nextInner = { ...headObj, [pDef.key]: num }
                                                  const nextParams = mergeParams({ head: { [headKind]: nextInner } }) as Record<string, number | boolean | FloatFunctionValue>
                                                  if (entry.id === 'placeholder') return
                                                  const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                                  setEffects(next)
                                                }}
                                                className="timeframe-panel-effect-param-input"
                                              />
                                            </div>
                                          ))}
                                        </div>
                                        <div className="timeframe-panel-float-function-block">
                                          <div className="timeframe-panel-effect-param-row">
                                            <label className="timeframe-panel-effect-param-label">{trLabel('Tail length')}</label>
                                            <select
                                              value={tailKind}
                                              onChange={(e) => {
                                                const newKind = e.target.value as FloatFunctionKind
                                                const nextParams = mergeParams({ tail_length: defaultFloatFunction(newKind) }) as Record<string, number | boolean | FloatFunctionValue>
                                                if (entry.id === 'placeholder') return
                                                const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                                setEffects(next)
                                              }}
                                              className="timeframe-panel-select timeframe-panel-select-small"
                                            >
                                              {FLOAT_FUNCTION_KINDS.map(k => (
                                                <option key={k.value} value={k.value}>{trLabel(k.label)}</option>
                                              ))}
                                            </select>
                                          </div>
                                          {tailParams.map(pDef => (
                                            <div key={pDef.key} className="timeframe-panel-effect-param-row timeframe-panel-effect-param-row-indent">
                                              <label className="timeframe-panel-effect-param-label">{trLabel(pDef.label)}</label>
                                              <input
                                                type="number"
                                                value={typeof tailObj[pDef.key] === 'number' ? tailObj[pDef.key] : pDef.default}
                                                min={pDef.min}
                                                max={pDef.max}
                                                step={pDef.step}
                                                onChange={(e) => {
                                                  const num = parseFloat(e.target.value)
                                                  if (isNaN(num)) return
                                                  const nextInner = { ...tailObj, [pDef.key]: num }
                                                  const nextParams = mergeParams({ tail_length: { [tailKind]: nextInner } }) as Record<string, number | boolean | FloatFunctionValue>
                                                  if (entry.id === 'placeholder') return
                                                  const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                                  setEffects(next)
                                                }}
                                                className="timeframe-panel-effect-param-input"
                                              />
                                            </div>
                                          ))}
                                        </div>
                                        <div className="timeframe-panel-effect-param-row">
                                          <label className="timeframe-panel-checkbox-label">
                                            <input
                                              type="checkbox"
                                              checked={entry.params?.cyclic === true}
                                              onChange={(e) => {
                                                const nextParams = mergeParams({ cyclic: e.target.checked }) as Record<string, number | boolean | FloatFunctionValue>
                                                if (entry.id === 'placeholder') return
                                                const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                                setEffects(next)
                                              }}
                                              className="timeframe-panel-checkbox"
                                            />
                                            <span>{t({ en: 'Cyclic', he: 'מחזורי' })}</span>
                                          </label>
                                        </div>
                                      </>
                                    )
                                  })()}
                                  <div className="timeframe-panel-effect-param-row">
                                    <label className="timeframe-panel-effect-param-label">{t({ en: 'Apply', he: 'החל' })}</label>
                                    <select
                                      value={currentKey}
                                      onChange={(e) => {
                                        const newKey = e.target.value as typeof INCREASE_KEY | typeof DECREASE_KEY
                                        const valueToKeep = entry.params?.[currentKey] as FloatFunctionValue | undefined
                                        let nextParams: Record<string, number | boolean | FloatFunctionValue>
                                        if (isSnake) {
                                          nextParams = { ...(entry.params || {}), [newKey]: valueToKeep ?? defaultFloatFunction('const_value') }
                                          delete nextParams[currentKey]
                                        } else {
                                          nextParams = { [newKey]: valueToKeep ?? defaultFloatFunction('const_value') }
                                        }
                                        if (entry.id === 'placeholder') return
                                        const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                        setEffects(next)
                                      }}
                                      className="timeframe-panel-select timeframe-panel-select-small"
                                    >
                                      <option value={DECREASE_KEY}>{t({ en: 'Decrease', he: 'הפחתה' })}</option>
                                      <option value={INCREASE_KEY}>{t({ en: 'Increase', he: 'הגברה' })}</option>
                                    </select>
                                  </div>
                                  <div className="timeframe-panel-float-function-block">
                                    <div className="timeframe-panel-effect-param-row">
                                      <label className="timeframe-panel-effect-param-label">{t({ en: 'Function', he: 'פונקציה' })}</label>
                                      <select
                                        value={kind}
                                        onChange={(e) => {
                                          const newKind = e.target.value as FloatFunctionKind
                                          // For "Decrease" + "Steps", default to 1→0 so brightness steps down (not up)
                                          const nextF =
                                            newKind === 'steps' && currentKey === DECREASE_KEY
                                              ? { steps: { num_steps: 4, diff_per_step: -0.25, first_step_value: 1 } }
                                              : defaultFloatFunction(newKind)
                                          const nextParams = mergeParams({ [currentKey]: nextF }) as Record<string, number | boolean | FloatFunctionValue>
                                          if (entry.id === 'placeholder') return
                                          const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                          setEffects(next)
                                        }}
                                        className="timeframe-panel-select timeframe-panel-select-small"
                                      >
                                        {FLOAT_FUNCTION_KINDS.map(k => (
                                          <option key={k.value} value={k.value}>{trLabel(k.label)}</option>
                                        ))}
                                      </select>
                                    </div>
                                    {kindParams.map(pDef => {
                                      const pVal = typeof currentObj[pDef.key] === 'number' ? currentObj[pDef.key] : pDef.default
                                      return (
                                        <div key={pDef.key} className="timeframe-panel-effect-param-row timeframe-panel-effect-param-row-indent">
                                          <label className="timeframe-panel-effect-param-label">{trLabel(pDef.label)}</label>
                                          <input
                                            type="number"
                                            value={pVal}
                                            min={pDef.min}
                                            max={pDef.max}
                                            step={pDef.step}
                                            onChange={(e) => {
                                              const num = parseFloat(e.target.value)
                                              if (isNaN(num)) return
                                              const nextInner = { ...currentObj, [pDef.key]: num }
                                              const nextF = { [kind]: nextInner } as FloatFunctionValue
                                              const nextParams = mergeParams({ [currentKey]: nextF }) as Record<string, number | boolean | FloatFunctionValue>
                                              if (entry.id === 'placeholder') return
                                              const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                              setEffects(next)
                                            }}
                                            className="timeframe-panel-effect-param-input"
                                          />
                                        </div>
                                      )
                                    })}
                                  </div>
                                </>
                              )
                            })()
                          ) : (
                            EFFECT_PARAM_SCHEMAS[entry.effectKey].map(def => {
                              if (def.type === 'floatFunction') {
                                const fVal = (entry.params?.[def.key] as FloatFunctionValue | undefined)
                                const kind = getFloatFunctionKind(fVal)
                                const kindParams = FLOAT_FUNCTION_KIND_PARAMS[kind]
                                const currentObj = (fVal?.[kind] ?? kindParams.reduce((a, p) => ({ ...a, [p.key]: p.default }), {} as Record<string, number>)) as Record<string, number>
                                return (
                                  <div key={def.key} className="timeframe-panel-float-function-block">
                                    <div className="timeframe-panel-effect-param-row">
                                      <label className="timeframe-panel-effect-param-label">{trLabel(def.label)}</label>
                                      <select
                                        value={kind}
                                        onChange={(e) => {
                                          const newKind = e.target.value as FloatFunctionKind
                                          const nextF = defaultFloatFunction(newKind)
                                          const nextParams = { ...entry.params, [def.key]: nextF }
                                          if (entry.id === 'placeholder') return
                                          const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                          setEffects(next)
                                        }}
                                        className="timeframe-panel-select timeframe-panel-select-small"
                                      >
                                        {FLOAT_FUNCTION_KINDS.map(k => (
                                          <option key={k.value} value={k.value}>{trLabel(k.label)}</option>
                                        ))}
                                      </select>
                                    </div>
                                    {kindParams.map(pDef => {
                                      const pVal = typeof currentObj[pDef.key] === 'number' ? currentObj[pDef.key] : pDef.default
                                      return (
                                        <div key={pDef.key} className="timeframe-panel-effect-param-row timeframe-panel-effect-param-row-indent">
                                          <label className="timeframe-panel-effect-param-label">{trLabel(pDef.label)}</label>
                                          <input
                                            type="number"
                                            value={pVal}
                                            min={pDef.min}
                                            max={pDef.max}
                                            step={pDef.step}
                                            onChange={(e) => {
                                              const num = parseFloat(e.target.value)
                                              if (isNaN(num)) return
                                              const nextInner = { ...currentObj, [pDef.key]: num }
                                              const nextF = { [kind]: nextInner } as FloatFunctionValue
                                              const nextParams = { ...entry.params, [def.key]: nextF }
                                              if (entry.id === 'placeholder') return
                                              const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                              setEffects(next)
                                            }}
                                            className="timeframe-panel-effect-param-input"
                                          />
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              }
                              const current = entry.params?.[def.key]
                              const value = current !== undefined ? current : def.default
                              return (
                                <div key={def.key} className="timeframe-panel-effect-param-row">
                                  <label className="timeframe-panel-effect-param-label">{trLabel(def.label)}</label>
                                  {def.type === 'boolean' ? (
                                    <input
                                      type="checkbox"
                                      checked={value === true}
                                      onChange={(e) => {
                                        const nextParams = { ...entry.params, [def.key]: e.target.checked }
                                        if (entry.id === 'placeholder') return
                                        const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                        setEffects(next)
                                      }}
                                      className="timeframe-panel-effect-param-checkbox"
                                    />
                                  ) : (
                                    <input
                                      type="number"
                                      value={typeof value === 'number' ? value : (typeof def.default === 'number' ? def.default : 0)}
                                      min={def.min}
                                      max={def.max}
                                      step={def.step}
                                      onChange={(e) => {
                                        const num = parseFloat(e.target.value)
                                        if (isNaN(num)) return
                                        const nextParams = { ...entry.params, [def.key]: num }
                                        if (entry.id === 'placeholder') return
                                        const next = effects.map((ex, i) => i === idx ? { ...ex, params: nextParams } : ex)
                                        setEffects(next)
                                      }}
                                      className="timeframe-panel-effect-param-input"
                                    />
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {effects.length > 0 && (
                  <button
                    type="button"
                    className="timeframe-panel-effect-add"
                    onClick={() => {
                      onUpdate({
                        effects: [...effects, { id: genId(), effectKey: '', params: undefined }],
                      })
                    }}
                  >
                    {t({ en: '+ Add effect', he: '+ הוסף אפקט' })}
                  </button>
                )}
              </>
            )
          })()}
        </div>

        <div className="timeframe-panel-section timeframe-panel-movement-section">
          <label className="timeframe-panel-label">{t({ en: 'Movement', he: 'תנועה' })}</label>
          <select
            value={timeframe.movement?.type ?? ''}
            onChange={(e) => {
              const val = e.target.value as MovementType | ''
              if (!val) {
                onUpdate({ movement: undefined })
              } else {
                const dir = timeframe.movement?.direction ?? 'forward'
                const bpr = defaultBeatsPerRing(val, timeframe.startTime, timeframe.endTime, timeframe.rings, dir)
                onUpdate({
                  movement: {
                    type: val,
                    direction: dir,
                    beatsPerRing: bpr,
                  },
                })
              }
            }}
            className="timeframe-panel-select"
          >
            <option value="">{t({ en: '(none)', he: '(ללא)' })}</option>
            {MOVEMENT_TYPES.map(mt => (
              <option key={mt.id} value={mt.id}>{trLabel(mt.label)}</option>
            ))}
          </select>
          {timeframe.movement && (() => {
            const mv = timeframe.movement
            const typeDef = MOVEMENT_TYPES.find(mt => mt.id === mv.type)
            return (
              <div className="timeframe-panel-movement-config">
                <p className="timeframe-panel-movement-desc">{typeDef?.description ? trLabel(typeDef.description) : null}</p>
                {/* Direction: hidden for random unless using a custom order (random shuffles otherwise). */}
                {(mv.type !== 'random' || mv.direction === 'custom') && (
                  <div className="timeframe-panel-movement-param-row">
                    <label className="timeframe-panel-effect-param-label">{t({ en: 'Direction', he: 'כיוון' })}</label>
                    <select
                      value={mv.direction}
                      onChange={(e) => {
                        const dir = e.target.value as MovementDirection
                        const customOrder = dir === 'custom' ? (mv.customOrder ?? []) : undefined
                        const bpr = defaultBeatsPerRing(mv.type, timeframe.startTime, timeframe.endTime, timeframe.rings, dir, mv.bounce, mv.retire, customOrder)
                        onUpdate({
                          movement: { ...mv, direction: dir, beatsPerRing: bpr, customOrder },
                        })
                      }}
                      className="timeframe-panel-select timeframe-panel-select-small"
                    >
                      {MOVEMENT_DIRECTIONS.map(d => (
                        <option key={d.id} value={d.id}>{trLabel(d.label)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Random: offer enabling a custom order (replaces the shuffle). */}
                {mv.type === 'random' && mv.direction !== 'custom' && (
                  <div className="timeframe-panel-movement-param-row">
                    <label className="timeframe-panel-checkbox-label">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => {
                          const bpr = defaultBeatsPerRing(mv.type, timeframe.startTime, timeframe.endTime, timeframe.rings, 'custom', mv.bounce, mv.retire, [])
                          onUpdate({ movement: { ...mv, direction: 'custom', beatsPerRing: bpr, customOrder: [] } })
                        }}
                        className="timeframe-panel-checkbox"
                      />
                      <span>{t({ en: 'Use custom order', he: 'השתמש בסדר מותאם' })}</span>
                    </label>
                  </div>
                )}
                {mv.direction === 'custom' && (
                  <div className="timeframe-panel-movement-param-row">
                    <label className="timeframe-panel-effect-param-label">{t({ en: 'Ring order', he: 'סדר טבעות' })}</label>
                    <input
                      type="text"
                      value={ringOrderText}
                      placeholder={t({ en: 'e.g. 1, 2, 3, 4, 6', he: 'למשל 1, 2, 3, 4, 6' })}
                      onChange={(e) => {
                        setRingOrderText(e.target.value)
                        const seen = new Set<number>()
                        const order = e.target.value
                          .split(/[\s,]+/)
                          .map(s => parseInt(s, 10))
                          .filter(n => Number.isInteger(n) && n >= 1 && n <= 12 && !seen.has(n) && (seen.add(n), true))
                        const bpr = defaultBeatsPerRing(mv.type, timeframe.startTime, timeframe.endTime, timeframe.rings, 'custom', mv.bounce, mv.retire, order)
                        onUpdate({ movement: { ...mv, customOrder: order, beatsPerRing: bpr } })
                      }}
                      className="timeframe-panel-effect-param-input"
                    />
                  </div>
                )}
                {mv.direction === 'custom' && (() => {
                  const order = mv.customOrder ?? []
                  const notInSet = order.filter(r => !timeframe.rings.includes(r))
                  const stayOn = timeframe.rings.filter(r => !order.includes(r)).sort((a, b) => a - b)
                  return (
                    <p className="timeframe-panel-movement-desc">
                      {order.length === 0 && t({ en: 'Enter a ring order above.', he: 'הזן סדר טבעות למעלה.' })}
                      {notInSet.length > 0 && `${t({ en: 'Ignored (not in this timeframe):', he: 'התעלמות (לא במסגרת זמן זו):' })} ${notInSet.join(', ')}. `}
                      {stayOn.length > 0 && `${t({ en: 'Stay on full-time:', he: 'נשארות דולקות כל הזמן:' })} ${stayOn.join(', ')}.`}
                    </p>
                  )
                })()}
                <div className="timeframe-panel-movement-param-row">
                  <label className="timeframe-panel-effect-param-label">{t({ en: 'Beats / ring', he: 'ביטים / טבעת' })}</label>
                  <input
                    type="number"
                    value={mv.beatsPerRing}
                    min={0.25}
                    step={0.25}
                    onChange={(e) => {
                      const num = parseFloat(e.target.value)
                      if (!isNaN(num) && num > 0) {
                        onUpdate({ movement: { ...mv, beatsPerRing: num } })
                      }
                    }}
                    className="timeframe-panel-effect-param-input"
                  />
                </div>
                {typeDef?.extraParams.map(ep => (
                  <div key={ep.key} className="timeframe-panel-movement-param-row">
                    <label className="timeframe-panel-checkbox-label">
                      <input
                        type="checkbox"
                        checked={mv[ep.key] === true}
                        onChange={(e) => {
                          const checked = e.target.checked
                          // Retire and accumulate are mutually exclusive
                          const updates: Record<string, boolean | undefined> = { [ep.key]: checked || undefined }
                          if (checked && ep.key === 'retire') updates.accumulate = undefined
                          if (checked && ep.key === 'accumulate') updates.retire = undefined
                          const updated = { ...mv, ...updates }
                          const bpr = defaultBeatsPerRing(
                            mv.type, timeframe.startTime, timeframe.endTime, timeframe.rings, mv.direction,
                            updated.bounce,
                            updated.retire,
                          )
                          onUpdate({ movement: { ...updated, beatsPerRing: bpr } })
                        }}
                        className="timeframe-panel-checkbox"
                      />
                      <span>{trLabel(ep.label)}</span>
                    </label>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        <div className="timeframe-panel-section">
          <label className="timeframe-panel-label">{t({ en: 'Mapping', he: 'מיפוי' })}</label>
          <select
            value={timeframe.mapping || 'all'}
            onChange={(e) => onUpdate({ mapping: e.target.value })}
            className="timeframe-panel-select"
          >
            {segmentNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="timeframe-panel-mapping-visualization">
            <RingVisualization
              mapping={timeframe.mapping || 'all'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default TimeframePanel
