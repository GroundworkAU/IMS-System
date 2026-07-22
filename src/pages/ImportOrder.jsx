import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BackLink from '../components/BackLink'
import { readWorkbook, colLetter, cleanHeader, guessSize, isNumeric, toNumber } from '../lib/sheet'

// What we need out of a supplier's file, whatever they call it.
const FIELDS = [
  { key: 'supplier_sku', label: 'Supplier code', hint: 'Their product code, e.g. Code or MATERIAL ID', required: true },
  { key: 'name', label: 'Product description', hint: 'The product name', required: true },
  { key: 'colour', label: 'Colour', hint: 'Optional' },
  { key: 'unit_cost', label: 'Cost per unit', hint: 'What you pay, e.g. WHL per Pc or NET PRICE' },
  { key: 'retail_price', label: 'Recommended retail', hint: 'Optional' },
  { key: 'barcode', label: 'Barcode', hint: 'Optional. Only if the file already has them' },
  { key: 'total_check', label: 'Their total column', hint: 'Optional, used to check our maths' },
]

export default function ImportOrder() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [orderYear, setOrderYear] = useState(new Date().getFullYear() + 1)
  const [orderType, setOrderType] = useState('new')
  const [reference, setReference] = useState('')
  const [mode, setMode] = useState('new')          // 'new' or 'existing'
  const [existingOrders, setExistingOrders] = useState([])
  const [existingOrderId, setExistingOrderId] = useState('')
  const [locations, setLocations] = useState([])
  const [destination, setDestination] = useState('')   // '' = not split yet

  const [file, setFile] = useState(null)
  const [sheets, setSheets] = useState([])
  const [sheetIndex, setSheetIndex] = useState(0)      // the sheet used for mapping
  const [chosenSheets, setChosenSheets] = useState([0]) // every sheet to read
  const [headerRow, setHeaderRow] = useState(null)   // zero based
  const [mapping, setMapping] = useState({})         // field -> column index
  const [sizeCols, setSizeCols] = useState({})       // column index -> size label
  const [templateId, setTemplateId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setSuppliers(data ?? []))
    supabase.from('locations').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setLocations(data ?? []))
  }, [])

  // Orders already started for this supplier, so another file can be added.
  useEffect(() => {
    if (!supplierId) { setExistingOrders([]); return }
    supabase
      .from('purchase_orders')
      .select('id, reference, order_year, po_imports(file_name, locations:location_id(name))')
      .eq('supplier_id', supplierId)
      .is('pushed_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setExistingOrders(data ?? []))
  }, [supplierId])

  useEffect(() => {
    if (!supplierId) { setBrands([]); return }
    supabase.from('brands').select('id, name').eq('supplier_id', supplierId).order('name')
      .then(({ data }) => setBrands(data ?? []))
  }, [supplierId])

  const sheet = sheets[sheetIndex]
  const rows = sheet?.rows ?? []
  const headers = headerRow != null ? (rows[headerRow] ?? []) : []

  // Apply a saved template by matching header text, so moved columns still work.
  const applyTemplate = useCallback((config, aliases, sheetRows) => {
    const wanted = config.headers ?? {}
    const sizeNames = config.sizes ?? []

    let bestRow = null
    let bestScore = 0
    const targets = Object.values(wanted).concat(sizeNames).map((h) => h.toLowerCase())

    sheetRows.slice(0, 40).forEach((row, i) => {
      const cells = (row ?? []).map((c) => cleanHeader(c).toLowerCase()).filter(Boolean)
      const score = cells.filter((c) => targets.includes(c)).length
      if (score > bestScore) { bestScore = score; bestRow = i }
    })

    if (bestRow == null || bestScore < 2) return false

    const rowCells = (sheetRows[bestRow] ?? []).map((c) => cleanHeader(c))
    const nextMapping = {}
    for (const [field, header] of Object.entries(wanted)) {
      const idx = rowCells.findIndex((c) => c.toLowerCase() === header.toLowerCase())
      if (idx !== -1) nextMapping[field] = idx
    }

    const nextSizes = {}
    rowCells.forEach((cell, idx) => {
      if (!cell) return
      if (sizeNames.some((s) => s.toLowerCase() === cell.toLowerCase())) {
        nextSizes[idx] = aliases?.[cell] ?? guessSize(sheetRows[bestRow][idx])
      }
    })

    setHeaderRow(bestRow)
    setMapping(nextMapping)
    setSizeCols(nextSizes)
    return true
  }, [])

  async function handleFile(f) {
    setError(null)
    setFile(f)
    try {
      const parsed = await readWorkbook(f)
      setSheets(parsed)
      setSheetIndex(0)
      setChosenSheets([0])

      // Any saved template for this supplier?
      if (supplierId) {
        const { data: tpl } = await supabase
          .from('import_templates')
          .select('id, column_config, size_aliases')
          .eq('supplier_id', supplierId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (tpl?.column_config) {
          setTemplateId(tpl.id)
          const ok = applyTemplate(tpl.column_config, tpl.size_aliases, parsed[0].rows)
          setStep(ok ? 4 : 2)
          return
        }
      }
      setStep(2)
    } catch (err) {
      setError(`Could not read that file: ${err.message}`)
    }
  }

  // ---- parse -------------------------------------------------------------
  // Columns are matched by heading text rather than position, so the same
  // mapping works across sheets that are laid out slightly differently.
  const parsed = useMemo(() => {
    const empty = { lines: [], products: 0, total: 0, theirTotal: 0, perSheet: [] }
    if (headerRow == null || mapping.supplier_sku == null) return empty

    const fieldHeaders = {}
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx == null) continue
      fieldHeaders[field] = cleanHeader(headers[idx]).toLowerCase()
    }
    const sizeHeaders = {}
    for (const [idx, label] of Object.entries(sizeCols)) {
      sizeHeaders[cleanHeader(headers[Number(idx)]).toLowerCase()] = label
    }
    const targets = Object.values(fieldHeaders).concat(Object.keys(sizeHeaders))

    const out = []
    let theirTotal = 0
    const perSheet = []

    for (const si of chosenSheets) {
      const sheetRows = sheets[si]?.rows ?? []
      if (sheetRows.length === 0) continue

      // Find this sheet's header row by matching the headings we know.
      let hRow = si === sheetIndex ? headerRow : null
      if (hRow == null) {
        let best = 0
        sheetRows.slice(0, 40).forEach((row, i) => {
          const cells = (row ?? []).map((c) => cleanHeader(c).toLowerCase()).filter(Boolean)
          const score = cells.filter((c) => targets.includes(c)).length
          if (score > best) { best = score; hRow = i }
        })
        if (best < 2) { perSheet.push({ name: sheets[si].name, lines: 0, found: false }); continue }
      }

      const rowCells = (sheetRows[hRow] ?? []).map((c) => cleanHeader(c).toLowerCase())
      const idxOf = (header) => (header ? rowCells.indexOf(header) : -1)

      const cCode = idxOf(fieldHeaders.supplier_sku)
      if (cCode === -1) { perSheet.push({ name: sheets[si].name, lines: 0, found: false }); continue }

      const cName = idxOf(fieldHeaders.name)
      const cColour = idxOf(fieldHeaders.colour)
      const cCost = idxOf(fieldHeaders.unit_cost)
      const cRrp = idxOf(fieldHeaders.retail_price)
      const cBarcode = idxOf(fieldHeaders.barcode)
      const cTotal = idxOf(fieldHeaders.total_check)

      const sizeIdx = []
      rowCells.forEach((cell, i) => {
        if (cell && sizeHeaders[cell]) sizeIdx.push([i, sizeHeaders[cell]])
      })

      let sheetLines = 0
      for (let r = hRow + 1; r < sheetRows.length; r += 1) {
        const row = sheetRows[r] ?? []
        const code = row[cCode]
        if (code == null || String(code).trim() === '') continue
        if (/^total/i.test(String(code).trim())) continue

        const cost = cCost === -1 ? 0 : toNumber(row[cCost])
        const rrp = cRrp === -1 ? 0 : toNumber(row[cRrp])
        if (cTotal !== -1) theirTotal += toNumber(row[cTotal])

        for (const [ci, sizeLabel] of sizeIdx) {
          const qty = toNumber(row[ci])
          if (!qty || qty <= 0) continue
          out.push({
            supplier_sku: String(code).trim(),
            name: cName === -1 || row[cName] == null ? '' : String(row[cName]).trim(),
            colour: cColour === -1 || row[cColour] == null ? null : String(row[cColour]).trim(),
            size: sizeLabel,
            qty,
            unit_cost: cost,
            retail_price: rrp,
            barcode: cBarcode === -1 || row[cBarcode] == null ? null : String(row[cBarcode]).trim(),
            sheet: sheets[si].name,
          })
          sheetLines += 1
        }
      }

      perSheet.push({ name: sheets[si].name, lines: sheetLines, found: true })
    }

    // The same product can appear on more than one sheet, so add the sizes up.
    const merged = {}
    for (const l of out) {
      const key = `${l.supplier_sku}||${l.size}`
      if (!merged[key]) merged[key] = { ...l }
      else merged[key].qty += l.qty
    }
    const lines = Object.values(merged)

    const products = new Set(lines.map((l) => l.supplier_sku)).size
    const total = lines.reduce((n, l) => n + l.qty, 0)
    return { lines, products, total, theirTotal, perSheet }
  }, [sheets, chosenSheets, sheetIndex, headers, headerRow, mapping, sizeCols])

  // ---- save --------------------------------------------------------------
  async function save() {
    if (!supplierId || !brandId) return setError('Choose the supplier and brand.')
    if (mode === 'existing' && !existingOrderId) return setError('Choose the order to add to.')
    if (parsed.lines.length === 0) return setError('Nothing to import ~ check the mapping.')

    setBusy(true)
    setError(null)

    let poId = existingOrderId

    if (mode === 'new') {
      const { data: order, error: oErr } = await supabase
        .from('purchase_orders')
        .insert({
          org_id: profile.org_id,
          reference: reference.trim() || `${file?.name?.replace(/\.[^.]+$/, '') ?? 'Order'}`,
          brand_id: brandId,
          supplier_id: supplierId,
          order_year: Number(orderYear),
          order_type: orderType,
          status: 'confirmed',
          source_file_name: file?.name ?? null,
          created_by: profile.id,
        })
        .select('id')
        .single()

      if (oErr) {
        setBusy(false)
        return setError(
          oErr.code === '23505' ? 'An order with that reference already exists.' : oErr.message
        )
      }
      poId = order.id
    }

    // What is already on this order, so a second file adds to it rather than
    // creating the same product twice.
    const { data: existingLines } = await supabase
      .from('purchase_order_lines')
      .select('id, supplier_sku, option_name, qty_ordered')
      .eq('po_id', poId)

    const lineKey = (sku, size) => `${sku}||${String(size ?? '').trim().toUpperCase()}`
    const byKey = {}
    for (const l of existingLines ?? []) byKey[lineKey(l.supplier_sku, l.option_name)] = l

    let units = 0

    for (const l of parsed.lines) {
      units += l.qty
      const key = lineKey(l.supplier_sku, l.size)
      const existing = byKey[key]
      let lineId = existing?.id

      if (existing) {
        const { error: uErr } = await supabase
          .from('purchase_order_lines')
          .update({
            qty_ordered: (existing.qty_ordered || 0) + l.qty,
            ...(l.barcode ? { barcode: l.barcode } : {}),
          })
          .eq('id', existing.id)
        if (uErr) { setBusy(false); return setError(uErr.message) }
      } else {
        const { data: inserted, error: iErr } = await supabase
          .from('purchase_order_lines')
          .insert({
            org_id: profile.org_id,
            po_id: poId,
            supplier_sku: l.supplier_sku,
            supplier_product_name: l.name,
            colour: l.colour,
            option_name: l.size,
            qty_ordered: l.qty,
            unit_cost: l.unit_cost,
            retail_price: l.retail_price,
            barcode: l.barcode || null,
          })
          .select('id')
          .single()
        if (iErr) { setBusy(false); return setError(iErr.message) }
        lineId = inserted.id
        byKey[key] = { id: lineId, qty_ordered: l.qty }
      }

      // Record where this file's stock is going, if we were told.
      if (destination && lineId) {
        const { data: alloc } = await supabase
          .from('po_allocations')
          .select('id, qty')
          .match({ po_line_id: lineId, location_id: destination })
          .maybeSingle()

        if (alloc) {
          await supabase
            .from('po_allocations')
            .update({ qty: (alloc.qty || 0) + l.qty })
            .eq('id', alloc.id)
        } else {
          await supabase.from('po_allocations').insert({
            org_id: profile.org_id,
            po_line_id: lineId,
            location_id: destination,
            qty: l.qty,
          })
        }
      }
    }

    // Product rows for anything new on this order.
    const { data: knownProducts } = await supabase
      .from('po_products')
      .select('supplier_sku')
      .eq('po_id', poId)
    const known = new Set((knownProducts ?? []).map((p) => p.supplier_sku))

    const byCode = {}
    for (const l of parsed.lines) {
      if (known.has(l.supplier_sku)) continue
      if (!byCode[l.supplier_sku]) {
        byCode[l.supplier_sku] = {
          org_id: profile.org_id,
          po_id: poId,
          supplier_sku: l.supplier_sku,
          supplier_name: l.name,
          colour: l.colour,
          our_name: l.name,
          sku_prefix: l.supplier_sku,
          sizes: new Set(),
        }
      }
      byCode[l.supplier_sku].sizes.add(l.size)
    }

    const productRows = Object.values(byCode).map(({ sizes, ...row }) => ({
      ...row,
      has_variants: sizes.size > 1 || ![...sizes].every((s) => /one\s*size|osfm/i.test(s)),
    }))

    if (productRows.length) {
      const { error: pErr } = await supabase.from('po_products').insert(productRows)
      if (pErr) { setBusy(false); return setError(pErr.message) }
    }

    // Keep a record of the file itself.
    await supabase.from('po_imports').insert({
      org_id: profile.org_id,
      po_id: poId,
      file_name: file?.name ?? null,
      sheets: parsed.perSheet.filter((sh) => sh.lines > 0).map((sh) => sh.name).join(', '),
      location_id: destination || null,
      line_count: parsed.lines.length,
      unit_count: units,
      imported_by: profile.id,
    })

    // Remember how this file was read.
    const config = {
      headers: Object.fromEntries(
        Object.entries(mapping)
          .filter(([, idx]) => idx != null)
          .map(([field, idx]) => [field, cleanHeader(headers[idx])])
      ),
      sizes: Object.keys(sizeCols).map((idx) => cleanHeader(headers[Number(idx)])),
    }
    const aliases = Object.fromEntries(
      Object.entries(sizeCols).map(([idx, label]) => [cleanHeader(headers[Number(idx)]), label])
    )

    await supabase.from('import_templates').upsert(
      {
        ...(templateId ? { id: templateId } : {}),
        org_id: profile.org_id,
        supplier_id: supplierId,
        name: 'Order confirmation',
        source_format: 'excel',
        column_config: config,
        size_aliases: aliases,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    setBusy(false)
    navigate(`/purchase-orders/${poId}`)
  }

  // ---- render ------------------------------------------------------------
  return (
    <div>
      <BackLink to="/purchase-orders" label="Back to purchase orders" />

      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">Import a supplier order</h2>
        <p className="page-desc">
          Upload the confirmation your supplier sent. Sizes usually run across the columns ~ tell
          us which ones once, and we will remember it for next time.
        </p>
      </div>

      {error && <div className="auth-msg err" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="steps">
        {['Order details', 'Find the table', 'Map the columns', 'Check and import'].map((label, i) => (
          <div key={label} className={'step' + (step === i + 1 ? ' active' : step > i + 1 ? ' done' : '')}>
            <span className="step-num">{i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {/* ---- 1. order details ---- */}
      {step === 1 && (
        <div className="card">
          <h3 className="section-title">Which order is this?</h3>
          <div className="form-row">
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label htmlFor="sup">Supplier</label>
              <select id="sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="brand">Brand</label>
              <select id="brand" className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Choose...</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {supplierId && brands.length === 0 && (
                <p className="field-hint">
                  That supplier has no brands linked yet. Add one under Suppliers &amp; Brands.
                </p>
              )}
            </div>
          </div>

          <div className="field">
            <label>Is this a new order, or another file for one you have started?</label>
            <div className="loc-chips" style={{ marginTop: 4 }}>
              <button
                className={'loc-chip' + (mode === 'new' ? ' on' : '')}
                onClick={() => setMode('new')}
              >
                A new order
              </button>
              <button
                className={'loc-chip' + (mode === 'existing' ? ' on' : '')}
                disabled={existingOrders.length === 0}
                onClick={() => setMode('existing')}
              >
                Add to an existing order
              </button>
            </div>
            {mode === 'existing' && (
              <select
                className="input"
                style={{ marginTop: 10 }}
                value={existingOrderId}
                onChange={(e) => setExistingOrderId(e.target.value)}
              >
                <option value="">Choose the order...</option>
                {existingOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.reference} ({o.order_year}) ~ {(o.po_imports ?? []).length} file(s) so far
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field">
            <label htmlFor="dest">Where is this file's stock going?</label>
            <select
              id="dest"
              className="input"
              style={{ maxWidth: 340 }}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Not split yet ~ these are total quantities</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="field-hint">
              If your supplier sends one file per destination, import each in turn and pick its
              location here. Products are matched across files, so the order ends up with the
              total and a split by location.
            </p>
          </div>

          <div className="form-row" style={mode === 'existing' ? { display: 'none' } : undefined}>
            <div className="field" style={{ flex: '0 1 140px' }}>
              <label htmlFor="year">Season / year</label>
              <input id="year" className="input" type="number" value={orderYear}
                onChange={(e) => setOrderYear(e.target.value)} />
            </div>
            <div className="field" style={{ flex: '0 1 180px' }}>
              <label htmlFor="type">Order type</label>
              <select id="type" className="input" value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                <option value="new">New products</option>
                <option value="indent">Indent ~ existing products</option>
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label htmlFor="ref">Your reference</label>
              <input id="ref" className="input" placeholder="e.g. 2027 Venue Retail Order"
                value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="file">The supplier's file</label>
            <input
              id="file"
              className="input"
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={!supplierId || !brandId || (mode === 'existing' && !existingOrderId)}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <p className="field-hint">
              Excel or CSV. Choose the supplier first so we can reuse their mapping.
            </p>
          </div>
        </div>
      )}

      {/* ---- 2. find the header row ---- */}
      {step === 2 && sheet && (
        <div className="card">
          <div className="card-head">
            <h3 className="section-title" style={{ margin: 0 }}>Which row holds the column headings?</h3>
            {sheets.length > 1 && (
              <select
                className="input"
                style={{ width: 'auto' }}
                value={sheetIndex}
                onChange={(e) => { setSheetIndex(Number(e.target.value)); setHeaderRow(null) }}
              >
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
              </select>
            )}
          </div>

          {sheets.length > 1 && (
            <div className="field">
              <label>Which sheets should we read?</label>
              <p className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Suppliers often split an order across sheets, one per delivery. Tick every sheet
                that holds order lines ~ the same column mapping is used for all of them, and a
                product appearing on several sheets has its quantities added together.
              </p>
              <div className="loc-chips">
                {sheets.map((sh, i) => {
                  const on = chosenSheets.includes(i)
                  return (
                    <button
                      key={sh.name}
                      className={'loc-chip' + (on ? ' on' : '')}
                      onClick={() =>
                        setChosenSheets(
                          on ? chosenSheets.filter((x) => x !== i) : [...chosenSheets, i]
                        )
                      }
                    >
                      {sh.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <p className="page-desc" style={{ marginBottom: 12 }}>
            Click the row that names the columns ~ the one with things like Code, Description and
            the sizes.
          </p>

          <div className="sheet-preview">
            <table className="sheet-table">
              <tbody>
                {rows.slice(0, 30).map((row, i) => (
                  <tr
                    key={i}
                    className={headerRow === i ? 'chosen' : ''}
                    onClick={() => setHeaderRow(i)}
                  >
                    <td className="row-num">{i + 1}</td>
                    {Array.from({ length: Math.min(18, Math.max(...rows.slice(0, 30).map((r) => r?.length ?? 0))) })
                      .map((_, c) => (
                        <td key={c}>{row?.[c] == null ? '' : String(row[c]).slice(0, 18)}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="page-actions" style={{ marginTop: 16 }}>
            <span className="field-hint" style={{ margin: 0 }}>
              {headerRow == null ? 'Nothing chosen yet' : `Row ${headerRow + 1} selected`}
            </span>
            <div className="request-bar-actions">
              <button className="btn" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-primary" disabled={headerRow == null} onClick={() => setStep(3)}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 3. map columns ---- */}
      {step === 3 && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="section-title">What does each column mean?</h3>
            <div className="map-grid">
              {FIELDS.map((f) => (
                <div key={f.key} className="field" style={{ marginBottom: 0 }}>
                  <label>{f.label}{f.required && ' *'}</label>
                  <select
                    className="input"
                    value={mapping[f.key] ?? ''}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [f.key]: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">Not in this file</option>
                    {headers.map((h, i) =>
                      cleanHeader(h) ? (
                        <option key={i} value={i}>
                          {colLetter(i)} · {cleanHeader(h).slice(0, 40)}
                        </option>
                      ) : null
                    )}
                  </select>
                  <p className="field-hint">{f.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="section-title" style={{ margin: 0 }}>Which columns are sizes?</h3>
              <span className="cell-sub">{Object.keys(sizeCols).length} selected</span>
            </div>
            <p className="page-desc" style={{ marginBottom: 12 }}>
              Tick every column that holds a quantity for a size. Correct the size name if their
              heading is messy ~ we will remember your wording.
            </p>

            <div className="size-map">
              {headers.map((h, i) => {
                const label = cleanHeader(h)
                if (!label) return null
                const on = sizeCols[i] != null
                const mapped = Object.values(mapping).includes(i)
                return (
                  <div key={i} className={'size-map-row' + (on ? ' on' : '')}>
                    <label className="check-row" style={{ margin: 0, flex: '1 1 auto' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={mapped}
                        onChange={() => {
                          const next = { ...sizeCols }
                          if (on) delete next[i]
                          else next[i] = guessSize(h)
                          setSizeCols(next)
                        }}
                      />
                      <span>
                        <span className="cell-strong">{colLetter(i)}</span>{' '}
                        <span className="cell-sub">{label.slice(0, 50)}</span>
                        {mapped && <span className="cell-sub"> (used above)</span>}
                      </span>
                    </label>
                    {on && (
                      <input
                        className="input mini"
                        style={{ width: 110 }}
                        value={sizeCols[i]}
                        onChange={(e) => setSizeCols({ ...sizeCols, [i]: e.target.value })}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <div className="page-actions" style={{ marginTop: 16 }}>
              <span className="field-hint" style={{ margin: 0 }}>
                {parsed.lines.length} lines found with these settings
              </span>
              <div className="request-bar-actions">
                <button className="btn" onClick={() => setStep(2)}>Back</button>
                <button
                  className="btn btn-primary"
                  disabled={!mapping.supplier_sku || Object.keys(sizeCols).length === 0}
                  onClick={() => setStep(4)}
                >
                  Preview
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- 4. preview ---- */}
      {step === 4 && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="stat-label">Products</div>
              <div className="stat-value">{parsed.products}</div>
              <div className="stat-note">Distinct supplier codes</div>
            </div>
            <div className="card">
              <div className="stat-label">Lines</div>
              <div className="stat-value">{parsed.lines.length}</div>
              <div className="stat-note">One per size with a quantity</div>
            </div>
            <div className="card">
              <div className="stat-label">Units</div>
              <div className="stat-value">{parsed.total}</div>
              <div className="stat-note">
                {mapping.total_check != null
                  ? parsed.theirTotal === parsed.total
                    ? 'Matches their total'
                    : `Their total says ${parsed.theirTotal}`
                  : 'No total column mapped'}
              </div>
            </div>
          </div>

          {parsed.perSheet.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 className="section-title">Sheets read</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Sheet</th><th className="num">Lines found</th><th></th></tr></thead>
                  <tbody>
                    {parsed.perSheet.map((sh) => (
                      <tr key={sh.name}>
                        <td className="cell-strong">{sh.name}</td>
                        <td className="num">{sh.lines}</td>
                        <td>
                          {!sh.found
                            ? <span className="status-pill bad">Headings not found</span>
                            : sh.lines === 0
                              ? <span className="status-pill neutral">Nothing to import</span>
                              : <span className="status-pill ok">Read</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mapping.total_check != null && parsed.theirTotal !== parsed.total && (
            <div className="auth-msg err" style={{ marginBottom: 16 }}>
              Our total does not match theirs. Check the size columns ~ one may be missed or
              double counted.
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h3 className="section-title" style={{ margin: 0 }}>What will be imported</h3>
              <button className="btn" onClick={() => setStep(3)}>Change the mapping</button>
            </div>

            <div className="table-wrap" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              <table className="variant-table">
                <thead>
                  <tr>
                    <th>Code</th><th>Product</th><th>Colour</th><th>Size</th>
                    {mapping.barcode != null && <th>Barcode</th>}
                    <th className="num">Qty</th><th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.lines.slice(0, 300).map((l, i) => (
                    <tr key={i}>
                      <td className="cell-strong">{l.supplier_sku}</td>
                      <td>{l.name}</td>
                      <td>{l.colour || '-'}</td>
                      <td>{l.size}</td>
                      {mapping.barcode != null && (
                        <td className="cell-sub">{l.barcode || '-'}</td>
                      )}
                      <td className="num">{l.qty}</td>
                      <td className="num">{l.unit_cost ? l.unit_cost.toFixed(2) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.lines.length > 300 && (
                <p className="field-hint">Showing the first 300 of {parsed.lines.length}.</p>
              )}
            </div>

            {mapping.barcode != null && (
              <div className="placeholder-note" style={{ marginTop: 12 }}>
                Barcodes are taken from the product row, so every size on that row gets the same
                one. That is right for single size products, but if their file lists a barcode per
                size you will want to import those separately once the order is in.
              </div>
            )}

            <div className="page-actions" style={{ marginTop: 16 }}>
              <span className="field-hint" style={{ margin: 0 }}>
                {destination
                  ? `These quantities will be allocated to ${
                      locations.find((l) => l.id === destination)?.name ?? 'the chosen location'
                    }.`
                  : 'These are total quantities, not yet split by location.'}
                {mode === 'existing' && ' Adding to the order you chose.'}
              </span>
              <div className="request-bar-actions">
                <button className="btn" onClick={() => navigate('/purchase-orders')}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Importing...' : mode === 'existing' ? 'Add to order' : 'Import order'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
