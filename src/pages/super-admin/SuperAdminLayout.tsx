import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore, OFFLINE_SIGNOUT_MESSAGE } from '@/stores/authStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/utils/cn'

const SuperAdminLayout = () => {
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const { isOnline } = useOnlineStatus()

  const handleSignOut = async () => {
    if (!isOnline) {
      toast.error(OFFLINE_SIGNOUT_MESSAGE)
      return
    }
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign out failed')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M4 6h16v3H4zM4 11h16v3H4zM4 16h11v3H4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">POS Console</p>
              <p className="text-xs text-slate-500">Super Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-slate-900">{user?.name}</p>
              <p className="text-[11px] text-slate-500">{user?.email}</p>
            </div>
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleSignOut()}
              disabled={!isOnline}
              title={!isOnline ? OFFLINE_SIGNOUT_MESSAGE : undefined}
            >
              {isOnline ? 'Sign out' : 'Sign out (offline)'}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-4 pb-2 text-sm">
          <NavLink
            to="/super-admin/companies"
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100',
              )
            }
          >
            Companies
          </NavLink>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

export default SuperAdminLayout
