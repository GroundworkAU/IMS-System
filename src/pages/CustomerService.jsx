import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OrderIssuesModal from '../components/OrderIssuesModal'
import { useIntegrationConfigs, orderAdminUrl } from '../lib/platformLinks'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function CustomerService() {
  const navigate = useNavigate()
  const configs = useIntegrationConfigs()

  const [openReturns, setOpenReturns] = useState(0)
  const [openIssues, setOpenIssues] = useState(0)
  const [attention, setAttention] = useState([])
  const [issueOrderIds, setIssueOrderIds] = useState(new Set())
  const [issuesFor, setIssuesFor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()

    const [ret, iss, unfulfilled, openIssueOrders] = await Promise.all([
      supabase.from('returns').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('order_issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase
        .from('orders')
        .select('id, order_number, external_order_id, status, order_date, total, customers(first_name, last_name, email), sales_channels(platform)')
        .not('status', 'in', '("Shipped","Completed","Cancelled","Declined","Refunded","Partially Refunded","Disputed","Incomplete")')
        .lte('order_date', threeDaysAgo)
        .order('order_date', { ascending: true })
        .limit(50),
      supabase.from('order_issues').select('order_id').eq('status', 'open'),
    ])

    if (unfulfilled.error) setStatus({ type: 'err', text: unfulfilled.error.message })

    setOpenReturns(ret.count ?? 0)
    setOpenIssues(iss.count ?? 0)
    setAttention(unfulfilled.data ?? [])
    setIssueOrderIds(new Set((openIssueOrders.data ?? []).map((o) => o.order_id).filter(Boolean)))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Service</div>
        <h2 className="page-title">Customer Service</h2>
        <p className="page-desc">
          What needs attention today ~ returns waiting on a refund, issues raised against an
          order, and orders that have been sitting too long.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <button className="card stat-card" onClick={() => navigate('/returns')}>
          <span className="stat-label">Open returns</span>
          <span className="stat-value">{openReturns}</span>
          <span className="stat-note">Logged but not yet refunded</span>
        </button>

        <button className="card stat-card" onClick={() => navigate('/order-issues')}>
          <span className="stat-label">Open order issues</span>
          <span className="stat-value">{openIssues}</span>
          <span className="stat-note">Raised and waiting on someone</span>
        </button>

        <button
          className="card stat-card"
          onClick={() =>
            document.getElementById('needs-attention')?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          <span className="stat-label">Waiting 3+ days</span>
          <span className="stat-value">{attention.length}</span>
          <span className="stat-note">Orders placed but not yet shipped</span>
        </button>
      </div>

      <div className="card" id="needs-attention">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Needs attention</h3>
          <button className="btn" onClick={() => navigate('/orders')}>All orders</button>
        </div>

        <p className="page-desc" style={{ marginBottom: 14 }}>
          Orders placed three or more days ago that have not shipped, oldest first.
        </p>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : attention.length === 0 ? (
          <div className="empty-state">
            <p>Nothing waiting.</p>
            <p className="page-desc">Every order placed more than three days ago has shipped.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Placed</th><th>Waiting</th><th>Status</th></tr>
              </thead>
              <tbody>
                {attention.map((o) => {
                  const days = Math.floor((Date.now() - new Date(o.order_date)) / 86400000)
                  const url = orderAdminUrl(configs, o.sales_channels?.platform, o.external_order_id)
                  return (
                    <tr key={o.id}>
                      <td>
                        {url ? (
                          <a
                            className="cell-strong order-link"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{o.order_number}
                          </a>
                        ) : (
                          <span className="cell-strong">#{o.order_number}</span>
                        )}
                        {issueOrderIds.has(o.id) && (
                          <button
                            className="flag-pill flag-pill-button"
                            title="See the issue raised on this order"
                            onClick={() => setIssuesFor(o)}
                          >
                            Issue
                          </button>
                        )}
                      </td>
                      <td>
                        {[o.customers?.first_name, o.customers?.last_name].filter(Boolean).join(' ')
                          || o.customers?.email || 'Guest'}
                      </td>
                      <td>{formatDate(o.order_date)}</td>
                      <td>
                        <span className={days >= 7 ? 'days-bad' : 'days-warn'}>
                          {days} day{days === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td><span className="status-pill warn">{o.status}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {issuesFor && (
        <OrderIssuesModal
          orderId={issuesFor.id}
          orderNumber={issuesFor.order_number}
          onClose={() => setIssuesFor(null)}
        />
      )}
    </div>
  )
}
