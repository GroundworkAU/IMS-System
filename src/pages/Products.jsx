import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { syncProducts } from '../lib/integrations'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

const SELECT =
  'id,name,external_brand,image_url,status,external_source,created_at,last_synced_at,' +
  'variants(id,sku,option_name,barcode,unit_cost,retail_price,' +
  'inventory_levels(on_hand,location_id,locations(name)))'

export default function Products() {
  const { org } = useAuth()
  const [products, setProducts] = useState([])
  const [brands, setBrands] = useState([])
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [sort, setSort] = useState('name')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [total, setTotal] = useState(0)

  const syncable = (org?.platforms ?? []).filter((p) => p === 'bigcommerce' || p === 'lightspeed')
  const connected = syncable.length > 0

  const load = useCallback(async (opts = {}) => {
    const { search = query, brandVal = brand, sortVal = sort } = opts
    setLoading(true)

    let q = supabase.from('products').select(SELECT, { count: 'exact' }).limit(100)

    if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
    if (brandVal) q = q.eq('external_brand', brandVal)

    if (sortVal === 'newest') q = q.order('created_at', { ascending: false })
    else if (sortVal === 'recently_synced') q = q.order('last_synced_at', { ascending: false })
    else q = q.order('name')

    const { data, error, count } = await q
    if (error) setStatus({ type: 'err', text: error.message })
    setProducts(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [query, brand, sort])

  useEffect(() => { load({}) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Brand list for the filter
  useEffect(() => {
    supabase
      .from('products')
      .select('external_brand')
      .not('external_brand', 'is', null)
      .limit(1000)
      .then(({ data }) => {
        setBrands([...new Set((data ?? []).map((p) => p.external_brand))].sort())
      })
  }, [total])

  const platformLabel = { bigcommerce: 'BigCommerce', lightspeed: 'Lightspeed' }

  async function handleSync() {
    setSyncing(true)
    setStatus(null)

    const lines = []
    let anyError = null

    for (const platform of syncable) {
      const res = await syncProducts(platform)
      const label = platformLabel[platform] ?? platform

      if (res.error) {
        anyError = res.error
        lines.push(`${label}: ${res.error}`)
        continue
      }

      let bit = `${label}: ${res.products} products, ${res.variants} variants`
      if (res.stockRows) {
        bit += `, stock on ${res.stockRows} lines`
      } else if (res.stockLocationMissing) {
        bit += ` ~ no location has "Stock figures come from" set to ${label}`
      } else if (res.invFetched === 0) {
        bit += ` ~ ${label} returned no stock records`
      } else if (res.invMatched === 0) {
        bit += ` ~ ${res.invFetched} stock records came back but none matched your ` +
               `${res.mappedLocations} mapped location(s), so the location ids do not line up`
      } else {
        bit += ', no stock figures returned'
      }
      lines.push(bit)
    }

    setSyncing(false)
    setStatus({ type: anyError ? 'err' : 'ok', text: lines.join('. ') + '.' })
    load({})
  }

  function toggle(id) {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">Products</h2>
        <p className="page-desc">
          Your catalogue with stock on hand. Open a product to see each size, its SKU and how
          many are sitting at each location.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>
            {products.length} of {total} products
          </h3>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !connected}>
            {syncing ? 'Bringing products in...' : 'Sync products'}
          </button>
        </div>

        <div className="filter-bar">
          <div className="filter-field" style={{ flex: '2 1 220px' }}>
            <label htmlFor="p-search">Search</label>
            <input
              id="p-search"
              className="input"
              placeholder="Product name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load({})}
            />
          </div>
          <div className="filter-field" style={{ flex: '2 1 180px' }}>
            <label htmlFor="p-brand">Brand</label>
            <select
              id="p-brand"
              className="input"
              value={brand}
              onChange={(e) => { setBrand(e.target.value); load({ brandVal: e.target.value }) }}
            >
              <option value="">All brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="filter-field" style={{ flex: '1 1 170px' }}>
            <label htmlFor="p-sort">Sort by</label>
            <select
              id="p-sort"
              className="input"
              value={sort}
              onChange={(e) => { setSort(e.target.value); load({ sortVal: e.target.value }) }}
            >
              <option value="name">Name</option>
              <option value="newest">Most recently added</option>
              <option value="recently_synced">Most recently synced</option>
            </select>
          </div>
          <div className="filter-actions">
            <button className="btn" onClick={() => load({})}>Apply</button>
            {(query || brand || sort !== 'name') && (
              <button
                className="btn btn-quiet"
                onClick={() => {
                  setQuery(''); setBrand(''); setSort('name')
                  load({ search: '', brandVal: '', sortVal: 'name' })
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <p>{query || brand ? 'No products match those filters.' : 'No products yet.'}</p>
            <p className="page-desc">
              {connected
                ? 'Hit Sync products to bring your catalogue across.'
                : 'Connect a platform in Settings to sync your catalogue.'}
            </p>
          </div>
        ) : (
          <div className="product-list">
            {products.map((p) => {
              const isOpen = expanded.has(p.id)
              const stock = (p.variants ?? []).reduce(
                (sum, v) => sum + (v.inventory_levels ?? []).reduce((s, i) => s + (i.on_hand || 0), 0),
                0
              )
              const prices = (p.variants ?? []).map((v) => Number(v.retail_price || 0))
              const min = prices.length ? Math.min(...prices) : 0
              const max = prices.length ? Math.max(...prices) : 0

              return (
                <div key={p.id} className="product-row">
                  <button className="product-head" onClick={() => toggle(p.id)}>
                    <span className={'chev' + (isOpen ? ' open' : '')}>›</span>
                    {p.image_url
                      ? <img className="thumb" src={p.image_url} alt="" loading="lazy" />
                      : <div className="thumb thumb-blank" />}
                    <span className="product-main">
                      <span className="cell-strong">{p.name || 'Unnamed product'}</span>
                      <span className="cell-sub">
                        {p.external_brand || 'No brand'} · {(p.variants ?? []).length} variant
                        {(p.variants ?? []).length === 1 ? '' : 's'}
                        {p.status !== 'active' && ' · not visible online'}
                      </span>
                    </span>
                    <span className="product-price">
                      {min === max ? money(min) : `${money(min)} - ${money(max)}`}
                    </span>
                    <span className={'stock-chip' + (stock === 0 ? ' zero' : '')}>
                      {stock} in stock
                    </span>
                  </button>

                  {isOpen && (
                    <div className="product-variants">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Size / option</th><th>SKU</th><th>Barcode</th>
                            <th>Price</th><th>Stock on hand</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(p.variants ?? []).map((v) => {
                            const levels = v.inventory_levels ?? []
                            const totalStock = levels.reduce((s, i) => s + (i.on_hand || 0), 0)
                            return (
                              <tr key={v.id}>
                                <td className="cell-strong">{v.option_name || 'Single'}</td>
                                <td>{v.sku || '-'}</td>
                                <td>
                                  {v.barcode || <span className="cell-sub">Missing</span>}
                                </td>
                                <td>{money(v.retail_price)}</td>
                                <td>
                                  {levels.length === 0 ? (
                                    <span className="cell-sub">Not tracked yet</span>
                                  ) : (
                                    <div className="stock-lines">
                                      {levels.map((l) => (
                                        <div key={l.location_id} className="stock-line">
                                          <span className="cell-sub">{l.locations?.name || 'Location'}</span>
                                          <span className={l.on_hand > 0 ? 'stock-num' : 'stock-num zero'}>
                                            {l.on_hand}
                                          </span>
                                        </div>
                                      ))}
                                      {levels.length > 1 && (
                                        <div className="stock-line stock-total">
                                          <span className="cell-sub">Total</span>
                                          <span className="stock-num">{totalStock}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
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
    </div>
  )
}
