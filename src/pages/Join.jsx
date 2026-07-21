import { useEffect, useState } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Join() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { session, profile, refresh, signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  // Once signed in with a token present, join automatically.
  useEffect(() => {
    async function join() {
      if (!session || !token || profile?.org_id) return
      setBusy(true)
      const { error } = await supabase.rpc('accept_invitation', { invite_token: token })
      setBusy(false)
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
            This link is missing its invitation code. Ask whoever invited you to resend it.
          </p>
        </div>
      </div>
    )
  }

  async function handleSend() {
    if (!email.trim()) {
      setStatus({ type: 'err', text: 'Enter the email your invitation was sent to.' })
      return
    }
    setBusy(true)
    const { error } = await signInWithEmail(email.trim())
    setBusy(false)
    if (error) setStatus({ type: 'err', text: error.message })
    else setStatus({ type: 'ok', text: 'Check your inbox - we sent you a sign-in link.' })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name" style={{ color: '#17201f' }}>IMS System</div>
            <div className="brand-sub" style={{ color: '#6a7570' }}>You've been invited</div>
          </div>
        </div>

        {session ? (
          <>
            <h1 className="auth-title">{busy ? 'Joining...' : 'Almost there'}</h1>
            <p className="auth-sub">Connecting your account to the business.</p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Accept your invitation</h1>
            <p className="auth-sub">Sign in with the email your invitation was sent to.</p>

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
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
              {busy ? 'Sending...' : 'Email me a sign-in link'}
            </button>
          </>
        )}

        {status && <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>}
      </div>
    </div>
  )
}
