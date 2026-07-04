import React, { useCallback, useEffect, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { library, type LibraryProject } from '../lib/library'
import { useI18n } from '../lib/i18n'

/**
 * First screen after login: pick an installation ("project"). "Rings" is the built-in project
 * (the original 12-ring rig); more installations can be added and each keeps its own song
 * library. The per-installation LED-mapping tool is a later stage — for now a project is a
 * named library scope.
 */

interface Props {
  onOpen: (id: string, name: string, role: 'admin' | 'member' | null) => void
}

const icon = (p: LibraryProject) => (p.builtin ? '💍' : '🎨')

export default function ProjectPicker({ onOpen }: Props) {
  const { t } = useI18n()
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const [projects, setProjects] = useState<LibraryProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyEmail = useCallback(async () => {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }, [email])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setProjects(await library.listProjects())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function createProject() {
    const name = window.prompt(t({ en: 'New installation name:', he: 'שם מיצב חדש:' }), '')
    if (name == null || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const p = await library.createProject(name.trim())
      await refresh()
      onOpen(p.id, p.name, p.role ?? 'admin')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <h1 style={{ fontSize: 26, margin: '8px 0 4px' }}>{t({ en: 'Choose an installation', he: 'בחר מיצב' })}</h1>
        <p style={{ color: '#8a93a3', margin: '0 0 24px' }}>{t({ en: 'Each installation keeps its own song library.', he: 'לכל מיצב יש ספריית שירים משלו.' })}</p>

        {error && <div style={errorBox}>{error}</div>}

        {loading ? (
          <div style={{ color: '#9aa', padding: 40, textAlign: 'center' }}>{t({ en: 'Loading…', he: 'טוען…' })}</div>
        ) : projects.length === 0 && !error ? (
          <div style={emptyPanel}>
            <div style={{ fontSize: 40 }}>🎭</div>
            <h2 style={{ margin: '10px 0 6px', fontSize: 19 }}>{t({ en: "You're not in any installation yet", he: 'עדיין אין לך אף מיצב' })}</h2>
            <p style={{ margin: '0 0 18px', color: '#8a93a3', fontSize: 14, lineHeight: 1.6, maxWidth: 440 }}>
              {t({
                en: 'Installations are set up by whoever has the LED hardware. Ask them to invite you, or create your own.',
                he: 'מיצבים מוקמים על ידי מי שיש לו את חומרת ה-LED. בקשו ממנו להזמין אתכם, או צרו מיצב משלכם.',
              })}
            </p>
            {email && (
              <div style={inviteBox}>
                <span style={{ color: '#8a93a3', fontSize: 13 }}>{t({ en: 'Your email (give it to an admin to be invited):', he: 'המייל שלכם (תנו אותו למנהל כדי שיזמין אתכם):' })}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <code style={emailChip}>{email}</code>
                  <button style={copyBtn} onClick={copyEmail}>{copied ? t({ en: '✓ Copied', he: '✓ הועתק' }) : t({ en: 'Copy', he: 'העתק' })}</button>
                </div>
              </div>
            )}
            <button style={{ ...primaryCreate }} onClick={createProject} disabled={busy}>
              ＋ {t({ en: 'Create an installation (needs a Raspberry Pi)', he: 'צור מיצב (דורש Raspberry Pi)' })}
            </button>
          </div>
        ) : (
          <div style={grid}>
            {projects.map((p) => (
              <button key={p.id} style={card} onClick={() => onOpen(p.id, p.name, p.role ?? null)} disabled={busy}>
                <span style={{ fontSize: 40 }}>{icon(p)}</span>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{p.name}</span>
                {p.role && <span style={{ ...roleBadge, ...(p.role === 'admin' ? adminBadge : {}) }}>{t(p.role === 'admin' ? { en: 'admin', he: 'מנהל' } : { en: 'member', he: 'חבר' })}</span>}
              </button>
            ))}
            <button style={{ ...card, ...addCard }} onClick={createProject} disabled={busy} title={t({ en: 'A new installation drives real LEDs via a Raspberry Pi', he: 'מיצב חדש מפעיל LEDs אמיתיים דרך Raspberry Pi' })}>
              <span style={{ fontSize: 40 }}>＋</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{t({ en: 'New installation', he: 'מיצב חדש' })}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { flex: 1, padding: '32px 20px', overflowY: 'auto' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }
const card: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 150, background: '#1b1f27', color: '#e8eaed', border: '1px solid #2a303b', borderRadius: 14,
  cursor: 'pointer', padding: 20, transition: 'border-color .15s, transform .05s',
}
const addCard: React.CSSProperties = { background: 'transparent', borderStyle: 'dashed', color: '#9aa7bd' }
const roleBadge: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9aa7bd', background: '#2a303b', borderRadius: 4, padding: '1px 7px' }
const adminBadge: React.CSSProperties = { color: '#04150f', background: '#34d399' }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 13 }
const emptyPanel: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', background: '#12161d', border: '1px solid #1e232c', borderRadius: 16, padding: '36px 24px', maxWidth: 560, margin: '8px auto 0' }
const inviteBox: React.CSSProperties = { background: '#171b22', border: '1px solid #262c37', borderRadius: 12, padding: '14px 16px', marginBottom: 20, width: '100%', maxWidth: 460 }
const emailChip: React.CSSProperties = { background: '#0f1218', border: '1px solid #2a303b', borderRadius: 6, padding: '5px 10px', fontSize: 13, color: '#e8eaed', wordBreak: 'break-all' }
const copyBtn: React.CSSProperties = { background: '#2a303b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }
const primaryCreate: React.CSSProperties = { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '11px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }
