import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { nextReference } from '../lib/references'
import LineGroups from '../components/LineGroups'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function Restocks() {
  const { profile, org } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [orders, setOrders] = useState([])
  const [inProgress, setInProgress] = useState([])
  const [images, setImages] = useState({})
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [receiving, setReceiving] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [rq, ro, loc] = await Promise.all([
      supabase.from('restock_requests')
        .select('id,reference,status,note,created_at,destination:destination_location_id(name),requester:requested_by(full_name),restock_request_lines(id,variant_id,name,sku,qty_requested,qty_fulfilled,note)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('restock_orders')
        .select('id,reference,status,note,created_at,external_transfer_id,source:source_location_id(name,external_refs),destination:destination_location_id(name),fulfiller:fulfilled_by(full_name),restock_order_lines(id,name,sku,qty_sent,qty_received,note)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('locations')
        .select('id, name, type, external_refs')
        .eq('is_active', true).order('name'),
    ])

    const building = (ro.data ?? []).filter((o) => o.status === 'building')
    if (rq.error) setStatus({ type: 'err', text: rq.error.message })
    setRequests(rq.data ?? [])
    setOrders((ro.data ?? []).filter((o) => o.status !== 'building'))
    setInProgress(building)
    setLocations(loc.data ?? [])

    // Thumbnails for the products referenced by these lines, keyed on product
    // name so the grouped view can show them.
    const variantIds = [
      ...(rq.data ?? []).flatMap((r) =>
        (r.restock_request_lines ?? []).map((l) => l.variant_id)),
      ...(ro.data ?? []).flatMap((o) =>
        (o.restock_order_lines ?? []).map((l) => l.variant_id)),
    ].filter(Boolean)

    if (variantIds.length) {
      const { data: vs } = await supabase
        .from('variants')
        .select('id, products(name, image_url)')
        .in('id', [...new Set(variantIds)])

      const map = {}
      for (const v of vs ?? []) {
        if (v.products?.name && v.products?.image_url) {
          map[v.products.name] = v.products.image_url
        }
      }
      setImages(map)
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const drafts = requests.filter((r) => r.status === 'draft')
  const openRequests = requests.filter((r) => r.status === 'open' || r.status === 'partly_fulfilled')
  const openOrders = orders.filter((o) => ['draft', 'sent', 'discrepancy'].includes(o.status))

  async function closeRequest(r) {
    const reason = window.prompt(
      `Close ${r.reference}? Anything outstanding will not be sent.\n\nWhy? (optional)`,
      ''
    )
    if (reason === null) return

    const { error } = await supabase
      .from('restock_requests')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: profile.id,
        closed_reason: reason.trim() || null,
      })
      .eq('id', r.id)

    if (error) setStatus({ type: 'err', text: error.message })
    else { setStatus({ type: 'ok', text: `${r.reference} closed.` }); load() }
  }

  async function reopenRequest(r) {
    const { error } = await supabase
      .from('restock_requests')
      .update({ status: 'partly_fulfilled', closed_at: null, closed_by: null, closed_reason: null })
      .eq('id', r.id)
    if (error) setStatus({ type: 'err', text: error.message })
    else load()
  }

  async function discardDraft(r) {
    if (!window.confirm(`Discard ${r.reference}? This cannot be undone.`)) return
    const { error } = await supabase.from('restock_requests').delete().eq('id', r.id)
    if (error) setStatus({ type: 'err', text: error.message })
    else { setStatus({ type: 'ok', text: 'Draft discarded.' }); load() }
  }

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
              { key: 'requests', label: 'Requests', count: requests.length - drafts.length },
              { key: 'drafts', label: 'Drafts', count: drafts.length },
              { key: 'orders', label: 'Restock orders', count: orders.length },
              ...(inProgress.length
                ? [{ key: 'progress', label: 'Being fulfilled', count: inProgress.length }]
                : []),
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
          <button className="btn btn-primary" onClick={() => navigate('/restocks/new')}>
            New request
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : tab === 'progress' ? (
          <div className="return-list">
            {inProgress.map((o) => (
              <article key={o.id} className="return-card">
                <header className="return-card-head">
                  <div className="return-ident">
                    <span className="return-order">{o.reference}</span>
                    <span className="return-customer">
                      {o.source?.name || '?'} to {o.destination?.name || '?'}
                    </span>
                  </div>
                  <div className="return-card-actions">
                    <span className="status-pill warn">Not finished</span>
                    <button
                      className="btn btn-primary"
                      onClick={() => navigate(`/restocks/${o.request_id}/fulfil`)}
                    >
                      Continue
                    </button>
                  </div>
                </header>
                <div className="stack-body">
                  <div className="fact-row">
                    <span>
                      <span className="fact-label">Started</span>
                      {formatDate(o.created_at)} by {o.fulfiller?.full_name || 'Unknown'}
                    </span>
                    <span>
                      <span className="fact-label">So far</span>
                      {(o.restock_order_lines ?? []).reduce((n, l) => n + (l.qty_sent || 0), 0)} items
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : tab === 'drafts' ? (
          drafts.length === 0 ? (
            <div className="empty-state">
              <p>No drafts.</p>
              <p className="page-desc">
                Half finished requests are saved here so you can pick them up later.
              </p>
            </div>
          ) : (
            <div className="return-list">
              {drafts.map((r) => (
                <article key={r.id} className="return-card">
                  <header className="return-card-head">
                    <div className="return-ident">
                      <span className="return-order">{r.reference}</span>
                      <span className="return-customer">
                        {r.destination?.name ? `for ${r.destination.name}` : 'no location yet'}
                      </span>
                    </div>
                    <div className="return-card-actions">
                      <span className="status-pill neutral">Draft</span>
                      <button
                        className="btn btn-primary"
                        onClick={() => navigate(`/restocks/new?draft=${r.id}`)}
                      >
                        Continue
                      </button>
                      <button className="btn btn-quiet" onClick={() => discardDraft(r)}>
                        Discard
                      </button>
                    </div>
                  </header>
                  <div className="stack-body">
                    <div className="fact-row">
                      <span>
                        <span className="fact-label">Started</span>
                        {formatDate(r.created_at)} by {r.requester?.full_name || 'Unknown'}
                      </span>
                    </div>
                    <LineGroups
                      images={images}
                      lines={(r.restock_request_lines ?? []).map((l) => ({
                        id: l.id, name: l.name, sku: l.sku, qty: l.qty_requested,
                      }))}
                      limit={2}
                      emptyText="Nothing added yet"
                    />
                  </div>
                </article>
              ))}
            </div>
          )
        ) : tab === 'requests' ? (
          requests.filter((r) => r.status !== 'draft').length === 0 ? (
            <div className="empty-state">
              <p>No restock requests yet.</p>
              <p className="page-desc">
                Raise one for a location and list what you need. It moves no stock on its own.
              </p>
            </div>
          ) : (
            <div className="return-list">
              {requests.filter((r) => r.status !== 'draft').map((r) => (
                <article key={r.id} className="return-card">
                  <header className="return-card-head">
                    <div className="return-ident">
                      <span className="return-order">{r.reference}</span>
                      <span className="return-customer">
                        for {r.destination?.name || 'no location'}
                      </span>
                    </div>
                    <div className="return-card-actions">
                      {inProgress.some((o) => o.request_id === r.id) ? (
                        <span className="status-pill warn">Being fulfilled</span>
                      ) : (
                        <StatusPill status={r.status} />
                      )}
                      {(r.status === 'open' || r.status === 'partly_fulfilled') && (
                        <button
                          className="btn"
                          onClick={() => navigate(`/restocks/new?request=${r.id}`)}
                        >
                          Edit
                        </button>
                      )}
                      {(r.status === 'open' || r.status === 'partly_fulfilled') && (
                        <button
                          className="btn btn-primary"
                          onClick={() => navigate(`/restocks/${r.id}/fulfil`)}
                        >
                          {inProgress.some((o) => o.request_id === r.id)
                            ? 'Continue fulfilling'
                            : 'Fulfil'}
                        </button>
                      )}
                      {(r.status === 'open' || r.status === 'partly_fulfilled') && (
                        <button className="btn btn-quiet" onClick={() => closeRequest(r)}>
                          Close
                        </button>
                      )}
                      {r.status === 'closed' && (
                        <button className="btn btn-quiet" onClick={() => reopenRequest(r)}>
                          Reopen
                        </button>
                      )}
                    </div>
                  </header>

                  <div className="stack-body">
                    <div className="fact-row">
                      <span>
                        <span className="fact-label">Requested</span>
                        {formatDate(r.created_at)} by {r.requester?.full_name || 'Unknown'}
                      </span>
                      <span>
                        <span className="fact-label">Items</span>
                        {(r.restock_request_lines ?? []).reduce(
                          (n, l) => n + (l.qty_requested || 0), 0
                        )}{' '}
                        across {(r.restock_request_lines ?? []).length} line
                        {(r.restock_request_lines ?? []).length === 1 ? '' : 's'}
                      </span>
                      {r.note && (
                        <span>
                          <span className="fact-label">Note</span>
                          {r.note}
                        </span>
                      )}
                      {r.status === 'closed' && (
                        <span>
                          <span className="fact-label">Closed</span>
                          {formatDate(r.closed_at)}
                          {r.closed_reason ? ` ~ ${r.closed_reason}` : ''}
                        </span>
                      )}
                    </div>

                    <LineGroups
                      images={images}
                      lines={(r.restock_request_lines ?? []).map((l) => ({
                        id: l.id, name: l.name, sku: l.sku, qty: l.qty_requested,
                      }))}
                    />
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
                    <button
                      className="btn"
                      onClick={() => navigate(`/restocks/orders/${o.id}`)}
                    >
                      View
                    </button>
                  </div>
                </header>

                <div className="stack-body">
                  <div className="fact-row">
                    <span>
                      <span className="fact-label">Fulfilled</span>
                      {formatDate(o.created_at)} by {o.fulfiller?.full_name || 'Unknown'}
                    </span>
                    <span>
                      <span className="fact-label">Transfer on point of sale</span>
                      {o.external_transfer_id
                        ? <code className="code-ref">{o.external_transfer_id}</code>
                        : 'not created yet'}
                    </span>
                    {o.note && (
                      <span><span className="fact-label">Note</span>{o.note}</span>
                    )}
                  </div>

                  <LineGroups
                    images={images}
                    showReceived={o.status !== 'draft'}
                    lines={(o.restock_order_lines ?? []).map((l) => ({
                      id: l.id,
                      name: l.name,
                      sku: l.sku,
                      qty: l.qty_sent,
                      received: l.qty_received,
                    }))}
                  />

                  {(o.restock_order_lines ?? []).some(
                    (l) => l.qty_received != null && l.qty_received !== l.qty_sent
                  ) && (
                    <div className="placeholder-note" style={{ marginTop: 12 }}>
                      Received short or over on{' '}
                      {(o.restock_order_lines ?? []).filter(
                        (l) => l.qty_received != null && l.qty_received !== l.qty_sent
                      ).length}{' '}
                      line(s). Open Check off received to see the detail.
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

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
    closed: ['neutral', 'Closed short'],
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
