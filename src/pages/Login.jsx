import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState(null) // {type, text}
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSend() {
    if (!email.trim()) {
      setStatus({ type: 'err', text: 'Enter your work email to continue.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await signInWithEmail(email.trim())
    setBusy(false)
    if (error) setStatus({ type: 'err', text: error.message })
    else setStatus({ type: 'ok', text: 'Check your inbox — we sent you a sign-in link.' })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: '#17201f' }}>IMS System</div>
            <div className="brand-sub" style={{ color: '#6a7570' }}>PAFC Inventory</div>
          </div>
        </div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">We'll email you a secure link — no password to remember.</p>

        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@pafc.com.au"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSend} disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>

        {status && <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>}
      </div>
    </div>
  )
}
