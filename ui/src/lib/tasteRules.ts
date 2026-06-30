/**
 * taste/rules.yaml ↔ structured model — a focused parser + serializer for the
 * constrained taste-rules schema, so the Compose panel can offer a VISUAL editor
 * instead of a raw textarea.
 *
 * The schema is small and regular:
 *   version: N
 *   randomness: 0..1
 *   palettes:   name: { hueRange:[lo,hi], sat, val, hueSpread }   # comment
 *   defaults:   patterns: [...]   palette: [...]
 *   sections:   <label>:  patterns: [...]   palette: [...]
 *
 * To stay byte-faithful we PRESERVE verbatim:
 *   - the header comment block (everything before `version:`)
 *   - each palette's inline body + trailing comment (palettes aren't edited here,
 *     only selected/ordered per section)
 *   - any unknown extra lines inside a rule block
 * The editor only mutates `randomness` and the per-section/defaults pattern &
 * palette lists — all simple identifier lists — so the output round-trips cleanly
 * through the Python yaml loader (scripts/translate.py).
 */

export interface PaletteDef {
  name: string
  /** Inline body verbatim, e.g. "{ hueRange: [0.95, 1.10], sat: [0.85, 1.0], val: 1.0, hueSpread: 0.12 }" */
  raw: string
  /** Trailing `# comment` text (without the #), used as a human description. */
  comment: string
  // Parsed for rendering swatches:
  hueRange: [number, number]
  sat: number | [number, number]
  val: number | [number, number]
  hueSpread: number
}

export interface SectionRule {
  patterns: string[]
  palette: string[]
  /** Verbatim extra lines inside the block we don't model (future-proofing). */
  extra: string[]
}

export interface TasteModel {
  /** Everything before `version:` — the documentation header, preserved verbatim. */
  preamble: string
  version: string
  randomness: number
  palettes: PaletteDef[]
  defaults: SectionRule
  sections: { name: string; rule: SectionRule }[]
  ok: boolean
  error?: string
}

// ── small helpers ────────────────────────────────────────────────────────────
function splitComment(line: string): { code: string; comment: string } {
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === '#' && depth <= 0) return { code: line.slice(0, i), comment: line.slice(i + 1).trim() }
  }
  return { code: line, comment: '' }
}

function indentOf(line: string): number {
  const m = line.match(/^(\s*)/)
  return m ? m[1].length : 0
}

function parseListLiteral(s: string): string[] {
  const inner = s.trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return []
  return inner.split(',').map((x) => x.trim()).filter(Boolean)
}

function parseScalar(v: string): number | string | number[] {
  v = v.trim()
  if (v.startsWith('[')) return parseListLiteral(v).map((x) => (isNaN(Number(x)) ? (x as unknown as number) : Number(x))) as number[]
  const n = Number(v)
  return isNaN(n) ? v : n
}

function parseInlineMap(raw: string): Record<string, number | string | number[]> {
  const inner = raw.trim().replace(/^\{/, '').replace(/\}$/, '').trim()
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '[' || ch === '{') depth++
    if (ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  const obj: Record<string, number | string | number[]> = {}
  for (const p of parts) {
    const idx = p.indexOf(':')
    if (idx < 0) continue
    obj[p.slice(0, idx).trim()] = parseScalar(p.slice(idx + 1))
  }
  return obj
}

// ── block parsers ────────────────────────────────────────────────────────────
function parsePalettes(lines: string[], start: number, model: TasteModel): number {
  let i = start
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.trim() === '') {
      i++
      continue
    }
    const { code, comment } = splitComment(raw)
    if (indentOf(code) === 0 && code.trim() !== '') break
    const t = code.trim()
    const ci = t.indexOf(':')
    if (ci > 0) {
      const name = t.slice(0, ci).trim()
      const body = t.slice(ci + 1).trim()
      const map = body.startsWith('{') ? parseInlineMap(body) : {}
      model.palettes.push({
        name,
        raw: body,
        comment,
        hueRange: Array.isArray(map.hueRange) ? ([map.hueRange[0], map.hueRange[1]] as [number, number]) : [0.55, 0.7],
        sat: (map.sat as number | number[] | undefined) != null ? (map.sat as number | [number, number]) : 1,
        val: (map.val as number | number[] | undefined) != null ? (map.val as number | [number, number]) : 1,
        hueSpread: typeof map.hueSpread === 'number' ? map.hueSpread : 0.12,
      })
    }
    i++
  }
  return i
}

