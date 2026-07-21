import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

// Shows every issue raised against a single order. Used from the issue pill on
// the Orders list and on the customer service overview.
export default function OrderIssuesModal({ orderId, orderNumber, onClose }) {
  const [issues, setIssues] = useState(null)

  useEffect(() => {
    supabase
      .from('order_issues')
      .select('id,reference,reason,detail,status,created_at,resolved_at,resolution_note,raised:raised_by(full_name),resolver:resolved_by(full_name),order_issue_lines(id,qty,note,order_lines(name,sku))')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setIssues(data ?? []))
  }, [orderId])

  return (
    <Modal
      title={`Issues on order ${orderNumber ? '#' + orderNumber : ''}`}
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}
    >
      {issues === null ? (
        <p className="field-hint">Loading...</p>
      ) : issues.length === 0 ? (
        <p className="field-hint">No issues raised against this order.</p>
      ) : (
        <div className="issue-stack">
          {issues.map((i) => (
            <div key={i.id} className="issue-block">
              <div className="issue-block-head">
                <span className="cell-strong">{i.reason}</span>
                {i.status === 'resolved' ? (
                  <span className="status-pill ok">Resolved</span>
                ) : i.status === 'cancelled' ? (
                  <span className="status-pill neutral">Cancelled</span>
                ) : (
                  <span className="status-pill warn">Open</span>
                )}
              </div>

              <p className="cell-sub" style={{ marginTop: 4 }}>
                {i.reference} · raised {formatDate(i.created_at)} by {i.raised?.full_name || 'Unknown'}
              </p>

              {i.detail && <p className="issue-detail">{i.detail}</p>}

              {(i.order_issue_lines ?? []).length > 0 && (
                <div className="item-list" style={{ marginTop: 10 }}>
                  {i.order_issue_lines.map((l) => (
                    <div key={l.id} className="item-line">
                      <span className="item-qty">{l.qty ?? '-'}</span>
                      <span>
                        <span className="item-name">{l.order_lines?.name || 'Item'}</span>
                        <span className="cell-sub">
                          {l.order_lines?.sku || 'No SKU'}
                          {l.note ? ` \u00b7 ${l.note}` : ''}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {i.status === 'resolved' && (
                <p className="cell-sub" style={{ marginTop: 10 }}>
                  Resolved {formatDate(i.resolved_at)} by {i.resolver?.full_name || 'Unknown'}
                  {i.resolution_note ? ` ~ ${i.resolution_note}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
