import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ROLES = [
  { value: 'admin', label: 'Admin - full access, can manage users' },
  { value: 'staff', label: 'Staff - full day to day access' },
  { value: 'warehouse', label: 'Warehouse - goods in/out and returns' },
  { value: 'supplier', label: 'Supplier - their own brand only' },
]

export default function Admin() {
  const { profile, org, isAdmin } = useAuth()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const [m, i, s] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, email, job_title, role, is_active')
        .eq('org_id', org.id)
        .order('created_at'),
      supabase.from('org_invitations')
        .select('id, email, role, status, token, created_at')
        .eq('org_id', org.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name').order('name'),
    ])
    setMembers(m.data ?? [])
    setInvites(i.data ?? [])
    setSuppliers(s.data ?? [])
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  async function handleInvite() {
    if (!email.trim()) {
      setStatus({ type: 'err', text: 'Enter an email address.' })
      return
    }
    if (role === 'supplier' && !supplierId) {
      setStatus({ type: 'err', text: 'Choose which supplier this person belongs to.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await supabase.from('org_invitations').insert({
      org_id: org.id,
      email: email.trim().toLowerCase(),
      role,
      supplier_id: role === 'supplier' ? supplierId : null,
      invited_by: profile.id,
    })
    setBusy(false)
    if (error) {
      setStatus({ type: 'err', text: error.message })
    } else {
      setEmail('')
      setSupplierId('')
      setStatus({ type: 'ok', text: 'Invitation created - copy the link and send it over.' })
      load()
    }
  }

  async function revoke(id) {
    await supabase.from('org_invitations').update({ status: 'revoked' }).eq('id', id)
    load()
  }

  function inviteLink(token) {
    return `${window.location.origin}/join?token=${token}`
  }

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(inviteLink(token))
      setStatus({ type: 'ok', text: 'Invitation link copied.' })
    } catch {
      setStatus({ type: 'err', text: 'Could not copy - select the link and copy it manually.' })
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h2 className="page-title">Users</h2>
          <p className="page-desc">Only owners and admins can manage users for this business.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h2 className="page-title">Users</h2>
        <p className="page-desc">
          Invite your team, your warehouse, and your suppliers. Everyone you invite joins
          {org?.name ? ` ${org.name}` : ' this business'} and sees only its data.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Invite someone</h3>
        <div className="form-row">
          <div className="field" style={{ flex: '2 1 220px', marginBottom: 0 }}>
            <label htmlFor="inv-email">Email</label>
            <input
              id="inv-email"
              className="input"
              type="email"
              placeholder="name@business.com.au"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '2 1 220px', marginBottom: 0 }}>
            <label htmlFor="inv-role">Role</label>
            <select
              id="inv-role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {role === 'supplier' && (
            <div className="field" style={{ flex: '2 1 200px', marginBottom: 0 }}>
              <label htmlFor="inv-supplier">Supplier</label>
              <select
                id="inv-supplier"
                className="input"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Choose...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleInvite} disabled={busy}>
              {busy ? 'Creating...' : 'Create invitation'}
            </button>
          </div>
        </div>
        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}
        <div className="placeholder-note">
          Invitation emails aren't being sent automatically yet - copy the link below and send it
          however you like. Automatic emails switch on once Resend is connected.
        </div>
      </div>

      {invites.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Pending invitations</h3>
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Link</th><th></th></tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td><span className="pill">{i.role}</span></td>
                  <td>
                    <button className="linklike" onClick={() => copyLink(i.token)}>
                      Copy link
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" onClick={() => revoke(i.id)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Team</h3>
        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Position</th><th>Email</th><th>Access</th><th>Status</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name || '-'}</td>
                  <td>{m.job_title || '-'}</td>
                  <td>{m.email || '-'}</td>
                  <td><span className="pill">{m.role}</span></td>
                  <td>{m.is_active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
