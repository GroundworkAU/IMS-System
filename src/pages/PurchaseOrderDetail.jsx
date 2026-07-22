import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BackLink from '../components/BackLink'
import { sortVariants } from '../lib/sizes'
import { pushProducts } from '../lib/integrations'
import BarcodeImport from '../components/BarcodeImport'

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
  const [selected, setSelected] = useState(new Set())
  const [pushing, setPushing] = useState(false)
  const [pushResults, setPushResults] = useState(null)
  const [barcodesOpen, setBarcodesOpen] = useState(false)

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
        .select('id,supplier_sku,supplier_product_name,colour,option_name,qty_ordered,unit_cost,retail_price,barcode,external_product_id')
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

  const skuForLine = (l) => {
    const p = products.find((x) => x.supplier_sku === l.supplier_sku)
    if (!p) return ''
    return skuFor(
      { sku_prefix: field(p, 'sku_prefix'), has_variants: field(p, 'has_variants') },
      l.option_name
    )
  }

  async function push() {
    const ids = [...selected]
    if (ids.length === 0) return

    const alreadyDone = products.filter((p) => ids.includes(p.id) && p.pushed_at).length
    const wording = alreadyDone > 0
      ? `${ids.length} product(s) selected. ${alreadyDone} already exist in Lightspeed and will be updated rather than created again.`
      : `Create ${ids.length} product(s) in Lightspeed? This cannot be undone from here.`

    if (!window.confirm(wording)) return

    setPushing(true)
    setPushResults(null)
    const res = await pushProducts(orderId, ids)
    setPushing(false)

    if (res.error && !res.results) {
      setStatus({ type: 'err', text: res.error })
    } else {
      setPushResults(res.results ?? [])
      setStatus({
        type: res.failed > 0 ? 'err' : 'ok',
        text: `${res.created ?? 0} created, ${res.updated ?? 0} updated, ${res.failed ?? 0} failed.`,
      })
      setSelected(new Set())
      load()
    }
  }

  async function removeOrder() {
    const pushed = products.some((p) => p.pushed_at)
    const warning = pushed
      ? `Delete ${order.reference}? ${products.filter((p) => p.pushed_at).length} product(s) already created in Lightspeed stay there ~ this only removes the order from IMS.`
      : `Delete ${order.reference}? Its lines and products go with it and this cannot be undone.`

    if (!window.confirm(warning)) return

    const { error } = await supabase.from('purchase_orders').delete().eq('id', order.id)
    if (error) {
      setStatus({
        type: 'err',
        text: error.message.includes('policy')
          ? 'You can only delete orders you imported. Ask an owner or admin.'
          : error.message,
      })
    } else {
      navigate('/purchase-orders')
    }
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
            <button className="btn btn-quiet" onClick={removeOrder}>
              Delete order
            </button>
            <button className="btn" onClick={() => setBarcodesOpen(true)}>
              Import barcodes
            </button>
            <button className="btn" onClick={save} disabled={!changed || saving}>
              {saving ? 'Saving...' : changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'Saved'}
            </button>
            <button
              className="btn btn-primary"
              disabled={selected.size === 0 || changed > 0 || pushing}
              title={changed > 0 ? 'Save your changes first' : undefined}
              onClick={push}
            >
              {pushing
                ? 'Pushing...'
                : `Push ${selected.size || ''} to Lightspeed`.replace('  ', ' ')}
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

        <div className="bulk-bar">
          <label className="check-row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={products.length > 0 && products.every((p) => selected.has(p.id))}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(products.map((p) => p.id)) : new Set())
              }
            />
            <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
          </label>

          <div className="search-wrap">
            <button
              className="btn"
              onClick={() =>
                setSelected(new Set(products.filter((p) => !p.pushed_at).map((p) => p.id)))
              }
            >
              Select not yet pushed
            </button>
            {selected.size > 0 && (
              <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
          </div>
        </div>

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
                  <span className="po-select">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => {
                        const next = new Set(selected)
                        if (next.has(p.id)) next.delete(p.id)
                        else next.add(p.id)
                        setSelected(next)
                      }}
                      aria-label={`Select ${p.supplier_sku}`}
                    />
                    <button
                      className="po-toggle"
                      onClick={() => toggle(p.supplier_sku)}
                      aria-label="Show sizes"
                    >
                      <span className={'chev' + (isOpen ? ' open' : '')}>›</span>
                    </button>
                  </span>

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

                  <span className="po-state">
                    {p.pushed_at ? (
                      <span className="status-pill ok" title={p.external_parent_id ?? ''}>
                        In Lightspeed
                      </span>
                    ) : p.push_error ? (
                      <span className="status-pill bad" title={p.push_error}>Failed</span>
                    ) : (
                      <span className="status-pill neutral">Not pushed</span>
                    )}
                    <span className="stock-chip">{qty}</span>
                  </span>
                </div>

                {isOpen && (
                  <div className="product-variants">
                    {p.push_error && (
                      <div className="connection-error" style={{ marginBottom: 10 }}>
                        {p.push_error}
                      </div>
                    )}
                    <table className="variant-table">
                      <thead>
                        <tr>
                          <th>Size</th>
                          <th>SKU that will be created</th>
                          <th>Barcode</th>
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
                            <td>
                              {l.barcode
                                ? <code className="code-ref">{l.barcode}</code>
                                : <span className="cell-sub">not yet</span>}
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

      {pushResults && pushResults.some((r) => !r.ok) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">What went wrong</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>SKU</th><th>Problem</th></tr></thead>
              <tbody>
                {pushResults.filter((r) => !r.ok).map((r) => (
                  <tr key={r.id}>
                    <td className="cell-strong">{r.sku}</td>
                    <td className="cell-sub">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {barcodesOpen && (
        <BarcodeImport
          poId={orderId}
          lines={lines}
          skuFor={skuForLine}
          onClose={() => setBarcodesOpen(false)}
          onDone={(n) => {
            setBarcodesOpen(false)
            setStatus({ type: 'ok', text: `${n} barcode${n === 1 ? '' : 's'} applied.` })
            load()
          }}
        />
      )}
    </div>
  )
}
