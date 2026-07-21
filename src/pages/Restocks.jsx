import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ProductPicker from '../components/ProductPicker'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

const ref = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`

export default function Restocks() {
  const { profile, org } = useAuth()
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [orders, setOrders] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [creating, setCreating] = useState(false)
  const [fulfilling, setFulfilling] = useState(null)
  const [receiving, setReceiving] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [rq, ro, loc] = await Promise.all([
      supabase.from('restock_requests')
        .select(`id, reference, status, note, created_at,
                 destination:destination_location_id(name),
                 requester:requested_by(full_name),
                 restock_request_lines(id, variant_id, name, sku, qty_requested, qty_fulfilled, note)`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('restock_orders')
        .select(`id, reference, status, note, created_at, external_transfer_id,
                 source:source_location_id(name, external_refs),
                 destination:destination_location_id(name),
                 fulfiller:fulfilled_by(full_name),
                 restock_order_lines(id, name, sku, qty_sent, qty_received, note)`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('locations')
        .select('id, name, type, external_refs')
        .eq('is_active', true).order('name'),
    ])
    if (rq.error) setStatus({ type: 'err', text: rq.error.message })
    setRequests(rq.data ?? [])
    setOrders(ro.data ?? [])
    setLocations(loc.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openRequests = requests.filter((r) => r.status === 'open' || r.status === 'partly_fulfilled')
  const openOrders = orders.filter((o) => ['draft', 'sent', 'discrepancy'].includes(o.status))

  // ---- send a goods inwards to the warehouse -------------------------------
  async function sendGoodsInwards(order) {
    if (!window.confirm(`Send a goods inwards to the warehouse for ${order.reference}?`)) return

    const { data: gi, error: gErr } = await supabase
      .from('goods_inwards')
      .insert({
        org_id: profile.org_id,
        restock_order_id: order.id,
        location_id: order.destination?.id ?? null,
        status: 'submitted',
        submitted_by: profile.id,
        notes: `Restock ${order.reference}`,
      })
      .select('id')
      .single()

    if (gErr) return setStatus({ type: 'err', text: gErr.message })

    const rows = (order.restock_order_lines ?? []).map((l) => ({
      org_id: profile.org_id,
      gi_id: gi.id,
      qty_expected: l.qty_sent,
      qty_received: 0,
      note: l.name,
    }))
    if (rows.length) {
      const { error: lErr } = await supabase.from('goods_inwards_lines').insert(rows)
      if (lErr) return setStatus({ type: 'err', text: lErr.message })
    }

    const { error: uErr } = await supabase
      .from('restock_orders')
      .update({ status: 'sent' })
      .eq('id', order.id)

    if (uErr) setStatus({ type: 'err', text: uErr.message })
    else {
      setStatus({ type: 'ok', text: `Goods inwards sent for ${order.reference}.` })
      load()
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">Restocks</h2>
        <p className="page-desc">
          Ask for stock at a location, then whoever holds it fulfils what they can. Nothing moves
          until a goods inwards is checked off by the receiving team.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Open requests</div>
          <div className="stat-value">{openRequests.length}</div>
          <div className="stat-note">Waiting to be fulfilled</div>
        </div>
        <div className="card">
          <div className="stat-label">Restock orders in progress</div>
          <div className="stat-value">{openOrders.length}</div>
          <div className="stat-note">Agreed but not yet received</div>
        </div>
        <div className="card">
          <div className="stat-label">Discrepancies</div>
          <div className="stat-value">
            {orders.filter((o) => o.status === 'discrepancy').length}
          </div>
          <div className="stat-note">Received short or over</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="tabs" style={{ margin: 0, border: 'none' }}>
            {[
              { key: 'requests', label: 'Requests', count: requests.length },
              { key: 'orders', label: 'Restock orders', count: orders.length },
            ].map((t) => (
              <button
                key={t.key}
                className={'tab' + (tab === t.key ? ' active' : '')}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="tab-count">{t.count}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New request
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : tab === 'requests' ? (
          requests.length === 0 ? (
            <div className="empty-state">
              <p>No restock requests yet.</p>
              <p className="page-desc">
                Raise one for a location and list what you need. It moves no stock on its own.
              </p>
            </div>
          ) : (
            <div className="return-list">
              {requests.map((r) => (
                <article key={r.id} className="return-card">
                  <header className="return-card-head">
                    <div className="return-ident">
                      <span className="return-order">{r.reference}</span>
                      <span className="return-customer">
                        for {r.destination?.name || 'no location'}
                      </span>
                    </div>
                    <div className="return-card-actions">
                      <StatusPill status={r.status} />
                      {(r.status === 'open' || r.status === 'partly_fulfilled') && (
                        <button className="btn btn-primary" onClick={() => setFulfilling(r)}>
                          Fulfil
                        </button>
                      )}
                    </div>
                  </header>

                  <div className="return-card-body">
                    <dl className="return-facts">
                      <div>
                        <dt>Requested</dt>
                        <dd>
                          {formatDate(r.created_at)}
                          <span className="cell-sub">
                            by {r.requester?.full_name || 'Unknown'}
                          </span>
                        </dd>
                      </div>
                      {r.note && (
                        <div><dt>Note</dt><dd>{r.note}</dd></div>
                      )}
                    </dl>

                    <div className="return-items">
                      <span className="panel-label">Items requested</span>
                      <div className="item-list">
                        {(r.restock_request_lines ?? []).map((l) => (
                          <div key={l.id} className="item-line">
                            <span className="item-qty">{l.qty_requested}</span>
                            <span>
                              <span className="item-name">{l.name}</span>
                              <span className="cell-sub">
                                {l.sku || 'No SKU'}
                                {l.qty_fulfilled > 0 && ` · ${l.qty_fulfilled} fulfilled`}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <p>No restock orders yet.</p>
            <p className="page-desc">One is created when someone fulfils part of a request.</p>
          </div>
        ) : (
          <div className="return-list">
            {orders.map((o) => (
              <article key={o.id} className="return-card">
                <header className="return-card-head">
                  <div className="return-ident">
                    <span className="return-order">{o.reference}</span>
                    <span className="return-customer">
                      {o.source?.name || '?'} to {o.destination?.name || '?'}
                    </span>
                  </div>
                  <div className="return-card-actions">
                    <StatusPill status={o.status} />
                    {o.status === 'draft' && (
                      <button className="btn btn-primary" onClick={() => sendGoodsInwards(o)}>
                        Send goods inwards
                      </button>
                    )}
                    {(o.status === 'sent' || o.status === 'discrepancy') && (
                      <button className="btn btn-primary" onClick={() => setReceiving(o)}>
                        Check off received
                      </button>
                    )}
                  </div>
                </header>

                <div className="return-card-body">
                  <dl className="return-facts">
                    <div>
                      <dt>Fulfilled</dt>
                      <dd>
                        {formatDate(o.created_at)}
                        <span className="cell-sub">by {o.fulfiller?.full_name || 'Unknown'}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Transfer on point of sale</dt>
                      <dd>
                        {o.external_transfer_id ? (
                          <code className="code-ref">{o.external_transfer_id}</code>
                        ) : (
                          <span className="cell-sub">
                            Not created yet ~ raise it in Lightspeed for now
                          </span>
                        )}
                      </dd>
                    </div>
                    {o.note && <div><dt>Note</dt><dd>{o.note}</dd></div>}
                  </dl>

                  <div className="return-items">
                    <span className="panel-label">Items</span>
                    <div className="item-list">
                      {(o.restock_order_lines ?? []).map((l) => {
                        const short = l.qty_received != null && l.qty_received !== l.qty_sent
                        return (
                          <div key={l.id} className="item-line">
                            <span className={'item-qty' + (short ? ' item-qty-bad' : '')}>
                              {l.qty_sent}
                            </span>
                            <span>
                              <span className="item-name">{l.name}</span>
                              <span className="cell-sub">
                                {l.sku || 'No SKU'}
                                {l.qty_received != null && ` · ${l.qty_received} received`}
                                {short && ` · off by ${l.qty_received - l.qty_sent}`}
                              </span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <NewRequestModal
          locations={locations}
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            setStatus({ type: 'ok', text: 'Restock request raised.' })
            load()
          }}
        />
      )}

      {fulfilling && (
        <FulfilModal
          request={fulfilling}
          locations={locations}
          profile={profile}
          onClose={() => setFulfilling(null)}
          onSaved={() => {
            setFulfilling(null)
            setStatus({ type: 'ok', text: 'Restock order created.' })
            load()
          }}
        />
      )}

      {receiving && (
        <ReceiveModal
          order={receiving}
          onClose={() => setReceiving(null)}
          onSaved={(hadDiscrepancy) => {
            setReceiving(null)
            setStatus({
              type: hadDiscrepancy ? 'err' : 'ok',
              text: hadDiscrepancy
                ? 'Received with a discrepancy ~ flagged for checking.'
                : 'Restock received in full.',
            })
            load()
          }}
        />
      )}
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    open: ['warn', 'Open'],
    partly_fulfilled: ['warn', 'Partly fulfilled'],
    fulfilled: ['ok', 'Fulfilled'],
    draft: ['warn', 'Ready to send'],
    sent: ['warn', 'Awaiting receipt'],
    received: ['ok', 'Received'],
    discrepancy: ['bad', 'Discrepancy'],
    closed: ['ok', 'Closed'],
    cancelled: ['neutral', 'Cancelled'],
  }
  const [tone, label] = map[status] ?? ['neutral', status]
  return <span className={`status-pill ${tone}`}>{label}</span>
}

// ---------------------------------------------------------------------------
// Raise a request
// ---------------------------------------------------------------------------
function NewRequestModal({ locations, profile, onClose, onSaved }) {
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([])
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const setLine = (i, patch) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  async function save() {
    if (!destination) return setError('Choose where the stock is needed.')
    const clean = lines.filter((l) => l.name.trim() && Number(l.qty) > 0)
    if (clean.length === 0) return setError('Add at least one item with a quantity.')

    setBusy(true)
    setError(null)

    const { data: created, error: rErr } = await supabase
      .from('restock_requests')
      .insert({
        org_id: profile.org_id,
        reference: ref('REQ'),
        destination_location_id: destination,
        note: note.trim() || null,
        requested_by: profile.id,
      })
      .select('id')
      .single()

    if (rErr) { setBusy(false); return setError(rErr.message) }

    const { error: lErr } = await supabase.from('restock_request_lines').insert(
      clean.map((l) => ({
        org_id: profile.org_id,
        request_id: created.id,
        variant_id: l.variant_id ?? null,
        name: l.name.trim(),
        sku: (l.sku || '').trim() || null,
        qty_requested: Number(l.qty),
      }))
    )

    setBusy(false)
    if (lErr) setError(lErr.message)
    else onSaved()
  }

  return (
    <Modal
      title="New restock request"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : 'Raise request'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rq-dest">Stock needed at</label>
        <select
          id="rq-dest"
          className="input"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="">Choose a location...</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <h4 className="sub-label">What do you need?</h4>

      <ProductPicker
        onPick={(item) =>
          setLines((ls) =>
            ls.some((l) => l.variant_id && l.variant_id === item.variant_id)
              ? ls
              : [...ls, { ...item, qty: 1 }]
          )
        }
      />

      {lines.length === 0 && !manual && (
        <p className="field-hint">
          Search for what you need above, or{' '}
          <button className="linklike" onClick={() => {
            setManual(true)
            setLines([{ name: '', sku: '', qty: 1, variant_id: null }])
          }}>
            add an item by hand
          </button>{' '}
          if it is not in the catalogue yet.
        </p>
      )}

      <div className="line-picker" style={{ marginTop: 12 }}>
        {lines.map((l, i) => (
          <div key={i} className="line-row selected">
            {l.variant_id ? (
              <div className="line-row-head">
                <span>
                  <span className="cell-strong">{l.name}</span>
                  <span className="cell-sub">{l.sku || 'No SKU'}</span>
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
                    Qty
                    <input
                      className="input mini"
                      type="number"
                      min="1"
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </label>
                  <button
                    className="btn btn-quiet"
                    onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ) : (
              <div className="form-row">
                <div className="field" style={{ flex: '2 1 180px', marginBottom: 0 }}>
                  <label>Product</label>
                  <input
                    className="input"
                    placeholder="e.g. Home Guernsey 2026"
                    value={l.name}
                    onChange={(e) => setLine(i, { name: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}>
                  <label>SKU</label>
                  <input
                    className="input"
                    value={l.sku}
                    onChange={(e) => setLine(i, { sku: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: '0 1 80px', marginBottom: 0 }}>
                  <label>Qty</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                  />
                </div>
                <button
                  className="btn btn-quiet"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {manual && (
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => setLines([...lines, { name: '', sku: '', qty: 1, variant_id: null }])}
        >
          Add another item by hand
        </button>
      )}

      <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
        <label htmlFor="rq-note">Note (optional)</label>
        <textarea
          id="rq-note"
          className="input"
          rows="2"
          placeholder="e.g. needed before the home game"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Fulfil what you can, from a source location
// ---------------------------------------------------------------------------
function FulfilModal({ request, locations, profile, onClose, onSaved }) {
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(() => {
    const start = {}
    for (const l of request.restock_request_lines ?? []) {
      start[l.id] = Math.max(0, l.qty_requested - l.qty_fulfilled)
    }
    return start
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    if (!source) return setError('Choose which location you are sending from.')

    const lines = (request.restock_request_lines ?? [])
      .map((l) => ({ line: l, qty: Number(qty[l.id]) || 0 }))
      .filter((x) => x.qty > 0)

    if (lines.length === 0) return setError('Enter a quantity for at least one item.')

    setBusy(true)
    setError(null)

    const { data: order, error: oErr } = await supabase
      .from('restock_orders')
      .insert({
        org_id: profile.org_id,
        reference: ref('RST'),
        request_id: request.id,
        source_location_id: source,
        destination_location_id: request.destination_location_id ?? null,
        status: 'draft',
        note: note.trim() || null,
        fulfilled_by: profile.id,
      })
      .select('id')
      .single()

    if (oErr) { setBusy(false); return setError(oErr.message) }

    const { error: lErr } = await supabase.from('restock_order_lines').insert(
      lines.map(({ line, qty: q }) => ({
        org_id: profile.org_id,
        order_id: order.id,
        request_line_id: line.id,
        variant_id: line.variant_id ?? null,
        name: line.name,
        sku: line.sku,
        qty_sent: q,
      }))
    )
    if (lErr) { setBusy(false); return setError(lErr.message) }

    // Update how much of each requested line is now covered.
    for (const { line, qty: q } of lines) {
      await supabase
        .from('restock_request_lines')
        .update({ qty_fulfilled: (line.qty_fulfilled ?? 0) + q })
        .eq('id', line.id)
    }

    const allCovered = (request.restock_request_lines ?? []).every((l) => {
      const added = lines.find((x) => x.line.id === l.id)?.qty ?? 0
      return (l.qty_fulfilled ?? 0) + added >= l.qty_requested
    })

    await supabase
      .from('restock_requests')
      .update({ status: allCovered ? 'fulfilled' : 'partly_fulfilled' })
      .eq('id', request.id)

    setBusy(false)
    onSaved()
  }

  return (
    <Modal
      title={`Fulfil ${request.reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Creating...' : 'Create restock order'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="fl-source">Sending from</label>
        <select
          id="fl-source"
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choose a location...</option>
          {locations
            .filter((l) => l.id !== request.destination_location_id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.external_refs?.lightspeed ? '' : ' (not linked to Lightspeed)'}
              </option>
            ))}
        </select>
        <p className="field-hint">
          Locations come from your Locations page. Linking one to a Lightspeed outlet lets us
          raise the transfer there later.
        </p>
      </div>

      <h4 className="sub-label">How much can you send?</h4>
      <div className="line-picker">
        {(request.restock_request_lines ?? []).map((l) => {
          const outstanding = Math.max(0, l.qty_requested - (l.qty_fulfilled ?? 0))
          return (
            <div key={l.id} className="line-row selected">
              <div className="line-row-head">
                <span>
                  <span className="cell-strong">{l.name}</span>
                  <span className="cell-sub">
                    {l.sku || 'No SKU'} · asked for {l.qty_requested}
                    {l.qty_fulfilled > 0 && `, ${l.qty_fulfilled} already sent`}
                  </span>
                </span>
                <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
                  Sending
                  <input
                    className="input mini"
                    type="number"
                    min="0"
                    max={outstanding}
                    value={qty[l.id] ?? 0}
                    onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
        <label htmlFor="fl-note">Note (optional)</label>
        <textarea
          id="fl-note"
          className="input"
          rows="2"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Check off what actually turned up
// ---------------------------------------------------------------------------
function ReceiveModal({ order, onClose, onSaved }) {
  const [received, setReceived] = useState(() => {
    const start = {}
    for (const l of order.restock_order_lines ?? []) {
      start[l.id] = l.qty_received ?? l.qty_sent
    }
    return start
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setBusy(true)
    setError(null)

    let discrepancy = false
    for (const l of order.restock_order_lines ?? []) {
      const got = Number(received[l.id]) || 0
      if (got !== l.qty_sent) discrepancy = true
      const { error: lErr } = await supabase
        .from('restock_order_lines')
        .update({ qty_received: got })
        .eq('id', l.id)
      if (lErr) { setBusy(false); return setError(lErr.message) }
    }

    const { error: oErr } = await supabase
      .from('restock_orders')
      .update({ status: discrepancy ? 'discrepancy' : 'received' })
      .eq('id', order.id)

    setBusy(false)
    if (oErr) setError(oErr.message)
    else onSaved(discrepancy)
  }

  return (
    <Modal
      title={`Check off ${order.reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : 'Confirm received'}
          </button>
        </>
      }
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        Enter what actually arrived. Anything that does not match what was sent is flagged so it
        can be corrected on the point of sale.
      </p>

      <div className="line-picker">
        {(order.restock_order_lines ?? []).map((l) => {
          const got = Number(received[l.id])
          const off = got !== l.qty_sent
          return (
            <div key={l.id} className={'line-row' + (off ? '' : ' selected')}>
              <div className="line-row-head">
                <span>
                  <span className="cell-strong">{l.name}</span>
                  <span className="cell-sub">{l.sku || 'No SKU'} · sent {l.qty_sent}</span>
                </span>
                <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
                  Received
                  <input
                    className="input mini"
                    type="number"
                    min="0"
                    value={received[l.id] ?? 0}
                    onChange={(e) => setReceived({ ...received, [l.id]: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
              {off && (
                <p className="field-hint" style={{ color: 'var(--red)' }}>
                  {got > l.qty_sent
                    ? `${got - l.qty_sent} more than sent`
                    : `${l.qty_sent - got} short`}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
