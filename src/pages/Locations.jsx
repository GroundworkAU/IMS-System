import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { platformInfo } from '../lib/platforms'
import { fetchPlatformLocations } from '../lib/integrations'
import { Link } from 'react-router-dom'

const EMPTY = { name: '', type: 'physical', external_refs: {}, address: '', stock_source: '', is_active: true }

const TYPES = [
  { value: 'physical', label: 'Physical store' },
  { value: 'online', label: 'Online store' },
]

const typeLabel = (v) => TYPES.find((t) => t.value === v)?.label ?? v

export default function Locations({ embedded = false }) {
  const { profile, org } = useAuth()
  const orgPlatforms = org?.platforms ?? []
  const [locations, setLocations] = useState([])
  const [settings, setSettings] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)
  const [remote, setRemote] = useState({})   // { provider: {loading, options, error, unsupported} }

  const load = useCallback(async () => {
    setLoading(true)
    const [l, i] = await Promise.all([
      supabase.from('locations')
        .select('id, name, type, external_refs, address, stock_source, is_active')
        .order('name'),
      supabase.from('integration_settings').select('provider, status'),
    ])
    if (l.error) setStatus({ type: 'err', text: l.error.message })
    setLocations(l.data ?? [])
    setSettings(i.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Pull the location lists from any platform that is connected, so the user
  // can pick from a dropdown rather than typing an id.
  useEffect(() => {
    let cancelled = false
    async function loadRemote() {
      const connected = (settings ?? []).filter((s) => s.status === 'connected')
      for (const s of connected) {
        setRemote((r) => ({ ...r, [s.provider]: { loading: true } }))
        const res = await fetchPlatformLocations(s.provider)
        if (cancelled) return
        setRemote((r) => ({
          ...r,
          [s.provider]: {
            loading: false,
            options: res.locations ?? [],
            unsupported: res.unsupported ?? false,
            error: res.ok === false ? res.error : null,
          },
        }))
      }
    }
    if (settings.length) loadRemote()
    return () => { cancelled = true }
  }, [settings])

  async function save(values, id) {
    if (!values.name.trim()) {
      setStatus({ type: 'err', text: 'Give the location a name.' })
      return
    }
    setBusy(true)
    // Online stores have no street address, and we only keep references for
    // platforms this business actually uses.
    const refs = {}
    for (const key of orgPlatforms) {
      const val = (values.external_refs?.[key] ?? '').trim()
      if (val) refs[key] = val
    }
    const payload = {
      name: values.name.trim(),
      type: values.type,
      external_refs: refs,
      stock_source: values.stock_source || null,
      address: values.type === 'online' ? null : (values.address.trim() || null),
      is_active: values.is_active,
    }
    const { error } = id
      ? await supabase.from('locations').update(payload).eq('id', id)
      : await supabase.from('locations').insert({ ...payload, org_id: profile.org_id })
    setBusy(false)
    if (error) {
      setStatus({
        type: 'err',
        text: error.code === '23505'
          ? 'You already have a location with that name.'
          : error.message,
      })
    } else {
      setModal(null)
      setStatus({ type: 'ok', text: id ? 'Location updated.' : 'Location added.' })
      load()
    }
  }

  async function remove(l) {
    if (!window.confirm(`Remove ${l.name}? This cannot be undone.`)) return
    const { error } = await supabase.from('locations').delete().eq('id', l.id)
    if (error) {
      setStatus({
        type: 'err',
        text: 'That location is used on existing orders or stock, so it cannot be removed. Mark it inactive instead.',
      })
    } else {
      setStatus({ type: 'ok', text: 'Location removed.' })
      load()
    }
  }

  return (
    <div>
      {!embedded && (
        <div className="page-head">
          <div className="eyebrow">Inventory</div>
          <h2 className="page-title">Locations</h2>
          <p className="page-desc">
            Everywhere you hold stock, physical or online. Stock is counted per location, and
            orders are allocated across them.
          </p>
        </div>
      )}

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className={embedded ? '' : 'card'}>
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>
            {embedded ? 'Locations' : 'Your locations'}
          </h3>
          <button className="btn btn-primary" onClick={() => setModal({ values: { ...EMPTY }, id: null })}>
            Add location
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : locations.length === 0 ? (
          <div className="empty-state">
            <p>No locations yet.</p>
            <p className="page-desc">
              Add each place you hold stock. If you use Lightspeed, adding its outlet reference
              here lets stock line up between the two systems later.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Location</th><th>Type</th><th>Linked to</th>
                  <th>Stock from</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} className={l.is_active ? '' : 'row-muted'}>
                    <td>
                      <div className="cell-strong">{l.name}</div>
                      {l.address && <div className="cell-sub">{l.address}</div>}
                    </td>
                    <td><span className="pill">{typeLabel(l.type)}</span></td>
                    <td>
                      {Object.keys(l.external_refs ?? {}).length > 0 ? (
                        Object.entries(l.external_refs).map(([key, val]) => {
                          const match = remote?.[key]?.options?.find((o) => o.id === val)
                          return (
                            <div key={key} className="ref-line">
                              <span className="ref-name">{platformInfo(key).label}</span>
                              {match
                                ? <span className="cell-strong">{match.name}</span>
                                : <code className="code-ref">{val}</code>}
                            </div>
                          )
                        })
                      ) : (
                        <span className="cell-sub">Not linked</span>
                      )}
                    </td>
                    <td>
                      {l.stock_source
                        ? <span className="pill">{platformInfo(l.stock_source).label}</span>
                        : <span className="cell-sub">Manual</span>}
                    </td>
                    <td>{l.is_active ? 'Active' : 'Inactive'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn"
                        onClick={() =>
                          setModal({
                            values: { ...EMPTY, ...l, external_refs: l.external_refs ?? {} },
                            id: l.id,
                          })
                        }
                      >
                        Edit
                      </button>{' '}
                      <button className="btn btn-quiet" onClick={() => remove(l)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <LocationModal
          initial={modal.values}
          id={modal.id}
          orgPlatforms={orgPlatforms}
          remote={remote}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function LocationModal({ initial, id, orgPlatforms, remote, busy, onClose, onSave }) {
  const [v, setV] = useState(initial)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const setRef = (key) => (e) =>
    setV({ ...v, external_refs: { ...(v.external_refs ?? {}), [key]: e.target.value } })

  return (
    <Modal
      title={id ? 'Edit location' : 'Add location'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(v, id)} disabled={busy}>
            {busy ? 'Saving...' : id ? 'Save changes' : 'Add location'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="l-name">Location name</label>
        <input id="l-name" className="input" value={v.name} onChange={set('name')} autoFocus />
      </div>

      <div className="field">
        <label htmlFor="l-type">Type</label>
        <select id="l-type" className="input" value={v.type} onChange={set('type')}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {v.type === 'physical' && (
        <div className="field">
          <label htmlFor="l-address">Address</label>
          <input id="l-address" className="input" value={v.address ?? ''} onChange={set('address')} />
        </div>
      )}

      {orgPlatforms.length > 0 ? (
        <>
          <h4 className="sub-label">Linked systems (optional)</h4>
          {orgPlatforms.map((key) => {
            const info = platformInfo(key)
            const r = remote?.[key]
            const current = v.external_refs?.[key] ?? ''
            const options = r?.options ?? []
            // If the saved value is not in the fetched list, keep it visible.
            const missing = current && !options.some((o) => o.id === current)

            return (
              <div className="field" key={key}>
                <label htmlFor={`l-ref-${key}`}>{info.refLabel}</label>

                {r?.loading ? (
                  <p className="field-hint">Loading locations from {info.label}...</p>
                ) : options.length > 0 ? (
                  <>
                    <select
                      id={`l-ref-${key}`}
                      className="input"
                      value={current}
                      onChange={setRef(key)}
                    >
                      <option value="">Not linked</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}{o.detail ? ` ~ ${o.detail}` : ''}
                        </option>
                      ))}
                      {missing && (
                        <option value={current}>{current} (no longer in {info.label})</option>
                      )}
                    </select>
                    <p className="field-hint">
                      Pulled live from {info.label}. Pick the one this location matches.
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      id={`l-ref-${key}`}
                      className="input"
                      placeholder="Optional for now"
                      value={current}
                      onChange={setRef(key)}
                    />
                    <p className="field-hint">
                      {r?.unsupported
                        ? `${info.label} is not returning a location list on your plan, so enter the reference by hand.`
                        : r?.error
                          ? `Could not load locations from ${info.label}: ${r.error}`
                          : info.refHint}
                    </p>
                  </>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <p className="field-hint" style={{ marginBottom: 16 }}>
          Tell us which systems you use in <Link className="linklike" to="/settings">Settings</Link>{' '}
          and you'll be able to link this location to them.
        </p>
      )}

      {orgPlatforms.length > 0 && (
        <div className="field">
          <label htmlFor="l-stock">Stock figures come from</label>
          <select
            id="l-stock"
            className="input"
            value={v.stock_source ?? ''}
            onChange={set('stock_source')}
          >
            <option value="">Not synced ~ managed by hand</option>
            {orgPlatforms
              .filter((k) => k !== 'other')
              .map((k) => (
                <option key={k} value={k}>{platformInfo(k).label}</option>
              ))}
          </select>
          <p className="field-hint">
            Which system reports the stock held here. If your online stock is really held in
            your point of sale and only mirrored to the web store, pick the point of sale ~ it
            is the one that knows the truth.
          </p>
        </div>
      )}

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={v.is_active}
            onChange={(e) => setV({ ...v, is_active: e.target.checked })}
          />
          <span>Active. Untick to stop new stock being allocated here.</span>
        </label>
      </div>
    </Modal>
  )
}
