import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ResetPassword() {
  const { updatePassword, session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleUpdate() {
    if (password.length < 8) {
      setStatus({ type: 'err', text: 'Use a password of at least 8 characters.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) {
      setStatus({ type: 'err', text: error.message })
    } else {
      setStatus({ type: 'ok', text: 'Password updated. Taking you in...' })
      setTimeout(() => navigate('/'), 1200)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">
          {session
            ? 'Choose a new password for your account.'
            : 'Open this page from the reset link in your email.'}
        </p>

        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleUpdate}
          disabled={busy || !session}
        >
          {busy ? 'Saving...' : 'Update password'}
        </button>

        {status && (
          <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')}>{status.text}</div>
        )}
      </div>
    </div>
  )
}
