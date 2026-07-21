import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', end: true }] },
  {
    group: 'Purchasing',
    items: [
      { to: '/purchase-orders', label: 'Purchase Orders' },
      { to: '/suppliers', label: 'Suppliers & Brands' },
      { to: '/products', label: 'Products' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { to: '/locations', label: 'Locations' },
      { to: '/inbound', label: 'Inbound Shipments' },
      { to: '/goods-inwards', label: 'Goods Inwards' },
      { to: '/goods-outwards', label: 'Goods Outwards' },
    ],
  },
  {
    group: 'Service',
    items: [
      { to: '/customer-service', label: 'Customer Service' },
      { to: '/returns', label: 'Returns' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/admin', label: 'Users' },
      { to: '/settings', label: 'Integrations' },
    ],
  },
]

function titleFor(pathname) {
  for (const g of NAV) {
    for (const i of g.items) {
      if (i.end ? pathname === i.to : pathname.startsWith(i.to)) return i.label
    }
  }
  return 'IMS'
}

export default function Layout() {
  const { user, profile, org, signOut } = useAuth()
  const { pathname } = useLocation()
  const email = user?.email ?? ''
  const initials = (profile?.full_name || email || '?').trim().slice(0, 1).toUpperCase()

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">IMS</div>
          <div>
            <div className="brand-name">IMS System</div>
            <div className="brand-sub">PAFC Inventory</div>
          </div>
        </div>

        <nav>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.end}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                >
                  <span className="nav-dot" />
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">Phase 1 · foundation</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{titleFor(pathname)}</h1>
          <div className="user-chip">
            <span>{profile?.full_name || email}</span>
            <span className="avatar">{initials}</span>
            <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
