import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Onboarding from '../pages/Onboarding'

export default function ProtectedRoute({ children }) {
  const { session, profile, loading, profileLoading } = useAuth()

  if (loading || (session && profileLoading && !profile)) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#6a7570' }}>
        Loading...
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Signed in but not yet part of a business: send them through setup.
  if (profile && !profile.org_id) return <Onboarding />

  return children
}
