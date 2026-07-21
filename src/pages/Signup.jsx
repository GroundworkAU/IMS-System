import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Signup() {
  const { session, signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim()) {
      setStatus({ type: 'err', text: 'Please fill in your name and email.' })
      return
    }
    if (password.length < 8) {
      setStatus({ type: 'err', text: 'Use a password of at least 8 characters.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { data, error } = await signUp(
      email.trim(), password, fullName.trim(), jobTitle.trim()
    )
    setBusy(false)
    if (error) {
      setStatus({ type: 'err', text: error.message })
    } else if (!data.session) {
      setStatus({
        type: 'ok',
        text: 'Account created. Check your inbox to confirm your email, then sign in.',
      })
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">
          Set up an account, then create your business or join one you've been invited to.
        </p>

        <div className="field">
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="jobtitle">Job title or position</label>
          <input
            id="jobtitle"
            className="input"
            autoComplete="organization-title"
            placeholder="e.g. Ecommerce Manager"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>

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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSignUp}
          disabled={busy}
        >
          {busy ? 'Creating account...' : 'Create account'}
        </button>

        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}

        <div className="auth-foot">
          <span>
            Already have an account? <Link className="linklike" to="/login">Sign in</Link>
          </span>
        </div>
      </div>
    </div>
  )
}
