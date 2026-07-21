import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PLATFORMS } from '../lib/platforms'

export default function Onboarding() {
  const { user, profile, refresh, signOut } = useAuth()
  const [name, setName] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const firstName = profile?.full_name?.trim().split(/\s+/)[0]

  function toggle(value) {
    setPlatforms((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value]))
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your business a name to continue.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('create_organisation', {
      org_name: name.trim(),
      org_platforms: platforms,
    })
    setBusy(false)
    if (error) setError(error.message)
    else await refresh()
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: 'var(--dark-brown)' }}>IMS System</div>
            <div className="brand-sub" style={{ color: 'var(--muted)' }}>Inventory management</div>
          </div>
        </div>

        <h1 className="auth-title">
          {firstName ? `Welcome, ${firstName}` : 'Set up your business'}
        </h1>
        <p className="auth-sub">
          You're signed in as {user?.email}. Set your business up and you'll be its owner, ready
          to invite your team.
        </p>

        <div className="field">
          <label htmlFor="orgname">Business name</label>
          <input
            id="orgname"
            className="input"
            placeholder="e.g. Port Adelaide Football Club"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Which systems do you use?</label>
          <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Pick any that apply. This decides which details we ask you for later ~ you can change
            it any time in Settings.
          </p>
          <div className="choice-grid">
            {PLATFORMS.map((p) => (
              <label
                key={p.value}
                className={'choice' + (platforms.includes(p.value) ? ' selected' : '')}
              >
                <input
                  type="checkbox"
                  checked={platforms.includes(p.value)}
                  onChange={() => toggle(p.value)}
                />
                <span>
                  <span className="choice-label">{p.label}</span>
                  <span className="choice-kind">{p.kind}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleCreate}
          disabled={busy}
        >
          {busy ? 'Setting up...' : 'Create business'}
        </button>

        {error && <div className="auth-msg err">{error}</div>}

        <div className="auth-foot">
          <span>
            Been invited to an existing business? Use the link from your invitation instead.{' '}
            <button className="linklike" onClick={signOut}>Sign out</button>
          </span>
        </div>
      </div>
    </div>
  )
}
