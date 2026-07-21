import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PLATFORMS } from '../lib/platforms'
import ConnectionCard from '../components/ConnectionCard'
import Locations from './Locations'
import SyncFilters from '../components/SyncFilters'

export default function Settings() {
  const { org, isAdmin, refresh } = useAuth()
  const [name, setName] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [settings, setSettings] = useState([])
  const [counters, setCounters] = useState([])
  const [catalogueSource, setCatalogueSource] = useState('')
  const [tidying, setTidying] = useState(false)

  const KINDS = [
    { kind: 'restock_request', label: 'Restock requests', example: 'RS-0001' },
    { kind: 'restock_order', label: 'Restock orders', example: 'RO-0001' },
    { kind: 'return', label: 'Returns', example: 'RMA-0001' },
    { kind: 'issue', label: 'Order issues', example: 'ISS-0001' },
  ]

  const loadCounters = async () => {
    const { data } = await supabase
      .from('reference_counters')
      .select('kind, prefix, padding, next_number')
    setCounters(data ?? [])
  }

  const counterFor = (kind) =>
    counters.find((c) => c.kind === kind) ?? { prefix: '', padding: 4, next_number: 1 }

  async function saveCounter(kind, patch) {
    const current = counterFor(kind)
    const { error } = await supabase.from('reference_counters').upsert(
      {
        org_id: org.id,
        kind,
        prefix: patch.prefix ?? current.prefix,
        padding: current.padding,
        next_number: patch.next_number ?? current.next_number,
      },
      { onConflict: 'org_id,kind' }
    )
    if (error) setStatus({ type: 'err', text: error.message })
    else loadCounters()
  }

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
      setCatalogueSource(org.catalogue_source ?? '')
      loadSettings()
      loadCounters()
    }
  }, [org])

  function toggle(value) {
    setPlatforms((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value]))
  }

  // Clears out products brought in from a platform that no longer owns the
  // catalogue, which is what leaves duplicates behind after switching.
  async function tidyDuplicates() {
    if (!window.confirm(
      'Remove products that came from other systems? Their stock records go with them. ' +
      'Anything already on a restock line keeps its line, but loses the product link.'
    )) return

    setTidying(true)
    setStatus(null)
    const { data, error } = await supabase
      .from('products')
      .delete()
      .neq('external_source', catalogueSource)
      .not('external_source', 'is', null)
      .select('id')

    setTidying(false)
    if (error) setStatus({ type: 'err', text: error.message })
    else {
      setStatus({
        type: 'ok',
        text: `Removed ${data?.length ?? 0} product${data?.length === 1 ? '' : 's'} from other systems.`,
      })
    }
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
      .update({
        name: name.trim(),
        platforms,
        catalogue_source: catalogueSource || null,
      })
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

      {connectable.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Where your products come from</h3>
          <p className="page-desc" style={{ marginBottom: 14 }}>
            Only one system brings products in. If the same product is sold on two platforms it
            would otherwise arrive twice, once under each platform's own id.
          </p>

          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="cat-source">Catalogue source</label>
            <select
              id="cat-source"
              className="input"
              value={catalogueSource}
              onChange={(e) => setCatalogueSource(e.target.value)}
            >
              <option value="">Not set ~ products will not sync</option>
              {connectable.map((p) => (
                <option key={p} value={p}>{PLATFORMS.find((x) => x.value === p)?.label ?? p}</option>
              ))}
            </select>
            <p className="field-hint">
              Other systems keep doing what they are best at ~ orders, customers and refunds.
              Remember to save after changing this.
            </p>
          </div>

          {catalogueSource && (
            <div className="placeholder-note">
              Products already brought in from another system stay put.{' '}
              <button className="linklike" onClick={tidyDuplicates} disabled={tidying}>
                {tidying ? 'Removing...' : 'Remove products from other systems'}
              </button>
            </div>
          )}
        </div>
      )}

      {connectable.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="section-title">What to sync</h3>
          <SyncFilters orgId={org?.id} providers={connectable} />
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="page-desc" style={{ marginBottom: 14 }}>
          Everywhere you hold stock. Link each one to the systems you use so stock and transfers
          line up, and say which system reports its stock.
        </p>
        <Locations embedded />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Reference numbers</h3>
        <p className="page-desc" style={{ marginBottom: 14 }}>
          The prefix used when something is raised, followed by a number that counts up. Change
          the prefix to whatever your team already says out loud.
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Record</th><th>Prefix</th><th>Next number</th><th>Looks like</th></tr>
            </thead>
            <tbody>
              {KINDS.map((k) => {
                const c = counterFor(k.kind)
                return (
                  <tr key={k.kind}>
                    <td className="cell-strong">{k.label}</td>
                    <td>
                      <input
                        className="input mini"
                        style={{ width: 90 }}
                        defaultValue={c.prefix}
                        placeholder={k.example.split('-')[0] + '-'}
                        onBlur={(e) => saveCounter(k.kind, { prefix: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input mini"
                        style={{ width: 80 }}
                        type="number"
                        min="1"
                        defaultValue={c.next_number}
                        onBlur={(e) =>
                          saveCounter(k.kind, { next_number: Number(e.target.value) || 1 })
                        }
                      />
                    </td>
                    <td>
                      <code className="code-ref">
                        {(c.prefix || '') + String(c.next_number).padStart(c.padding ?? 4, '0')}
                      </code>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="field-hint">
          Changing the next number is handy when moving off an old system ~ set it to carry on
          from where you left off.
        </p>
      </div>

      <button className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving...' : 'Save settings'}
      </button>
    </div>
  )
}
