import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import { readWorkbook, colLetter, cleanHeader, normaliseBarcode } from '../lib/sheet'

// Compare loosely: case, spaces and punctuation differ constantly between a
// supplier's file and what we hold. "S/M" and "sm" are the same size.
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// What we can match against on our side of the order.
const TARGETS = [
  { key: 'supplier_sku', label: 'Their product code', get: (l) => l.supplier_sku },
  { key: 'name', label: 'Product description', get: (l) => l.supplier_product_name },
  { key: 'our_sku', label: 'The SKU we created', get: (l, skuFor) => skuFor(l) },
]

export default function BarcodeImport({ poId, lines, skuFor, onClose, onDone }) {
  const [sheets, setSheets] = useState([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRow, setHeaderRow] = useState(0)
  const [showSheet, setShowSheet] = useState(true)
  const [target, setTarget] = useState('supplier_sku')
  const [keyCol, setKeyCol] = useState(null)
  const [useSize, setUseSize] = useState(true)
  const [sizeCol, setSizeCol] = useState(null)
  const [barcodeCol, setBarcodeCol] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(file) {
    setError(null)
    try {
      const parsed = await readWorkbook(file)
      setSheets(parsed)
      setSheetIndex(0)
      setHeaderRow(0)
      setShowSheet(true)
      setKeyCol(null); setSizeCol(null); setBarcodeCol(null)
    } catch (err) {
      setError(`Could not read that file: ${err.message}`)
    }
  }

  const rows = sheets[sheetIndex]?.rows ?? []
  const headers = rows[headerRow] ?? []
  const targetDef = TARGETS.find((t) => t.key === target) ?? TARGETS[0]

  // Our side of the lookup.
  const ourKeys = useMemo(() => {
    const map = {}
    for (const l of lines) {
      const base = norm(targetDef.get(l, skuFor))
      if (!base) continue
      const key = useSize ? `${base}::${norm(l.option_name)}` : base
      if (!map[key]) map[key] = []
      map[key].push(l)
    }
    return map
  }, [lines, target, useSize, skuFor, targetDef])

  const ready = barcodeCol != null && keyCol != null && (!useSize || sizeCol != null)

  const { matched, unmatched, sample } = useMemo(() => {
    if (!ready) return { matched: [], unmatched: [], sample: [] }

    const matchedRows = []
    const missed = []
    const preview = []

    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const barcode = normaliseBarcode(rows[r]?.[barcodeCol])
      const rawKey = rows[r]?.[keyCol]
      if (!barcode || rawKey == null || String(rawKey).trim() === '') continue

      const rawSize = useSize ? rows[r]?.[sizeCol] : null
      const key = useSize
        ? `${norm(rawKey)}::${norm(rawSize)}`
        : norm(rawKey)

      const hit = ourKeys[key]
      const label = useSize
        ? `${String(rawKey).trim()} · ${String(rawSize ?? '').trim()}`
        : String(rawKey).trim()

      if (preview.length < 5) preview.push({ label, barcode, hit: !!hit })

      if (hit) for (const line of hit) matchedRows.push({ line, barcode })
      else missed.push({ label, barcode })
    }

    return { matched: matchedRows, unmatched: missed, sample: preview }
  }, [rows, headerRow, keyCol, sizeCol, barcodeCol, useSize, ourKeys, ready])

  // A few of ours, so the two can be compared side by side.
  const ourSample = useMemo(
    () =>
      lines.slice(0, 5).map((l) => ({
        label: useSize
          ? `${targetDef.get(l, skuFor) ?? ''} · ${l.option_name ?? ''}`
          : String(targetDef.get(l, skuFor) ?? ''),
      })),
    [lines, target, useSize, skuFor, targetDef]
  )

  const stillMissing = lines.filter(
    (l) => !l.barcode && !matched.some((m) => m.line.id === l.id)
  ).length

  const columnOptions = headers
    .map((h, i) => ({ i, text: cleanHeader(h) }))
    .filter((o) => o.text)

  async function save() {
    setBusy(true)
    setError(null)
    for (const { line, barcode } of matched) {
      const { error: uErr } = await supabase
        .from('purchase_order_lines')
        .update({ barcode })
        .eq('id', line.id)
      if (uErr) { setBusy(false); return setError(uErr.message) }
    }
    setBusy(false)
    onDone(matched.length)
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
            disabled={busy || matched.length === 0}
          >
            {busy ? 'Saving...' : `Apply ${matched.length} barcode${matched.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        This works like a lookup: choose the column in their file that identifies each item, and
        what it corresponds to on this order. The match count updates as you go.
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

      {sheets.length > 0 && (
        <>
          {sheets.length > 1 && (
            <div className="field">
              <label htmlFor="bc-sheet">Which sheet?</label>
              <select
                id="bc-sheet"
                className="input"
                style={{ maxWidth: 260 }}
                value={sheetIndex}
                onChange={(e) => {
                  setSheetIndex(Number(e.target.value))
                  setHeaderRow(0)
                  setKeyCol(null); setSizeCol(null); setBarcodeCol(null)
                }}
              >
                {sheets.map((sh, i) => (
                  <option key={sh.name} value={i}>{sh.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <label style={{ margin: 0 }}>
                Click the row with the column headings
              </label>
              <button className="linklike" onClick={() => setShowSheet(!showSheet)}>
                {showSheet ? 'Hide the file' : 'Show the file'}
              </button>
            </div>

            {showSheet && (
              <div className="sheet-preview" style={{ maxHeight: 220 }}>
                <table className="sheet-table">
                  <tbody>
                    {rows.slice(0, 20).map((row, i) => (
                      <tr
                        key={i}
                        className={headerRow === i ? 'chosen' : ''}
                        onClick={() => {
                          setHeaderRow(i)
                          setKeyCol(null); setSizeCol(null); setBarcodeCol(null)
                        }}
                      >
                        <td className="row-num">{i + 1}</td>
                        {Array.from({
                          length: Math.min(
                            12,
                            Math.max(...rows.slice(0, 20).map((r) => r?.length ?? 0), 1)
                          ),
                        }).map((_, c) => (
                          <td key={c}>{row?.[c] == null ? '' : String(row[c]).slice(0, 18)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {columnOptions.length === 0 && (
            <div className="placeholder-note">
              No column headings found on row {headerRow + 1}. Click the right row above, or try
              another sheet.
            </div>
          )}

          <div className="form-row">

            <div className="field" style={{ flex: '1 1 180px' }}>
              <label htmlFor="bc-key">Their column to match on</label>
              <select
                id="bc-key"
                className="input"
                value={keyCol ?? ''}
                onChange={(e) => setKeyCol(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Choose...</option>
                {columnOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {colLetter(o.i)} · {o.text.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ flex: '1 1 180px' }}>
              <label htmlFor="bc-target">Compare it to</label>
              <select
                id="bc-target"
                className="input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {TARGETS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="bc-code">Barcode column</label>
              <select
                id="bc-code"
                className="input"
                value={barcodeCol ?? ''}
                onChange={(e) => setBarcodeCol(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Choose...</option>
                {columnOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {colLetter(o.i)} · {o.text.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={useSize}
                onChange={(e) => setUseSize(e.target.checked)}
              />
              <span>Also match on size ~ needed unless their column already includes it</span>
            </label>
          </div>

          {useSize && (
            <div className="field">
              <label htmlFor="bc-size">Their size column</label>
              <select
                id="bc-size"
                className="input"
                style={{ maxWidth: 260 }}
                value={sizeCol ?? ''}
                onChange={(e) => setSizeCol(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Choose...</option>
                {columnOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {colLetter(o.i)} · {o.text.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {ready && (
            <>
              <div className="fact-row" style={{ marginTop: 4 }}>
                <span>
                  <span className="fact-label">Matched</span>
                  {matched.length} line{matched.length === 1 ? '' : 's'}
                </span>
                <span>
                  <span className="fact-label">No match on this order</span>
                  {unmatched.length}
                </span>
                <span>
                  <span className="fact-label">Still without a barcode</span>
                  {stillMissing}
                </span>
              </div>

              {/* Seeing both sides is usually enough to spot the problem. */}
              <div className="compare-grid">
                <div>
                  <span className="fact-label">From their file</span>
                  {sample.map((sIt, i) => (
                    <div key={i} className="compare-row">
                      <span className={sIt.hit ? 'ok-tick' : 'no-tick'}>
                        {sIt.hit ? '✓' : '✕'}
                      </span>
                      <span className="cell-sub">{sIt.label}</span>
                    </div>
                  ))}
                  {sample.length === 0 && <span className="cell-sub">Nothing readable yet</span>}
                </div>
                <div>
                  <span className="fact-label">On this order</span>
                  {ourSample.map((o, i) => (
                    <div key={i} className="compare-row">
                      <span className="cell-sub">{o.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {matched.length === 0 && (
                <div className="placeholder-note">
                  Nothing matched. Compare the two columns above ~ if they look different, change
                  what you are comparing to, or untick size if their column already includes it.
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && <div className="auth-msg err">{error}</div>}
    </Modal>
  )
}
