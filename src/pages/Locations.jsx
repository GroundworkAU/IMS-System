import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { platformInfo } from '../lib/platforms'
import { Link } from 'react-router-dom'

const EMPTY = { name: '', type: 'physical', external_refs: {}, address: '', is_active: true }

const TYPES = [
  { value: 'physical', label: 'Physical store' },
  { value: 'online', label: 'Online store' },
]

const typeLabel = (v) => TYPES.find((t) => t.value === v)?.label ?? v

export default function Locations() {
  const { profile, org } = useAuth()
  const orgPlatforms = org?.platforms ?? []
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, type, external_refs, address, is_active')
      .order('name')
    if (error) setStatus({ type: 'err', text: error.message })
    setLocations(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">Locations</h2>
        <p className="page-desc">
          Everywhere you hold stock, physical or online. Stock is counted per location, and
          orders are allocated across them.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Your locations</h3>
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
                  <th>Status</th><th></th>
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
                        Object.entries(l.external_refs).map(([key, val]) => (
                          <div key={key} className="ref-line">
                            <span className="ref-name">{platformInfo(key).label}</span>
                            <code className="code-ref">{val}</code>
                          </div>
                        ))
                      ) : (
                        <span className="cell-sub">Not linked</span>
                      )}
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
          busy={busy}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function LocationModal({ initial, id, orgPlatforms, busy, onClose, onSave }) {
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
            return (
              <div className="field" key={key}>
                <label htmlFor={`l-ref-${key}`}>{info.refLabel}</label>
                <input
                  id={`l-ref-${key}`}
                  className="input"
                  placeholder="Optional for now"
                  value={v.external_refs?.[key] ?? ''}
                  onChange={setRef(key)}
                />
                <p className="field-hint">{info.refHint}</p>
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
