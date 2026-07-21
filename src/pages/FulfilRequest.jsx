import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { nextReference } from '../lib/references'
import { sortVariants } from '../lib/sizes'

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
  const [orderId, setOrderId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
      const { data: levels } = await supabase
        .from('inventory_levels')
        .select('variant_id, location_id, on_hand')
        .in('variant_id', variantIds)

      const map = {}
      for (const lvl of levels ?? []) {
        if (!map[lvl.variant_id]) map[lvl.variant_id] = {}
        map[lvl.variant_id][lvl.location_id] = lvl.on_hand
      }
      setStock(map)
    }

    setLoading(false)
  }, [requestId])

  useEffect(() => { load() }, [load])

  const lines = request?.restock_request_lines ?? []
  const outstanding = (l) => Math.max(0, l.qty_requested - (l.qty_fulfilled ?? 0))
  const available = (l) => (source && l.variant_id ? stock[l.variant_id]?.[source] ?? 0 : null)

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
    if (id) navigate('/restocks')
  }

  if (loading) return <p className="page-desc">Loading request...</p>
  if (!request) return <p className="page-desc">That request could not be found.</p>

  return (
    <div>
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
            {source
              ? 'Stock at that location is shown against each line.'
              : 'Choose where you are sending from to see what you have.'}
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

        <div className="table-wrap">
          <table className="variant-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th className="num">Asked for</th>
                <th className="num">Already sent</th>
                <th className="num">Available</th>
                <th className="num">Sending</th>
              </tr>
            </thead>
            <tbody>
              {sortVariants(
                lines.map((l) => ({ ...l, option_name: (l.name ?? '').split(' ~ ').pop() }))
              ).map((l) => {
                const have = available(l)
                const want = outstanding(l)
                const sending = Number(qty[l.id]) || 0
                const short = have != null && sending > have
                return (
                  <tr key={l.id} className={want === 0 ? 'row-muted' : ''}>
                    <td className="cell-strong">{l.name}</td>
                    <td className="cell-sub">{l.sku || 'No SKU'}</td>
                    <td className="num">{l.qty_requested}</td>
                    <td className="num">{l.qty_fulfilled || 0}</td>
                    <td className={'num' + (have === 0 ? ' zero' : have < 0 ? ' negative' : '')}>
                      {have == null ? '~' : have}
                    </td>
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
    </div>
  )
}
