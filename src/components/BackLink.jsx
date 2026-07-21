import { useNavigate } from 'react-router-dom'

// Small back link for pages you reach from a list, so there is always a way
// out that does not rely on the browser's own button.
export default function BackLink({ to, label }) {
  const navigate = useNavigate()
  return (
    <button className="back-link" onClick={() => navigate(to)}>
      <span aria-hidden="true">‹</span> {label}
    </button>
  )
}
