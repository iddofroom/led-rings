import React, { useCallback, useEffect, useState } from 'react'
import { mappingApi } from '../lib/mapping'

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
  onBack: () => void
}

type StageState = 'unknown' | 'checking' | 'ok' | 'todo'

export default function ProjectHome({ projectId, projectName, projectRole, onCompose, onMapping, onSetupControllers, onBack }: Props) {
  const [pi, setPi] = useState<StageState>('unknown')
  const [controllers, setControllers] = useState<{ state: StageState; count: number }>({ state: 'unknown', count: 0 })
  const [mapInfo, setMapInfo] = useState<{ state: StageState; leds: number; controllers: number }>({ state: 'unknown', leds: 0, controllers: 0 })

  const refresh = useCallback(async () => {
    setPi('checking')
    setControllers({ state: 'checking', count: 0 })
    setMapInfo((m) => ({ ...m, state: 'checking' }))

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
      title: 'Connect the Raspberry Pi',
      desc: 'Run the host bundle on the Pi wired to the installation. The tool reaches the hardware through it.',
      state: pi,
      status: pi === 'ok' ? 'Online' : pi === 'checking' ? 'Checking…' : 'Offline',
      action: <button style={S.ghost} onClick={refresh}>Test connection</button>,
    },
    {
      key: 'esp',
      badge: '2',
      title: 'Set up the controllers',
      desc: 'Flash each ESP32 with its thing name and power it. They announce themselves automatically.',
      state: controllers.state,
      status:
        controllers.state === 'ok' ? `${controllers.count} online` : controllers.state === 'checking' ? 'Scanning…' : 'None found',
      action: (
        <>
          <button style={S.primary} onClick={onSetupControllers}>Set up controllers →</button>
          <button style={S.ghost} onClick={refresh}>Refresh</button>
        </>
      ),
    },
    {
      key: 'map',
      badge: '3',
      title: 'Map the LEDs',
      desc: 'Aim your camera at the installation and let the tool learn every LED’s position.',
      state: mapInfo.state,
      status:
        mapInfo.state === 'ok' ? `${mapInfo.leds} LEDs · ${mapInfo.controllers} controllers` : mapInfo.state === 'checking' ? 'Loading…' : 'Not mapped',
      action: <button style={S.primary} onClick={onMapping}>Open mapping →</button>,
    },
    {
      key: 'compose',
      badge: '4',
      title: 'Compose & play',
      desc: 'Upload a song, generate a beat-synced animation, edit the timeline, and play it live.',
      state: 'unknown' as StageState,
      status: 'Ready',
      action: <button style={S.primary} onClick={onCompose}>Open songs →</button>,
    },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <button style={S.back} onClick={onBack}>← Projects</button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{projectName}</div>
          <div style={{ color: '#8fa0bd', fontSize: 13 }}>
            Build your installation, one step at a time{projectRole ? ` · you are ${projectRole}` : ''}
          </div>
        </div>
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 },
  card: { background: '#12161d', border: '1px solid #1e232c', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 168 },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 8, background: '#1c2432', border: '1px solid #2a3140', color: '#c7d2e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: '0 0 auto' },
  badgeOk: { background: 'rgba(56,211,159,0.15)', borderColor: 'rgba(56,211,159,0.4)', color: '#38d39f' },
  desc: { color: '#8fa0bd', fontSize: 14, margin: 0, lineHeight: 1.5 },
  primary: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 },
  ghost: { background: 'transparent', color: '#c7d2e6', border: '1px solid #2a3140', borderRadius: 10, padding: '9px 14px', cursor: 'pointer' },
}
