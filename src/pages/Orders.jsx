import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { syncOrders, loadOrderLines } from '../lib/integrations'
import Modal from '../components/Modal'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

// Colour the status so the list can be scanned at a glance.
// Note the platform spells it 'Fulfillment', so match loosely.
function statusTone(status) {
  const v = String(status || '').toLowerCase()
  if (!v) return 'neutral'
  if (v.includes('shipped') && !v.includes('partially')) return 'ok'
  if (v.includes('completed')) return 'ok'
  if (v.includes('cancel') || v.includes('declined') || v.includes('disputed')) return 'bad'
  if (v.includes('refunded')) return 'info'
  if (
    v.includes('awaiting') || v.includes('pending') ||
    v.includes('partially') || v.includes('verification')
  ) return 'warn'
  return 'neutral'
}

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function Orders() {
  const { org } = useAuth()
  const [orders, setOrders] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusOptions, setStatusOptions] = useState([])

  const connected = (org?.platforms ?? []).includes('bigcommerce')

  const load = useCallback(async (opts = {}) => {
    const {
      search = query,
      status: statusVal = statusFilter,
      from = fromDate,
      to = toDate,
    } = opts

    setLoading(true)
    let q = supabase
      .from('orders')
      .select('id, order_number, status, financial_status, order_date, total, raw, customers(first_name, last_name, email)')
      // Incomplete orders are abandoned carts, never real orders.
      .not('status', 'ilike', 'incomplete')
      .order('order_date', { ascending: false })
      .limit(200)

    if (search.trim()) q = q.ilike('order_number', `%${search.trim()}%`)
    if (statusVal) q = q.eq('status', statusVal)
    if (from) q = q.gte('order_date', new Date(`${from}T00:00:00`).toISOString())
    if (to) q = q.lte('order_date', new Date(`${to}T23:59:59`).toISOString())

    const { data, error } = await q
    if (error) setStatus({ type: 'err', text: error.message })
    setOrders(data ?? [])
    setLoading(false)
  }, [query, statusFilter, fromDate, toDate])

  useEffect(() => { load({}) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Offer only the statuses this business actually has.
  useEffect(() => {
    supabase
      .from('orders')
      .select('status')
      .not('status', 'ilike', 'incomplete')
      .limit(1000)
      .then(({ data }) => {
        const seen = [...new Set((data ?? []).map((o) => o.status).filter(Boolean))]
        setStatusOptions(seen.sort())
      })
  }, [orders.length])

  async function handleSync() {
    setSyncing(true)
    setStatus(null)
    const res = await syncOrders('bigcommerce')
    setSyncing(false)
    if (!res.ok) {
      setStatus({ type: 'err', text: res.error || 'Sync failed.' })
    } else if (res.error) {
      // Orders came back from the platform but could not be saved.
      setStatus({
        type: 'err',
        text: `Found ${res.fetched} orders but could not save them: ${res.error}`,
      })
    } else if (res.fetched === 0) {
      setStatus({
        type: 'err',
        text: 'BigCommerce returned no orders. Check the API account has read access to Orders.',
      })
    } else {
      const bits = [`Brought in ${res.imported} of ${res.fetched} orders`]
      if (res.removedIncomplete > 0) {
        bits.push(`cleared ${res.removedIncomplete} abandoned cart${res.removedIncomplete === 1 ? '' : 's'}`)
      }
      setStatus({ type: 'ok', text: bits.join(', ') + '.' })
      load({})
    }
  }

  const customerName = (o) =>
    o.customers
      ? [o.customers.first_name, o.customers.last_name].filter(Boolean).join(' ') || o.customers.email
      : o.raw?.billing_name || 'Guest'

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Service</div>
        <h2 className="page-title">Orders</h2>
        <p className="page-desc">
          Every online order in one list. Search by order number, open one to see the customer
          and what they bought.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      {!connected && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="placeholder-note">
            Connect BigCommerce in Settings to bring your orders across.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>
            {orders.length} order{orders.length === 1 ? '' : 's'}
          </h3>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !connected}>
            {syncing ? 'Bringing orders in...' : 'Sync orders'}
          </button>
        </div>

        <div className="filter-bar">
          <div className="filter-field" style={{ flex: '2 1 220px' }}>
            <label htmlFor="f-search">Order number</label>
            <input
              id="f-search"
              className="input"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load({})}
            />
          </div>

          <div className="filter-field" style={{ flex: '2 1 180px' }}>
            <label htmlFor="f-status">Status</label>
            <select
              id="f-status"
              className="input"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); load({ status: e.target.value }) }}
            >
              <option value="">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="filter-field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              className="input"
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); load({ from: e.target.value }) }}
            />
          </div>

          <div className="filter-field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="f-to">To</label>
            <input
              id="f-to"
              className="input"
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); load({ to: e.target.value }) }}
            />
          </div>

          <div className="filter-actions">
            <button className="btn" onClick={() => load({})}>Apply</button>
            {(query || statusFilter || fromDate || toDate) && (
              <button
                className="btn btn-quiet"
                onClick={() => {
                  setQuery(''); setStatusFilter(''); setFromDate(''); setToDate('')
                  load({ search: '', status: '', from: '', to: '' })
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            {query || statusFilter || fromDate || toDate ? (
              <>
                <p>No orders match those filters.</p>
                <p className="page-desc">Try widening the dates or clearing the status.</p>
              </>
            ) : (
              <>
                <p>No orders yet.</p>
                <p className="page-desc">
                  {connected
                    ? 'Hit Sync orders to bring across the last few months from BigCommerce.'
                    : 'Once BigCommerce is connected you can sync your orders here.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>Date</th>
                  <th>Status</th><th>Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="cell-strong">#{o.order_number}</td>
                    <td>
                      <div>{customerName(o)}</div>
                      {o.customers?.email && <div className="cell-sub">{o.customers.email}</div>}
                    </td>
                    <td>{formatDate(o.order_date)}</td>
                    <td>
                      <span className={`status-pill ${statusTone(o.status)}`}>
                        {o.status || 'Unknown'}
                      </span>
                    </td>
                    <td>{money(o.total)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn" onClick={() => setViewing(o)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && <OrderModal order={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function OrderModal({ order, onClose }) {
  const [lines, setLines] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function go() {
      const res = await loadOrderLines(order.id)
      if (cancelled) return
      if (res.ok) setLines(res.lines ?? [])
      else { setError(res.error); setLines([]) }
    }
    go()
    return () => { cancelled = true }
  }, [order])

  const name = order.customers
    ? [order.customers.first_name, order.customers.last_name].filter(Boolean).join(' ')
    : order.raw?.billing_name

  return (
    <Modal title={`Order #${order.order_number}`} onClose={onClose}>
      <div className="detail-grid">
        <div><span className="detail-label">Customer</span>{name || 'Guest'}</div>
        <div><span className="detail-label">Email</span>{order.customers?.email || order.raw?.email || '-'}</div>
        <div><span className="detail-label">Phone</span>{order.raw?.phone || '-'}</div>
        <div><span className="detail-label">Placed</span>{formatDate(order.order_date)}</div>
        <div>
          <span className="detail-label">Status</span>
          <span className={`status-pill ${statusTone(order.status)}`}>
            {order.status || '-'}
          </span>
        </div>
        <div><span className="detail-label">Payment</span>{order.financial_status || '-'}</div>
      </div>

      <h4 className="sub-label">Items</h4>
      {lines === null ? (
        <p className="field-hint">Loading items...</p>
      ) : error ? (
        <p className="field-hint">Could not load items: {error}</p>
      ) : lines.length === 0 ? (
        <p className="field-hint">No items found on this order.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.sku || '-'}</td>
                <td>{l.qty}</td>
                <td>{money(l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="detail-total">
        <span>Order total</span>
        <strong>{money(order.total)}</strong>
      </div>
    </Modal>
  )
}
