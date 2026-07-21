import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BackLink from '../components/BackLink'
import LineGroups from '../components/LineGroups'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

const STATUS = {
  building: ['warn', 'Not finished'],
  draft: ['warn', 'Ready to send'],
  sent: ['warn', 'Awaiting receipt'],
  received: ['ok', 'Received'],
  discrepancy: ['bad', 'Discrepancy'],
  closed: ['ok', 'Closed'],
  cancelled: ['neutral', 'Cancelled'],
}

export default function RestockOrder() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [request, setRequest] = useState(null)
  const [images, setImages] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    const { data: o } = await supabase
      .from('restock_orders')
      .select('id,reference,status,note,created_at,external_transfer_id,request_id,source:source_location_id(name),destination:destination_location_id(name),fulfiller:fulfilled_by(full_name),restock_order_lines(id,variant_id,name,sku,qty_sent,qty_received)')
      .eq('id', orderId)
      .maybeSingle()

    setOrder(o ?? null)

    if (o?.request_id) {
      const [{ data: req }, { data: others }] = await Promise.all([
        supabase
          .from('restock_requests')
          .select('id,reference,status,note,created_at,destination:destination_location_id(name),requester:requested_by(full_name),restock_request_lines(id,variant_id,name,sku,qty_requested,qty_fulfilled)')
          .eq('id', o.request_id)
          .maybeSingle(),
        supabase
          .from('restock_orders')
          .select('id,reference,status,created_at,source:source_location_id(name),restock_order_lines(qty_sent)')
          .eq('request_id', o.request_id)
          .neq('id', orderId)
          .order('created_at'),
      ])
      setRequest(req ?? null)
      setSiblings(others ?? [])
    }

    const variantIds = (o?.restock_order_lines ?? []).map((l) => l.variant_id).filter(Boolean)
    if (variantIds.length) {
      const { data: vs } = await supabase
        .from('variants')
        .select('id, products(name, image_url)')
        .in('id', [...new Set(variantIds)])
      const map = {}
      for (const v of vs ?? []) {
        if (v.products?.name && v.products?.image_url) map[v.products.name] = v.products.image_url
      }
      setImages(map)
    }

    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load])

  if (loading) return <p className="page-desc">Loading restock order...</p>
  if (!order) return <p className="page-desc">That restock order could not be found.</p>

  const [tone, label] = STATUS[order.status] ?? ['neutral', order.status]
  const sentTotal = (order.restock_order_lines ?? []).reduce((n, l) => n + (l.qty_sent || 0), 0)
  const receivedTotal = (order.restock_order_lines ?? [])
    .reduce((n, l) => n + (l.qty_received ?? 0), 0)
  const anyReceived = (order.restock_order_lines ?? []).some((l) => l.qty_received != null)

  // Anything on the original request still waiting on someone.
  const outstanding = (request?.restock_request_lines ?? [])
    .map((l) => ({
      id: l.id,
      name: l.name,
      sku: l.sku,
      qty: Math.max(0, (l.qty_requested ?? 0) - (l.qty_fulfilled ?? 0)),
    }))
    .filter((l) => l.qty > 0)

  const outstandingTotal = outstanding.reduce((n, l) => n + l.qty, 0)

  return (
    <div>
      <BackLink to="/restocks" label="Back to restocks" />

      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">{order.reference}</h2>
        <p className="page-desc">
          {order.source?.name || 'Unknown'} to {order.destination?.name || 'unknown'}, put
          together by {order.fulfiller?.full_name || 'someone'} on {formatDate(order.created_at)}.
        </p>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Sent</div>
          <div className="stat-value">{sentTotal}</div>
          <div className="stat-note">
            across {(order.restock_order_lines ?? []).length} line
            {(order.restock_order_lines ?? []).length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Received</div>
          <div className="stat-value">{anyReceived ? receivedTotal : '-'}</div>
          <div className="stat-note">
            {anyReceived
              ? receivedTotal === sentTotal ? 'Matches what was sent' : 'Does not match'
              : 'Not checked off yet'}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Still outstanding</div>
          <div className="stat-value">{outstandingTotal}</div>
          <div className="stat-note">On the original request</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>What was sent</h3>
          <span className={`status-pill ${tone}`}>{label}</span>
        </div>

        <div className="fact-row">
          <span>
            <span className="fact-label">From</span>
            {order.source?.name || '-'}
          </span>
          <span>
            <span className="fact-label">To</span>
            {order.destination?.name || '-'}
          </span>
          <span>
            <span className="fact-label">Transfer on point of sale</span>
            {order.external_transfer_id
              ? <code className="code-ref">{order.external_transfer_id}</code>
              : 'not created yet'}
          </span>
          {order.note && (
            <span><span className="fact-label">Note</span>{order.note}</span>
          )}
        </div>

        <LineGroups
          images={images}
          showReceived={anyReceived}
          startOpen
          limit={50}
          lines={(order.restock_order_lines ?? []).map((l) => ({
            id: l.id, name: l.name, sku: l.sku, qty: l.qty_sent, received: l.qty_received,
          }))}
        />
      </div>

      {request && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h3 className="section-title" style={{ margin: 0 }}>
              Not fulfilled ~ still on {request.reference}
            </h3>
            {outstanding.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/restocks/${request.id}/fulfil`)}
              >
                Fulfil the rest
              </button>
            )}
          </div>

          {outstanding.length === 0 ? (
            <div className="empty-state">
              <p>Nothing outstanding.</p>
              <p className="page-desc">Everything asked for has been covered.</p>
            </div>
          ) : (
            <LineGroups images={images} lines={outstanding} limit={50} />
          )}
        </div>
      )}

      {siblings.length > 0 && (
        <div className="card">
          <h3 className="section-title">Other fulfilments for {request?.reference}</h3>
          <p className="page-desc" style={{ marginBottom: 12 }}>
            This request has been covered from more than one location.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Reference</th><th>From</th><th>Created</th><th className="num">Items</th><th></th></tr>
              </thead>
              <tbody>
                {siblings.map((sib) => (
                  <tr key={sib.id}>
                    <td className="cell-strong">{sib.reference}</td>
                    <td>{sib.source?.name || '-'}</td>
                    <td>{formatDate(sib.created_at)}</td>
                    <td className="num">
                      {(sib.restock_order_lines ?? []).reduce((n, l) => n + (l.qty_sent || 0), 0)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn"
                        onClick={() => navigate(`/restocks/orders/${sib.id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
