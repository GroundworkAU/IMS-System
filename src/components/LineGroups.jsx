import { useState } from 'react'
import { sortVariants } from '../lib/sizes'

// Request and order lines are stored as "Product ~ Size". Grouping them back
// under the product turns a wall of near identical rows into something you can
// actually read.
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

export default function LineGroups({ lines, limit = 3, emptyText = 'Nothing added yet' }) {
  const [expanded, setExpanded] = useState(false)
  const groups = group(lines)

  if (groups.length === 0) return <span className="cell-sub">{emptyText}</span>

  const shown = expanded ? groups : groups.slice(0, limit)
  const hidden = groups.length - shown.length

  return (
    <div className="line-groups">
      {shown.map((g) => (
        <div key={g.product} className="line-group">
          <div className="line-group-head">
            <span className="cell-strong">{g.product}</span>
            <span className="line-group-total">{g.total}</span>
          </div>
          <div className="size-chips">
            {sortVariants(g.lines).map((l, i) => (
              <span key={l.id ?? i} className="size-chip">
                {l.option_name || 'Single'}
                <strong>{l.qty}</strong>
              </span>
            ))}
          </div>
        </div>
      ))}

      {(hidden > 0 || expanded) && (
        <button className="linklike" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show ${hidden} more product${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
