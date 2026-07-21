import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ErrorBoundary from './ErrorBoundary'

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
      { to: '/restocks', label: 'Restocks' },
      { to: '/inbound', label: 'Inbound Shipments' },
      { to: '/goods-inwards', label: 'Goods Inwards' },
      { to: '/goods-outwards', label: 'Goods Outwards' },
    ],
  },
  {
    group: 'Service',
    items: [
      { to: '/customer-service', label: 'Customer Service' },
      { to: '/orders', label: 'Orders' },
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

function SidebarInner({ org, onNavigate, onSignOut }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">IMS</div>
        <div>
          <div className="brand-name">IMS System</div>
          <div className="brand-sub">Inventory management</div>
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
                onClick={onNavigate}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
              >
                <span className="nav-dot" />
                {i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div>{org?.name || 'Setting up'}</div>
        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>build {__BUILD__}</div>
        {onSignOut && (
          <button className="linklike" style={{ color: '#b09a8c', marginTop: 8 }} onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </aside>
  )
}

export default function Layout() {
  const { user, profile, org, signOut } = useAuth()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const email = user?.email ?? ''
  const displayName = profile?.full_name || email
  const initials = (profile?.full_name || email || '?').trim().slice(0, 1).toUpperCase()

  return (
    <div className="app">
      <SidebarInner org={org} />

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="drawer">
            <SidebarInner
              org={org}
              onNavigate={() => setDrawerOpen(false)}
              onSignOut={signOut}
            />
          </div>
        </>
      )}

      <div className="main">
        <div className="mobile-bar">
          <button
            className="hamburger"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <span /><span /><span />
          </button>
          <div className="mobile-word">IMS System</div>
        </div>

        <header className="topbar">
          <h1>{titleFor(pathname)}</h1>
          <div className="user-chip">
            <span className="user-meta">
              <span className="user-name">{displayName}</span>
              {profile?.job_title && <span className="user-role">{profile.job_title}</span>}
            </span>
            <span className="avatar">{initials}</span>
            <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <div className="checker-strip" />

        <main className="content">
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
