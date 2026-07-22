import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

export default function PurchaseOrders() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [orders, setOrders] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select('id,reference,order_year,order_type,status,created_at,pushed_at,source_file_name,created_by,brands(name),suppliers(name),purchase_order_lines(qty_ordered,unit_cost),po_products(pushed_at)')
      .order('created_at', { ascending: false })
      .limit(100)
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(o) {
    const pushed = o.pushed_at || (o.po_products ?? []).some((p) => p.pushed_at)
    const warning = pushed
      ? `Delete ${o.reference}? Products already created in Lightspeed stay there ~ this only removes the order from IMS.`
      : `Delete ${o.reference}? Its lines go with it and this cannot be undone.`

    if (!window.confirm(warning)) return

    const { error } = await supabase.from('purchase_orders').delete().eq('id', o.id)
    if (error) {
      setStatus({
        type: 'err',
        text: error.message.includes('policy')
          ? 'You can only delete orders you imported. Ask an owner or admin.'
          : error.message,
      })
    } else {
      setStatus({ type: 'ok', text: `${o.reference} deleted.` })
      load()
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">Purchase Orders</h2>
        <p className="page-desc">
          Orders placed with your brands. Import the confirmation they send and IMS turns their
          size grid into product lines ready to create in your point of sale.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>
            {orders.length} order{orders.length === 1 ? '' : 's'}
          </h3>
          <button className="btn btn-primary" onClick={() => navigate('/purchase-orders/import')}>
            Import a supplier order
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <p>No orders yet.</p>
            <p className="page-desc">
              Import a confirmation from a supplier to get started. Their file usually has sizes
              across the columns ~ we will unpick that for you.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th><th>Brand</th><th>Season</th><th>Type</th>
                  <th className="num">Units</th><th className="num">Value</th>
                  <th>Pushed</th><th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const lines = o.purchase_order_lines ?? []
                  const units = lines.reduce((n, l) => n + (l.qty_ordered || 0), 0)
                  const value = lines.reduce(
                    (n, l) => n + (l.qty_ordered || 0) * Number(l.unit_cost || 0), 0
                  )
                  return (
                    <tr key={o.id}>
                      <td>
                        <div className="cell-strong">{o.reference}</div>
                        <div className="cell-sub">{o.suppliers?.name}</div>
                      </td>
                      <td>{o.brands?.name || '-'}</td>
                      <td>{o.order_year}</td>
                      <td>
                        <span className="pill">
                          {o.order_type === 'indent' ? 'Indent' : 'New'}
                        </span>
                      </td>
                      <td className="num">{units}</td>
                      <td className="num">{money(value)}</td>
                      <td>
                        {o.pushed_at
                          ? <span className="status-pill ok">{formatDate(o.pushed_at)}</span>
                          : <span className="status-pill neutral">Not yet</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          className="btn"
                          onClick={() => navigate(`/purchase-orders/${o.id}`)}
                        >
                          View
                        </button>{' '}
                        <button className="btn btn-quiet" onClick={() => remove(o)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
