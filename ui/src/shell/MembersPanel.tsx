import React, { useCallback, useEffect, useState } from 'react'
import { library, type LibraryMember } from '../lib/library'

/**
 * Admin-only member management for a project. Admins invite by email (the invitee sees the project
 * on their next sign-in — no email is sent), set role (admin/member), and remove members. Enforced
 * again at the Worker: only admins may mutate, and the last admin can't be removed.
 */

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
}

export default function MembersPanel({ projectId, projectName, onClose }: Props) {
  const [members, setMembers] = useState<LibraryMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setMembers(await library.listMembers(projectId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!addr) return
    setBusy(true); setError(null)
    try {
      await library.addMember(addr, role, projectId)
      setEmail('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function setMemberRole(addr: string, r: 'admin' | 'member') {
    setBusy(true); setError(null)
    try { await library.addMember(addr, r, projectId); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function remove(addr: string) {
    if (!window.confirm(`Remove ${addr} from ${projectName}?`)) return
    setBusy(true); setError(null)
    try { await library.removeMember(addr, projectId); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>👥 Members — {projectName}</h2>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email to invite"
            style={input}
            disabled={busy}
          />
          <select value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'member')} style={select} disabled={busy}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" style={primaryBtn} disabled={busy || !email.trim()}>Invite</button>
        </form>

        {loading ? (
          <div style={{ color: '#9aa', padding: 20, textAlign: 'center' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map((m) => (
              <div key={m.email} style={row}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>
                <select value={m.role} onChange={(e) => setMemberRole(m.email, e.target.value === 'admin' ? 'admin' : 'member')} style={smallSelect} disabled={busy}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
                <button onClick={() => remove(m.email)} style={trashBtn} title="Remove" disabled={busy}>🗑</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 14 }}>
          Invited people see this project the next time they sign in. No email is sent.
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#0009', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: 24 }
const modal: React.CSSProperties = { background: '#1b1e24', color: '#e8eaed', borderRadius: 10, padding: 18, width: 'min(560px, 95vw)', boxShadow: '0 10px 40px #000a', marginTop: 40 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#23272f', borderRadius: 6, padding: '7px 10px' }
const input: React.CSSProperties = { flex: 1, background: '#12161d', color: '#e8eaed', border: '1px solid #2a303b', borderRadius: 6, padding: '8px 10px', fontSize: 13 }
const select: React.CSSProperties = { background: '#12161d', color: '#e8eaed', border: '1px solid #2a303b', borderRadius: 6, padding: '8px 10px', fontSize: 13 }
const smallSelect: React.CSSProperties = { background: '#12161d', color: '#e8eaed', border: '1px solid #2a303b', borderRadius: 5, padding: '3px 6px', fontSize: 12 }
const primaryBtn: React.CSSProperties = { background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontWeight: 600 }
const trashBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.6 }
const errorBox: React.CSSProperties = { background: '#c0222a', color: '#fff', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }
