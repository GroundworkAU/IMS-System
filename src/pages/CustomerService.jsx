import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { syncOrders, loadOrderLines } from '../lib/integrations'
import Modal from '../components/Modal'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function CustomerService() {
  const { org } = useAuth()
  const [orders, setOrders] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState(null)
  const [viewing, setViewing] = useState(null)

  const connected = (org?.platforms ?? []).includes('bigcommerce')

  const load = useCallback(async (search = '') => {
    setLoading(true)
    let q = supabase
      .from('orders')
      .select('id, order_number, status, financial_status, order_date, total, raw, customers(first_name, last_name, email)')
      .order('order_date', { ascending: false })
      .limit(100)

    if (search.trim()) {
      q = q.ilike('order_number', `%${search.trim()}%`)
    }
    const { data, error } = await q
    if (error) setStatus({ type: 'err', text: error.message })
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSync() {
    setSyncing(true)
    setStatus(null)
    const res = await syncOrders('bigcommerce')
    setSyncing(false)
    if (res.ok) {
      setStatus({ type: 'ok', text: `Brought in ${res.imported} orders.` })
      load(query)
    } else {
      setStatus({ type: 'err', text: res.error || 'Sync failed.' })
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
        <h2 className="page-title">Customer Service</h2>
        <p className="page-desc">
          Recent online orders, so you and the warehouse can answer questions and log returns
          against the real order rather than digging through inboxes.
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
          <div className="search-wrap">
            <input
              className="input"
              placeholder="Search by order number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(query)}
            />
            <button className="btn" onClick={() => load(query)}>Search</button>
            {query && (
              <button className="btn btn-quiet" onClick={() => { setQuery(''); load('') }}>
                Clear
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !connected}>
            {syncing ? 'Bringing orders in...' : 'Sync orders'}
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <p>No orders yet.</p>
            <p className="page-desc">
              {connected
                ? 'Hit Sync orders to bring across the last few months from BigCommerce.'
                : 'Once BigCommerce is connected you can sync your orders here.'}
            </p>
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
                    <td><span className="pill">{o.status || 'Unknown'}</span></td>
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
        <div><span className="detail-label">Status</span>{order.status || '-'}</div>
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
