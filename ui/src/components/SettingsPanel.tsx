import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import './SettingsPanel.css'

interface SettingsPanelProps {
  value: string
  connected: boolean
  onSave: (value: string) => void
  onClose: () => void
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail' }

export default function SettingsPanel({ value, connected, onSave, onClose }: SettingsPanelProps) {
  const { t } = useI18n()
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
          <h2>{t({ en: 'Settings', he: 'הגדרות' })}</h2>
          <button type="button" className="settings-panel-close" onClick={onClose} aria-label={t({ en: 'Close', he: 'סגור' })}>×</button>
        </div>
        <label className="settings-panel-field">
          <span>{t({ en: 'Control server URL', he: 'כתובת שרת בקרה' })}</span>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setTest({ status: 'idle' }) }}
            placeholder="http://192.168.1.50:3080"
          />
        </label>
        <p className="settings-panel-hint">
          {t({ en: 'Point this at a control server reachable from your current network (e.g. the machine at the venue running ', he: 'הפנה את זה לשרת בקרה שנגיש מהרשת הנוכחית שלך (למשל המחשב באירוע שמריץ ' })}
          <code>yarn control-server</code>
          {t({ en: '). Leave blank to use this app in editing-only mode — timeline/preset editing keeps working, but Send to LEDs, Live mode, Import .ts and Detect Beats need a reachable server.', he: '). השאר ריק כדי להשתמש באפליקציה במצב עריכה בלבד — עריכת ציר הזמן/פריסטים ממשיכה לעבוד, אך שליחה ללדים, מצב חי, ייבוא .ts וזיהוי ביטים דורשים שרת נגיש.' })}
        </p>
        <div className="settings-panel-status">
          {value && (
            <span className={`settings-panel-dot${connected ? ' connected' : ''}`} />
          )}
          {value
            ? (connected ? t({ en: 'Currently connected', he: 'מחובר כרגע' }) : t({ en: 'Currently configured, not reachable', he: 'מוגדר כרגע, לא נגיש' }))
            : t({ en: 'No control server configured', he: 'לא הוגדר שרת בקרה' })}
        </div>
        <div className="settings-panel-actions">
          <button type="button" className="secondary-button" onClick={handleTest} disabled={test.status === 'testing'}>
            {test.status === 'testing' ? t({ en: 'Testing…', he: 'בודק…' }) : t({ en: 'Test connection', he: 'בדוק חיבור' })}
          </button>
          {test.status === 'ok' && <span className="settings-panel-test-ok">{t({ en: '✓ Reachable', he: '✓ נגיש' })}</span>}
          {test.status === 'fail' && <span className="settings-panel-test-fail">{t({ en: '✗ Not reachable', he: '✗ לא נגיש' })}</span>}
          <div className="settings-panel-actions-spacer" />
          <button type="button" className="secondary-button" onClick={() => onSave(input)}>{t({ en: 'Save', he: 'שמור' })}</button>
        </div>
      </div>
    </div>
  )
}
