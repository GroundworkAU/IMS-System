import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import { readWorkbook, colLetter, cleanHeader } from '../lib/sheet'

// Barcodes usually arrive weeks after the order. This matches a file of
// SKU/barcode pairs back onto the order lines.
export default function BarcodeImport({ poId, lines, skuFor, onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [headerRow, setHeaderRow] = useState(0)
  const [skuCol, setSkuCol] = useState(null)
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
  const pairs = []
  if (skuCol != null && barcodeCol != null) {
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const sku = rows[r]?.[skuCol]
      const barcode = rows[r]?.[barcodeCol]
      if (sku == null || barcode == null) continue
      const cleanSku = String(sku).trim().toUpperCase()
      const cleanBarcode = String(barcode).trim()
      if (!cleanSku || !cleanBarcode) continue
      pairs.push({ sku: cleanSku, barcode: cleanBarcode })
    }
  }

  const byLine = []
  const unmatched = []
  for (const pair of pairs) {
    const line = lines.find((l) => skuFor(l).toUpperCase() === pair.sku)
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
          <div className="form-row">
            <div className="field" style={{ flex: '0 1 130px' }}>
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
            <div className="field" style={{ flex: '1 1 160px' }}>
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

          {skuCol != null && barcodeCol != null && (
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
              {unmatched.length} row(s) did not match a SKU on this order, for example{' '}
              {unmatched.slice(0, 3).map((u) => u.sku).join(', ')}. Check the SKUs match what you
              set on this order.
            </div>
          )}
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
