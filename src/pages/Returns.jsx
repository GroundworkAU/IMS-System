import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadOrderLines, syncOrders } from '../lib/integrations'
import Modal from '../components/Modal'

const DEFAULT_REASONS = [
  'Wrong size',
  'Wrong item sent',
  'Faulty or damaged',
  'Not as described',
  'Changed mind',
  'Arrived late',
  'Other',
]

const CONDITIONS = [
  { value: 'resalable', label: 'Resalable' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'faulty', label: 'Faulty' },
]

const platformUrl = {
  bigcommerce: (cfg, extId) =>
    cfg?.store_hash ? `https://store-${cfg.store_hash}.mybigcommerce.com/manage/orders/${extId}` : null,
  shopify: (cfg, extId) =>
    cfg?.shop_domain ? `https://${cfg.shop_domain}/admin/orders/${extId}` : null,
}

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function Returns() {
  const { profile, isAdmin } = useAuth()
  const [returns, setReturns] = useState([])
  const [locations, setLocations] = useState([])
  const [integrations, setIntegrations] = useState([])
  const [reasons, setReasons] = useState([])
  const [managingReasons, setManagingReasons] = useState(false)
  const [checking, setChecking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, l, i, rr] = await Promise.all([
      supabase.from('returns')
        .select(`id, rma_number, order_number, return_date, reason, status, created_at,
                 refunded_at, refund_source, returned_to_location_id,
                 locations:returned_to_location_id(name),
                 profiles:logged_by(full_name),
                 orders(id, order_date, external_order_id,
                        sales_channels(platform),
                        customers(first_name, last_name, email))`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('locations').select('id, name').eq('is_active', true).order('name'),
      supabase.from('integration_settings').select('provider, config, status'),
      supabase.from('return_reasons')
        .select('id, label, sort_order, is_active')
        .order('sort_order').order('label'),
    ])
    if (r.error) setStatus({ type: 'err', text: r.error.message })
    setReturns(r.data ?? [])
    setLocations(l.data ?? [])
    setIntegrations(i.data ?? [])
    setReasons(rr.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function markRefunded(r) {
    const { error } = await supabase
      .from('returns')
      .update({
        status: 'refunded',
        refunded_at: new Date().toISOString(),
        refund_source: 'manual',
      })
      .eq('id', r.id)
    if (error) setStatus({ type: 'err', text: error.message })
    else { setStatus({ type: 'ok', text: `${r.rma_number} marked as refunded.` }); load() }
  }

  async function reopen(r) {
    const { error } = await supabase
      .from('returns')
      .update({ status: 'open', refunded_at: null, refund_source: null })
      .eq('id', r.id)
    if (error) setStatus({ type: 'err', text: error.message })
    else load()
  }

  // Re-syncs orders, which also picks up any refunds processed on the platform.
  async function checkRefunds() {
    setChecking(true)
    setStatus(null)
    const res = await syncOrders('bigcommerce')
    setChecking(false)
    if (!res.ok) return setStatus({ type: 'err', text: res.error || 'Could not check.' })
    setStatus({
      type: 'ok',
      text: res.autoClosed > 0
        ? `${res.autoClosed} return${res.autoClosed === 1 ? '' : 's'} marked as refunded.`
        : 'Checked. No new refunds found.',
    })
    load()
  }

  function adminLink(r) {
    const platform = r.orders?.sales_channels?.platform
    const cfg = integrations.find((i) => i.provider === platform)?.config
    const build = platformUrl[platform]
    return build && r.orders?.external_order_id ? build(cfg, r.orders.external_order_id) : null
  }

  const customerName = (r) => {
    const c = r.orders?.customers
    if (!c) return '-'
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '-'
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Service</div>
        <h2 className="page-title">Returns</h2>
        <p className="page-desc">
          Log what has come back, where it went, and why. Anyone on the team or at the warehouse
          can raise one against a real order.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Logged returns</h3>
          <div className="search-wrap">
            {isAdmin && (
              <button className="btn" onClick={() => setManagingReasons(true)}>
                Return reasons
              </button>
            )}
            <button className="btn" onClick={checkRefunds} disabled={checking}>
              {checking ? 'Checking...' : 'Check for refunds'}
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Log a return
            </button>
          </div>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : returns.length === 0 ? (
          <div className="empty-state">
            <p>No returns logged yet.</p>
            <p className="page-desc">
              Search an order, pick the items that came back, say why and when.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>Returned</th>
                  <th>Logged</th><th>Reason</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => {
                  const link = adminLink(r)
                  return (
                    <tr key={r.id}>
                      <td className="cell-strong">
                        {r.order_number ? `#${r.order_number}` : '-'}
                      </td>
                      <td>{customerName(r)}</td>
                      <td>{formatDate(r.return_date)}</td>
                      <td>
                        <div>{formatDate(r.created_at)}</div>
                        <div className="cell-sub">by {r.profiles?.full_name || 'Unknown'}</div>
                      </td>
                      <td>{r.reason || '-'}</td>
                      <td>
                        {r.status === 'refunded' ? (
                          <span
                            className="status-pill ok"
                            title={
                              r.refund_source === 'platform'
                                ? 'Detected automatically from the sales platform'
                                : 'Marked by a team member'
                            }
                          >
                            Refunded
                          </span>
                        ) : r.status === 'cancelled' ? (
                          <span className="status-pill neutral">Cancelled</span>
                        ) : (
                          <span className="status-pill warn">Open</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.status === 'open' ? (
                          <>
                            {link && (
                              <a
                                className="btn"
                                href={link}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Refund order
                              </a>
                            )}{' '}
                            <button className="btn btn-quiet" onClick={() => markRefunded(r)}>
                              Mark refunded
                            </button>{' '}
                          </>
                        ) : (
                          <button className="btn btn-quiet" onClick={() => reopen(r)}>Reopen</button>
                        )}{' '}
                        <button className="btn" onClick={() => setViewing(r)}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <LogReturnModal
          locations={locations}
          reasons={reasons.filter((r) => r.is_active)}
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); setStatus({ type: 'ok', text: 'Return logged.' }); load() }}
        />
      )}

      {managingReasons && (
        <ReasonsModal
          reasons={reasons}
          profile={profile}
          onClose={() => setManagingReasons(false)}
          onChanged={load}
        />
      )}

      {viewing && <ReturnDetailModal ret={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Log a return: find the order, pick the items, say where and why.
// ---------------------------------------------------------------------------
function LogReturnModal({ locations, reasons, profile, onClose, onSaved }) {
  const [step, setStep] = useState('find')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [order, setOrder] = useState(null)
  const [lines, setLines] = useState([])
  const [selected, setSelected] = useState({})   // { lineId: { qty, condition } }
  const [locationId, setLocationId] = useState('')
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, order_date, total, raw, customers(first_name, last_name, email)')
      .ilike('order_number', `%${query.trim()}%`)
      .order('order_date', { ascending: false })
      .limit(10)
    setResults(data ?? [])
    setSearching(false)
  }

  async function chooseOrder(o) {
    setOrder(o)
    setStep('items')
    const res = await loadOrderLines(o.id)
    if (res.ok) setLines(res.lines ?? [])
    else setError(res.error)
  }

  function toggleLine(line) {
    setSelected((s) => {
      const next = { ...s }
      if (next[line.id]) delete next[line.id]
      else next[line.id] = { qty: line.qty, condition: 'resalable' }
      return next
    })
  }

  async function save() {
    const chosen = Object.entries(selected)
    if (chosen.length === 0) return setError('Pick at least one item that came back.')
    if (!locationId) return setError('Say where the return came back to.')
    if (!reason) return setError('Choose a reason for the return.')

    setBusy(true)
    setError(null)

    const rma = 'RMA-' + Date.now().toString(36).toUpperCase()

    const { data: created, error: rErr } = await supabase
      .from('returns')
      .insert({
        org_id: profile.org_id,
        rma_number: rma,
        order_id: order.id,
        order_number: order.order_number,
        returned_to_location_id: locationId,
        return_date: returnDate,
        reason: note.trim() ? `${reason} ~ ${note.trim()}` : reason,
        status: 'open',
        logged_by: profile.id,
      })
      .select('id')
      .single()

    if (rErr) { setBusy(false); return setError(rErr.message) }

    const rows = chosen.map(([lineId, v]) => {
      const line = lines.find((l) => String(l.id) === String(lineId))
      return {
        org_id: profile.org_id,
        return_id: created.id,
        order_line_id: lineId,
        variant_id: line?.variant_id ?? null,
        qty: Number(v.qty) || 1,
        condition: v.condition,
      }
    })

    const { error: lErr } = await supabase.from('return_lines').insert(rows)
    setBusy(false)
    if (lErr) return setError(lErr.message)
    onSaved()
  }

  return (
    <Modal
      title="Log a return"
      onClose={onClose}
      footer={
        step === 'items' ? (
          <>
            <button className="btn" onClick={() => setStep('find')}>Back</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving...' : 'Log return'}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>Cancel</button>
        )
      }
    >
      {step === 'find' && (
        <>
          <div className="field">
            <label htmlFor="r-search">Order number</label>
            <div className="search-wrap">
              <input
                id="r-search"
                className="input"
                placeholder="e.g. 10482"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              <button className="btn" onClick={search} disabled={searching}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
            <p className="field-hint">
              Orders come from BigCommerce. If you cannot find one, sync orders on the Customer
              Service page first.
            </p>
          </div>

          {results.length > 0 && (
            <div className="result-list">
              {results.map((o) => (
                <button key={o.id} className="result-row" onClick={() => chooseOrder(o)}>
                  <span>
                    <strong>#{o.order_number}</strong>
                    <span className="cell-sub">
                      {[o.customers?.first_name, o.customers?.last_name].filter(Boolean).join(' ') ||
                        o.raw?.billing_name || 'Guest'}
                    </span>
                  </span>
                  <span className="cell-sub">{formatDate(o.order_date)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'items' && order && (
        <>
          <div className="chosen-order">
            <strong>#{order.order_number}</strong>
            <span className="cell-sub">
              {[order.customers?.first_name, order.customers?.last_name].filter(Boolean).join(' ') ||
                order.raw?.billing_name || 'Guest'} · {formatDate(order.order_date)}
            </span>
          </div>

          <h4 className="sub-label">What came back?</h4>
          {lines.length === 0 ? (
            <p className="field-hint">Loading items from the order...</p>
          ) : (
            <div className="line-picker">
              {lines.map((l) => {
                const chosen = selected[l.id]
                return (
                  <div key={l.id} className={'line-row' + (chosen ? ' selected' : '')}>
                    <label className="check-row">
                      <input type="checkbox" checked={!!chosen} onChange={() => toggleLine(l)} />
                      <span>
                        <span className="cell-strong">{l.name}</span>
                        <span className="cell-sub">{l.sku || 'No SKU'} · ordered {l.qty}</span>
                      </span>
                    </label>

                    {chosen && (
                      <div className="line-controls">
                        <label>
                          Qty
                          <input
                            className="input mini"
                            type="number"
                            min="1"
                            max={l.qty}
                            value={chosen.qty}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                [l.id]: { ...chosen, qty: e.target.value },
                              })
                            }
                          />
                        </label>
                        <label>
                          Condition
                          <select
                            className="input mini"
                            value={chosen.condition}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                [l.id]: { ...chosen, condition: e.target.value },
                              })
                            }
                          >
                            {CONDITIONS.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <h4 className="sub-label">Return details</h4>

          <div className="form-row">
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="r-loc">Returned to</label>
              <select
                id="r-loc"
                className="input"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Choose...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              {locations.length === 0 && (
                <p className="field-hint">
                  No active locations yet. Add them on the Locations page first.
                </p>
              )}
            </div>
            <div className="field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="r-date">Date received</label>
              <input
                id="r-date"
                className="input"
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="r-reason">Reason</label>
            <select
              id="r-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Choose...</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.label}>{r.label}</option>
              ))}
            </select>
            {reasons.length === 0 && (
              <p className="field-hint">
                No reasons set up yet. An owner or admin can add them with the Return reasons
                button on this page.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="r-note">Anything else? (optional)</label>
            <textarea
              id="r-note"
              className="input"
              rows="2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

function ReturnDetailModal({ ret, onClose }) {
  const [lines, setLines] = useState(null)

  useEffect(() => {
    supabase
      .from('return_lines')
      .select('id, qty, condition, order_lines(name, sku)')
      .eq('return_id', ret.id)
      .then(({ data }) => setLines(data ?? []))
  }, [ret])

  return (
    <Modal title={ret.rma_number} onClose={onClose}>
      <div className="detail-grid">
        <div><span className="detail-label">Order</span>{ret.order_number ? `#${ret.order_number}` : '-'}</div>
        <div><span className="detail-label">Order date</span>{formatDate(ret.orders?.order_date)}</div>
        <div><span className="detail-label">Returned to</span>{ret.locations?.name || '-'}</div>
        <div><span className="detail-label">Date returned</span>{formatDate(ret.return_date)}</div>
        <div><span className="detail-label">Logged</span>{formatDate(ret.created_at)}</div>
        <div><span className="detail-label">Logged by</span>{ret.profiles?.full_name || '-'}</div>
        <div><span className="detail-label">Reason</span>{ret.reason || '-'}</div>
        <div>
          <span className="detail-label">Status</span>
          {ret.status === 'refunded'
            ? `Refunded${ret.refund_source === 'platform' ? ' (found on platform)' : ''}`
            : ret.status}
        </div>
      </div>

      <h4 className="sub-label">Items returned</h4>
      {lines === null ? (
        <p className="field-hint">Loading...</p>
      ) : lines.length === 0 ? (
        <p className="field-hint">No items recorded.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Condition</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.order_lines?.name || '-'}</td>
                <td>{l.order_lines?.sku || '-'}</td>
                <td>{l.qty}</td>
                <td>{l.condition || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Manage the list of reasons a return can be logged against.
// ---------------------------------------------------------------------------
function ReasonsModal({ reasons, profile, onClose, onChanged }) {
  const [items, setItems] = useState(reasons)
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function refresh() {
    const { data } = await supabase
      .from('return_reasons')
      .select('id, label, sort_order, is_active')
      .order('sort_order').order('label')
    setItems(data ?? [])
    onChanged()
  }

  async function add() {
    const label = newLabel.trim()
    if (!label) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('return_reasons').insert({
      org_id: profile.org_id,
      label,
      sort_order: items.length,
    })
    setBusy(false)
    if (error) {
      setError(error.code === '23505' ? 'That reason already exists.' : error.message)
    } else {
      setNewLabel('')
      refresh()
    }
  }

  async function addDefaults() {
    setBusy(true)
    setError(null)
    const rows = DEFAULT_REASONS.map((label, i) => ({
      org_id: profile.org_id,
      label,
      sort_order: i,
    }))
    const { error } = await supabase.from('return_reasons').insert(rows)
    setBusy(false)
    if (error) setError(error.message)
    else refresh()
  }

  async function toggle(item) {
    await supabase
      .from('return_reasons')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    refresh()
  }

  async function rename(item, label) {
    if (!label.trim() || label === item.label) return
    const { error } = await supabase
      .from('return_reasons')
      .update({ label: label.trim() })
      .eq('id', item.id)
    if (error) setError(error.code === '23505' ? 'That reason already exists.' : error.message)
    else refresh()
  }

  async function remove(item) {
    if (!window.confirm(`Remove "${item.label}"? Returns already logged keep their reason.`)) return
    const { error } = await supabase.from('return_reasons').delete().eq('id', item.id)
    if (error) setError(error.message)
    else refresh()
  }

  return (
    <Modal
      title="Return reasons"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        These are the options your team picks from when logging a return. Turning one off hides
        it from new returns without changing anything already logged.
      </p>

      {items.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <p>No reasons yet.</p>
          <p className="page-desc">Start with a common set, then adjust to suit.</p>
          <button className="btn btn-primary" onClick={addDefaults} disabled={busy}>
            {busy ? 'Adding...' : 'Add the common ones'}
          </button>
        </div>
      ) : (
        <div className="reason-list">
          {items.map((item) => (
            <div key={item.id} className={'reason-row' + (item.is_active ? '' : ' inactive')}>
              <input
                className="input"
                defaultValue={item.label}
                onBlur={(e) => rename(item, e.target.value)}
              />
              <button
                className="btn"
                onClick={() => toggle(item)}
                title={item.is_active ? 'Hide from new returns' : 'Show again'}
              >
                {item.is_active ? 'On' : 'Off'}
              </button>
              <button className="btn btn-quiet" onClick={() => remove(item)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <h4 className="sub-label">Add a reason</h4>
      <div className="search-wrap">
        <input
          className="input"
          placeholder="e.g. Ordered wrong item"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add} disabled={busy || !newLabel.trim()}>
          Add
        </button>
      </div>

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
