import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  parseTasteRules,
  serializeTasteRules,
  type TasteModel,
  type SectionRule,
  type PaletteDef,
} from '../lib/tasteRules'
import { hsvToRgbString } from '../effectPreview'
import { useI18n } from '../lib/i18n'
import './TasteRulesEditor.css'

/**
 * Visual taste-rules editor — replaces the raw YAML textarea with a playable
 * surface: drag-to-arrange pattern chips (with LED-ring glyphs) and palette
 * swatches per section, plus a randomness slider. Operates on the YAML text so
 * the panel's existing load/save/generate flow is unchanged: parse on the way
 * in, serialize on every edit. A collapsible raw-YAML view remains as an escape
 * hatch (and the only editor if the file ever fails to parse).
 */

interface Props {
  value: string
  onChange: (yamlText: string) => void
}

// ── pattern vocabulary (the 7 SAFE patterns the translator can emit) ──────────
interface PatternMeta {
  key: string
  name: string
  desc: string
  color: string
}
const PATTERNS: PatternMeta[] = [
  { key: 'build_up', name: 'Build-up', desc: 'Rings light up one by one and stay on — rising', color: '#ffd166' },
  { key: 'accumulate', name: 'Accumulate', desc: 'Build-up, and each ring pulses as it joins', color: '#ffb703' },
  { key: 'sweep', name: 'Sweep', desc: 'A single lit ring sweeps across, one at a time', color: '#4cc9f0' },
  { key: 'per_ring_blink', name: 'Per-ring blink', desc: 'Every ring blinks on its own staggered cycle', color: '#f72585' },
  { key: 'snake_seg', name: 'Snake', desc: 'A snake runs around a segment on a cycle', color: '#4895ef' },
  { key: 'pulse_beat', name: 'Pulse', desc: 'All rings pulse on the beat — driving (drops)', color: '#ff5d5d' },
  { key: 'solid_fade', name: 'Solid fade', desc: 'One solid colour with a fade envelope — calm', color: '#80ffdb' },
]
const PATTERN_BY_KEY = new Map(PATTERNS.map((p) => [p.key, p]))
const PATTERN_OPTIONS: ChipOption[] = PATTERNS.map((p) => ({ key: p.key, desc: p.desc }))

// ── section vocabulary (analyzer labels) ──────────────────────────────────────
const SECTION_META: Record<string, { color: string; tag: string }> = {
  intro: { color: '#9cf', tag: 'Opening — ease in' },
  build: { color: '#fd6', tag: 'Rising energy' },
  drop: { color: '#f66', tag: 'Peak — hit hard' },
  breakdown: { color: '#6cf', tag: 'Pull back' },
  chorus: { color: '#fa6', tag: 'Big & bright' },
  verse: { color: '#ccc', tag: 'The groove' },
  outro: { color: '#aaa', tag: 'Wind down' },
}
const sectionColor = (n: string) => SECTION_META[n]?.color ?? '#8aa'

// ── Hebrew translations for the display text above ────────────────────────────
// (pattern `key` / palette names / section names stay English — they're data/keys.)
const PATTERN_NAME_HE: Record<string, string> = {
  build_up: 'בנייה',
  accumulate: 'צבירה',
  sweep: 'סריקה',
  per_ring_blink: 'הבהוב פר-טבעת',
  snake_seg: 'נחש',
  pulse_beat: 'פעימה',
  solid_fade: 'דעיכה אחידה',
}
const PATTERN_DESC_HE: Record<string, string> = {
  build_up: 'טבעות נדלקות אחת-אחת ונשארות דולקות — עולה',
  accumulate: 'בנייה, וכל טבעת פועמת כשהיא מצטרפת',
  sweep: 'טבעת דולקת אחת סורקת לרוחב, אחת בכל פעם',
  per_ring_blink: 'כל טבעת מהבהבת במחזור מדורג משלה',
  snake_seg: 'נחש רץ סביב מקטע במחזור',
  pulse_beat: 'כל הטבעות פועמות בקצב — מניע (דרופים)',
  solid_fade: 'צבע אחיד אחד עם מעטפת דעיכה — רגוע',
}
const SECTION_TAG_HE: Record<string, string> = {
  intro: 'פתיחה — כניסה רכה',
  build: 'אנרגיה עולה',
  drop: 'שיא — בעוצמה',
  breakdown: 'ירידה',
  chorus: 'גדול ובהיר',
  verse: 'הגרוב',
  outro: 'סיום רגוע',
}

