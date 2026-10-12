import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { can, defaultAdminPath } from '@/utils/permissions'
import type { StaffPermission } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'

interface Props {
  permission: StaffPermission
  children: ReactNode
}

const PermissionGate = ({ permission, children }: Props) => {
  const { user, initialized } = useAuthStore()

  if (!initialized) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!can(user, permission)) {
    return <Navigate to={defaultAdminPath(user)} replace />
  }
  return <>{children}</>
}

export default PermissionGate
