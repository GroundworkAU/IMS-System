import { useState } from 'react'
import { sortVariants } from '../lib/sizes'

// Lines are stored as "Product ~ Size". Grouping them back under the product
// and showing sizes in a table keeps requests, fulfilments and orders looking
// the same as the product pages.
function group(lines) {
  const groups = []
  const byName = {}

  for (const l of lines ?? []) {
    const raw = l.name ?? ''
    const idx = raw.lastIndexOf(' ~ ')
    const product = idx === -1 ? raw : raw.slice(0, idx)
    const option = idx === -1 ? null : raw.slice(idx + 3)

    if (!byName[product]) {
      byName[product] = { product, lines: [], total: 0 }
      groups.push(byName[product])
    }
    const qty = Number(l.qty ?? 0)
    byName[product].lines.push({ ...l, option_name: option, qty })
    byName[product].total += qty
  }

  return groups
}

function Group({ g, image, showReceived, startOpen }) {
  const [open, setOpen] = useState(startOpen)

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
        {image
          ? <img className="thumb" src={image} alt="" loading="lazy" />
          : <span className="thumb thumb-blank" />}
        <span className="product-main">
          <span className="cell-strong">{g.product}</span>
          <span className="cell-sub">
            {g.lines.length} size{g.lines.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="stock-chip">{g.total} items</span>
      </div>

      {open && (
        <div className="product-variants">
          <table className="variant-table">
            <thead>
              <tr>
                <th>Size</th>
                <th>SKU</th>
                <th className="num">Qty</th>
                {showReceived && <th className="num">Received</th>}
              </tr>
            </thead>
            <tbody>
              {sortVariants(g.lines).map((l, i) => {
                const off = showReceived && l.received != null && l.received !== l.qty
                return (
                  <tr key={l.id ?? i}>
                    <td className="cell-strong">{l.option_name || 'Single'}</td>
                    <td className="cell-sub">{l.sku || 'No SKU'}</td>
                    <td className="num">{l.qty}</td>
                    {showReceived && (
                      <td className={'num' + (off ? ' negative' : '')}>
                        {l.received == null ? '~' : l.received}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function LineGroups({
  lines, limit = 3, emptyText = 'Nothing added yet', images = {},
  showReceived = false, startOpen = false,
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = group(lines)

  if (groups.length === 0) return <span className="cell-sub">{emptyText}</span>

  const shown = expanded ? groups : groups.slice(0, limit)
  const hidden = groups.length - shown.length

  return (
    <div className="product-list">
      {shown.map((g) => (
        <Group
          key={g.product}
          g={g}
          image={images[g.product]}
          showReceived={showReceived}
          startOpen={startOpen}
        />
      ))}

      {(hidden > 0 || expanded) && (
        <button className="linklike" style={{ alignSelf: 'flex-start' }} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show ${hidden} more product${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
