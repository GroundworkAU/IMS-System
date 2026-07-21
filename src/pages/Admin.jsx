import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'

const INVITE_ROLES = [
  { value: 'admin', label: 'Admin - full access, can manage users' },
  { value: 'staff', label: 'Staff - full day to day access' },
  { value: 'warehouse', label: 'Warehouse - goods in/out and returns' },
  { value: 'supplier', label: 'Supplier - their own brand only' },
]

export default function Admin() {
  const { profile, org, isAdmin, refresh } = useAuth()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

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

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join?token=${token}`)
      setStatus({ type: 'ok', text: 'Invitation link copied.' })
    } catch {
      setStatus({ type: 'err', text: 'Could not copy - select the link and copy it manually.' })
    }
  }

  async function saveMember(values) {
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: values.full_name.trim() || null,
        job_title: values.job_title.trim() || null,
        role: values.role,
        is_active: values.is_active,
      })
      .eq('id', editing.id)
    setBusy(false)
    if (error) {
      setStatus({ type: 'err', text: error.message })
    } else {
      setEditing(null)
      setStatus({ type: 'ok', text: 'Details updated.' })
      load()
      if (editing.id === profile.id) refresh()
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
            <label htmlFor="inv-role">Access level</label>
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {INVITE_ROLES.map((r) => (
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
              {busy ? 'Working...' : 'Create invitation'}
            </button>
          </div>
        </div>
        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}
        <div className="placeholder-note">
          Invitation emails aren't sent automatically yet - copy the link and send it however you
          like. Automatic emails switch on once Resend is connected.
        </div>
      </div>

      {invites.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Pending invitations</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Email</th><th>Access</th><th>Link</th><th></th></tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td><span className="pill">{i.role}</span></td>
                    <td>
                      <button className="linklike" onClick={() => copyLink(i.token)}>Copy link</button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn" onClick={() => revoke(i.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Team</h3>
        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Position</th><th>Email</th>
                  <th>Access</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  // Only an owner can edit the owner's record.
                  const locked = m.role === 'owner' && profile.role !== 'owner'
                  return (
                    <tr key={m.id} className={m.is_active ? '' : 'row-muted'}>
                      <td>
                        {m.full_name || '-'}
                        {m.id === profile.id && <span className="you-tag">you</span>}
                      </td>
                      <td>{m.job_title || '-'}</td>
                      <td>{m.email || '-'}</td>
                      <td><span className="pill">{m.role}</span></td>
                      <td>{m.is_active ? 'Active' : 'Deactivated'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {!locked && (
                          <button className="btn" onClick={() => setEditing(m)}>Edit</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditMemberModal
          member={editing}
          isSelf={editing.id === profile.id}
          currentUserRole={profile.role}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveMember}
        />
      )}
    </div>
  )
}

function EditMemberModal({ member, isSelf, currentUserRole, busy, onClose, onSave }) {
  const [values, setValues] = useState({
    full_name: member.full_name ?? '',
    job_title: member.job_title ?? '',
    role: member.role,
    is_active: member.is_active,
  })

  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value })

  const roleOptions = [
    ...(currentUserRole === 'owner' ? [{ value: 'owner', label: 'Owner' }] : []),
    { value: 'admin', label: 'Admin' },
    { value: 'staff', label: 'Staff' },
    { value: 'warehouse', label: 'Warehouse' },
    { value: 'supplier', label: 'Supplier' },
  ]

  return (
    <Modal
      title={`Edit ${member.full_name || member.email}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(values)} disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="e-name">Full name</label>
        <input id="e-name" className="input" value={values.full_name} onChange={set('full_name')} />
      </div>

      <div className="field">
        <label htmlFor="e-title">Job title or position</label>
        <input id="e-title" className="input" value={values.job_title} onChange={set('job_title')} />
      </div>

      <div className="field">
        <label htmlFor="e-role">Access level</label>
        <select
          id="e-role"
          className="input"
          value={values.role}
          onChange={set('role')}
          disabled={isSelf}
        >
          {roleOptions.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {isSelf && (
          <p className="field-hint">
            You can't change your own access level. Ask another owner or admin to do it.
          </p>
        )}
      </div>

      {!isSelf && (
        <div className="field">
          <label>Status</label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(e) => setValues({ ...values, is_active: e.target.checked })}
            />
            <span>
              Active. Untick to remove their access without deleting their history.
            </span>
          </label>
        </div>
      )}

      <p className="field-hint">
        Email addresses can't be changed here - the person signs in with theirs, so they'd need
        to be invited again under a new address.
      </p>
    </Modal>
  )
}
