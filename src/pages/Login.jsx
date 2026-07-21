import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'That email and password combination did not work. Try again, or reset your password.'
          : error.message
      )
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: 'var(--dark-brown)' }}>IMS System</div>
            <div className="brand-sub" style={{ color: 'var(--muted)' }}>Inventory management</div>
          </div>
        </div>

        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">Welcome back. Enter your details to get to work.</p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSignIn}
          disabled={busy}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>

        {error && <div className="auth-msg err">{error}</div>}

        <div className="auth-foot">
          <Link className="linklike" to="/forgot-password">Forgot your password?</Link>
          <span>
            New here? <Link className="linklike" to="/signup">Create an account</Link>
          </span>
        </div>
      </div>
    </div>
  )
}
