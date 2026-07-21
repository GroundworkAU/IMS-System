import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Onboarding() {
  const { user, refresh, signOut } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your business a name to continue.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('create_organisation', { org_name: name.trim() })
    setBusy(false)
    if (error) setError(error.message)
    else await refresh()
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: '#17201f' }}>IMS System</div>
            <div className="brand-sub" style={{ color: '#6a7570' }}>Inventory management</div>
          </div>
        </div>

        <h1 className="auth-title">Set up your business</h1>
        <p className="auth-sub">
          You're signed in as {user?.email}. Create your business to get started - you'll be
          the owner and can invite your team afterwards.
        </p>

        <div className="field">
          <label htmlFor="orgname">Business name</label>
          <input
            id="orgname"
            className="input"
            placeholder="e.g. Port Adelaide Football Club"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleCreate}
          disabled={busy}
        >
          {busy ? 'Creating...' : 'Create business'}
        </button>

        {error && <div className="auth-msg err">{error}</div>}

        <p className="auth-sub" style={{ marginTop: 18, marginBottom: 0, fontSize: 12 }}>
          Been invited to an existing business? Use the link from your invitation email instead.{' '}
          <button
            className="linklike"
            onClick={signOut}
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  )
}
