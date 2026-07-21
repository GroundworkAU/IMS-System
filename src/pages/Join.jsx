import { useEffect, useState } from 'react'
import { useSearchParams, Navigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Join() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { session, profile, refresh, signUp, signIn } = useAuth()

  const [mode, setMode] = useState('create') // 'create' | 'signin'
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  // Once there's a session and a token, join the organisation.
  useEffect(() => {
    async function join() {
      if (!session || !token || profile?.org_id) return
      const { error } = await supabase.rpc('accept_invitation', { invite_token: token })
      if (error) setStatus({ type: 'err', text: error.message })
      else await refresh()
    }
    join()
  }, [session, token, profile, refresh])

  if (profile?.org_id) return <Navigate to="/" replace />

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">Invitation link incomplete</h1>
          <p className="auth-sub">
            This link is missing its invitation code. Ask whoever invited you to send it again.
          </p>
          <div className="auth-foot">
            <Link className="linklike" to="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setStatus({ type: 'err', text: 'Enter your email and password.' })
      return
    }
    setBusy(true)
    setStatus(null)

    if (mode === 'create') {
      if (!fullName.trim()) {
        setBusy(false)
        setStatus({ type: 'err', text: 'Enter your full name.' })
        return
      }
      if (password.length < 8) {
        setBusy(false)
        setStatus({ type: 'err', text: 'Use a password of at least 8 characters.' })
        return
      }
      const { data, error } = await signUp(email.trim(), password, fullName.trim())
      setBusy(false)
      if (error) setStatus({ type: 'err', text: error.message })
      else if (!data.session) {
        setStatus({
          type: 'ok',
          text: 'Account created. Confirm your email, then open this invitation link again.',
        })
      }
    } else {
      const { error } = await signIn(email.trim(), password)
      setBusy(false)
      if (error) setStatus({ type: 'err', text: error.message })
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: 'var(--dark-brown)' }}>IMS System</div>
            <div className="brand-sub" style={{ color: 'var(--muted)' }}>You've been invited</div>
          </div>
        </div>

        {session ? (
          <>
            <h1 className="auth-title">Joining...</h1>
            <p className="auth-sub">Connecting your account to the business.</p>
          </>
        ) : (
          <>
            <h1 className="auth-title">
              {mode === 'create' ? 'Accept your invitation' : 'Sign in to accept'}
            </h1>
            <p className="auth-sub">
              Use the email address your invitation was sent to.
            </p>

            {mode === 'create' && (
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
            )}

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
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? 'Working...' : mode === 'create' ? 'Create account and join' : 'Sign in and join'}
            </button>

            <div className="auth-foot">
              <button
                className="linklike"
                onClick={() => { setMode(mode === 'create' ? 'signin' : 'create'); setStatus(null) }}
              >
                {mode === 'create'
                  ? 'I already have an account'
                  : 'I need to create an account'}
              </button>
            </div>
          </>
        )}

        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}
      </div>
    </div>
  )
}
