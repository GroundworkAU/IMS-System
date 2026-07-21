import { useState } from 'react'
import Modal from './Modal'
import { fieldsFor, variantsFor, callIntegrations } from '../lib/integrations'
import { platformInfo } from '../lib/platforms'

function StatusPill({ status }) {
  const map = {
    connected: { label: 'Connected', cls: 'ok' },
    error: { label: 'Needs attention', cls: 'warn' },
    not_connected: { label: 'Not connected', cls: 'neutral' },
  }
  const s = map[status] ?? map.not_connected
  return <span className={`status-pill ${s.cls}`}>{s.label}</span>
}

export default function ConnectionCard({ provider, setting, onChanged }) {
  const info = platformInfo(provider)
  const variants = variantsFor(provider)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  const connected = setting?.status === 'connected'

  async function run(payload, okText) {
    setBusy(true)
    setStatus(null)
    const result = await callIntegrations(payload)
    setBusy(false)
    if (result.ok) {
      setStatus({ type: 'ok', text: okText })
      setOpen(false)
      onChanged()
    } else {
      setStatus({ type: 'err', text: result.error || 'That did not work.' })
      onChanged()
    }
    return result
  }

  return (
    <div className="connection">
      <div className="connection-head">
        <div>
          <div className="connection-name">{info.label}</div>
          <div className="connection-meta">
            {setting?.variant &&
              variants?.find((v) => v.value === setting.variant)?.label}
            {setting?.last_tested_at && (
              <> · Last checked {new Date(setting.last_tested_at).toLocaleDateString('en-AU')}</>
            )}
          </div>
        </div>
        <StatusPill status={setting?.status} />
      </div>

      {setting?.status === 'error' && setting?.last_error && (
        <div className="connection-error">{setting.last_error}</div>
      )}

      <div className="connection-actions">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          {connected ? 'Update details' : 'Connect'}
        </button>
        {setting && setting.status !== 'not_connected' && (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run({ action: 'test', provider }, 'Connection is working.')}
            >
              {busy ? 'Checking...' : 'Test connection'}
            </button>
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Disconnect ${info.label}? The saved keys are deleted.`)) {
                  run({ action: 'disconnect', provider }, 'Disconnected.')
                }
              }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
      )}

      {open && (
        <CredentialsModal
          provider={provider}
          label={info.label}
          variants={variants}
          initialVariant={setting?.variant}
          busy={busy}
          onClose={() => setOpen(false)}
          onSave={(variant, credentials) =>
            run({ action: 'save', provider, variant, credentials }, `${info.label} connected.`)
          }
        />
      )}
    </div>
  )
}

function CredentialsModal({ provider, label, variants, initialVariant, busy, onClose, onSave }) {
  const [variant, setVariant] = useState(initialVariant || variants?.[0]?.value)
  const [values, setValues] = useState({})
  const fields = fieldsFor(provider, variant)

  return (
    <Modal
      title={`Connect ${label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onSave(variant, values)}
          >
            {busy ? 'Connecting...' : 'Save and test'}
          </button>
        </>
      }
    >
      {variants && (
        <div className="field">
          <label htmlFor="variant">Which version?</label>
          <select
            id="variant"
            className="input"
            value={variant}
            onChange={(e) => { setVariant(e.target.value); setValues({}) }}
          >
            {variants.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
      )}

      {fields.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`f-${f.key}`}>{f.label}</label>
          <input
            id={`f-${f.key}`}
            className="input"
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            value={values[f.key] ?? ''}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
          {f.hint && <p className="field-hint">{f.hint}</p>}
        </div>
      ))}

      <p className="field-hint" style={{ marginTop: 16 }}>
        These keys are sent straight to our server and stored where the app in your browser
        cannot read them. We'll check they work before saving. You will not be able to view them
        again ~ if you need to change one, enter it fresh.
      </p>
    </Modal>
  )
}
