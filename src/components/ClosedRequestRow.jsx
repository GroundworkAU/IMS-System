import { useState } from 'react'
import { sortVariants } from '../lib/sizes'

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

// A finished request is history, so it collapses to one line. Opening it shows
// what was asked for against what actually went out, size by size.
export default function ClosedRequestRow({ request, images = {}, onReopen }) {
  const [open, setOpen] = useState(false)

  const lines = request.restock_request_lines ?? []
  const requested = lines.reduce((n, l) => n + (l.qty_requested || 0), 0)
  const fulfilled = lines.reduce((n, l) => n + (l.qty_fulfilled || 0), 0)
  const short = requested - fulfilled

  // Group by product, keeping the requested and fulfilled figures per size.
  const groups = []
  const byName = {}
  for (const l of lines) {
    const raw = l.name ?? ''
    const idx = raw.lastIndexOf(' ~ ')
    const product = idx === -1 ? raw : raw.slice(0, idx)
    const option = idx === -1 ? null : raw.slice(idx + 3)

    if (!byName[product]) {
      byName[product] = { product, lines: [], requested: 0, fulfilled: 0 }
      groups.push(byName[product])
    }
    byName[product].lines.push({ ...l, option_name: option })
    byName[product].requested += l.qty_requested || 0
    byName[product].fulfilled += l.qty_fulfilled || 0
  }

  return (
    <div className="product-row">
      <div
        className="product-head"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}
      >
        <span className={'chev' + (open ? ' open' : '')}>›</span>

        <span className="product-main">
          <span className="cell-strong">
            {request.reference}
            <span className="closed-dest"> for {request.destination?.name || 'no location'}</span>
          </span>
          <span className="cell-sub">
            {request.status === 'closed' ? 'Closed' : 'Fulfilled'}{' '}
            {formatDate(request.closed_at ?? request.updated_at ?? request.created_at)}
            {request.closed_reason ? ` ~ ${request.closed_reason}` : ''}
          </span>
        </span>

        <span className="closed-figures">
          <span className="stock-chip">{fulfilled} of {requested} sent</span>
          {short > 0 && <span className="stock-chip zero">{short} short</span>}
        </span>

        {onReopen && (
          <button
            className="btn btn-quiet"
            onClick={(e) => { e.stopPropagation(); onReopen(request) }}
          >
            Reopen
          </button>
        )}
      </div>

      {open && (
        <div className="product-variants">
          {groups.map((g) => (
            <div key={g.product} className="closed-group">
              <div className="line-group-head">
                <span className="line-group-name">
                  {images[g.product]
                    ? <img className="thumb thumb-sm" src={images[g.product]} alt="" loading="lazy" />
                    : <span className="thumb thumb-sm thumb-blank" />}
                  <span className="cell-strong">{g.product}</span>
                </span>
                <span className="line-group-total">
                  {g.fulfilled} of {g.requested}
                </span>
              </div>

              <table className="variant-table">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>SKU</th>
                    <th className="num">Requested</th>
                    <th className="num">Fulfilled</th>
                    <th className="num">Not sent</th>
                  </tr>
                </thead>
                <tbody>
                  {sortVariants(g.lines).map((l) => {
                    const missing = (l.qty_requested || 0) - (l.qty_fulfilled || 0)
                    return (
                      <tr key={l.id}>
                        <td className="cell-strong">{l.option_name || 'Single'}</td>
                        <td className="cell-sub">{l.sku || 'No SKU'}</td>
                        <td className="num">{l.qty_requested}</td>
                        <td className="num">{l.qty_fulfilled || 0}</td>
                        <td className={'num' + (missing > 0 ? ' negative' : ' zero')}>
                          {missing > 0 ? missing : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
