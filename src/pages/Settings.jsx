import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PLATFORMS } from '../lib/platforms'
import ConnectionCard from '../components/ConnectionCard'

export default function Settings() {
  const { org, isAdmin, refresh } = useAuth()
  const [name, setName] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [settings, setSettings] = useState([])

  const loadSettings = async () => {
    const { data } = await supabase
      .from('integration_settings')
      .select('provider, variant, status, is_active, last_tested_at, last_error')
    setSettings(data ?? [])
  }

  useEffect(() => {
    if (org) {
      setName(org.name ?? '')
      setPlatforms(org.platforms ?? [])
      loadSettings()
    }
  }, [org])

  function toggle(value) {
    setPlatforms((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value]))
  }

  async function save() {
    if (!name.trim()) {
      setStatus({ type: 'err', text: 'Your business needs a name.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await supabase
      .from('organisations')
      .update({ name: name.trim(), platforms })
      .eq('id', org.id)
    setBusy(false)
    if (error) setStatus({ type: 'err', text: error.message })
    else {
      setStatus({ type: 'ok', text: 'Settings saved.' })
      refresh()
    }
  }

  // 'other' has no API to connect to.
  const connectable = (org?.platforms ?? []).filter((p) => p !== 'other')

  if (!isAdmin) {
    return (
      <div>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h2 className="page-title">Settings</h2>
          <p className="page-desc">Only owners and admins can change business settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h2 className="page-title">Settings</h2>
        <p className="page-desc">
          Your business details and the systems you run. What you choose here decides which
          fields the rest of the app asks you for.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Business</h3>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="org-name">Business name</label>
          <input id="org-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Systems you use</h3>
        <p className="page-desc" style={{ marginBottom: 14 }}>
          Tick the systems your stock and orders live in. For example, if you use Lightspeed,
          each location will ask for its Lightspeed outlet reference so stock lines up between
          the two.
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

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Connections</h3>
        {connectable.length === 0 ? (
          <div className="placeholder-note">
            Tick the systems you use above and save, then you can connect them here.
          </div>
        ) : (
          <>
            <p className="page-desc" style={{ marginBottom: 16 }}>
              Connect each system so products, stock and orders flow through automatically
              instead of being keyed in. Your keys are stored on our server, never in the
              browser, and only owners and admins can change them.
            </p>
            <div className="connection-list">
              {connectable.map((p) => (
                <ConnectionCard
                  key={p}
                  provider={p}
                  setting={settings.find((s) => s.provider === p)}
                  onChanged={loadSettings}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <button className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving...' : 'Save settings'}
      </button>
    </div>
  )
}
