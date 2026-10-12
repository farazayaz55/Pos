import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'

interface Props {
  children: ReactNode
  allow?: UserRole[]
}

const ProtectedRoute = ({ children, allow }: Props) => {
  const { user, initialized } = useAuthStore()
  const location = useLocation()

  if (!initialized) return <LoadingScreen />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (allow && !allow.includes(user.role)) {
    const redirect =
      user.role === 'super_admin'
        ? '/super-admin'
        : user.role === 'admin' || user.role === 'staff'
          ? '/admin/pos'
          : '/login'
    return <Navigate to={redirect} replace />
  }
  return <>{children}</>
}

export default ProtectedRoute
