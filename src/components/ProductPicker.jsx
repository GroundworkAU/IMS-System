import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Search the synced catalogue by product name or SKU and pick a variant.
// Falls back to manual entry, since anything not yet synced (Lightspeed only
// lines, or a brand new product) still needs to be requestable.
export default function ProductPicker({ onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  async function search() {
    const q = query.trim()
    if (!q) return
    setSearching(true)

    const [byName, bySku] = await Promise.all([
      supabase
        .from('variants')
        .select('id, sku, option_name, products!inner(name, image_url)')
        .ilike('products.name', `%${q}%`)
        .limit(25),
      supabase
        .from('variants')
        .select('id, sku, option_name, products!inner(name, image_url)')
        .ilike('sku', `%${q}%`)
        .limit(25),
    ])

    const merged = []
    const seen = new Set()
    for (const row of [...(byName.data ?? []), ...(bySku.data ?? [])]) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      merged.push(row)
    }

    setResults(merged)
    setSearching(false)
  }

  return (
    <div>
      <div className="search-wrap">
        <input
          className="input"
          placeholder="Search by product name or SKU"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className="btn" onClick={search} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {results !== null && (
        results.length === 0 ? (
          <p className="field-hint">
            Nothing found. Sync products on the Products page, or add the item by hand below.
          </p>
        ) : (
          <div className="result-list" style={{ marginTop: 10, maxHeight: 240, overflowY: 'auto' }}>
            {results.map((v) => (
              <button
                key={v.id}
                className="result-row"
                onClick={() => {
                  onPick({
                    variant_id: v.id,
                    name: v.option_name
                      ? `${v.products.name} ~ ${v.option_name}`
                      : v.products.name,
                    sku: v.sku || '',
                  })
                  setResults(null)
                  setQuery('')
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {v.products.image_url
                    ? <img className="thumb" src={v.products.image_url} alt="" loading="lazy" />
                    : <div className="thumb thumb-blank" />}
                  <span>
                    <strong>{v.products.name}</strong>
                    <span className="cell-sub">
                      {v.option_name || 'Single'} · {v.sku || 'No SKU'}
                    </span>
                  </span>
                </span>
                <span className="cell-sub">Add</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}
