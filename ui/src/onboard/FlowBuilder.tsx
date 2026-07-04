import React, { useCallback, useEffect, useState } from 'react'
import { flowApi } from '../lib/flow'
import { library, FlowRule, LibrarySongSummary } from '../lib/library'
import { useI18n } from '../lib/i18n'

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
  { value: 'playSong', label: 'Play a song', he: 'נגן שיר' },
  { value: 'trigger', label: 'Fire a pattern', he: 'הפעל תבנית' },
  { value: 'brightness', label: 'Set brightness', he: 'קבע בהירות' },
  { value: 'stop', label: 'Stop', he: 'עצור' },
] as const

let idc = 0
const newId = () => `r${Date.now().toString(36)}${idc++}`

export default function FlowBuilder({ projectId, projectName, onBack }: Props) {
  const { t } = useI18n()
  const [rules, setRules] = useState<FlowRule[]>([])
  const [songs, setSongs] = useState<LibrarySongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

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
      setMsg({ text: t({ en: 'Saved ✓', he: 'נשמר ✓' }), ok: true })
    } catch (e: any) {
      setMsg({ text: `${t({ en: 'Save failed:', he: 'השמירה נכשלה:' })} ${e?.message || e}`, ok: false })
    } finally {
      setBusy(false)
    }
  }, [rules, projectId, t])

  const apply = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      await flowApi.saveRules(rules, projectId) // persist first
      const r = await flowApi.apply(rules) // then push to the Pi engine
      setMsg({ text: `${t({ en: 'Applied to hardware ✓', he: 'הוחל על החומרה ✓' })} (${r.ruleCount} ${t({ en: 'rules live', he: 'חוקים פעילים' })})`, ok: true })
    } catch (e: any) {
      setMsg({ text: `${t({ en: 'Apply failed:', he: 'ההחלה נכשלה:' })} ${e?.message || e}`, ok: false })
    } finally {
      setBusy(false)
    }
  }, [rules, projectId, t])

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <button style={S.back} onClick={onBack}>← {projectName}</button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{t({ en: 'Installation flow', he: 'פלואו התקנה' })}</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>{t({ en: 'When a tag is scanned, do something — then apply it to the installation.', he: 'כאשר תג נסרק, בצע פעולה — ואז החל אותה על ההתקנה.' })}</div>
        </div>
      </div>

      <section style={S.card}>
        <div style={S.cardTitle}>{t({ en: 'Rules', he: 'חוקים' })}</div>
        {loading ? (
          <div style={S.muted}>{t({ en: 'Loading…', he: 'טוען…' })}</div>
        ) : rules.length === 0 ? (
          <div style={S.muted}>{t({ en: 'No rules yet. Add one below.', he: 'אין עדיין חוקים. הוסף אחד למטה.' })}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.map((r) => (
              <div key={r.id} style={S.rule}>
                <span style={S.when}>{t({ en: 'WHEN', he: 'כאשר' })}</span>
                <input style={{ ...S.input, width: 80 }} value={r.when.box || ''} placeholder={t({ en: 'any box', he: 'כל box' })} onChange={(e) => patchWhen(r.id, { box: e.target.value })} title={t({ en: 'RFID box (e.g. box1) — blank = any', he: 'תיבת RFID (למשל box1) — ריק = הכל' })} />
                <input style={{ ...S.input, width: 90 }} value={r.when.color || ''} placeholder={t({ en: 'any tag', he: 'כל תג' })} onChange={(e) => patchWhen(r.id, { color: e.target.value })} title={t({ en: 'Tag colour/value — blank = any', he: 'צבע/ערך התג — ריק = הכל' })} />
                <span style={S.then}>{t({ en: 'DO', he: 'אז' })}</span>
                <select style={S.input} value={r.then.action} onChange={(e) => patchThen(r.id, { action: e.target.value as FlowRule['then']['action'] })}>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{t({ en: a.label, he: a.he })}</option>)}
                </select>
                {r.then.action === 'playSong' && (
                  <select style={{ ...S.input, flex: 1 }} value={r.then.song || ''} onChange={(e) => patchThen(r.id, { song: e.target.value })}>
                    <option value="">{t({ en: '— pick a song —', he: '— בחר שיר —' })}</option>
                    {songs.map((s) => <option key={s.slug} value={s.slug}>{s.name || s.slug}</option>)}
                  </select>
                )}
                {r.then.action === 'trigger' && (
                  <input style={{ ...S.input, flex: 1 }} value={r.then.trigger || ''} placeholder={t({ en: 'trigger name (e.g. clock)', he: 'שם טריגר (למשל clock)' })} onChange={(e) => patchThen(r.id, { trigger: e.target.value })} />
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
        <button style={S.ghost} onClick={addRule}>{t({ en: '+ Add rule', he: '+ הוסף חוק' })}</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <button style={S.primary} disabled={busy} onClick={apply}>{busy ? t({ en: 'Working…', he: 'עובד…' }) : `⚡ ${t({ en: 'Apply to installation', he: 'החל על ההתקנה' })}`}</button>
          <button style={S.ghost} disabled={busy} onClick={save}>{t({ en: 'Save only', he: 'שמור בלבד' })}</button>
          {msg && <span style={{ fontSize: 13, color: msg.ok ? '#38d39f' : '#ff8a8a' }}>{msg.text}</span>}
        </div>
      </section>

      <section style={S.card}>
        <div style={S.cardTitle}>{t({ en: 'How to wire it', he: 'איך לחווט' })}</div>
        <div style={S.muted}>
          {t({ en: 'A rule fires when an', he: 'חוק מופעל כאשר' })} <b>{t({ en: 'RFID reader', he: 'קורא RFID' })}</b> {t({ en: 'publishes a scan over MQTT. Wire an RFID reader board (e.g. an ESP or a Pi HAT) to your network and have it publish, on each scan:', he: 'מפרסם סריקה דרך MQTT. חבר לוח קורא RFID (למשל ESP או Pi HAT) לרשת שלך, וגרום לו לפרסם בכל סריקה:' })}
          <div style={S.codeblock}>topic: <b>sensors/rfid/box1/chip</b>{'\n'}payload: {'{'} "color": "red" {'}'}</div>
          {t({ en: 'Use one', he: 'השתמש ב-' })} <b>box</b> {t({ en: 'per physical reader (', he: 'אחד לכל קורא פיזי (' })}<code style={S.codei}>box1</code>, <code style={S.codei}>box2</code>{t({ en: "…), and put the tag's value in", he: '…), ושים את ערך התג ב-' })} <code style={S.codei}>color</code>{t({ en: ". The Pi's flow engine (already listening on", he: '. מנוע ה-flow של ה-Pi (שמאזין כבר ל-' })} <code style={S.codei}>sensors/#</code>{t({ en: ') matches your rules and runs the action. Leave a field blank to match any box / any tag.', he: ') מתאים את החוקים שלך ומריץ את הפעולה. השאר שדה ריק כדי להתאים לכל box / כל תג.' })}
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