// ── pattern glyph: 12 LED dots whose brightness sketches the pattern ─────────
function patternOpacities(key: string): number[] {
  const n = 12
  switch (key) {
    case 'build_up':
      return Array.from({ length: n }, (_, i) => 0.18 + (i / (n - 1)) * 0.82)
    case 'accumulate':
      return Array.from({ length: n }, (_, i) => 0.25 + (i / (n - 1)) * 0.75)
    case 'sweep':
      return Array.from({ length: n }, (_, i) => (i === 4 ? 1 : i === 3 || i === 5 ? 0.4 : 0.14))
    case 'per_ring_blink':
      return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0.22))
    case 'snake_seg':
      return Array.from({ length: n }, (_, i) => (i >= 3 && i <= 6 ? 0.4 + (i - 3) * 0.2 : 0.14))
    case 'pulse_beat':
      return Array.from({ length: n }, () => 1)
    case 'solid_fade':
      return Array.from({ length: n }, () => 0.6)
    default:
      return Array.from({ length: n }, () => 0.4)
  }
}

function PatternGlyph({ patternKey }: { patternKey: string }) {
  const color = PATTERN_BY_KEY.get(patternKey)?.color ?? '#7df'
  const ops = patternOpacities(patternKey)
  const n = ops.length
  const r = 2.3
  const gap = 6.2
  const w = (n - 1) * gap + r * 2 + 2
  const h = r * 2 + 2
  return (
    <svg className="tre-glyph" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {ops.map((o, i) => (
        <circle key={i} cx={r + 1 + i * gap} cy={h / 2} r={r} fill={color} opacity={o} />
      ))}
    </svg>
  )
}

