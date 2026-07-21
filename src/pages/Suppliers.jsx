import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { syncSuppliers } from '../lib/integrations'

const EMPTY_SUPPLIER = {
  name: '', contact_name: '', email: '', phone: '',
  address: '', payment_terms: '', currency: 'AUD', notes: '', is_active: true,
}

export default function Suppliers() {
  const { profile, org } = useAuth()
  const [importing, setImporting] = useState(false)
  const canImport = (org?.platforms ?? []).includes('lightspeed')
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [supplierModal, setSupplierModal] = useState(null) // {mode, values, id}
  const [brandModal, setBrandModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, b] = await Promise.all([
      supabase.from('suppliers')
        .select('id, name, contact_name, email, phone, address, payment_terms, currency, notes, is_active, external_source')
        .order('name'),
      supabase.from('brands')
        .select('id, name, is_active, supplier_id, external_source, suppliers(name)')
        .order('name'),
    ])
    if (s.error) setStatus({ type: 'err', text: s.error.message })
    setSuppliers(s.data ?? [])
    setBrands(b.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const brandCount = (id) => brands.filter((b) => b.supplier_id === id).length

  async function handleImport() {
    setImporting(true)
    setStatus(null)
    const res = await syncSuppliers('lightspeed')
    setImporting(false)
    if (res.error) {
      setStatus({ type: 'err', text: `Import problem: ${res.error}` })
    } else {
      setStatus({
        type: 'ok',
        text: `Imported ${res.suppliers} suppliers and ${res.brands} brands. ` +
              'Brands come across without a supplier ~ edit one to link it up.',
      })
    }
    load()
  }

  async function saveSupplier(values, id) {
    if (!values.name.trim()) {
      setStatus({ type: 'err', text: 'Give the supplier a name.' })
      return
    }
    setBusy(true)
    const payload = {
      name: values.name.trim(),
      contact_name: values.contact_name.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      address: values.address.trim() || null,
      payment_terms: values.payment_terms.trim() || null,
      currency: values.currency.trim() || 'AUD',
      notes: values.notes.trim() || null,
      is_active: values.is_active,
    }
    const { error } = id
      ? await supabase.from('suppliers').update(payload).eq('id', id)
      : await supabase.from('suppliers').insert({ ...payload, org_id: profile.org_id })
    setBusy(false)
    if (error) {
      setStatus({
        type: 'err',
        text: error.code === '23505'
          ? 'You already have a supplier with that name.'
          : error.message,
      })
    } else {
      setSupplierModal(null)
      setStatus({ type: 'ok', text: id ? 'Supplier updated.' : 'Supplier added.' })
      load()
    }
  }

  async function saveBrand(values, id) {
    if (!values.name.trim()) {
      setStatus({ type: 'err', text: 'Give the brand a name.' })
      return
    }
    setBusy(true)
    const payload = {
      name: values.name.trim(),
      supplier_id: values.supplier_id || null,
      is_active: values.is_active,
    }
    const { error } = id
      ? await supabase.from('brands').update(payload).eq('id', id)
      : await supabase.from('brands').insert({ ...payload, org_id: profile.org_id })
    setBusy(false)
    if (error) {
      setStatus({
        type: 'err',
        text: error.code === '23505'
          ? 'You already have a brand with that name.'
          : error.message,
      })
    } else {
      setBrandModal(null)
      setStatus({ type: 'ok', text: id ? 'Brand updated.' : 'Brand added.' })
      load()
    }
  }

  async function removeSupplier(s) {
    if (brandCount(s.id) > 0) {
      setStatus({
        type: 'err',
        text: `${s.name} still has brands attached. Move or remove those first, or mark the supplier inactive instead.`,
      })
      return
    }
    if (!window.confirm(`Remove ${s.name}? This cannot be undone.`)) return
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id)
    if (error) {
      setStatus({
        type: 'err',
        text: 'That supplier is used elsewhere, so it cannot be removed. Mark it inactive instead.',
      })
    } else {
      setStatus({ type: 'ok', text: 'Supplier removed.' })
      load()
    }
  }

  async function removeBrand(b) {
    if (!window.confirm(`Remove ${b.name}? This cannot be undone.`)) return
    const { error } = await supabase.from('brands').delete().eq('id', b.id)
    if (error) {
      setStatus({
        type: 'err',
        text: 'That brand is used on existing orders, so it cannot be removed. Mark it inactive instead.',
      })
    } else {
      setStatus({ type: 'ok', text: 'Brand removed.' })
      load()
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Purchasing</div>
        <h2 className="page-title">Suppliers &amp; Brands</h2>
        <p className="page-desc">
          Your suppliers and the brands each one carries. Linking them here means that when you
          raise an order, choosing a brand fills in its supplier for you.
        </p>
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 16 }}>
          {status.text}
        </div>
      )}

      {/* ---------------- Suppliers ---------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Suppliers</h3>
          <div className="search-wrap">
            {canImport && (
              <button className="btn" onClick={handleImport} disabled={importing}>
                {importing ? 'Importing...' : 'Import from Lightspeed'}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => setSupplierModal({ values: { ...EMPTY_SUPPLIER }, id: null })}
            >
              Add supplier
            </button>
          </div>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : suppliers.length === 0 ? (
          <div className="empty-state">
            <p>No suppliers yet.</p>
            <p className="page-desc">
              Add the businesses you order stock from. You can include a contact name, email and
              phone number so the details sit alongside the orders.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th><th>Contact</th><th>Brands</th>
                  <th>Terms</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                    <td>
                      <div className="cell-strong">{s.name}</div>
                      {s.address && <div className="cell-sub">{s.address}</div>}
                    </td>
                    <td>
                      {s.contact_name || s.email || s.phone ? (
                        <>
                          {s.contact_name && <div>{s.contact_name}</div>}
                          {s.email && (
                            <div className="cell-sub">
                              <a href={`mailto:${s.email}`}>{s.email}</a>
                            </div>
                          )}
                          {s.phone && <div className="cell-sub">{s.phone}</div>}
                        </>
                      ) : (
                        <span className="cell-sub">Not added</span>
                      )}
                    </td>
                    <td>{brandCount(s.id) || '-'}</td>
                    <td>{s.payment_terms || '-'}</td>
                    <td>{s.is_active ? 'Active' : 'Inactive'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn"
                        onClick={() => setSupplierModal({ values: { ...EMPTY_SUPPLIER, ...s }, id: s.id })}
                      >
                        Edit
                      </button>{' '}
                      <button className="btn btn-quiet" onClick={() => removeSupplier(s)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- Brands ---------------- */}
      <div className="card">
        <div className="card-head">
          <h3 className="section-title" style={{ margin: 0 }}>Brands</h3>
          <button
            className="btn btn-primary"
            onClick={() =>
              setBrandModal({ values: { name: '', supplier_id: '', is_active: true }, id: null })
            }
          >
            Add brand
          </button>
        </div>

        {loading ? (
          <p className="page-desc">Loading...</p>
        ) : brands.length === 0 ? (
          <div className="empty-state">
            <p>No brands yet.</p>
            <p className="page-desc">
              A supplier can carry more than one brand ~ for example one supplier might provide
              two separate labels you order under.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Brand</th><th>Supplier</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} className={b.is_active ? '' : 'row-muted'}>
                    <td className="cell-strong">{b.name}</td>
                    <td>
                      {b.suppliers?.name || <span className="cell-sub">Not linked</span>}
                    </td>
                    <td>{b.is_active ? 'Active' : 'Inactive'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn"
                        onClick={() =>
                          setBrandModal({
                            values: {
                              name: b.name,
                              supplier_id: b.supplier_id,
                              is_active: b.is_active,
                            },
                            id: b.id,
                          })
                        }
                      >
                        Edit
                      </button>{' '}
                      <button className="btn btn-quiet" onClick={() => removeBrand(b)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {supplierModal && (
        <SupplierModal
          initial={supplierModal.values}
          id={supplierModal.id}
          busy={busy}
          onClose={() => setSupplierModal(null)}
          onSave={saveSupplier}
        />
      )}

      {brandModal && (
        <BrandModal
          initial={brandModal.values}
          id={brandModal.id}
          suppliers={suppliers}
          busy={busy}
          onClose={() => setBrandModal(null)}
          onSave={saveBrand}
        />
      )}
    </div>
  )
}

function SupplierModal({ initial, id, busy, onClose, onSave }) {
  const [v, setV] = useState(initial)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  return (
    <Modal
      title={id ? 'Edit supplier' : 'Add supplier'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(v, id)} disabled={busy}>
            {busy ? 'Saving...' : id ? 'Save changes' : 'Add supplier'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="s-name">Supplier name</label>
        <input id="s-name" className="input" value={v.name} onChange={set('name')} autoFocus />
        <p className="field-hint">The business you place orders with.</p>
      </div>

      <h4 className="sub-label">Contact details (optional)</h4>

      <div className="field">
        <label htmlFor="s-contact">Contact name</label>
        <input id="s-contact" className="input" value={v.contact_name} onChange={set('contact_name')} />
      </div>

      <div className="form-row">
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="s-email">Email</label>
          <input id="s-email" className="input" type="email" value={v.email} onChange={set('email')} />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="s-phone">Phone</label>
          <input id="s-phone" className="input" value={v.phone} onChange={set('phone')} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="s-address">Address</label>
        <input id="s-address" className="input" value={v.address} onChange={set('address')} />
      </div>

      <div className="form-row">
        <div className="field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="s-terms">Payment terms</label>
          <input
            id="s-terms"
            className="input"
            placeholder="e.g. 30 days"
            value={v.payment_terms}
            onChange={set('payment_terms')}
          />
        </div>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="s-currency">Currency</label>
          <input id="s-currency" className="input" value={v.currency} onChange={set('currency')} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="s-notes">Notes</label>
        <textarea id="s-notes" className="input" rows="3" value={v.notes} onChange={set('notes')} />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={v.is_active}
            onChange={(e) => setV({ ...v, is_active: e.target.checked })}
          />
          <span>Active. Untick to hide this supplier without losing its history.</span>
        </label>
      </div>
    </Modal>
  )
}

function BrandModal({ initial, id, suppliers, busy, onClose, onSave }) {
  const [v, setV] = useState(initial)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  return (
    <Modal
      title={id ? 'Edit brand' : 'Add brand'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(v, id)} disabled={busy}>
            {busy ? 'Saving...' : id ? 'Save changes' : 'Add brand'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="b-name">Brand name</label>
        <input id="b-name" className="input" value={v.name} onChange={set('name')} autoFocus />
      </div>

      <div className="field">
        <label htmlFor="b-supplier">Supplier</label>
        <select id="b-supplier" className="input" value={v.supplier_id} onChange={set('supplier_id')}>
          <option value="">No supplier yet</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <p className="field-hint">
          Orders for this brand will use this supplier automatically. Imported brands start
          without one ~ set it here.
        </p>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={v.is_active}
            onChange={(e) => setV({ ...v, is_active: e.target.checked })}
          />
          <span>Active. Untick to hide this brand from new orders.</span>
        </label>
      </div>
    </Modal>
  )
}
