import React, { useCallback, useEffect, useState } from 'react'
import { flowApi } from '../lib/flow'
import { library, FlowRule, LibrarySongSummary } from '../lib/library'

/**
 * Step 8 — "Installation flow". Map physical inputs (RFID scans) to actions (play a song, fire a
 * pattern trigger, set brightness, stop). Rules are saved to the cloud and pushed to the Pi's flow
 * engine, which listens on the sensor MQTT topics. Also explains how to wire the electronics.
 */

interface Props {
  projectId: string
  projectName: string
  onBack: () => void
}

const ACTIONS = [
  { value: 'playSong', label: 'Play a song' },
  { value: 'trigger', label: 'Fire a pattern' },
  { value: 'brightness', label: 'Set brightness' },
  { value: 'stop', label: 'Stop' },
] as const

let idc = 0
const newId = () => `r${Date.now().toString(36)}${idc++}`

export default function FlowBuilder({ projectId, projectName, onBack }: Props) {
  const [rules, setRules] = useState<FlowRule[]>([])
  const [songs, setSongs] = useState<LibrarySongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([flowApi.loadRules(projectId).catch(() => null), library.listSongs(projectId).catch(() => [])])
      .then(([flow, s]) => {
        if (flow?.rules) setRules(flow.rules)
        setSongs(s)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  const addRule = () =>
    setRules((rs) => [...rs, { id: newId(), when: { box: 'box1' }, then: { action: 'playSong' } }])
  const removeRule = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id))
  const patchWhen = (id: string, w: Partial<FlowRule['when']>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, when: { ...r.when, ...w } } : r)))
  const patchThen = (id: string, t: Partial<FlowRule['then']>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, then: { ...r.then, ...t } } : r)))

  const save = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      await flowApi.saveRules(rules, projectId)
      setMsg('Saved ✓')
    } catch (e: any) {
      setMsg(`Save failed: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }, [rules, projectId])

  const apply = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      await flowApi.saveRules(rules, projectId) // persist first
      const r = await flowApi.apply(rules) // then push to the Pi engine
      setMsg(`Applied to hardware ✓ (${r.ruleCount} rules live)`)
    } catch (e: any) {
      setMsg(`Apply failed: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }, [rules, projectId])

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <button style={S.back} onClick={onBack}>← {projectName}</button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Installation flow</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>When a tag is scanned, do something — then apply it to the installation.</div>
        </div>
      </div>

      <section style={S.card}>
        <div style={S.cardTitle}>Rules</div>
        {loading ? (
          <div style={S.muted}>Loading…</div>
        ) : rules.length === 0 ? (
          <div style={S.muted}>No rules yet. Add one below.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.map((r) => (
              <div key={r.id} style={S.rule}>
                <span style={S.when}>WHEN</span>
                <input style={{ ...S.input, width: 80 }} value={r.when.box || ''} placeholder="any box" onChange={(e) => patchWhen(r.id, { box: e.target.value })} title="RFID box (e.g. box1) — blank = any" />
                <input style={{ ...S.input, width: 90 }} value={r.when.color || ''} placeholder="any tag" onChange={(e) => patchWhen(r.id, { color: e.target.value })} title="Tag colour/value — blank = any" />
                <span style={S.then}>DO</span>
                <select style={S.input} value={r.then.action} onChange={(e) => patchThen(r.id, { action: e.target.value as FlowRule['then']['action'] })}>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {r.then.action === 'playSong' && (
                  <select style={{ ...S.input, flex: 1 }} value={r.then.song || ''} onChange={(e) => patchThen(r.id, { song: e.target.value })}>
                    <option value="">— pick a song —</option>
                    {songs.map((s) => <option key={s.slug} value={s.slug}>{s.name || s.slug}</option>)}
                  </select>
                )}
                {r.then.action === 'trigger' && (
                  <input style={{ ...S.input, flex: 1 }} value={r.then.trigger || ''} placeholder="trigger name (e.g. clock)" onChange={(e) => patchThen(r.id, { trigger: e.target.value })} />
                )}
                {r.then.action === 'brightness' && (
                  <input type="number" min={0} max={1} step={0.05} style={{ ...S.input, width: 90 }} value={r.then.brightness ?? 1} onChange={(e) => patchThen(r.id, { brightness: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
                )}
                <span style={{ flex: 1 }} />
                <button style={S.smallGhost} onClick={() => removeRule(r.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <button style={S.ghost} onClick={addRule}>+ Add rule</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <button style={S.primary} disabled={busy} onClick={apply}>{busy ? 'Working…' : '⚡ Apply to installation'}</button>
          <button style={S.ghost} disabled={busy} onClick={save}>Save only</button>
          {msg && <span style={{ fontSize: 13, color: msg.includes('failed') ? '#ff8a8a' : '#38d39f' }}>{msg}</span>}
        </div>
      </section>

      <section style={S.card}>
        <div style={S.cardTitle}>How to wire it</div>
        <div style={S.muted}>
          A rule fires when an <b>RFID reader</b> publishes a scan over MQTT. Wire an RFID reader board (e.g. an ESP or a
          Pi HAT) to your network and have it publish, on each scan:
          <div style={S.codeblock}>topic: <b>sensors/rfid/box1/chip</b>{'\n'}payload: {'{'} "color": "red" {'}'}</div>
          Use one <b>box</b> per physical reader (<code style={S.codei}>box1</code>, <code style={S.codei}>box2</code>…), and put the
          tag's value in <code style={S.codei}>color</code>. The Pi's flow engine (already listening on <code style={S.codei}>sensors/#</code>)
          matches your rules and runs the action. Leave a field blank to match any box / any tag.
        </div>
      </section>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, padding: '28px 24px 48px', maxWidth: 980, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 16 },
  head: { display: 'flex', alignItems: 'center', gap: 16 },
  back: { background: 'transparent', color: '#8fb4ff', border: '1px solid #2a3140', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
  card: { background: '#12161d', border: '1px solid #1e232c', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#c7d2e6', textTransform: 'uppercase', letterSpacing: '0.04em' },
  rule: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid #1a1f28' },
  when: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#5b8cff', fontWeight: 700 },
  then: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7a5cff', fontWeight: 700 },
  input: { background: '#0d1016', color: '#e8eaed', border: '1px solid #2a3140', borderRadius: 6, padding: '6px 8px' },
  muted: { color: '#8fa0bd', fontSize: 14, lineHeight: 1.6 },
  codeblock: { fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'pre-wrap', background: '#0d1016', border: '1px solid #232c3c', borderRadius: 8, padding: 10, margin: '8px 0', color: '#c7d2e6' },
  codei: { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#0d1016', border: '1px solid #232c3c', borderRadius: 4, padding: '1px 5px' },
  primary: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 },
  ghost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', alignSelf: 'flex-start' },
  smallGhost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
}
