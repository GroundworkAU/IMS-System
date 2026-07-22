import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

export default function PurchaseOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select('id,reference,order_year,order_type,status,created_at,pushed_at,source_file_name,brands(name),suppliers(name),purchase_order_lines(qty_ordered,unit_cost)')
      .order('created_at', { ascending: false })
      .limit(100)
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn"
                          onClick={() => navigate(`/purchase-orders/${o.id}`)}
                        >
                          View
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
