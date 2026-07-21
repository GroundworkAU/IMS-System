import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSend() {
    if (!email.trim()) {
      setStatus({ type: 'err', text: 'Enter your email address.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await requestPasswordReset(email.trim())
    setBusy(false)
    if (error) setStatus({ type: 'err', text: error.message })
    else setStatus({ type: 'ok', text: 'If that email has an account, a reset link is on its way.' })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-sub">We'll email you a link to set a new one.</p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSend}
          disabled={busy}
        >
          {busy ? 'Sending...' : 'Send reset link'}
        </button>

        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}

        <div className="auth-foot">
          <Link className="linklike" to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}
