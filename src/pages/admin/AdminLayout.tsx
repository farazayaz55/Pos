import { useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompany } from '@/hooks/useCompany'
import { cn } from '@/utils/cn'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const ICON = {
  pos: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4 10h16M9 14h6" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  cat: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  mods: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 6h16M4 12h10M4 18h16" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 4h12l-1 16H7L6 4Z" />
      <path d="M9 9h6" />
    </svg>
  ),
  display: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8" />
    </svg>
  ),
}

const AdminLayout = () => {
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const activeCompanyId = useCompanyContextStore((s) => s.activeCompanyId)
  const isImpersonating = useCompanyContextStore((s) => s.isImpersonating)
  const clearContext = useCompanyContextStore((s) => s.clear)
  const { company } = useCompany(activeCompanyId || undefined)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!user) return null

  if (!activeCompanyId) {
    if (user.role === 'admin' && user.companyId) {
      return <Navigate to="/admin/pos" replace />
    }
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <div className="card max-w-md p-8 text-center">
          <h2 className="text-lg font-semibold">No company selected</h2>
          <p className="mt-2 text-sm text-slate-500">
            Open a company from the Super Admin dashboard to manage it.
          </p>
          <button
            onClick={() => navigate('/super-admin/companies')}
            className="btn-primary mt-4"
          >
            Go to companies
          </button>
        </div>
      </div>
    )
  }

  const items: NavItem[] = [
    { to: '/admin/pos', label: 'POS', icon: ICON.pos },
    { to: '/admin/menu/categories', label: 'Categories', icon: ICON.cat },
    { to: '/admin/menu/items', label: 'Items', icon: ICON.menu },
    { to: '/admin/menu/modifiers', label: 'Modifiers', icon: ICON.mods },
    { to: '/admin/orders', label: 'Orders', icon: ICON.orders },
  ]

  const handleSignOut = async () => {
    await signOut()
    clearContext()
    navigate('/login', { replace: true })
  }

  const exitImpersonation = () => {
    clearContext()
    navigate('/super-admin/companies')
  }

  const openDisplay = () => {
    window.open(`/display/${activeCompanyId}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-brand-600 text-white">
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-bold">
                {(company?.name || 'P').slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {company?.name || 'Company'}
            </p>
            <p className="truncate text-xs text-slate-500">{company?.location || ''}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              {it.icon}
              {it.label}
            </NavLink>
          ))}
          <button
            onClick={openDisplay}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {ICON.display}
            Display Page
          </button>
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-1">
            <p className="truncate text-xs font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <button onClick={handleSignOut} className="btn-secondary w-full text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isImpersonating && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <span>
              Super Admin view: managing <b>{company?.name || 'this company'}</b>
            </span>
            <button onClick={exitImpersonation} className="font-semibold underline">
              Exit
            </button>
          </div>
        )}

        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          <button
            className="btn-ghost p-2"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <p className="text-sm font-semibold">{company?.name || 'Company'}</p>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}

export default AdminLayout
