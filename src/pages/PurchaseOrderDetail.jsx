import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BackLink from '../components/BackLink'
import { sortVariants } from '../lib/sizes'

const money = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n || 0))

// Sizes that mean "there is only one of these".
const ONE_SIZE = /one\s*size|osfm|^os$/i

export function skuFor(product, size) {
  const prefix = (product.sku_prefix ?? '').trim()
  if (!prefix) return ''
  if (!product.has_variants) return prefix
  const clean = String(size ?? '').trim().replace(/\s+/g, '')
  return clean ? `${prefix}-${clean}` : prefix
}

export default function PurchaseOrderDetail() {
  const { orderId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [order, setOrder] = useState(null)
  const [products, setProducts] = useState([])
  const [lines, setLines] = useState([])
  const [edits, setEdits] = useState({})       // supplier_sku -> { our_name, sku_prefix, has_variants }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)
  const [expanded, setExpanded] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: p }, { data: l }] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id,reference,order_year,order_type,status,created_at,pushed_at,source_file_name,brands(name),suppliers(name)')
        .eq('id', orderId)
        .maybeSingle(),
      supabase
        .from('po_products')
        .select('*')
        .eq('po_id', orderId)
        .order('supplier_sku'),
      supabase
        .from('purchase_order_lines')
        .select('id,supplier_sku,supplier_product_name,colour,option_name,qty_ordered,unit_cost,retail_price')
        .eq('po_id', orderId),
    ])

    setOrder(o ?? null)
    setProducts(p ?? [])
    setLines(l ?? [])
    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load])

  const linesByCode = useMemo(() => {
    const map = {}
    for (const l of lines) {
      if (!map[l.supplier_sku]) map[l.supplier_sku] = []
      map[l.supplier_sku].push(l)
    }
    return map
  }, [lines])

  const valueOf = (p) => (edits[p.supplier_sku] ?? {})
  const field = (p, key) => valueOf(p)[key] ?? p[key]

  function edit(p, key, value) {
    setEdits({
      ...edits,
      [p.supplier_sku]: { ...valueOf(p), [key]: value },
    })
  }

  const changed = Object.keys(edits).length
  const missingSku = products.filter((p) => !String(field(p, 'sku_prefix') ?? '').trim()).length
  const missingName = products.filter((p) => !String(field(p, 'our_name') ?? '').trim()).length

  // Two products must not end up with the same SKU.
  const duplicateSkus = useMemo(() => {
    const seen = {}
    const dupes = new Set()
    for (const p of products) {
      const prefix = String(field(p, 'sku_prefix') ?? '').trim().toUpperCase()
      if (!prefix) continue
      if (seen[prefix]) dupes.add(prefix)
      seen[prefix] = true
    }
    return dupes
  }, [products, edits])

  async function save() {
    setSaving(true)
    setStatus(null)
    for (const code of Object.keys(edits)) {
      const p = products.find((x) => x.supplier_sku === code)
      if (!p) continue
      const patch = edits[code]
      const { error } = await supabase
        .from('po_products')
        .update({
          our_name: patch.our_name ?? p.our_name,
          sku_prefix: patch.sku_prefix ?? p.sku_prefix,
          has_variants: patch.has_variants ?? p.has_variants,
        })
        .eq('id', p.id)
      if (error) { setSaving(false); return setStatus({ type: 'err', text: error.message }) }
    }
    setSaving(false)
    setEdits({})
    setStatus({ type: 'ok', text: 'Saved.' })
    load()
  }

  function toggle(code) {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  if (loading) return <p className="page-desc">Loading order...</p>
  if (!order) return <p className="page-desc">That order could not be found.</p>

  const units = lines.reduce((n, l) => n + (l.qty_ordered || 0), 0)
  const value = lines.reduce((n, l) => n + (l.qty_ordered || 0) * Number(l.unit_cost || 0), 0)
  const ready = missingSku === 0 && missingName === 0 && duplicateSkus.size === 0

  return (
    <div>
      <BackLink to="/purchase-orders" label="Back to purchase orders" />

      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">{order.reference}</h2>
        <p className="page-desc">
          {order.brands?.name} from {order.suppliers?.name}, {order.order_year}{' '}
          {order.order_type === 'indent' ? 'indent' : 'new products'}.
          {order.source_file_name ? ` Imported from ${order.source_file_name}.` : ''}
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Products</div>
          <div className="stat-value">{products.length}</div>
          <div className="stat-note">{lines.length} lines in total</div>
        </div>
        <div className="card">
          <div className="stat-label">Units</div>
          <div className="stat-value">{units}</div>
          <div className="stat-note">Ordered across all sizes</div>
        </div>
        <div className="card">
          <div className="stat-label">Cost</div>
          <div className="stat-value">{money(value)}</div>
          <div className="stat-note">At the costs on the order</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Names and SKUs</h3>
          <div className="search-wrap">
            <button className="btn" onClick={save} disabled={!changed || saving}>
              {saving ? 'Saving...' : changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'Saved'}
            </button>
            <button className="btn btn-primary" disabled={!ready || changed > 0} title={
              changed > 0 ? 'Save your changes first' : undefined
            }>
              Push to Lightspeed
            </button>
          </div>
        </div>

        <p className="page-desc" style={{ marginBottom: 14 }}>
          Set what each product is called and its SKU. Products with sizes take the prefix plus
          the size, so <code className="code-ref">PAM27AFL001</code> becomes{' '}
          <code className="code-ref">PAM27AFL001-M</code>. Products without sizes just use the
          prefix.
        </p>

        {(missingSku > 0 || missingName > 0 || duplicateSkus.size > 0) && (
          <div className="placeholder-note" style={{ marginBottom: 14 }}>
            {missingSku > 0 && <div>{missingSku} product(s) still need a SKU prefix.</div>}
            {missingName > 0 && <div>{missingName} product(s) still need a name.</div>}
            {duplicateSkus.size > 0 && (
              <div>
                These SKU prefixes are used more than once: {[...duplicateSkus].join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="product-list">
          {products.map((p) => {
            const productLines = sortVariants(
              (linesByCode[p.supplier_sku] ?? []).map((l) => ({ ...l, option_name: l.option_name }))
            )
            const isOpen = expanded.has(p.supplier_sku)
            const hasVariants = field(p, 'has_variants')
            const prefix = String(field(p, 'sku_prefix') ?? '')
            const dupe = duplicateSkus.has(prefix.trim().toUpperCase())
            const qty = productLines.reduce((n, l) => n + (l.qty_ordered || 0), 0)

            return (
              <div key={p.id} className="product-row">
                <div className="po-product">
                  <button
                    className="po-toggle"
                    onClick={() => toggle(p.supplier_sku)}
                    aria-label="Show sizes"
                  >
                    <span className={'chev' + (isOpen ? ' open' : '')}>›</span>
                  </button>

                  <div className="po-supplier">
                    <span className="cell-strong">{p.supplier_sku}</span>
                    <span className="cell-sub">
                      {p.supplier_name}
                      {p.colour ? ` · ${p.colour}` : ''}
                    </span>
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Our product name</label>
                    <input
                      className="input"
                      value={field(p, 'our_name') ?? ''}
                      onChange={(e) => edit(p, 'our_name', e.target.value)}
                    />
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>SKU prefix</label>
                    <input
                      className="input"
                      value={prefix}
                      onChange={(e) => edit(p, 'sku_prefix', e.target.value.toUpperCase())}
                      style={dupe ? { borderColor: '#c0392b' } : undefined}
                    />
                  </div>

                  <label className="check-row po-variants" title="Adds the size after the SKU">
                    <input
                      type="checkbox"
                      checked={hasVariants}
                      onChange={(e) => edit(p, 'has_variants', e.target.checked)}
                    />
                    <span>Sizes</span>
                  </label>

                  <span className="stock-chip">{qty}</span>
                </div>

                {isOpen && (
                  <div className="product-variants">
                    <table className="variant-table">
                      <thead>
                        <tr>
                          <th>Size</th>
                          <th>SKU that will be created</th>
                          <th className="num">Qty</th>
                          <th className="num">Cost</th>
                          <th className="num">RRP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productLines.map((l) => (
                          <tr key={l.id}>
                            <td className="cell-strong">
                              {hasVariants ? l.option_name : <span className="cell-sub">no sizes</span>}
                            </td>
                            <td>
                              <code className="code-ref">
                                {skuFor(
                                  { sku_prefix: prefix, has_variants: hasVariants },
                                  l.option_name
                                ) || 'set a prefix'}
                              </code>
                            </td>
                            <td className="num">{l.qty_ordered}</td>
                            <td className="num">{l.unit_cost ? money(l.unit_cost) : '-'}</td>
                            <td className="num">{l.retail_price ? money(l.retail_price) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!hasVariants && productLines.length > 1 && (
                      <div className="placeholder-note" style={{ marginTop: 10 }}>
                        This product has {productLines.length} sizes on the order but is marked as
                        having none. Every size would share one SKU. Tick Sizes unless that is
                        deliberate.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
