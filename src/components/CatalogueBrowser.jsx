import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sortVariants } from '../lib/sizes'

const stockTone = (n) => (n < 0 ? ' negative' : n === 0 ? ' zero' : '')

const SELECT =
  'id,name,external_brand,image_url,variants(id,sku,option_name,inventory_levels(on_hand,location_id,locations(name)))'

// Browse the catalogue with stock on hand, and set quantities per variant.
// `selected` is { [variantId]: { name, sku, qty } } owned by the parent.
export default function CatalogueBrowser({ selected, onChange, destinationId, fullHeight }) {
  const [products, setProducts] = useState([])
  const [brands, setBrands] = useState([])
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [locations, setLocations] = useState([])

  const load = useCallback(async (search, brandVal) => {
    setLoading(true)
    // Excluded products are not managed here, so keep them out of requests.
    let q = supabase
      .from('products')
      .select(SELECT)
      .eq('sync_enabled', true)
      .order('name')
      .limit(60)
    if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`)
    if (brandVal) q = q.eq('external_brand', brandVal)
    const { data, error: qErr } = await q
    if (qErr) setError(qErr.message)
    else setError(null)
    setProducts(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load('', '') }, [load])

  // Every active location, so stock can show a zero rather than nothing at all.
  useEffect(() => {
    supabase
      .from('locations')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLocations(data ?? []))
  }, [])

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
        product_id: product.id,
        product_name: product.name,
        option_name: variant.option_name || null,
        image_url: product.image_url || null,
        name: variant.option_name ? `${product.name} ~ ${variant.option_name}` : product.name,
        sku: variant.sku || '',
        qty: n,
      }
    }
    onChange(next)
  }

  // Stock for every active location, defaulting to zero where nothing is held.
  function stockByLocation(variant) {
    const levels = variant.inventory_levels ?? []
    return locations.map((loc) => {
      const found = levels.find((l) => l.location_id === loc.id)
      return {
        id: loc.id,
        name: loc.name,
        qty: found ? found.on_hand : 0,
        isDestination: destinationId === loc.id,
      }
    })
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

      {error && (
        <div className="auth-msg err" style={{ marginBottom: 12 }}>
          Could not load the catalogue: {error}
        </div>
      )}

      {loading ? (
        <p className="field-hint">Loading catalogue...</p>
      ) : products.length === 0 ? (
        <p className="field-hint">
          Nothing found. Sync products on the Products page, or add an item by hand below.
        </p>
      ) : (
        <div className={'product-list browse-list' + (fullHeight ? ' browse-tall' : '')}>
          {products.map((p) => {
            const isOpen = expanded.has(p.id)
            const picked = (p.variants ?? []).filter((v) => selected[v.id]).length
            const totalStock = (p.variants ?? []).reduce(
              (sum, v) => sum + (v.inventory_levels ?? []).reduce((s, i) => s + (i.on_hand || 0), 0),
              0
            )
            return (
              <div key={p.id} className="product-row">
                <div
                  className="product-head"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(p.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(p.id)}
                >
                  <span className={'chev' + (isOpen ? ' open' : '')}>›</span>

                  {p.image_url
                    ? <img className="thumb" src={p.image_url} alt="" loading="lazy" />
                    : <span className="thumb thumb-blank" />}

                  <span className="product-main">
                    <span className="cell-strong">{p.name || 'Unnamed product'}</span>
                    <span className="cell-sub">
                      {p.external_brand || 'No brand'}
                      {picked > 0 && ` · ${picked} selected`}
                    </span>
                  </span>

                  <span className={'stock-chip' + stockTone(totalStock)}>
                    {totalStock} in stock
                  </span>
                </div>

                {isOpen && (
                  <div className="product-variants">
                    <table className="variant-table">
                      <thead>
                        <tr>
                          <th>Size</th>
                          <th>SKU</th>
                          {locations.map((l) => (
                            <th
                              key={l.id}
                              className={
                                'num' + (destinationId === l.id ? ' destination' : '')
                              }
                            >
                              {l.name}
                            </th>
                          ))}
                          <th className="num">Request</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortVariants(p.variants).map((v) => {
                          const levels = stockByLocation(v)
                          return (
                            <tr key={v.id}>
                              <td className="cell-strong">{v.option_name || 'Single'}</td>
                              <td className="cell-sub">{v.sku || 'No SKU'}</td>
                              {levels.map((l) => (
                                <td
                                  key={l.id}
                                  className={
                                    'num' + (l.isDestination ? ' destination' : '') +
                                    stockTone(l.qty)
                                  }
                                >
                                  {l.qty}
                                </td>
                              ))}
                              <td className="num">
                                <input
                                  className="input mini"
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={selected[v.id]?.qty ?? ''}
                                  onChange={(e) => setQty(v, p, e.target.value)}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
