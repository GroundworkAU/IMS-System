import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SELECT = `id, name, external_brand, image_url,
  variants(id, sku, option_name,
           inventory_levels(on_hand, location_id, locations(name)))`

// Browse the catalogue with stock on hand, and set quantities per variant.
// `selected` is { [variantId]: { name, sku, qty } } owned by the parent.
export default function CatalogueBrowser({ selected, onChange, destinationId }) {
  const [products, setProducts] = useState([])
  const [brands, setBrands] = useState([])
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  const load = useCallback(async (search, brandVal) => {
    setLoading(true)
    let q = supabase.from(  'products').select(SELECT).order('name').limit(60)
    if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`)
    if (brandVal) q = q.eq('external_brand', brandVal)
    const { data } = await q
    setProducts(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load('', '') }, [load])

  useEffect(() => {
    supabase
      .from('products')
      .select('external_brand')
      .not('external_brand', 'is', null)
      .limit(1000)
      .then(({ data }) => {
        setBrands([...new Set((data ?? []).map((p) => p.external_brand))].sort())
      })
  }, [])

  function toggle(id) {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setQty(variant, product, qty) {
    const next = { ...selected }
    const n = Number(qty)
    if (!n || n <= 0) {
      delete next[variant.id]
    } else {
      next[variant.id] = {
        name: variant.option_name ? `${product.name} ~ ${variant.option_name}` : product.name,
        sku: variant.sku || '',
        qty: n,
      }
    }
    onChange(next)
  }

  // Stock at the location the request is for, versus everywhere else.
  function stockSplit(variant) {
    const levels = variant.inventory_levels ?? []
    let here = null
    const elsewhere = []
    for (const l of levels) {
      if (destinationId && l.location_id === destinationId) here = l.on_hand
      else elsewhere.push({ name: l.locations?.name || 'Location', qty: l.on_hand })
    }
    return { here, elsewhere }
  }

  return (
    <div>
      <div className="filter-bar" style={{ marginBottom: 12 }}>
        <div className="filter-field" style={{ flex: '2 1 180px' }}>
          <label>Search</label>
          <input
            className="input"
            placeholder="Product name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(query, brand)}
          />
        </div>
        <div className="filter-field" style={{ flex: '1 1 150px' }}>
          <label>Brand</label>
          <select
            className="input"
            value={brand}
            onChange={(e) => { setBrand(e.target.value); load(query, e.target.value) }}
          >
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn" onClick={() => load(query, brand)}>Search</button>
        </div>
      </div>

      {loading ? (
        <p className="field-hint">Loading catalogue...</p>
      ) : products.length === 0 ? (
        <p className="field-hint">
          Nothing found. Sync products on the Products page, or add an item by hand below.
        </p>
      ) : (
        <div className="product-list browse-list">
          {products.map((p) => {
            const isOpen = expanded.has(p.id)
            const picked = (p.variants ?? []).filter((v) => selected[v.id]).length
            const totalStock = (p.variants ?? []).reduce(
              (sum, v) => sum + (v.inventory_levels ?? []).reduce((s, i) => s + (i.on_hand || 0), 0),
              0
            )
            return (
              <div key={p.id} className="product-row">
                <button className="product-head" onClick={() => toggle(p.id)}>
                  <span className={'chev' + (isOpen ? ' open' : '')}>›</span>
                  {p.image_url
                    ? <img className="thumb" src={p.image_url} alt="" loading="lazy" />
                    : <div className="thumb thumb-blank" />}
                  <span className="product-main">
                    <span className="cell-strong">{p.name}</span>
                    <span className="cell-sub">
                      {p.external_brand || 'No brand'}
                      {picked > 0 && ` · ${picked} selected`}
                    </span>
                  </span>
                  <span className={'stock-chip' + (totalStock === 0 ? ' zero' : '')}>
                    {totalStock} online
                  </span>
                </button>

                {isOpen && (
                  <div className="product-variants">
                    {(p.variants ?? []).map((v) => {
                      const { here, elsewhere } = stockSplit(v)
                      return (
                        <div key={v.id} className="browse-variant">
                          <span className="browse-variant-main">
                            <span className="cell-strong">{v.option_name || 'Single'}</span>
                            <span className="cell-sub">{v.sku || 'No SKU'}</span>
                          </span>

                          <span className="browse-stock">
                            {destinationId && (
                              <span className="cell-sub">
                                Here: <strong>{here ?? 0}</strong>
                              </span>
                            )}
                            {elsewhere.map((e) => (
                              <span key={e.name} className="cell-sub">
                                {e.name}: <strong>{e.qty}</strong>
                              </span>
                            ))}
                            {elsewhere.length === 0 && !destinationId && (
                              <span className="cell-sub">No stock recorded</span>
                            )}
                          </span>

                          <input
                            className="input mini"
                            type="number"
                            min="0"
                            placeholder="0"
                            value={selected[v.id]?.qty ?? ''}
                            onChange={(e) => setQty(v, p, e.target.value)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
