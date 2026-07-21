import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { loadOrderLines } from '../lib/integrations'
import Modal from '../components/Modal'
import { nextReference } from '../lib/references'
import OrderIssuesModal from '../components/OrderIssuesModal'
import { useIntegrationConfigs, orderAdminUrl } from '../lib/platformLinks'
import { useNavigate } from 'react-router-dom'

// Sensible starting set. requires_items decides whether the person raising the
// issue has to say which products are affected.
const DEFAULT_REASONS = [
  { label: 'Item missing from order', requires_items: true },
  { label: 'Item damaged in transit', requires_items: true },
  { label: 'Wrong item picked', requires_items: true },
  { label: 'Product not in warehouse system', requires_items: true },
  { label: 'Stock discrepancy', requires_items: true },
  { label: 'Cannot fulfil ~ out of stock', requires_items: true },
  { label: 'Address issue', requires_items: false },
  { label: 'Phone number issue', requires_items: false },
  { label: 'Email issue', requires_items: false },
  { label: 'Customer query', requires_items: false },
  { label: 'Something else', requires_items: false },
]

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export default function CustomerService() {
  const { profile, isAdmin } = useAuth()
  const [issues, setIssues] = useState([])
  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [tab, setTab] = useState('open')
  const [creating, setCreating] = useState(false)
  const [managingReasons, setManagingReasons] = useState(false)
  const [resolving, setResolving] = useState(null)
  const [editing, setEditing] = useState(null)
  const [openReturns, setOpenReturns] = useState(0)
  const [attention, setAttention] = useState([])
  const [issueOrderIds, setIssueOrderIds] = useState(new Set())
  const [issuesFor, setIssuesFor] = useState(null)
  const navigate = useNavigate()
  const configs = useIntegrationConfigs()

  const load = useCallback(async () => {
    setLoading(true)
    const [i, r] = await Promise.all([
      supabase.from('order_issues')
        .select('id,reference,order_number,reason,detail,status,created_at,resolved_at,resolution_note,raised:raised_by(full_name),resolver:resolved_by(full_name),orders(id,order_date,external_order_id,sales_channels(platform),customers(first_name,last_name,email)),order_issue_lines(id,qty,note,order_lines(name,sku))')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('issue_reasons')
        .select('id, label, requires_items, sort_order, is_active')
        .order('sort_order').order('label'),
    ])
    if (i.error) setStatus({ type: 'err', text: i.error.message })
    setIssues(i.data ?? [])
    setReasons(r.data ?? [])

    // ---- overview -------------------------------------------------------
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()

    const [ret, unfulfilled, openIssueOrders] = await Promise.all([
      supabase.from('returns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open'),
      // Anything still waiting, placed three or more days ago.
      supabase.from('orders')
        .select('id, order_number, external_order_id, status, order_date, total, customers(first_name, last_name, email), sales_channels(platform)')
        .not('status', 'in', '("Shipped","Completed","Cancelled","Declined","Refunded","Partially Refunded","Disputed","Incomplete")')
        .lte('order_date', threeDaysAgo)
        .order('order_date', { ascending: true })
        .limit(50),
      supabase.from('order_issues').select('order_id').eq('status', 'open'),
    ])

    setOpenReturns(ret.count ?? 0)
    setAttention(unfulfilled.data ?? [])
    setIssueOrderIds(new Set((openIssueOrders.data ?? []).map((o) => o.order_id).filter(Boolean)))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openIssues = issues.filter((i) => i.status === 'open')
  const closedIssues = issues.filter((i) => i.status !== 'open')
  const visible = tab === 'open' ? openIssues : tab === 'closed' ? closedIssues : issues

  const customerName = (i) => {
    const c = i.orders?.customers
    if (!c) return 'Guest'
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Guest'
  }

  const canManage = (i) => isAdmin || i.raised?.full_name === profile?.full_name

  async function removeIssue(i) {
    if (!window.confirm(`Delete ${i.reference}? This cannot be undone.`)) return
    const { error } = await supabase.from('order_issues').delete().eq('id', i.id)
    if (error) {
      setStatus({
        type: 'err',
        text: error.message.includes('policy')
          ? 'You can only delete issues you raised. Ask an owner or admin.'
          : error.message,
      })
    } else {
      setStatus({ type: 'ok', text: 'Issue deleted.' })
      load()
    }
  }

  async function reopen(issue) {
    const { error } = await supabase
      .from('order_issues')
      .update({ status: 'open', resolved_at: null, resolved_by: null, resolution_note: null })
      .eq('id', issue.id)
    if (error) setStatus({ type: 'err', text: error.message })
    else load()
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Service</div>
        <h2 className="page-title">Customer Service</h2>
        <p className="page-desc">
          Problems raised against an order ~ missing or damaged items, stock that will not
          fulfil, or a wrong address. Everyone sees the same list, so nothing gets lost in email.
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

        <button
          className="card stat-card"
          onClick={() => {
            setTab('open')
            document.getElementById('issues-list')?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          <span className="stat-label">Open order issues</span>
          <span className="stat-value">{openIssues.length}</span>
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

      {attention.length > 0 && (
        <div className="card" id="needs-attention" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Needs attention</h3>
          <p className="page-desc" style={{ marginBottom: 14 }}>
            Orders placed three or more days ago that have not shipped, oldest first.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Placed</th><th>Waiting</th><th>Status</th></tr>
              </thead>
              <tbody>
                {attention.map((o) => {
                  const days = Math.floor((Date.now() - new Date(o.order_date)) / 86400000)
                  return (
                    <tr key={o.id}>
                      <td>
                        {(() => {
                          const url = orderAdminUrl(
                            configs, o.sales_channels?.platform, o.external_order_id
                          )
                          return url ? (
                            <a
                              className="cell-strong order-link"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open this order in the sales platform"
                            >
                              #{o.order_number}
                            </a>
                          ) : (
                            <span className="cell-strong">#{o.order_number}</span>
                          )
                        })()}
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
        </div>
      )}

      <div className="card" id="issues-list">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Order issues</h3>
          <div className="search-wrap">
            {isAdmin && (
              <button className="btn" onClick={() => setManagingReasons(true)}>
                Issue reasons
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Raise an issue
            </button>
          </div>
        </div>

        <div className="tabs">
          {[
            { key: 'open', label: 'Open', count: openIssues.length },
            { key: 'closed', label: 'Closed', count: closedIssues.length },
            { key: 'all', label: 'All', count: issues.length },
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

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {issues.length === 0 ? (
              <>
                <p>No issues raised.</p>
                <p className="page-desc">
                  When something is wrong with an order, raise it here against the order itself.
                </p>
              </>
            ) : tab === 'open' ? (
              <>
                <p>Nothing open.</p>
                <p className="page-desc">Every issue has been resolved or cancelled.</p>
              </>
            ) : (
              <>
                <p>Nothing closed yet.</p>
                <p className="page-desc">Issues appear here once resolved or cancelled.</p>
              </>
            )}
          </div>
        ) : (
          <div className="return-list">
            {visible.map((i) => (
              <article key={i.id} className="return-card">
                <header className="return-card-head">
                  <div className="return-ident">
                    {(() => {
                      const url = orderAdminUrl(
                        configs, i.orders?.sales_channels?.platform, i.orders?.external_order_id
                      )
                      return url ? (
                        <a
                          className="return-order order-link"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          title="Open this order in the sales platform"
                        >
                          #{i.order_number}
                        </a>
                      ) : (
                        <span className="return-order">
                          {i.order_number ? `#${i.order_number}` : 'No order'}
                        </span>
                      )
                    })()}
                    <span className="return-customer">{customerName(i)}</span>
                  </div>

                  <div className="return-card-actions">
                    {i.status === 'resolved' ? (
                      <span className="status-pill ok">Resolved</span>
                    ) : i.status === 'cancelled' ? (
                      <span className="status-pill neutral">Cancelled</span>
                    ) : (
                      <span className="status-pill warn">Open</span>
                    )}

                    {i.status === 'open' ? (
                      <button className="btn btn-primary" onClick={() => setResolving(i)}>
                        Resolve
                      </button>
                    ) : (
                      <button className="btn btn-quiet" onClick={() => reopen(i)}>Reopen</button>
                    )}
                    <button className="btn" onClick={() => setEditing(i)}>Edit</button>
                    {canManage(i) && (
                      <button className="btn btn-quiet" onClick={() => removeIssue(i)}>
                        Delete
                      </button>
                    )}
                  </div>
                </header>

                <div className="return-card-body">
                  <dl className="return-facts">
                    <div>
                      <dt>Issue</dt>
                      <dd>{i.reason}</dd>
                    </div>
                    <div>
                      <dt>Raised</dt>
                      <dd>
                        {formatDate(i.created_at)}
                        <span className="cell-sub">by {i.raised?.full_name || 'Unknown'}</span>
                      </dd>
                    </div>
                    {i.detail && (
                      <div>
                        <dt>Notes</dt>
                        <dd>{i.detail}</dd>
                      </div>
                    )}
                    {i.status === 'resolved' && (
                      <div>
                        <dt>Resolved</dt>
                        <dd>
                          {formatDate(i.resolved_at)}
                          <span className="cell-sub">by {i.resolver?.full_name || 'Unknown'}</span>
                          {i.resolution_note && (
                            <span className="cell-sub">{i.resolution_note}</span>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="return-items">
                    <span className="panel-label">Items affected</span>
                    {(i.order_issue_lines ?? []).length === 0 ? (
                      <p className="cell-sub" style={{ marginTop: 8 }}>
                        Not item specific.
                      </p>
                    ) : (
                      <div className="item-list">
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
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <RaiseIssueModal
          reasons={reasons.filter((r) => r.is_active)}
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            setStatus({ type: 'ok', text: 'Issue raised.' })
            load()
          }}
        />
      )}

      {resolving && (
        <ResolveModal
          issue={resolving}
          profile={profile}
          onClose={() => setResolving(null)}
          onSaved={() => {
            setResolving(null)
            setStatus({ type: 'ok', text: 'Issue resolved.' })
            load()
          }}
        />
      )}

      {editing && (
        <EditIssueModal
          issue={editing}
          reasons={reasons.filter((r) => r.is_active)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setStatus({ type: 'ok', text: 'Issue updated.' })
            load()
          }}
        />
      )}

      {issuesFor && (
        <OrderIssuesModal
          orderId={issuesFor.id}
          orderNumber={issuesFor.order_number}
          onClose={() => setIssuesFor(null)}
        />
      )}

      {managingReasons && (
        <IssueReasonsModal
          profile={profile}
          initial={reasons}
          onClose={() => setManagingReasons(false)}
          onChanged={load}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raise an issue: find the order, pick a reason, and only pick items when the
// reason actually concerns products.
// ---------------------------------------------------------------------------
function RaiseIssueModal({ reasons, profile, onClose, onSaved }) {
  const [step, setStep] = useState('find')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [order, setOrder] = useState(null)
  const [lines, setLines] = useState([])
  const [reasonId, setReasonId] = useState('')
  const [selected, setSelected] = useState({})
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const reason = reasons.find((r) => r.id === reasonId)
  const needsItems = !!reason?.requires_items

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, order_date, raw, customers(first_name, last_name, email)')
      .ilike('order_number', `%${query.trim()}%`)
      .not('status', 'ilike', 'incomplete')
      .order('order_date', { ascending: false })
      .limit(10)
    setResults(data ?? [])
    setSearching(false)
  }

  async function chooseOrder(o) {
    setOrder(o)
    setStep('details')
    const res = await loadOrderLines(o.id)
    if (res.ok) setLines(res.lines ?? [])
    else setError(res.error)
  }

  function toggleLine(line) {
    setSelected((s) => {
      const next = { ...s }
      if (next[line.id]) delete next[line.id]
      else next[line.id] = { qty: line.qty, note: '' }
      return next
    })
  }

  async function save() {
    if (!reasonId) return setError('Choose what the issue is.')
    const chosen = Object.entries(selected)
    if (needsItems && chosen.length === 0) {
      return setError('This kind of issue needs at least one item selected.')
    }

    setBusy(true)
    setError(null)

    const reference = await nextReference('issue', 'ISS-')

    const { data: created, error: iErr } = await supabase
      .from('order_issues')
      .insert({
        org_id: profile.org_id,
        reference,
        order_id: order.id,
        order_number: order.order_number,
        reason: reason.label,
        detail: detail.trim() || null,
        status: 'open',
        raised_by: profile.id,
      })
      .select('id')
      .single()

    if (iErr) { setBusy(false); return setError(iErr.message) }

    if (needsItems && chosen.length > 0) {
      const rows = chosen.map(([lineId, v]) => ({
        org_id: profile.org_id,
        issue_id: created.id,
        order_line_id: lineId,
        qty: Number(v.qty) || null,
        note: v.note?.trim() || null,
      }))
      const { error: lErr } = await supabase.from('order_issue_lines').insert(rows)
      if (lErr) { setBusy(false); return setError(lErr.message) }
    }

    setBusy(false)
    onSaved()
  }

  return (
    <Modal
      title="Raise an order issue"
      onClose={onClose}
      footer={
        step === 'details' ? (
          <>
            <button className="btn" onClick={() => setStep('find')}>Back</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving...' : 'Raise issue'}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>Cancel</button>
        )
      }
    >
      {step === 'find' && (
        <>
          <div className="field">
            <label htmlFor="i-search">Order number</label>
            <div className="search-wrap">
              <input
                id="i-search"
                className="input"
                placeholder="e.g. 1220009112"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              <button className="btn" onClick={search} disabled={searching}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {results.length > 0 && (
            <div className="result-list">
              {results.map((o) => (
                <button key={o.id} className="result-row" onClick={() => chooseOrder(o)}>
                  <span>
                    <strong>#{o.order_number}</strong>
                    <span className="cell-sub">
                      {[o.customers?.first_name, o.customers?.last_name].filter(Boolean).join(' ') ||
                        o.raw?.billing_name || 'Guest'}
                    </span>
                  </span>
                  <span className="cell-sub">{formatDate(o.order_date)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'details' && order && (
        <>
          <div className="chosen-order">
            <strong>#{order.order_number}</strong>
            <span className="cell-sub">
              {[order.customers?.first_name, order.customers?.last_name].filter(Boolean).join(' ') ||
                order.raw?.billing_name || 'Guest'} · {formatDate(order.order_date)}
            </span>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="i-reason">What is the issue?</label>
            <select
              id="i-reason"
              className="input"
              value={reasonId}
              onChange={(e) => { setReasonId(e.target.value); setSelected({}) }}
            >
              <option value="">Choose...</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {reasons.length === 0 && (
              <p className="field-hint">
                No issue reasons set up yet. An owner or admin can add them with the Issue
                reasons button.
              </p>
            )}
          </div>

          {needsItems && (
            <>
              <h4 className="sub-label">Which items?</h4>
              {lines.length === 0 ? (
                <p className="field-hint">Loading items from the order...</p>
              ) : (
                <div className="line-picker">
                  {lines.map((l) => {
                    const chosen = selected[l.id]
                    return (
                      <div key={l.id} className={'line-row' + (chosen ? ' selected' : '')}>
                        <label className="check-row">
                          <input type="checkbox" checked={!!chosen} onChange={() => toggleLine(l)} />
                          <span>
                            <span className="cell-strong">{l.name}</span>
                            <span className="cell-sub">{l.sku || 'No SKU'} · ordered {l.qty}</span>
                          </span>
                        </label>

                        {chosen && (
                          <div className="line-controls">
                            <label>
                              Qty affected
                              <input
                                className="input mini"
                                type="number"
                                min="1"
                                max={l.qty}
                                value={chosen.qty}
                                onChange={(e) =>
                                  setSelected({ ...selected, [l.id]: { ...chosen, qty: e.target.value } })
                                }
                              />
                            </label>
                            <label style={{ flex: '1 1 160px' }}>
                              Note
                              <input
                                className="input mini"
                                placeholder="e.g. box crushed"
                                value={chosen.note}
                                onChange={(e) =>
                                  setSelected({ ...selected, [l.id]: { ...chosen, note: e.target.value } })
                                }
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="i-detail">
              {needsItems ? 'Anything else? (optional)' : 'What is wrong? (optional)'}
            </label>
            <textarea
              id="i-detail"
              className="input"
              rows="3"
              placeholder={
                needsItems
                  ? 'Extra context for whoever picks this up'
                  : 'e.g. customer has given a new delivery address'
              }
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

function ResolveModal({ issue, profile, onClose, onSaved }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(cancelled = false) {
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('order_issues')
      .update({
        status: cancelled ? 'cancelled' : 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: profile.id,
        resolution_note: note.trim() || null,
      })
      .eq('id', issue.id)
    setBusy(false)
    if (error) setError(error.message)
    else onSaved()
  }

  return (
    <Modal
      title={`Resolve ${issue.reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-quiet" onClick={() => save(true)} disabled={busy}>
            Cancel issue
          </button>
          <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? 'Saving...' : 'Mark resolved'}
          </button>
        </>
      }
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        {issue.reason} on order {issue.order_number ? `#${issue.order_number}` : ''}.
      </p>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="res-note">What was done? (optional)</label>
        <textarea
          id="res-note"
          className="input"
          rows="3"
          placeholder="e.g. replacement sent, customer notified"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

function IssueReasonsModal({ profile, initial, onClose, onChanged }) {
  const [items, setItems] = useState(initial)
  const [newLabel, setNewLabel] = useState('')
  const [newNeedsItems, setNewNeedsItems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function refresh() {
    const { data } = await supabase
      .from('issue_reasons')
      .select('id, label, requires_items, sort_order, is_active')
      .order('sort_order').order('label')
    setItems(data ?? [])
    onChanged()
  }

  async function add() {
    const label = newLabel.trim()
    if (!label) return
    setBusy(true)
    const { error } = await supabase.from('issue_reasons').insert({
      org_id: profile.org_id,
      label,
      requires_items: newNeedsItems,
      sort_order: items.length,
    })
    setBusy(false)
    if (error) setError(error.code === '23505' ? 'That reason already exists.' : error.message)
    else { setNewLabel(''); setNewNeedsItems(false); refresh() }
  }

  async function addDefaults() {
    setBusy(true)
    const rows = DEFAULT_REASONS.map((r, i) => ({
      org_id: profile.org_id,
      label: r.label,
      requires_items: r.requires_items,
      sort_order: i,
    }))
    const { error } = await supabase.from('issue_reasons').insert(rows)
    setBusy(false)
    if (error) setError(error.message)
    else refresh()
  }

  async function update(item, patch) {
    const { error } = await supabase.from('issue_reasons').update(patch).eq('id', item.id)
    if (error) setError(error.message)
    else refresh()
  }

  async function remove(item) {
    if (!window.confirm(`Remove "${item.label}"? Issues already raised keep their reason.`)) return
    const { error } = await supabase.from('issue_reasons').delete().eq('id', item.id)
    if (error) setError(error.message)
    else refresh()
  }

  return (
    <Modal
      title="Issue reasons"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        Reasons your team picks from. Tick <strong>items</strong> where the issue is about
        specific products ~ those reasons will ask which items are affected. Leave it unticked
        for things like an address or phone number problem.
      </p>

      {items.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <p>No reasons yet.</p>
          <p className="page-desc">Start with a common set, then adjust to suit.</p>
          <button className="btn btn-primary" onClick={addDefaults} disabled={busy}>
            {busy ? 'Adding...' : 'Add the common ones'}
          </button>
        </div>
      ) : (
        <div className="reason-list">
          {items.map((item) => (
            <div key={item.id} className={'reason-row' + (item.is_active ? '' : ' inactive')}>
              <input
                className="input"
                defaultValue={item.label}
                onBlur={(e) =>
                  e.target.value.trim() && e.target.value !== item.label &&
                  update(item, { label: e.target.value.trim() })
                }
              />
              <button
                className={'btn' + (item.requires_items ? ' btn-selected' : '')}
                title="Does this issue concern specific items?"
                onClick={() => update(item, { requires_items: !item.requires_items })}
              >
                Items
              </button>
              <button className="btn" onClick={() => update(item, { is_active: !item.is_active })}>
                {item.is_active ? 'On' : 'Off'}
              </button>
              <button className="btn btn-quiet" onClick={() => remove(item)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <h4 className="sub-label">Add a reason</h4>
      <div className="search-wrap">
        <input
          className="input"
          placeholder="e.g. Parcel lost in transit"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add} disabled={busy || !newLabel.trim()}>
          Add
        </button>
      </div>
      <label className="check-row" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={newNeedsItems}
          onChange={(e) => setNewNeedsItems(e.target.checked)}
        />
        <span>This issue is about specific items</span>
      </label>

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Edit an issue after the fact: reason, notes, and the affected items.
// ---------------------------------------------------------------------------
function EditIssueModal({ issue, reasons, onClose, onSaved }) {
  const [reason, setReason] = useState(issue.reason ?? '')
  const [detail, setDetail] = useState(issue.detail ?? '')
  const [lines, setLines] = useState(issue.order_issue_lines ?? [])
  const [removed, setRemoved] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const knownReason = reasons.some((r) => r.label === reason)

  function updateLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function dropLine(id) {
    setLines((ls) => ls.filter((l) => l.id !== id))
    setRemoved((r) => [...r, id])
  }

  async function save() {
    if (!reason) return setError('Choose what the issue is.')

    setBusy(true)
    setError(null)

    const { error: iErr } = await supabase
      .from('order_issues')
      .update({ reason, detail: detail.trim() || null })
      .eq('id', issue.id)

    if (iErr) { setBusy(false); return setError(iErr.message) }

    for (const l of lines) {
      const { error: lErr } = await supabase
        .from('order_issue_lines')
        .update({ qty: l.qty ? Number(l.qty) : null, note: l.note?.trim() || null })
        .eq('id', l.id)
      if (lErr) { setBusy(false); return setError(lErr.message) }
    }

    if (removed.length > 0) {
      const { error: dErr } = await supabase.from('order_issue_lines').delete().in('id', removed)
      if (dErr) { setBusy(false); return setError(dErr.message) }
    }

    setBusy(false)
    onSaved()
  }

  return (
    <Modal
      title={`Edit ${issue.reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="chosen-order">
        <strong>{issue.order_number ? `#${issue.order_number}` : 'No order'}</strong>
        <span className="cell-sub">The order this issue belongs to cannot be changed.</span>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="ei-reason">What is the issue?</label>
        <select
          id="ei-reason"
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {!knownReason && reason && <option value={reason}>{reason}</option>}
          <option value="">Choose...</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.label}>{r.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="ei-detail">Notes</label>
        <textarea
          id="ei-detail"
          className="input"
          rows="3"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
      </div>

      {lines.length > 0 && (
        <>
          <h4 className="sub-label">Items affected</h4>
          <div className="line-picker">
            {lines.map((l) => (
              <div key={l.id} className="line-row selected">
                <div className="line-row-head">
                  <span>
                    <span className="cell-strong">{l.order_lines?.name || 'Item'}</span>
                    <span className="cell-sub">{l.order_lines?.sku || 'No SKU'}</span>
                  </span>
                  <button className="btn btn-quiet" onClick={() => dropLine(l.id)}>Remove</button>
                </div>
                <div className="line-controls">
                  <label>
                    Qty
                    <input
                      className="input mini"
                      type="number"
                      min="1"
                      value={l.qty ?? ''}
                      onChange={(e) => updateLine(l.id, { qty: e.target.value })}
                    />
                  </label>
                  <label style={{ flex: '1 1 160px' }}>
                    Note
                    <input
                      className="input mini"
                      value={l.note ?? ''}
                      onChange={(e) => updateLine(l.id, { note: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
