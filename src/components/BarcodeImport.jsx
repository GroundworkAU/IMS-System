import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import { readWorkbook, colLetter, cleanHeader, normaliseBarcode } from '../lib/sheet'

// Barcodes usually arrive weeks after the order. This matches a file of
// SKU/barcode pairs back onto the order lines.
// Sizes are written every which way between systems: "SM", "S/M", "s m".
// Compare them stripped back to letters and numbers.
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export default function BarcodeImport({ poId, lines, skuFor, onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [headerRow, setHeaderRow] = useState(0)
  const [mode, setMode] = useState('sku')      // 'sku' or 'code_size'
  const [skuCol, setSkuCol] = useState(null)
  const [codeCol, setCodeCol] = useState(null)
  const [sizeCol, setSizeCol] = useState(null)
  const [barcodeCol, setBarcodeCol] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(file) {
    setError(null)
    try {
      const sheets = await readWorkbook(file)
      setRows(sheets[0]?.rows ?? [])
      setSkuCol(null)
      setBarcodeCol(null)
    } catch (err) {
      setError(`Could not read that file: ${err.message}`)
    }
  }

  const headers = rows[headerRow] ?? []

  // Build the pairs, then see which of our lines they hit.
  const ready = barcodeCol != null &&
    (mode === 'sku' ? skuCol != null : codeCol != null && sizeCol != null)

  const pairs = []
  if (ready) {
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const barcode = normaliseBarcode(rows[r]?.[barcodeCol])
      if (!barcode) continue

      if (mode === 'sku') {
        const sku = rows[r]?.[skuCol]
        if (sku == null || String(sku).trim() === '') continue
        pairs.push({ label: String(sku).trim(), sku: String(sku).trim().toUpperCase(), barcode })
      } else {
        const code = rows[r]?.[codeCol]
        const size = rows[r]?.[sizeCol]
        if (code == null || String(code).trim() === '') continue
        pairs.push({
          label: `${String(code).trim()} ${String(size ?? '').trim()}`.trim(),
          code: String(code).trim().toUpperCase(),
          size: norm(size),
          barcode,
        })
      }
    }
  }

  const byLine = []
  const unmatched = []
  for (const pair of pairs) {
    const line = mode === 'sku'
      ? lines.find((l) => skuFor(l).toUpperCase() === pair.sku)
      : lines.find(
          (l) =>
            String(l.supplier_sku ?? '').trim().toUpperCase() === pair.code &&
            norm(l.option_name) === pair.size
        )

    if (line) byLine.push({ line, barcode: pair.barcode })
    else unmatched.push(pair)
  }

  const missing = lines.filter(
    (l) => !byLine.some((m) => m.line.id === l.id) && !l.barcode
  )

  async function save() {
    setBusy(true)
    setError(null)
    for (const { line, barcode } of byLine) {
      const { error: uErr } = await supabase
        .from('purchase_order_lines')
        .update({ barcode })
        .eq('id', line.id)
      if (uErr) { setBusy(false); return setError(uErr.message) }
    }
    setBusy(false)
    onDone(byLine.length)
  }

  return (
    <Modal
      title="Import barcodes"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={busy || byLine.length === 0}
          >
            {busy ? 'Saving...' : `Apply ${byLine.length} barcode${byLine.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        Upload the file your supplier sent. We match on the SKU we created, so the file needs a
        column of SKUs and a column of barcodes.
      </p>

      <div className="field">
        <label htmlFor="bc-file">Barcode file</label>
        <input
          id="bc-file"
          className="input"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {rows.length > 0 && (
        <>
          <div className="field">
            <label>How does their file identify each item?</label>
            <div className="loc-chips" style={{ marginTop: 4 }}>
              <button
                className={'loc-chip' + (mode === 'sku' ? ' on' : '')}
                onClick={() => setMode('sku')}
              >
                By our SKU
              </button>
              <button
                className={'loc-chip' + (mode === 'code_size' ? ' on' : '')}
                onClick={() => setMode('code_size')}
              >
                By their code and size
              </button>
            </div>
            <p className="field-hint">
              Suppliers usually send their own product code with a size beside it rather than the
              SKU you created. Both together identify the item.
            </p>
          </div>

          <div className="form-row">
            <div className="field" style={{ flex: '0 1 120px' }}>
              <label htmlFor="bc-header">Header row</label>
              <input
                id="bc-header"
                className="input"
                type="number"
                min="1"
                value={headerRow + 1}
                onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))}
              />
            </div>

            {mode === 'sku' ? (
              <div className="field" style={{ flex: '1 1 160px' }}>
                <label htmlFor="bc-sku">SKU column</label>
                <select
                  id="bc-sku"
                  className="input"
                  value={skuCol ?? ''}
                  onChange={(e) => setSkuCol(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">Choose...</option>
                  {headers.map((h, i) =>
                    cleanHeader(h) ? (
                      <option key={i} value={i}>{colLetter(i)} · {cleanHeader(h).slice(0, 30)}</option>
                    ) : null
                  )}
                </select>
              </div>
            ) : (
              <>
                <div className="field" style={{ flex: '1 1 150px' }}>
                  <label htmlFor="bc-supcode">Their product code</label>
                  <select
                    id="bc-supcode"
                    className="input"
                    value={codeCol ?? ''}
                    onChange={(e) => setCodeCol(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Choose...</option>
                    {headers.map((h, i) =>
                      cleanHeader(h) ? (
                        <option key={i} value={i}>{colLetter(i)} · {cleanHeader(h).slice(0, 26)}</option>
                      ) : null
                    )}
                  </select>
                </div>
                <div className="field" style={{ flex: '1 1 130px' }}>
                  <label htmlFor="bc-size">Size column</label>
                  <select
                    id="bc-size"
                    className="input"
                    value={sizeCol ?? ''}
                    onChange={(e) => setSizeCol(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Choose...</option>
                    {headers.map((h, i) =>
                      cleanHeader(h) ? (
                        <option key={i} value={i}>{colLetter(i)} · {cleanHeader(h).slice(0, 26)}</option>
                      ) : null
                    )}
                  </select>
                </div>
              </>
            )}

            <div className="field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="bc-code">Barcode column</label>
              <select
                id="bc-code"
                className="input"
                value={barcodeCol ?? ''}
                onChange={(e) => setBarcodeCol(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Choose...</option>
                {headers.map((h, i) =>
                  cleanHeader(h) ? (
                    <option key={i} value={i}>{colLetter(i)} · {cleanHeader(h).slice(0, 30)}</option>
                  ) : null
                )}
              </select>
            </div>
          </div>

          {ready && (
            <div className="fact-row" style={{ marginTop: 4 }}>
              <span>
                <span className="fact-label">Matched</span>
                {byLine.length} line{byLine.length === 1 ? '' : 's'}
              </span>
              <span>
                <span className="fact-label">In the file but not on this order</span>
                {unmatched.length}
              </span>
              <span>
                <span className="fact-label">Still without a barcode</span>
                {missing.length}
              </span>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="placeholder-note">
              {unmatched.length} row(s) did not match anything on this order, for example{' '}
              {unmatched.slice(0, 4).map((u) => u.label).join(', ')}.{' '}
              {mode === 'sku'
                ? 'Try matching by their code and size instead.'
                : 'Check their code matches the supplier code on this order, and that the sizes line up.'}
            </div>
          )}
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
