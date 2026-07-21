import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BackLink from '../components/BackLink'
import { nextReference } from '../lib/references'
import { sortVariants } from '../lib/sizes'
import Modal from '../components/Modal'

export default function FulfilRequest() {
  const { requestId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [request, setRequest] = useState(null)
  const [locations, setLocations] = useState([])
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [qty, setQty] = useState({})          // requestLineId -> qty
  const [stock, setStock] = useState({})      // variantId -> { locationId: onHand }
  const [info, setInfo] = useState({})        // variantId -> product and option details
  const [orderId, setOrderId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [askClose, setAskClose] = useState(null)   // { remaining }
  const [closeReason, setCloseReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)

    const [{ data: req }, { data: locs }, { data: building }] = await Promise.all([
      supabase
        .from('restock_requests')
        .select('id,reference,note,status,destination_location_id,destination:destination_location_id(name),requester:requested_by(full_name),created_at,restock_request_lines(id,variant_id,name,sku,qty_requested,qty_fulfilled)')
        .eq('id', requestId)
        .maybeSingle(),
      supabase.from('locations').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('restock_orders')
        .select('id,source_location_id,note,restock_order_lines(id,request_line_id,qty_sent)')
        .eq('request_id', requestId)
        .eq('status', 'building')
        .maybeSingle(),
    ])

    setRequest(req ?? null)
    setLocations(locs ?? [])

    // Prefill from a fulfilment already in progress, else start empty.
    if (building) {
      setOrderId(building.id)
      setSource(building.source_location_id ?? '')
      setNote(building.note ?? '')
      const start = {}
      for (const l of building.restock_order_lines ?? []) {
        if (l.request_line_id) start[l.request_line_id] = l.qty_sent
      }
      setQty(start)
    }

    // Stock for the requested variants, so you can see what you have to give.
    const variantIds = (req?.restock_request_lines ?? [])
      .map((l) => l.variant_id)
      .filter(Boolean)

    if (variantIds.length) {
      const [{ data: levels }, { data: vs }] = await Promise.all([
        supabase
          .from('inventory_levels')
          .select('variant_id, location_id, on_hand')
          .in('variant_id', variantIds),
        supabase
          .from('variants')
          .select('id, sku, option_name, products(id, name, image_url, external_brand)')
          .in('id', variantIds),
      ])

      const map = {}
      for (const lvl of levels ?? []) {
        if (!map[lvl.variant_id]) map[lvl.variant_id] = {}
        map[lvl.variant_id][lvl.location_id] = lvl.on_hand
      }
      setStock(map)

      const details = {}
      for (const v of vs ?? []) {
        details[v.id] = {
          productId: v.products?.id ?? null,
          productName: v.products?.name ?? null,
          brand: v.products?.external_brand ?? null,
          image: v.products?.image_url ?? null,
          option: v.option_name ?? null,
        }
      }
      setInfo(details)
    }

    setLoading(false)
  }, [requestId])

  useEffect(() => { load() }, [load])

  const lines = request?.restock_request_lines ?? []
  const outstanding = (l) => Math.max(0, l.qty_requested - (l.qty_fulfilled ?? 0))
  const available = (l) => (source && l.variant_id ? stock[l.variant_id]?.[source] ?? 0 : null)
  const stockAt = (l, locationId) =>
    l.variant_id ? stock[l.variant_id]?.[locationId] ?? 0 : null

  // Where else could this come from? Helps decide whether to split a request
  // across locations.
  const otherLocations = locations.filter((l) => l.id !== request?.destination_location_id)

  // Group the requested lines under their product, the way the product pages
  // show them, so a guernsey in six sizes reads as one block.
  const groups = []
  const byKey = {}
  for (const l of lines) {
    const d = info[l.variant_id] ?? {}
    const rawName = l.name ?? ''
    const idx = rawName.lastIndexOf(' ~ ')
    const productName = d.productName ?? (idx === -1 ? rawName : rawName.slice(0, idx))
    const option = d.option ?? (idx === -1 ? null : rawName.slice(idx + 3))
    const key = d.productId ?? productName

    if (!byKey[key]) {
      byKey[key] = { key, name: productName, brand: d.brand, image: d.image, lines: [] }
      groups.push(byKey[key])
    }
    byKey[key].lines.push({ ...l, option_name: option })
  }

  const totalSending = Object.values(qty).reduce((n, v) => n + (Number(v) || 0), 0)
  const linesSending = Object.values(qty).filter((v) => Number(v) > 0).length

  function setLineQty(lineId, value) {
    const n = Math.max(0, Number(value) || 0)
    setQty({ ...qty, [lineId]: n })
  }

  function fillFromStock() {
    const next = {}
    for (const l of lines) {
      const have = available(l)
      const want = outstanding(l)
      next[l.id] = have == null ? want : Math.max(0, Math.min(want, have))
    }
    setQty(next)
  }

  // Writes the in progress order. Confirming flips it to ready and updates the
  // request's totals; saving leaves it as a work in progress.
  async function persist(confirm) {
    if (!source) { setError('Choose which location you are sending from.'); return null }

    const chosen = lines
      .map((l) => ({ line: l, qty: Number(qty[l.id]) || 0 }))
      .filter((x) => x.qty > 0)

    if (confirm && chosen.length === 0) {
      setError('Enter a quantity for at least one item.')
      return null
    }

    setError(null)

    const payload = {
      org_id: profile.org_id,
      request_id: request.id,
      source_location_id: source,
      destination_location_id: request.destination_location_id ?? null,
      note: note.trim() || null,
      fulfilled_by: profile.id,
      status: confirm ? 'draft' : 'building',
    }

    let id = orderId
    if (id) {
      const { error: uErr } = await supabase.from('restock_orders').update(payload).eq('id', id)
      if (uErr) { setError(uErr.message); return null }
      await supabase.from('restock_order_lines').delete().eq('order_id', id)
    } else {
      const { data, error: iErr } = await supabase
        .from('restock_orders')
        .insert({ ...payload, reference: await nextReference('restock_order', 'RO-') })
        .select('id')
        .single()
      if (iErr) { setError(iErr.message); return null }
      id = data.id
      setOrderId(id)
    }

    if (chosen.length) {
      const { error: lErr } = await supabase.from('restock_order_lines').insert(
        chosen.map(({ line, qty: q }) => ({
          org_id: profile.org_id,
          order_id: id,
          request_line_id: line.id,
          variant_id: line.variant_id,
          name: line.name,
          sku: line.sku,
          qty_sent: q,
        }))
      )
      if (lErr) { setError(lErr.message); return null }
    }

    if (confirm) {
      // Recalculate what each requested line has been given across every
      // committed fulfilment, rather than trusting a running total.
      const { data: committed } = await supabase
        .from('restock_order_lines')
        .select('request_line_id, qty_sent, restock_orders!inner(status, request_id)')
        .eq('restock_orders.request_id', request.id)
        .neq('restock_orders.status', 'building')
        .neq('restock_orders.status', 'cancelled')

      const totals = {}
      for (const row of committed ?? []) {
        if (!row.request_line_id) continue
        totals[row.request_line_id] = (totals[row.request_line_id] ?? 0) + row.qty_sent
      }

      for (const l of lines) {
        await supabase
          .from('restock_request_lines')
          .update({ qty_fulfilled: totals[l.id] ?? 0 })
          .eq('id', l.id)
      }

      const allCovered = lines.every((l) => (totals[l.id] ?? 0) >= l.qty_requested)
      await supabase
        .from('restock_requests')
        .update({ status: allCovered ? 'fulfilled' : 'partly_fulfilled' })
        .eq('id', request.id)
    }

    return id
  }

  async function saveDraft() {
    setSaving(true)
    const id = await persist(false)
    setSaving(false)
    if (id) navigate('/restocks')
  }

  async function confirm() {
    setBusy(true)
    const id = await persist(true)
    setBusy(false)
    if (!id) return

    // Work out what this fulfilment leaves behind.
    const remaining = lines.reduce((n, l) => {
      const sending = Number(qty[l.id]) || 0
      const already = l.qty_fulfilled ?? 0
      return n + Math.max(0, l.qty_requested - already - sending)
    }, 0)

    if (remaining > 0) setAskClose({ remaining })
    else navigate('/restocks')
  }

  async function closeRequest(reason) {
    await supabase
      .from('restock_requests')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: profile.id,
        closed_reason: reason || null,
      })
      .eq('id', request.id)
    navigate('/restocks')
  }

  if (loading) return <p className="page-desc">Loading request...</p>
  if (!request) return <p className="page-desc">That request could not be found.</p>

  return (
    <div>
      <BackLink to="/restocks" label="Back to restocks" />

      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">Fulfil {request.reference}</h2>
        <p className="page-desc">
          For {request.destination?.name || 'no location'}, raised by{' '}
          {request.requester?.full_name || 'someone'}. Enter what you can send ~ nothing moves
          until the goods inwards is checked off.
        </p>
      </div>

      {error && <div className="auth-msg err" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card request-bar">
        <div className="request-bar-fields">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="src">Sending from</label>
            <select
              id="src"
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Choose a location...</option>
              {locations
                .filter((l) => l.id !== request.destination_location_id)
                .map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="fnote">Note (optional)</label>
            <input
              id="fnote"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="request-bar-actions">
            <button className="btn" onClick={() => navigate('/restocks')}>Cancel</button>
            <button className="btn" onClick={saveDraft} disabled={saving || busy}>
              {saving ? 'Saving...' : 'Save and finish later'}
            </button>
            <button className="btn btn-primary" onClick={confirm} disabled={busy || saving}>
              {busy ? 'Creating...' : 'Create restock order'}
            </button>
          </div>
        </div>

        <div className="request-bar-foot">
          <span className="field-hint" style={{ margin: 0 }}>
            Sending from one location at a time. Anything left outstanding can be fulfilled from
            another location afterwards, as its own restock order.
          </span>
          <span className="request-count">
            {linesSending} line{linesSending === 1 ? '' : 's'} · {totalSending} item
            {totalSending === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>What can you send?</h3>
          {source && (
            <button className="btn" onClick={fillFromStock}>
              Fill from available stock
            </button>
          )}
        </div>

        <div className="product-list">
          {groups.map((g) => {
            const groupTotal = g.lines.reduce((n, l) => n + (Number(qty[l.id]) || 0), 0)
            return (
              <div key={g.key} className="product-row">
                <div className="product-head" style={{ cursor: 'default' }}>
                  {g.image
                    ? <img className="thumb" src={g.image} alt="" loading="lazy" />
                    : <span className="thumb thumb-blank" />}
                  <span className="product-main">
                    <span className="cell-strong">{g.name}</span>
                    <span className="cell-sub">
                      {g.brand || 'No brand'} · {g.lines.length} size
                      {g.lines.length === 1 ? '' : 's'} requested
                    </span>
                  </span>
                  <span className={'stock-chip' + (groupTotal === 0 ? ' zero' : '')}>
                    sending {groupTotal}
                  </span>
                </div>

                <div className="product-variants">
                  <table className="variant-table">
                    <thead>
                      <tr>
                        <th>Size</th>
                        <th>SKU</th>
                        <th className="num">Asked for</th>
                        <th className="num">Already sent</th>
                        {otherLocations.map((loc) => (
                          <th
                            key={loc.id}
                            className={'num' + (loc.id === source ? ' destination' : '')}
                          >
                            {loc.name}
                          </th>
                        ))}
                        <th className="num">Sending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortVariants(g.lines).map((l) => {
                        const have = available(l)
                        const want = outstanding(l)
                        const sending = Number(qty[l.id]) || 0
                        const short = have != null && sending > have
                        return (
                          <tr key={l.id} className={want === 0 ? 'row-muted' : ''}>
                            <td className="cell-strong">{l.option_name || 'Single'}</td>
                            <td className="cell-sub">{l.sku || 'No SKU'}</td>
                            <td className="num">{l.qty_requested}</td>
                            <td className="num">{l.qty_fulfilled || 0}</td>
                            {otherLocations.map((loc) => {
                              const at = stockAt(l, loc.id)
                              return (
                                <td
                                  key={loc.id}
                                  className={
                                    'num' +
                                    (loc.id === source ? ' destination' : '') +
                                    (at === 0 ? ' zero' : at < 0 ? ' negative' : '')
                                  }
                                >
                                  {at == null ? '~' : at}
                                </td>
                              )
                            })}
                            <td className="num">
                              <input
                                className="input mini"
                                type="number"
                                min="0"
                                value={qty[l.id] ?? ''}
                                placeholder="0"
                                onChange={(e) => setLineQty(l.id, e.target.value)}
                                style={short ? { borderColor: '#c0392b' } : undefined}
                                title={short ? 'More than you have at that location' : undefined}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {askClose && (
        <Modal
          title="Anything else coming?"
          onClose={() => navigate('/restocks')}
          footer={
            <>
              <button className="btn" onClick={() => navigate('/restocks')}>
                Leave it open
              </button>
              <button
                className="btn btn-primary"
                onClick={() => closeRequest(closeReason)}
              >
                Close the request
              </button>
            </>
          }
        >
          <p className="page-desc" style={{ marginTop: 0 }}>
            {askClose.remaining} item{askClose.remaining === 1 ? '' : 's'} from{' '}
            {request.reference} {askClose.remaining === 1 ? 'is' : 'are'} still outstanding.
          </p>
          <p className="field-hint">
            Leave it open if the rest will be sent later, perhaps from another location. Close it
            if nothing more is coming ~ the request stays on record showing what was and was not
            covered.
          </p>
          <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
            <label htmlFor="close-reason">Why is nothing more coming? (optional)</label>
            <input
              id="close-reason"
              className="input"
              placeholder="e.g. out of stock everywhere, not needed now"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
            />
          </div>
        </Modal>
      )}

      <div className="card page-actions">
        <div className="page-actions-summary">
          <span>
            <span className="fact-label">Sending</span>
            {linesSending} line{linesSending === 1 ? '' : 's'} · {totalSending} item
            {totalSending === 1 ? '' : 's'}
          </span>
          <span>
            <span className="fact-label">From</span>
            {locations.find((l) => l.id === source)?.name || 'not chosen yet'}
          </span>
        </div>

        <div className="request-bar-actions">
          <button className="btn" onClick={() => navigate('/restocks')}>Cancel</button>
          <button className="btn" onClick={saveDraft} disabled={saving || busy}>
            {saving ? 'Saving...' : 'Save and finish later'}
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy || saving}>
            {busy ? 'Creating...' : 'Create restock order'}
          </button>
        </div>
      </div>
    </div>
  )
}
