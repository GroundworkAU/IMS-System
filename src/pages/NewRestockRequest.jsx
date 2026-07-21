import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BackLink from '../components/BackLink'
import CatalogueBrowser from '../components/CatalogueBrowser'
import RequestDrawer from '../components/RequestDrawer'
import { nextReference } from '../lib/references'

export default function NewRestockRequest() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const draftId = params.get('draft')

  const [locations, setLocations] = useState([])
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState({})
  const [manual, setManual] = useState([])
  const [busy, setBusy] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState(null)
  const [loadingDraft, setLoadingDraft] = useState(!!draftId)
  const [existingRef, setExistingRef] = useState(null)

  useEffect(() => {
    supabase
      .from('locations')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setLocations(data ?? []))
  }, [])

  // Pick up where a draft left off.
  useEffect(() => {
    if (!draftId) return
    async function loadDraft() {
      const { data } = await supabase
        .from('restock_requests')
        .select('id,reference,destination_location_id,note,restock_request_lines(id,variant_id,name,sku,qty_requested)')
        .eq('id', draftId)
        .maybeSingle()

      if (data) {
        setExistingRef(data.reference)
        setDestination(data.destination_location_id ?? '')
        setNote(data.note ?? '')

        const withVariants = (data.restock_request_lines ?? []).filter((l) => l.variant_id)
        const byHand = (data.restock_request_lines ?? []).filter((l) => !l.variant_id)

        if (withVariants.length) {
          const { data: vs } = await supabase
            .from('variants')
            .select('id, sku, option_name, products(id, name, image_url)')
            .in('id', withVariants.map((l) => l.variant_id))

          const next = {}
          for (const l of withVariants) {
            const v = (vs ?? []).find((x) => x.id === l.variant_id)
            next[l.variant_id] = {
              product_id: v?.products?.id ?? null,
              product_name: v?.products?.name ?? l.name,
              option_name: v?.option_name ?? null,
              image_url: v?.products?.image_url ?? null,
              name: l.name,
              sku: l.sku ?? v?.sku ?? '',
              qty: l.qty_requested,
            }
          }
          setPicked(next)
        }

        setManual(byHand.map((l) => ({ name: l.name, sku: l.sku ?? '', qty: l.qty_requested })))
      }
      setLoadingDraft(false)
    }
    loadDraft()
  }, [draftId])

  const pickedList = Object.entries(picked)
  const lineCount = pickedList.length + manual.filter((m) => m.name.trim()).length
  const itemCount =
    pickedList.reduce((n, [, v]) => n + Number(v.qty || 0), 0) +
    manual.reduce((n, m) => n + (Number(m.qty) || 0), 0)

  const destinationName = locations.find((l) => l.id === destination)?.name

  function setQty(variantId, qty) {
    const n = Number(qty)
    if (!n || n <= 0) return removePicked(variantId)
    setPicked({ ...picked, [variantId]: { ...picked[variantId], qty: n } })
  }

  function removePicked(variantId) {
    const next = { ...picked }
    delete next[variantId]
    setPicked(next)
  }

  const buildLines = useCallback(() => {
    const fromCatalogue = pickedList.map(([variantId, v]) => ({
      variant_id: variantId, name: v.name, sku: v.sku, qty: v.qty,
    }))
    const manualLines = manual
      .filter((l) => l.name.trim() && Number(l.qty) > 0)
      .map((l) => ({ variant_id: null, name: l.name, sku: l.sku, qty: l.qty }))
    return [...fromCatalogue, ...manualLines]
  }, [pickedList, manual])

  async function persist(status) {
    const all = buildLines()
    if (status === 'open') {
      if (!destination) { setError('Choose where the stock is needed.'); return null }
      if (all.length === 0) { setError('Add at least one item with a quantity.'); return null }
    }

    setError(null)
    const payload = {
      org_id: profile.org_id,
      destination_location_id: destination || null,
      note: note.trim() || null,
      status,
      requested_by: profile.id,
    }

    let requestId = draftId
    if (draftId) {
      const { error: uErr } = await supabase
        .from('restock_requests')
        .update(payload)
        .eq('id', draftId)
      if (uErr) { setError(uErr.message); return null }
      await supabase.from('restock_request_lines').delete().eq('request_id', draftId)
    } else {
      const { data, error: iErr } = await supabase
        .from('restock_requests')
        .insert({ ...payload, reference: await nextReference('restock_request', 'RS-') })
        .select('id')
        .single()
      if (iErr) { setError(iErr.message); return null }
      requestId = data.id
    }

    if (all.length) {
      const { error: lErr } = await supabase.from('restock_request_lines').insert(
        all.map((l) => ({
          org_id: profile.org_id,
          request_id: requestId,
          variant_id: l.variant_id,
          name: l.name.trim(),
          sku: (l.sku || '').trim() || null,
          qty_requested: Number(l.qty),
        }))
      )
      if (lErr) { setError(lErr.message); return null }
    }

    return requestId
  }

  async function saveDraft() {
    setSavingDraft(true)
    const id = await persist('draft')
    setSavingDraft(false)
    if (id) navigate('/restocks')
  }

  async function raise() {
    setBusy(true)
    const id = await persist('open')
    setBusy(false)
    if (id) navigate('/restocks')
  }

  if (loadingDraft) {
    return <p className="page-desc">Loading draft...</p>
  }

  return (
    <div>
      <BackLink to="/restocks" label="Back to restocks" />

      <div className="page-head">
        <div className="eyebrow">Inventory</div>
        <h2 className="page-title">
          {draftId ? `Continue ${existingRef ?? 'draft'}` : 'New restock request'}
        </h2>
        <p className="page-desc">
          Pick where the stock is needed, then work through the catalogue setting quantities.
          Raising a request moves no stock on its own.
        </p>
      </div>

      {error && <div className="auth-msg err" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card request-bar">
        <div className="request-bar-fields">
          <div className="field" style={{ marginBottom: 0 }}>
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
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="note">Note (optional)</label>
            <input
              id="note"
              className="input"
              placeholder="e.g. needed before the home game"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="request-bar-actions">
            <button className="btn" onClick={() => navigate('/restocks')}>Cancel</button>
            <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
              Review request
              {lineCount > 0 && <span className="cart-badge">{lineCount}</span>}
            </button>
          </div>
        </div>

        <div className="request-bar-foot">
          <span className="field-hint" style={{ margin: 0 }}>
            {destination
              ? 'Stock at this location is highlighted as you browse.'
              : 'Choose a location to see what is already there as you browse.'}
          </span>
          {lineCount > 0 && (
            <span className="request-count">
              {lineCount} line{lineCount === 1 ? '' : 's'} · {itemCount} item
              {itemCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

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

      {/* Floating button so the request is always one tap away */}
      {lineCount > 0 && !drawerOpen && (
        <button className="cart-fab" onClick={() => setDrawerOpen(true)}>
          Review request
          <span className="cart-badge">{lineCount}</span>
        </button>
      )}

      <RequestDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        picked={picked}
        manual={manual}
        onQty={setQty}
        onRemove={removePicked}
        onRemoveManual={(i) => setManual(manual.filter((_, idx) => idx !== i))}
        onSaveDraft={saveDraft}
        onRaise={raise}
        busy={busy}
        savingDraft={savingDraft}
        destinationName={destinationName}
      />
    </div>
  )
}
