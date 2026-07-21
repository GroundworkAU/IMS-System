import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { syncProducts } from '../lib/integrations'
import Modal from '../components/Modal'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

export default function Products() {
  const { org } = useAuth()
  const [products, setProducts] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [total, setTotal] = useState(0)

  const connected = (org?.platforms ?? []).includes('bigcommerce')

  const load = useCallback(async (search = '') => {
    setLoading(true)
    let q = supabase
      .from('products')
      .select(
        'id, name, external_brand, image_url, status, external_source, last_synced_at, variants(id, sku, option_name, barcode, unit_cost, retail_price)',
        { count: 'exact' }
      )
      .order('name')
      .limit(100)

    if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)

    const { data, error, count } = await q
    if (error) setStatus({ type: 'err', text: error.message })
    setProducts(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSync() {
    setSyncing(true)
    setStatus(null)
    const res = await syncProducts('bigcommerce')
    setSyncing(false)
    if (res.error) {
      setStatus({ type: 'err', text: `Sync problem: ${res.error}` })
    } else {
      setStatus({
        type: 'ok',
        text: `Brought in ${res.products} products and ${res.variants} variants.`,
      })
    }
    load(query)
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">Products</h2>
        <p className="page-desc">
          Your catalogue, synced from the platforms you have connected. Sizes and colours come
          across as variants, each with its own SKU and barcode.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="search-wrap">
            <input
              className="input"
              placeholder="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(query)}
            />
            <button className="btn" onClick={() => load(query)}>Search</button>
            {query && (
              <button className="btn btn-quiet" onClick={() => { setQuery(''); load('') }}>
                Clear
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !connected}>
            {syncing ? 'Bringing products in...' : 'Sync products'}
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <p>{query ? 'No products match that search.' : 'No products yet.'}</p>
            <p className="page-desc">
              {connected
                ? 'Hit Sync products to bring your catalogue across from BigCommerce.'
                : 'Connect a platform in Settings to sync your catalogue.'}
            </p>
          </div>
        ) : (
          <>
            <p className="page-desc" style={{ marginBottom: 12 }}>
              Showing {products.length} of {total} products.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th></th><th>Product</th><th>Brand</th>
                    <th>Variants</th><th>Price</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const prices = (p.variants ?? []).map((v) => Number(v.retail_price || 0))
                    const min = prices.length ? Math.min(...prices) : 0
                    const max = prices.length ? Math.max(...prices) : 0
                    return (
                      <tr key={p.id}>
                        <td style={{ width: 48 }}>
                          {p.image_url ? (
                            <img className="thumb" src={p.image_url} alt="" loading="lazy" />
                          ) : (
                            <div className="thumb thumb-blank" />
                          )}
                        </td>
                        <td>
                          <div className="cell-strong">{p.name}</div>
                          {p.status !== 'active' && <div className="cell-sub">Not visible online</div>}
                        </td>
                        <td>{p.external_brand || '-'}</td>
                        <td>{(p.variants ?? []).length}</td>
                        <td>{min === max ? money(min) : `${money(min)} - ${money(max)}`}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn" onClick={() => setViewing(p)}>View</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {viewing && <ProductModal product={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function ProductModal({ product, onClose }) {
  return (
    <Modal title={product.name} onClose={onClose}>
      <div className="detail-grid">
        <div><span className="detail-label">Brand</span>{product.external_brand || '-'}</div>
        <div><span className="detail-label">Source</span>{product.external_source || 'Added here'}</div>
        <div>
          <span className="detail-label">Last synced</span>
          {product.last_synced_at
            ? new Date(product.last_synced_at).toLocaleString('en-AU')
            : '-'}
        </div>
        <div><span className="detail-label">Variants</span>{(product.variants ?? []).length}</div>
      </div>

      <h4 className="sub-label">Variants</h4>
      <table className="table">
        <thead>
          <tr><th>Option</th><th>SKU</th><th>Barcode</th><th>Cost</th><th>Price</th></tr>
        </thead>
        <tbody>
          {(product.variants ?? []).map((v) => (
            <tr key={v.id}>
              <td>{v.option_name || 'Single'}</td>
              <td>{v.sku || '-'}</td>
              <td>{v.barcode || <span className="cell-sub">Missing</span>}</td>
              <td>{money(v.unit_cost)}</td>
              <td>{money(v.retail_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
