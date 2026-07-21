import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import CatalogueBrowser from '../components/CatalogueBrowser'

const ref = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`

export default function NewRestockRequest() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [locations, setLocations] = useState([])
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState({})
  const [manual, setManual] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('locations')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLocations(data ?? []))
  }, [])

  const pickedList = Object.entries(picked)
  const totalItems =
    pickedList.reduce((n, [, v]) => n + Number(v.qty || 0), 0) +
    manual.reduce((n, m) => n + (Number(m.qty) || 0), 0)

  function removePicked(variantId) {
    const next = { ...picked }
    delete next[variantId]
    setPicked(next)
  }

  async function save() {
    if (!destination) return setError('Choose where the stock is needed.')

    const fromCatalogue = pickedList.map(([variantId, v]) => ({
      variant_id: variantId, name: v.name, sku: v.sku, qty: v.qty,
    }))
    const manualLines = manual.filter((l) => l.name.trim() && Number(l.qty) > 0)
    const all = [...fromCatalogue, ...manualLines]

    if (all.length === 0) return setError('Add at least one item with a quantity.')

    setBusy(true)
    setError(null)

    const { data: created, error: rErr } = await supabase
      .from('restock_requests')
      .insert({
        org_id: profile.org_id,
        reference: ref('REQ'),
        destination_location_id: destination,
        note: note.trim() || null,
        requested_by: profile.id,
      })
      .select('id')
      .single()

    if (rErr) { setBusy(false); return setError(rErr.message) }

    const { error: lErr } = await supabase.from('restock_request_lines').insert(
      all.map((l) => ({
        org_id: profile.org_id,
        request_id: created.id,
        variant_id: l.variant_id ?? null,
        name: l.name.trim(),
        sku: (l.sku || '').trim() || null,
        qty_requested: Number(l.qty),
      }))
    )

    setBusy(false)
    if (lErr) setError(lErr.message)
    else navigate('/restocks')
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">New restock request</h2>
        <p className="page-desc">
          Pick where the stock is needed, then work through the catalogue setting quantities.
          Raising a request moves no stock on its own.
        </p>
      </div>

      {error && <div className="auth-msg err" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ---- request details, full width across the top ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title">Request details</h3>

        <div className="form-row">
          <div className="field" style={{ flex: '1 1 240px', marginBottom: 0 }}>
            <label htmlFor="dest">Stock needed at</label>
            <select
              id="dest"
              className="input"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Choose a location...</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="field-hint">
              Setting this shows what is already there as you browse.
            </p>
          </div>

          <div className="field" style={{ flex: '2 1 280px', marginBottom: 0 }}>
            <label htmlFor="note">Note (optional)</label>
            <input
              id="note"
              className="input"
              placeholder="e.g. needed before the home game"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="filter-actions" style={{ alignSelf: 'flex-end' }}>
            <button className="btn" onClick={() => navigate('/restocks')}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Raising...' : 'Raise request'}
            </button>
          </div>
        </div>

        {(pickedList.length > 0 || manual.length > 0) && (
          <details className="selected-summary" open>
            <summary>
              Selected: {pickedList.length + manual.length} line
              {pickedList.length + manual.length === 1 ? '' : 's'}, {totalItems} item
              {totalItems === 1 ? '' : 's'}
            </summary>
            <div className="selected-chips">
              {pickedList.map(([variantId, v]) => (
                <span key={variantId} className="selected-chip">
                  <strong>{v.qty}</strong> {v.name}
                  <button className="chip-x" onClick={() => removePicked(variantId)}>x</button>
                </span>
              ))}
              {manual.filter((m) => m.name.trim()).map((m, i) => (
                <span key={`m-${i}`} className="selected-chip">
                  <strong>{m.qty}</strong> {m.name}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ---- catalogue, full width ---- */}
      <div className="card">
        <h3 className="section-title">Choose what you need</h3>
        <CatalogueBrowser
          selected={picked}
          onChange={setPicked}
          destinationId={destination || null}
          fullHeight
        />

        <h4 className="sub-label">Not in the catalogue?</h4>
        {manual.map((m, i) => (
          <div className="form-row" key={i} style={{ marginBottom: 10 }}>
            <div className="field" style={{ flex: '2 1 180px', marginBottom: 0 }}>
              <label>Product</label>
              <input
                className="input"
                value={m.name}
                onChange={(e) =>
                  setManual(manual.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                }
              />
            </div>
            <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}>
              <label>SKU</label>
              <input
                className="input"
                value={m.sku}
                onChange={(e) =>
                  setManual(manual.map((x, idx) => (idx === i ? { ...x, sku: e.target.value } : x)))
                }
              />
            </div>
            <div className="field" style={{ flex: '0 1 80px', marginBottom: 0 }}>
              <label>Qty</label>
              <input
                className="input"
                type="number"
                min="1"
                value={m.qty}
                onChange={(e) =>
                  setManual(manual.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))
                }
              />
            </div>
            <button
              className="btn btn-quiet"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => setManual(manual.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="btn"
          onClick={() => setManual([...manual, { name: '', sku: '', qty: 1 }])}
        >
          Add an item by hand
        </button>
      </div>

    </div>
  )
}
