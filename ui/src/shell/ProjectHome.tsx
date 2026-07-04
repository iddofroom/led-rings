import React, { useCallback, useEffect, useState } from 'react'
import { mappingApi } from '../lib/mapping'
import { library } from '../lib/library'
import { useI18n } from '../lib/i18n'
import MembersPanel from './MembersPanel'

/**
 * Project home: the ordered stages of building an installation, from connecting
 * the Raspberry Pi through flashing controllers, mapping the LEDs, and composing.
 * Stage status is derived live (ping / discover / saved map) — stages stay
 * clickable regardless, so it guides without hard-locking.
 */

interface Props {
  projectId: string
  projectName: string
  projectRole: 'admin' | 'member' | null
  onCompose: () => void
  onMapping: () => void
  onSetupControllers: () => void
  onFlow: () => void
  onBack: () => void
}

type StageState = 'unknown' | 'checking' | 'ok' | 'todo'

export default function ProjectHome({ projectId, projectName, projectRole, onCompose, onMapping, onSetupControllers, onFlow, onBack }: Props) {
  const { t } = useI18n()
  const [showSettings, setShowSettings] = useState(false)
  const [pi, setPi] = useState<StageState>('unknown')
  const [controllers, setControllers] = useState<{ state: StageState; count: number }>({ state: 'unknown', count: 0 })
  const [declared, setDeclared] = useState(0)
  const [mapInfo, setMapInfo] = useState<{ state: StageState; leds: number; controllers: number }>({ state: 'unknown', leds: 0, controllers: 0 })

  const refresh = useCallback(async () => {
    setPi('checking')
    setControllers({ state: 'checking', count: 0 })
    setMapInfo((m) => ({ ...m, state: 'checking' }))

    // Declared controllers (registry) — independent of whether the hardware is powered on.
    try {
      setDeclared((await library.listDevices(projectId)).length)
    } catch {
      setDeclared(0)
    }

    const online = await mappingApi.ping()
    setPi(online ? 'ok' : 'todo')

    if (online) {
      try {
        const res = await mappingApi.discover()
        const count = res.controllers.filter((c) => c.alive).length
        setControllers({ state: count > 0 ? 'ok' : 'todo', count })
      } catch {
        setControllers({ state: 'todo', count: 0 })
      }
    } else {
      setControllers({ state: 'todo', count: 0 })
    }

    try {
      const blob = await mappingApi.loadMap(projectId)
      const cs = blob?.controllers?.length || 0
      const leds = blob?.controllers?.reduce((n, c) => n + c.leds.length, 0) || 0
      setMapInfo({ state: cs > 0 ? 'ok' : 'todo', leds, controllers: cs })
    } catch {
      setMapInfo({ state: 'todo', leds: 0, controllers: 0 })
    }
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  const stages = [
    {
      key: 'pi',
      badge: '1',
      title: t({ en: 'Connect the Raspberry Pi', he: 'חבר את ה-Raspberry Pi' }),
      desc: t({
        en: 'Run the host bundle on the Pi wired to the installation. The tool reaches the hardware through it.',
        he: 'הרץ את חבילת המארח על ה-Pi המחובר למיצב. הכלי מגיע לחומרה דרכו.',
      }),
      state: pi,
      status: pi === 'ok' ? t({ en: 'Online', he: 'מחובר' }) : pi === 'checking' ? t({ en: 'Checking…', he: 'בודק…' }) : t({ en: 'Offline', he: 'מנותק' }),
      action: (
        <>
          <button style={S.ghost} onClick={refresh}>{t({ en: 'Test connection', he: 'בדוק חיבור' })}</button>
          <a href="/setup" target="_blank" rel="noreferrer" style={{ ...S.ghost, textDecoration: 'none' }}>{t({ en: 'Download host bundle →', he: 'הורד את חבילת המארח →' })}</a>
        </>
      ),
    },
    {
      key: 'esp',
      badge: '2',
      title: t({ en: 'Set up the controllers', he: 'הגדר את הבקרים' }),
      desc: t({
        en: 'Flash each ESP32 with its thing name and power it. They announce themselves automatically.',
        he: 'צרוב כל ESP32 עם שם ה-thing שלו והפעל אותו. הם מכריזים על עצמם אוטומטית.',
      }),
      state: controllers.state,
      status:
        controllers.state === 'ok'
          ? `${controllers.count} ${t({ en: 'online', he: 'מחוברים' })}${declared ? ` · ${declared} ${t({ en: 'declared', he: 'רשומים' })}` : ''}`
          : controllers.state === 'checking'
            ? t({ en: 'Scanning…', he: 'סורק…' })
            : declared
              ? `${declared} ${t({ en: 'declared', he: 'רשומים' })} · ${t({ en: 'offline', he: 'מנותק' })}`
              : t({ en: 'None yet', he: 'אין עדיין' }),
      action: (
        <>
          <button style={S.primary} onClick={onSetupControllers}>{t({ en: 'Set up controllers →', he: 'הגדר בקרים →' })}</button>
          <button style={S.ghost} onClick={refresh}>{t({ en: 'Refresh', he: 'רענן' })}</button>
        </>
      ),
    },
    {
      key: 'map',
      badge: '3',
      title: t({ en: 'Map the LEDs', he: 'מפה את ה-LEDs' }),
      desc: t({
        en: 'Aim your camera at the installation and let the tool learn every LED’s position.',
        he: 'כוון את המצלמה אל המיצב ותן לכלי ללמוד את המיקום של כל LED.',
      }),
      state: mapInfo.state,
      status:
        mapInfo.state === 'ok'
          ? `${mapInfo.leds} LEDs · ${mapInfo.controllers} ${t({ en: 'controllers', he: 'בקרים' })}`
          : mapInfo.state === 'checking'
            ? t({ en: 'Loading…', he: 'טוען…' })
            : t({ en: 'Not mapped', he: 'לא ממופה' }),
      action: <button style={S.primary} onClick={onMapping}>{t({ en: 'Open mapping →', he: 'פתח מיפוי →' })}</button>,
    },
    {
      key: 'compose',
      badge: '4',
      title: t({ en: 'Compose & play', he: 'הלחן ונגן' }),
      desc: t({
        en: 'Upload a song, generate a beat-synced animation, edit the timeline, and play it live.',
        he: 'העלה שיר, צור אנימציה מסונכרנת לקצב, ערוך את ציר הזמן, ונגן אותה בשידור חי.',
      }),
      state: 'unknown' as StageState,
      status: t({ en: 'Ready', he: 'מוכן' }),
      action: <button style={S.primary} onClick={onCompose}>{t({ en: 'Open songs →', he: 'פתח שירים →' })}</button>,
    },
    {
      key: 'flow',
      badge: '5',
      title: t({ en: 'Installation flow', he: 'פלואו של המיצב' }),
      desc: t({
        en: 'Wire buttons / RFID to actions — scan a tag to play a song or fire a pattern.',
        he: 'חבר כפתורים / RFID לפעולות — סרוק תג כדי לנגן שיר או להפעיל תבנית.',
      }),
      state: 'unknown' as StageState,
      status: t({ en: 'Optional', he: 'אופציונלי' }),
      action: <button style={S.ghost} onClick={onFlow}>{t({ en: 'Open flow →', he: 'פתח פלואו →' })}</button>,
    },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <button style={S.back} onClick={onBack}>← {t({ en: 'Projects', he: 'פרויקטים' })}</button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{projectName}</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>
            {t({ en: 'Build your installation, one step at a time', he: 'בנה את המיצב שלך, שלב אחר שלב' })}
            {projectRole ? ` · ${t({ en: 'you are', he: 'התפקיד שלך' })} ${t(projectRole === 'admin' ? { en: 'admin', he: 'מנהל' } : { en: 'member', he: 'חבר' })}` : ''}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {projectRole === 'admin' && (
          <button style={S.settings} onClick={() => setShowSettings(true)}>
            ⚙️ {t({ en: 'Settings', he: 'הגדרות' })}
          </button>
        )}
      </div>

      <div style={S.grid}>
        {stages.map((s) => (
          <div key={s.key} style={S.card}>
            <div style={S.cardHead}>
              <span style={{ ...S.badge, ...(s.state === 'ok' ? S.badgeOk : {}) }}>{s.state === 'ok' ? '✓' : s.badge}</span>
              <span style={{ fontSize: 16, fontWeight: 750 }}>{s.title}</span>
              <span style={{ flex: 1 }} />
              <StatusChip state={s.state} label={s.status} />
            </div>
            <p style={S.desc}>{s.desc}</p>
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>{s.action}</div>
          </div>
        ))}
      </div>

      {showSettings && projectRole === 'admin' && (
        <MembersPanel projectId={projectId} projectName={projectName} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

function StatusChip({ state, label }: { state: StageState; label: string }) {
  const color = state === 'ok' ? '#38d39f' : state === 'checking' ? '#f0c020' : state === 'todo' ? '#66707f' : '#8fb4ff'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, padding: '28px 24px 48px', maxWidth: 980, margin: '0 auto', width: '100%' },
  head: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 26 },
  back: { background: 'transparent', color: '#8fb4ff', border: '1px solid #2a3140', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' },
  settings: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 },
  card: { background: '#12161d', border: '1px solid #1e232c', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 168 },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 8, background: '#1c2432', border: '1px solid #2a3140', color: '#c7d2e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: '0 0 auto' },
  badgeOk: { background: 'rgba(56,211,159,0.15)', borderColor: 'rgba(56,211,159,0.4)', color: '#38d39f' },
  desc: { color: '#8fa0bd', fontSize: 14, margin: 0, lineHeight: 1.5 },
  primary: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 },
  ghost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 10, padding: '9px 14px', cursor: 'pointer' },
}
