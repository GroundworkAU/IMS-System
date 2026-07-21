import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { syncProducts } from '../lib/integrations'
import { sortVariants } from '../lib/sizes'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

const SELECT =
  'id,name,external_brand,image_url,status,external_source,sync_enabled,created_at,last_synced_at,' +
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
  const [locations, setLocations] = useState([])
  const [visibleLocations, setVisibleLocations] = useState(null)   // null = all
  const [selected, setSelected] = useState(new Set())
  const [syncFilter, setSyncFilter] = useState('')   // '', 'included', 'excluded'
  const [total, setTotal] = useState(0)

  const syncable = (org?.platforms ?? []).filter((p) => p === 'bigcommerce' || p === 'lightspeed')
  const connected = syncable.length > 0

  const load = useCallback(async (opts = {}) => {
    const {
      search = query, brandVal = brand, sortVal = sort, syncVal = syncFilter,
    } = opts
    setLoading(true)

    let q = supabase.from('products').select(SELECT, { count: 'exact' }).limit(100)

    if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
    if (brandVal) q = q.eq('external_brand', brandVal)
    if (syncVal === 'included') q = q.eq('sync_enabled', true)
    if (syncVal === 'excluded') q = q.eq('sync_enabled', false)

    if (sortVal === 'newest') q = q.order('created_at', { ascending: false })
    else if (sortVal === 'recently_synced') q = q.order('last_synced_at', { ascending: false })
    else q = q.order('name')

    const { data, error, count } = await q
    if (error) setStatus({ type: 'err', text: error.message })
    setProducts(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [query, brand, sort, syncFilter])

  useEffect(() => { load({}) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase
      .from('locations')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLocations(data ?? []))
  }, [])

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
      if (res.skipped) bit += `, ${res.skipped} skipped by your brand filter`
      if (res.stockRows) {
        bit += `, stock on ${res.stockRows} lines`
        if (res.invFetched && res.invMatched < res.invFetched) {
          bit += ` (${res.invFetched - res.invMatched} stock records could not be matched)`
        }
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

  function toggleSelect(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setSyncEnabled(enabled) {
    const ids = [...selected]
    if (ids.length === 0) return
    const { error } = await supabase
      .from('products')
      .update({ sync_enabled: enabled })
      .in('id', ids)
    if (error) {
      setStatus({ type: 'err', text: error.message })
    } else {
      setStatus({
        type: 'ok',
        text: `${ids.length} product${ids.length === 1 ? '' : 's'} ` +
              (enabled ? 'will sync again.' : 'will be skipped on future syncs.'),
      })
      setSelected(new Set())
      load({})
    }
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
          <div className="filter-field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="p-sync">Syncing</label>
            <select
              id="p-sync"
              className="input"
              value={syncFilter}
              onChange={(e) => { setSyncFilter(e.target.value); load({ syncVal: e.target.value }) }}
            >
              <option value="">All products</option>
              <option value="included">Syncing</option>
              <option value="excluded">Excluded</option>
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
          {locations.length > 1 && (
            <div className="filter-field" style={{ flex: '1 1 100%' }}>
              <label>Show stock at</label>
              <div className="loc-chips">
                {locations.map((l) => {
                  const on = !visibleLocations || visibleLocations.includes(l.id)
                  return (
                    <button
                      key={l.id}
                      className={'loc-chip' + (on ? ' on' : '')}
                      onClick={() => {
                        const current = visibleLocations ?? locations.map((x) => x.id)
                        const next = current.includes(l.id)
                          ? current.filter((x) => x !== l.id)
                          : [...current, l.id]
                        setVisibleLocations(next.length === locations.length ? null : next)
                      }}
                    >
                      {l.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
          <>
          <div className="bulk-bar">
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={products.length > 0 && products.every((p) => selected.has(p.id))}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(products.map((p) => p.id)) : new Set())
                }
              />
              <span>
                {selected.size > 0
                  ? `${selected.size} selected`
                  : 'Select all shown'}
              </span>
            </label>

            {selected.size > 0 && (
              <div className="search-wrap">
                <button className="btn" onClick={() => setSyncEnabled(false)}>
                  Exclude from sync
                </button>
                <button className="btn" onClick={() => setSyncEnabled(true)}>
                  Include in sync
                </button>
                <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="product-list">
            {products.map((p) => {
              const isOpen = expanded.has(p.id)
              const shown = visibleLocations ?? locations.map((l) => l.id)
              const stock = (p.variants ?? []).reduce(
                (sum, v) =>
                  sum +
                  (v.inventory_levels ?? [])
                    .filter((i) => shown.includes(i.location_id))
                    .reduce((s, i) => s + (i.on_hand || 0), 0),
                0
              )
              const prices = (p.variants ?? []).map((v) => Number(v.retail_price || 0))
              const min = prices.length ? Math.min(...prices) : 0
              const max = prices.length ? Math.max(...prices) : 0

              return (
                <div key={p.id} className="product-row">
                  <div className={'product-head' + (p.sync_enabled ? '' : ' excluded')}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${p.name}`}
                    />
                    <span
                      className={'chev' + (isOpen ? ' open' : '')}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(p.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(p.id)}
                    >
                      ›
                    </span>
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

                    {!p.sync_enabled && <span className="excluded-tag">Not syncing</span>}
                    <span className="product-price">
                      {min === max ? money(min) : `${money(min)} - ${money(max)}`}
                    </span>
                    <span className={'stock-chip' + (stock === 0 ? ' zero' : '')}>
                      {stock} in stock
                    </span>
                  </div>

                  {isOpen && (
                    <div className="product-variants">
                      <table className="variant-table">
                        <thead>
                          <tr>
                            <th>Size / option</th>
                            <th>SKU</th>
                            <th>Barcode</th>
                            <th className="num">Price</th>
                            {locations
                              .filter((l) => shown.includes(l.id))
                              .map((l) => (
                                <th key={l.id} className="num">{l.name}</th>
                              ))}
                            <th className="num">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortVariants(p.variants).map((v) => {
                            const levels = v.inventory_levels ?? []
                            const rows = locations
                              .filter((l) => shown.includes(l.id))
                              .map((l) => {
                                const found = levels.find((i) => i.location_id === l.id)
                                return { id: l.id, name: l.name, qty: found ? found.on_hand : 0 }
                              })
                            const total = rows.reduce((sum, r) => sum + r.qty, 0)
                            return (
                              <tr key={v.id}>
                                <td className="cell-strong">{v.option_name || 'Single'}</td>
                                <td>{v.sku || '-'}</td>
                                <td>
                                  {v.barcode || <span className="cell-sub">Missing</span>}
                                </td>
                                <td className="num">{money(v.retail_price)}</td>
                                {rows.map((r) => (
                                  <td key={r.id} className={'num' + (r.qty === 0 ? ' zero' : '')}>
                                    {r.qty}
                                  </td>
                                ))}
                                <td className="num cell-strong">{total}</td>
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
          </>
        )}
      </div>
    </div>
  )
}
