import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadOrderLines } from '../lib/integrations'
import Modal from '../components/Modal'

const REASONS = [
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

const STATUSES = ['requested', 'approved', 'received', 'refunded', 'rejected']

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function Returns() {
  const { profile } = useAuth()
  const [returns, setReturns] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, l] = await Promise.all([
      supabase.from('returns')
        .select('id, rma_number, order_number, return_date, reason, status, returned_to_location_id, locations:returned_to_location_id(name), profiles:logged_by(full_name)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('locations').select('id, name').eq('is_active', true).order('name'),
    ])
    if (r.error) setStatus({ type: 'err', text: r.error.message })
    setReturns(r.data ?? [])
    setLocations(l.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function updateStatus(id, newStatus) {
    const { error } = await supabase.from('returns').update({ status: newStatus }).eq('id', id)
    if (error) setStatus({ type: 'err', text: error.message })
    else { setStatus({ type: 'ok', text: 'Return updated.' }); load() }
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
          <button className="btn btn-primary" onClick={() => setCreating(true)}>Log a return</button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : returns.length === 0 ? (
          <div className="empty-state">
            <p>No returns logged yet.</p>
            <p className="page-desc">
              Search an order, pick the items that came back, say where they went and why.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>RMA</th><th>Order</th><th>Returned to</th>
                  <th>Date</th><th>Reason</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-strong">{r.rma_number}</td>
                    <td>{r.order_number ? `#${r.order_number}` : '-'}</td>
                    <td>{r.locations?.name || '-'}</td>
                    <td>{formatDate(r.return_date)}</td>
                    <td>{r.reason || '-'}</td>
                    <td>
                      <select
                        className="mini-select"
                        value={r.status}
                        onChange={(e) => updateStatus(r.id, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn" onClick={() => setViewing(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <LogReturnModal
          locations={locations}
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); setStatus({ type: 'ok', text: 'Return logged.' }); load() }}
        />
      )}

      {viewing && <ReturnDetailModal ret={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Log a return: find the order, pick the items, say where and why.
// ---------------------------------------------------------------------------
function LogReturnModal({ locations, profile, onClose, onSaved }) {
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
        status: 'requested',
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
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
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
        <div><span className="detail-label">Returned to</span>{ret.locations?.name || '-'}</div>
        <div><span className="detail-label">Date</span>{formatDate(ret.return_date)}</div>
        <div><span className="detail-label">Logged by</span>{ret.profiles?.full_name || '-'}</div>
        <div><span className="detail-label">Status</span>{ret.status}</div>
        <div><span className="detail-label">Reason</span>{ret.reason || '-'}</div>
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
