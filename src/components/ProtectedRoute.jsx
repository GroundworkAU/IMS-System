import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#6a7570' }}>Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}
