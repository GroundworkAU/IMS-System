import { createPortal } from 'react-dom'

// A cart style drawer for building a restock request. Groups by product with
// its sizes underneath, which reads far better than a wall of chips once there
// are more than a handful of lines.
export default function RequestDrawer({
  open, onClose, picked, manual, onQty, onRemove, onRemoveManual,
  onSaveDraft, onRaise, busy, savingDraft, destinationName,
}) {
  const entries = Object.entries(picked)

  // Group variants under their product, keeping the order they were added.
  const groups = []
  const byProduct = {}
  for (const [variantId, v] of entries) {
    const key = v.product_id || v.product_name
    if (!byProduct[key]) {
      byProduct[key] = { key, name: v.product_name || v.name, image: v.image_url, lines: [] }
      groups.push(byProduct[key])
    }
    byProduct[key].lines.push({ variantId, ...v })
  }

  const lineCount = entries.length + manual.filter((m) => m.name.trim()).length
  const itemCount =
    entries.reduce((n, [, v]) => n + (Number(v.qty) || 0), 0) +
    manual.reduce((n, m) => n + (Number(m.qty) || 0), 0)

  if (!open) return null

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="cart-drawer" role="dialog" aria-label="Restock request">
        <header className="cart-head">
          <div>
            <div className="cart-title">Your request</div>
            <div className="cell-sub">
              {destinationName ? `for ${destinationName}` : 'no location chosen yet'}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">x</button>
        </header>

        <div className="cart-body">
          {lineCount === 0 ? (
            <p className="field-hint">
              Nothing added yet. Set quantities against the sizes you need and they will appear
              here.
            </p>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.key} className="cart-group">
                  <div className="cart-group-head">
                    {g.image
                      ? <img className="thumb" src={g.image} alt="" loading="lazy" />
                      : <span className="thumb thumb-blank" />}
                    <span className="cell-strong">{g.name}</span>
                  </div>

                  {g.lines.map((l) => (
                    <div key={l.variantId} className="cart-line">
                      <span className="cart-line-main">
                        <span className="cart-option">{l.option_name || 'Single'}</span>
                        <span className="cell-sub">{l.sku || 'No SKU'}</span>
                      </span>

                      <span className="qty-stepper">
                        <button
                          onClick={() => onQty(l.variantId, Math.max(1, Number(l.qty) - 1))}
                          aria-label="One fewer"
                        >
                          -
                        </button>
                        <input
                          className="input mini"
                          type="number"
                          min="1"
                          value={l.qty}
                          onChange={(e) => onQty(l.variantId, e.target.value)}
                        />
                        <button
                          onClick={() => onQty(l.variantId, Number(l.qty) + 1)}
                          aria-label="One more"
                        >
                          +
                        </button>
                      </span>

                      <button
                        className="chip-x"
                        onClick={() => onRemove(l.variantId)}
                        aria-label="Remove"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ))}

              {manual.filter((m) => m.name.trim()).length > 0 && (
                <div className="cart-group">
                  <div className="cart-group-head">
                    <span className="cell-strong">Added by hand</span>
                  </div>
                  {manual.map((m, i) =>
                    m.name.trim() ? (
                      <div key={`m-${i}`} className="cart-line">
                        <span className="cart-line-main">
                          <span className="cart-option">{m.name}</span>
                          <span className="cell-sub">{m.sku || 'No SKU'}</span>
                        </span>
                        <span className="cart-qty-plain">{m.qty}</span>
                        <button
                          className="chip-x"
                          onClick={() => onRemoveManual(i)}
                          aria-label="Remove"
                        >
                          x
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="cart-foot">
          <div className="cart-totals">
            <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
            <strong>{itemCount} item{itemCount === 1 ? '' : 's'}</strong>
          </div>
          <div className="cart-actions">
            {onSaveDraft && (
              <button className="btn" onClick={onSaveDraft} disabled={savingDraft || busy}>
                {savingDraft ? 'Saving...' : 'Save draft'}
              </button>
            )}
            <button className="btn btn-primary" onClick={onRaise} disabled={busy || savingDraft}>
              {busy ? 'Saving...' : onSaveDraft ? 'Raise request' : 'Save changes'}
            </button>
          </div>
        </footer>
      </aside>
    </>,
    document.body
  )
}
