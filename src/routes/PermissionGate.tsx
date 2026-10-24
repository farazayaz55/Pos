import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { can, defaultAdminPath } from '@/utils/permissions'
import type { StaffPermission } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'

interface Props {
  permission?: StaffPermission
  /** Allow access if the user has any of these permissions. */
  anyOf?: StaffPermission[]
  children: ReactNode
}

const PermissionGate = ({ permission, anyOf, children }: Props) => {
  const { user, initialized } = useAuthStore()

  if (!initialized) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />

  const allowed = anyOf?.length
    ? anyOf.some((p) => can(user, p))
    : permission
      ? can(user, permission)
      : false

  if (!allowed) {
    return <Navigate to={defaultAdminPath(user)} replace />
  }
  return <>{children}</>
}

export default PermissionGate