// ── palette swatch gradient ───────────────────────────────────────────────────
function paletteGradient(p: PaletteDef): string {
  let lo = p.hueRange[0]
  let hi = p.hueRange[1]
  if (hi < lo) hi += 1
  const sat = Array.isArray(p.sat) ? p.sat[1] : p.sat
  const val = Array.isArray(p.val) ? p.val[1] : p.val
  const N = 6
  const stops: string[] = []
  for (let k = 0; k < N; k++) {
    const hue = (lo + ((hi - lo) * k) / (N - 1)) % 1
    stops.push(hsvToRgbString(hue, sat, val))
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

// ── ordered, drag-to-arrange chip picker ──────────────────────────────────────
interface ChipOption {
  key: string
  desc: string
}
function OrderableChips({
  selected,
  options,
  onChange,
  renderItem,
}: {
  selected: string[]
  options: ChipOption[]
  onChange: (next: string[]) => void
  renderItem: (key: string) => React.ReactNode
}) {
  const { t } = useI18n()
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length || from === to) return
    const next = selected.slice()
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    onChange(next)
  }
  const remaining = options.filter((o) => !selected.includes(o.key))
  return (
    <div className="oc">
      <div className="oc-selected">
        {selected.length === 0 && <span className="oc-empty">{t({ en: 'none — add from the tray ↓', he: 'ריק — הוסף מהמגש ↓' })}</span>}
        {selected.map((key, idx) => (
          <div
            key={key}
            className={`oc-chip oc-on${dragIdx === idx ? ' oc-dragging' : ''}`}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIdx !== null && dragIdx !== idx) {
                move(dragIdx, idx)
                setDragIdx(idx)
              }
            }}
            onDragEnd={() => setDragIdx(null)}
            title={options.find((o) => o.key === key)?.desc}
          >
            <span className="oc-rank">{idx + 1}</span>
            {renderItem(key)}
            <button
              type="button"
              className="oc-x"
              title={t({ en: 'Remove', he: 'הסר' })}
              onClick={() => onChange(selected.filter((k) => k !== key))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {remaining.length > 0 && (
        <div className="oc-tray">
          {remaining.map((o) => (
            <button
              key={o.key}
              type="button"
              className="oc-chip oc-off"
              title={o.desc}
              onClick={() => onChange([...selected, o.key])}
            >
              <span className="oc-plus">+</span>
              {renderItem(o.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── one section's card (hoisted so it never remounts mid-drag) ────────────────
function RuleCard({
  name,
  rule,
  isDefault,
  palettes,
  paletteOptions,
  onChange,
}: {
  name: string
  rule: SectionRule
  isDefault: boolean
  palettes: PaletteDef[]
  paletteOptions: ChipOption[]
  onChange: (patch: Partial<SectionRule>) => void
}) {
  const { t } = useI18n()
  const patternOptions: ChipOption[] = PATTERN_OPTIONS.map((o) => ({
    key: o.key,
    desc: t({ en: o.desc, he: PATTERN_DESC_HE[o.key] ?? o.desc }),
  }))
  const renderPatternItem = (key: string) => {
    const meta = PATTERN_BY_KEY.get(key)
    return (
      <span className="oc-content">
        <PatternGlyph patternKey={key} />
        <span className="oc-name">{meta ? t({ en: meta.name, he: PATTERN_NAME_HE[key] ?? meta.name }) : key}</span>
      </span>
    )
  }
  const renderPaletteItem = (key: string) => {
    const p = palettes.find((x) => x.name === key)
    return (
      <span className="oc-content">
        <span className="tre-swatch" style={{ background: p ? paletteGradient(p) : '#555' }} />
        <span className="oc-name">{key}</span>
      </span>
    )
  }
  return (
    <div className="tre-card">
      <div className="tre-card-head">
        <span className="tre-dot" style={{ background: isDefault ? '#789' : sectionColor(name) }} />
        <span className="tre-card-title">{name}</span>
        <span className="tre-card-tag">{isDefault
          ? t({ en: 'Fallback for any unlabeled part', he: 'ברירת מחדל לכל חלק ללא תווית' })
          : t({ en: SECTION_META[name]?.tag ?? '', he: SECTION_TAG_HE[name] ?? SECTION_META[name]?.tag ?? '' })}</span>
      </div>

      <div className="tre-row">
        <div className="tre-row-label">{t({ en: 'Patterns', he: 'תבניות' })}</div>
        <OrderableChips
          selected={rule.patterns}
          options={patternOptions}
          onChange={(patterns) => onChange({ patterns })}
          renderItem={renderPatternItem}
        />
      </div>

      <div className="tre-row">
        <div className="tre-row-label">{t({ en: 'Palettes', he: 'פלטות' })}</div>
        <OrderableChips
          selected={rule.palette}
          options={paletteOptions}
          onChange={(palette) => onChange({ palette })}
          renderItem={renderPaletteItem}
        />
      </div>
    </div>
  )
}

// ── randomness phrasing ───────────────────────────────────────────────────────
function randomnessLabel(v: number): { en: string; he: string } {
  if (v <= 0.15) return { en: 'Predictable — always your top pick', he: 'צפוי — תמיד הבחירה המובילה שלך' }
  if (v <= 0.45) return { en: 'Mostly the favorite, the odd surprise', he: 'בעיקר המועדף, עם הפתעה מדי פעם' }
  if (v <= 0.75) return { en: 'Balanced variety', he: 'מגוון מאוזן' }
  return { en: 'Wild — a fresh mix every run', he: 'פרוע — מיקס חדש בכל הרצה' }
}

export default function TasteRulesEditor({ value, onChange }: Props) {
  const { t } = useI18n()
  const [model, setModel] = useState<TasteModel>(() => parseTasteRules(value))
  const [showRaw, setShowRaw] = useState(false)
  // Track the YAML we last emitted so external value changes re-parse, but our
  // own edits (which flow back in as `value`) don't clobber in-progress state.
  const lastEmitted = useRef<string>('')

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setModel(parseTasteRules(value))
    }
  }, [value])

  const paletteOptions: ChipOption[] = useMemo(
    () => model.palettes.map((p) => ({ key: p.name, desc: p.comment || p.name })),
    [model.palettes],
  )

  // Push a mutated model out as YAML.
  const commit = (next: TasteModel) => {
    setModel(next)
    const yaml = serializeTasteRules(next)
    lastEmitted.current = yaml
    onChange(yaml)
  }

  const setRandomness = (n: number) => commit({ ...model, randomness: n })

  const updateRule = (target: 'defaults' | number, patch: Partial<SectionRule>) => {
    if (target === 'defaults') {
      commit({ ...model, defaults: { ...model.defaults, ...patch } })
    } else {
      const sections = model.sections.map((s, i) => (i === target ? { ...s, rule: { ...s.rule, ...patch } } : s))
      commit({ ...model, sections })
    }
  }

  return (
    <div className="tre">
      {!model.ok && (
        <div className="tre-error">
          {t({ en: 'Couldn’t parse ', he: 'לא ניתן לנתח את ' })}<code>rules.yaml</code>{t({ en: ' as the expected shape — edit it raw below.', he: ' במבנה הצפוי — ערוך אותו כטקסט גולמי למטה.' })}
          {model.error ? <span className="tre-error-detail"> ({model.error})</span> : null}
        </div>
      )}

      {/* Randomness */}
      <div className="tre-rand">
        <div className="tre-rand-head">
          <span className="tre-rand-title">{t({ en: 'Variety', he: 'מגוון' })}</span>
          <span className="tre-rand-val">{t(randomnessLabel(model.randomness))}</span>
        </div>
        <input
          className="tre-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={model.randomness}
          onChange={(e) => setRandomness(Number(e.target.value))}
        />
        <div className="tre-rand-scale">
          <span>{t({ en: 'predictable', he: 'צפוי' })}</span>
          <span>{model.randomness.toFixed(2)}</span>
          <span>{t({ en: 'wild', he: 'פרוע' })}</span>
        </div>
      </div>

      {/* Palette vocabulary legend */}
      {model.palettes.length > 0 && (
        <details className="tre-legend">
          <summary>{t({ en: 'Palette vocabulary', he: 'מילון פלטות' })} · {model.palettes.length}</summary>
          <div className="tre-legend-grid">
            {model.palettes.map((p) => (
              <div key={p.name} className="tre-legend-item" title={p.comment}>
                <span className="tre-swatch tre-swatch-lg" style={{ background: paletteGradient(p) }} />
                <span className="tre-legend-name">{p.name}</span>
                {p.comment && <span className="tre-legend-desc">{p.comment}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="tre-hint">
        {t({ en: 'Click to add · drag to arrange · order = priority (the ', he: 'לחץ להוספה · גרור לסידור · הסדר = עדיפות (הצ׳יפ ה' })}<b>#1</b>{t({ en: ' chip is favored when Variety is low).', he: ' מועדף כשהמגוון נמוך).' })}
      </div>

      {/* Section cards */}
      <div className="tre-cards">
        <RuleCard
          name="defaults"
          rule={model.defaults}
          isDefault
          palettes={model.palettes}
          paletteOptions={paletteOptions}
          onChange={(patch) => updateRule('defaults', patch)}
        />
        {model.sections.map((s, i) => (
          <RuleCard
            key={s.name + i}
            name={s.name}
            rule={s.rule}
            isDefault={false}
            palettes={model.palettes}
            paletteOptions={paletteOptions}
            onChange={(patch) => updateRule(i, patch)}
          />
        ))}
      </div>

      {/* Raw escape hatch */}
      <details className="tre-raw" open={!model.ok} onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
        <summary>⚙ {t({ en: 'Edit raw YAML', he: 'עריכת YAML גולמי' })}</summary>
        {(showRaw || !model.ok) && (
          <textarea
            className="tre-raw-area"
            value={value}
            spellCheck={false}
            onChange={(e) => {
              lastEmitted.current = '' // force a re-parse from the raw text
              onChange(e.target.value)
            }}
          />
        )}
      </details>
    </div>
  )
}
