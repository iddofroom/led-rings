import { useState } from 'react'
import './SettingsPanel.css'

interface SettingsPanelProps {
  value: string
  connected: boolean
  onSave: (value: string) => void
  onClose: () => void
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail' }

export default function SettingsPanel({ value, connected, onSave, onClose }: SettingsPanelProps) {
  const [input, setInput] = useState(value)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  const handleTest = async () => {
    const target = input.trim()
    if (!target) { setTest({ status: 'fail' }); return }
    setTest({ status: 'testing' })
    try {
      const res = await fetch(`${target}/api/audio?path=_ping`, { method: 'HEAD' })
      // Any response (even 404) means the control server itself answered.
      setTest({ status: res ? 'ok' : 'fail' })
    } catch {
      setTest({ status: 'fail' })
    }
  }

  return (
    <div className="settings-panel-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button type="button" className="settings-panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <label className="settings-panel-field">
          <span>Control server URL</span>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setTest({ status: 'idle' }) }}
            placeholder="http://192.168.1.50:3080"
          />
        </label>
        <p className="settings-panel-hint">
          Point this at a control server reachable from your current network (e.g. the machine
          at the venue running <code>yarn control-server</code>). Leave blank to use this app in
          editing-only mode — timeline/preset editing keeps working, but Send to LEDs, Live mode,
          Import .ts and Detect Beats need a reachable server.
        </p>
        <div className="settings-panel-status">
          {value && (
            <span className={`settings-panel-dot${connected ? ' connected' : ''}`} />
          )}
          {value
            ? (connected ? 'Currently connected' : 'Currently configured, not reachable')
            : 'No control server configured'}
        </div>
        <div className="settings-panel-actions">
          <button type="button" className="secondary-button" onClick={handleTest} disabled={test.status === 'testing'}>
            {test.status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          {test.status === 'ok' && <span className="settings-panel-test-ok">✓ Reachable</span>}
          {test.status === 'fail' && <span className="settings-panel-test-fail">✗ Not reachable</span>}
          <div className="settings-panel-actions-spacer" />
          <button type="button" className="secondary-button" onClick={() => onSave(input)}>Save</button>
        </div>
      </div>
    </div>
  )
}
