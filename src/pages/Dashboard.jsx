import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { profile, user } = useAuth()
  const name = (profile?.full_name || user?.email || '').split('@')[0]

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Overview</div>
        <h2 className="page-title">{name ? `Welcome, ${name}` : 'Dashboard'}</h2>
        <p className="page-desc">
          Incoming brand orders, allocation across locations, goods inwards, and customer
          service — one place. The live metrics below switch on as each module comes online.
        </p>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <div className="stat-label">Open purchase orders</div>
          <div className="stat-value">—</div>
          <div className="stat-note">Awaiting confirmation, upload or landing</div>
        </div>
        <div className="card">
          <div className="stat-label">Shipments in transit</div>
          <div className="stat-value">—</div>
          <div className="stat-note">Tracked inbound + inter-location transfers</div>
        </div>
        <div className="card">
          <div className="stat-label">Goods inwards to check</div>
          <div className="stat-value">—</div>
          <div className="stat-note">Submitted, awaiting warehouse check-off</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Getting set up</div>
        <p className="page-desc" style={{ margin: 0 }}>
          This is the Phase 1 foundation: sign-in, the app shell, and the data model. Next up is
          supplier &amp; brand management, then order intake with file storage and location
          allocation.
        </p>
      </div>
    </div>
  )
}
