import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { library, Device, DevicePin } from '../lib/library'
import FlashController from './FlashController'
import { useI18n } from '../lib/i18n'

/**
 * Step 2 — "Set up the controllers". The user installs firmware on each ESP (via FlashController)
 * and DECLARES it here: a name + the GPIO pins wired to LED strips. No LED count — that's learned
 * later by the camera mapping. One ESP = one controller ("thing") whose pins concatenate into its
 * flat LED buffer (matches led-object-service's single-buffer model).
 */

interface Props {
  projectId: string
  projectName: string
  onBack: () => void
}

const THING_RE = /^[A-Za-z0-9_-]{1,16}$/

export default function ControllerSetup({ projectId, projectName, onBack }: Props) {
  const { t } = useI18n()
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setDevices(await library.listDevices(projectId))
      setError(null)
    } catch (e: any) {
      setError(e?.message || t({ en: 'Failed to load controllers', he: 'טעינת הבקרים נכשלה' }))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = useCallback(
    async (thing: string) => {
      if (!window.confirm(t({ en: `Remove controller "${thing}" from this project?`, he: `להסיר את הבקר "${thing}" מהפרויקט הזה?` }))) return
      try {
        await library.removeDevice(thing, projectId)
        await refresh()
      } catch (e: any) {
        setError(e?.message || t({ en: 'Remove failed', he: 'ההסרה נכשלה' }))
      }
    },
    [projectId, refresh, t],
  )

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <button style={S.back} onClick={onBack}>← {projectName}</button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{t({ en: 'Set up the controllers', he: 'הגדרת הבקרים' })}</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>{t({ en: 'Install the firmware, then name each ESP and list its LED output pins.', he: 'התקן את הקושחה, ואז תן שם לכל ESP ורשום את פיני יציאת הלדים שלו.' })}</div>
        </div>
      </div>

      <div style={S.grid}>
        <section style={S.card}>
          <div style={S.cardTitle}>{t({ en: 'Install firmware', he: 'התקנת קושחה' })}</div>
          <FlashController />
        </section>

        <section style={S.card}>
          <div style={S.cardTitle}>{t({ en: 'Add a controller', he: 'הוסף בקר' })}</div>
          <AddControllerForm projectId={projectId} existing={devices} onSaved={refresh} onError={setError} />
        </section>
      </div>

      <section style={{ ...S.card, marginTop: 16 }}>
        <div style={S.cardTitle}>{t({ en: 'Your controllers', he: 'הבקרים שלך' })} {devices.length > 0 && <span style={{ color: '#8fa0bd', fontWeight: 400 }}>· {devices.length}</span>}</div>
        {error && <div style={S.err}>{error}</div>}
        {loading ? (
          <div style={S.muted}>{t({ en: 'Loading…', he: 'טוען…' })}</div>
        ) : devices.length === 0 ? (
          <div style={S.muted}>{t({ en: 'No controllers yet. Add one above — you can do this before or after mapping.', he: 'אין עדיין בקרים. הוסף אחד למעלה — אפשר לעשות זאת לפני או אחרי המיפוי.' })}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {devices.map((d) => (
              <div key={d.thing} style={S.row}>
                <span style={{ fontWeight: 700 }}>{d.thing}</span>
                {d.chip && <span style={S.chip}>{d.chip}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ color: '#8fa0bd', fontSize: 13 }}>
                  {d.pins.length ? d.pins.map((p) => `GPIO ${p.gpio}${p.label ? ` (${p.label})` : ''}`).join(' · ') : t({ en: 'no pins', he: 'ללא פינים' })}
                </span>
                <button style={S.smallGhost} onClick={() => remove(d.thing)}>{t({ en: 'Remove', he: 'הסר' })}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function AddControllerForm({
  projectId,
  existing,
  onSaved,
  onError,
}: {
  projectId: string
  existing: Device[]
  onSaved: () => void
  onError: (m: string | null) => void
}) {
  const { t } = useI18n()
  const [thing, setThing] = useState('')
  const [pins, setPins] = useState<DevicePin[]>([{ gpio: 2 }])
  const [saving, setSaving] = useState(false)

  const nameTaken = useMemo(() => existing.some((d) => d.thing === thing.trim()), [existing, thing])
  const nameValid = THING_RE.test(thing.trim())
  const pinsValid = pins.some((p) => Number.isInteger(p.gpio) && p.gpio >= 0 && p.gpio <= 48)
  const canSave = nameValid && !nameTaken && pinsValid && !saving

  const setPin = (i: number, patch: Partial<DevicePin>) => setPins((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)))
  const addPin = () => setPins((ps) => [...ps, { gpio: 0 }])
  const removePin = (i: number) => setPins((ps) => ps.filter((_, k) => k !== i))

  const save = async () => {
    onError(null)
    setSaving(true)
    try {
      const cleanPins = pins.filter((p) => Number.isInteger(p.gpio) && p.gpio >= 0 && p.gpio <= 48)
      await library.saveDevice({ thing: thing.trim(), pins: cleanPins }, projectId)
      setThing('')
      setPins([{ gpio: 2 }])
      onSaved()
    } catch (e: any) {
      onError(e?.message || t({ en: 'Save failed', he: 'השמירה נכשלה' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={S.field}>
        {t({ en: 'Controller name', he: 'שם הבקר' })}
        <input
          value={thing}
          onChange={(e) => setThing(e.target.value)}
          placeholder={t({ en: 'e.g. ring1', he: 'לדוגמה ring1' })}
          maxLength={16}
          style={{ ...S.input, ...(thing && !nameValid ? S.inputBad : {}) }}
        />
        <span style={S.hint}>
          {thing && !nameValid
            ? t({ en: 'Letters, digits, - or _ only (max 16)', he: 'אותיות, ספרות, - או _ בלבד (עד 16)' })
            : nameTaken
              ? t({ en: 'A controller with this name already exists', he: 'כבר קיים בקר בשם הזה' })
              : t({ en: 'This becomes the ESP’s thing name', he: 'זה יהיה שם ה-thing של ה-ESP' })}
        </span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#8fa0bd' }}>{t({ en: 'LED output pins (GPIO) — no count needed', he: 'פיני יציאת לדים (GPIO) — אין צורך במספר' })}</span>
        {pins.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#66707f', fontSize: 12, width: 44 }}>GPIO</span>
            <input
              type="number"
              value={p.gpio}
              min={0}
              max={48}
              onChange={(e) => setPin(i, { gpio: Math.max(0, Math.min(48, Number(e.target.value) || 0)) })}
              style={{ ...S.input, width: 84 }}
            />
            <input
              value={p.label || ''}
              onChange={(e) => setPin(i, { label: e.target.value })}
              placeholder={t({ en: 'label (optional)', he: 'תווית (אופציונלי)' })}
              style={{ ...S.input, flex: 1 }}
            />
            {pins.length > 1 && (
              <button style={S.smallGhost} onClick={() => removePin(i)} title={t({ en: 'Remove pin', he: 'הסר פין' })}>✕</button>
            )}
          </div>
        ))}
        <button style={S.ghost} onClick={addPin}>{t({ en: '+ Add pin', he: '+ הוסף פין' })}</button>
      </div>

      <button style={{ ...S.primary, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={save}>
        {saving ? t({ en: 'Saving…', he: 'שומר…' }) : t({ en: 'Save controller', he: 'שמור בקר' })}
      </button>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, padding: '28px 24px 48px', maxWidth: 980, margin: '0 auto', width: '100%' },
  head: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 },
  back: { background: 'transparent', color: '#8fb4ff', border: '1px solid #2a3140', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 },
  card: { background: '#12161d', border: '1px solid #1e232c', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#c7d2e6', textTransform: 'uppercase', letterSpacing: '0.04em' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #1a1f28' },
  chip: { fontFamily: 'ui-monospace, monospace', fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#1c2432', border: '1px solid #2a3140', color: '#8fa0bd' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#8fa0bd' },
  input: { background: '#0d1016', color: '#e8eaed', border: '1px solid #2a3140', borderRadius: 6, padding: '8px 10px' },
  inputBad: { borderColor: '#c4506a' },
  hint: { fontSize: 11, color: '#66707f' },
  muted: { color: '#8fa0bd', fontSize: 13 },
  err: { color: '#ff8a8a', fontSize: 13 },
  primary: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', fontWeight: 700 },
  ghost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', alignSelf: 'flex-start' },
  smallGhost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
}