function parseRuleBlock(lines: string[], start: number, rule: SectionRule, baseIndent: number): number {
  let i = start
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.trim() === '') {
      i++
      continue
    }
    const { code } = splitComment(raw)
    if (indentOf(code) < baseIndent) break
    const t = code.trim()
    if (/^patterns\s*:/.test(t)) rule.patterns = parseListLiteral(t.slice(t.indexOf(':') + 1))
    else if (/^palette\s*:/.test(t)) rule.palette = parseListLiteral(t.slice(t.indexOf(':') + 1))
    else rule.extra.push(raw)
    i++
  }
  return i
}

function parseSections(lines: string[], start: number, model: TasteModel): number {
  let i = start
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.trim() === '') {
      i++
      continue
    }
    const { code } = splitComment(raw)
    const ind = indentOf(code)
    if (ind === 0 && code.trim() !== '') break
    if (ind === 2) {
      const t = code.trim()
      const ci = t.indexOf(':')
      const name = ci > 0 ? t.slice(0, ci).trim() : t
      const rule: SectionRule = { patterns: [], palette: [], extra: [] }
      i = parseRuleBlock(lines, i + 1, rule, 4)
      model.sections.push({ name, rule })
      continue
    }
    i++
  }
  return i
}

export function parseTasteRules(text: string): TasteModel {
  const empty = (): TasteModel => ({
    preamble: '',
    version: '2',
    randomness: 0.85,
    palettes: [],
    defaults: { patterns: [], palette: [], extra: [] },
    sections: [],
    ok: true,
  })
  try {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    let vi = lines.findIndex((l) => /^version\s*:/.test(l))
    if (vi < 0) vi = 0
    const model = empty()
    model.preamble = lines.slice(0, vi).join('\n')
    let i = vi
    while (i < lines.length) {
      const { code } = splitComment(lines[i])
      const trimmed = code.trim()
      if (!trimmed) {
        i++
        continue
      }
      if (indentOf(code) === 0) {
        if (/^version\s*:/.test(trimmed)) {
          model.version = trimmed.slice(trimmed.indexOf(':') + 1).trim() || '2'
          i++
          continue
        }
        if (/^randomness\s*:/.test(trimmed)) {
          const n = Number(trimmed.slice(trimmed.indexOf(':') + 1))
          model.randomness = isNaN(n) ? 0.85 : Math.max(0, Math.min(1, n))
          i++
          continue
        }
        if (/^palettes\s*:/.test(trimmed)) {
          i = parsePalettes(lines, i + 1, model)
          continue
        }
        if (/^defaults\s*:/.test(trimmed)) {
          i = parseRuleBlock(lines, i + 1, model.defaults, 2)
          continue
        }
        if (/^sections\s*:/.test(trimmed)) {
          i = parseSections(lines, i + 1, model)
          continue
        }
      }
      i++
    }
    return model
  } catch (e) {
    const m = empty()
    m.ok = false
    m.error = e instanceof Error ? e.message : String(e)
    return m
  }
}

// ── serialize ────────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1000) / 1000)
}

function emitRule(out: string[], rule: SectionRule, indent: string): void {
  out.push(`${indent}patterns: [${rule.patterns.join(', ')}]`)
  out.push(`${indent}palette:  [${rule.palette.join(', ')}]`)
  for (const ex of rule.extra) out.push(ex)
}

export function serializeTasteRules(m: TasteModel): string {
  const out: string[] = []
  const pre = m.preamble.replace(/\s+$/, '')
  if (pre) {
    out.push(pre)
    out.push('')
  }
  out.push(`version: ${m.version || '2'}`)
  out.push(`randomness: ${fmtNum(m.randomness)}`)
  out.push('')
  out.push('palettes:')
  const nameW = m.palettes.reduce((w, p) => Math.max(w, p.name.length), 0)
  for (const p of m.palettes) {
    let line = `  ${(p.name + ':').padEnd(nameW + 1)} ${p.raw}`
    if (p.comment) line += `   # ${p.comment}`
    out.push(line)
  }
  out.push('')
  out.push('defaults:')
  emitRule(out, m.defaults, '  ')
  out.push('')
  out.push('sections:')
  out.push('')
  m.sections.forEach((s, idx) => {
    out.push(`  ${s.name}:`)
    emitRule(out, s.rule, '    ')
    if (idx < m.sections.length - 1) out.push('')
  })
  out.push('')
  return out.join('\n')
}
