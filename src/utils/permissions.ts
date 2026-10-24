import type { AppUser, StaffPermission, StaffPermissions } from '@/types'

export const STAFF_PERMISSIONS: StaffPermission[] = [
  'pos',
  'menu',
  'orders',
  'settings',
  'receipt',
  'team',
]

export const PERMISSION_LABELS: Record<StaffPermission, string> = {
  pos: 'POS',
  menu: 'Menu (Categories, Items, Modifiers)',
  orders: 'Orders',
  settings: 'Settings',
  receipt: 'Receipt content & formatting',
  team: 'Team',
}

export const emptyPermissions = (): StaffPermissions => ({
  pos: false,
  menu: false,
  orders: false,
  settings: false,
  receipt: false,
  team: false,
})

export const defaultStaffPermissions = (): StaffPermissions => ({
  pos: true,
  menu: false,
  orders: false,
  settings: false,
  receipt: false,
  team: false,
})

/** First admin landing path the user is allowed to open. */
export const defaultAdminPath = (user: AppUser | null | undefined): string => {
  if (!user) return '/login'
  if (user.role === 'super_admin') return '/super-admin'
  if (can(user, 'pos')) return '/admin/pos'
  if (can(user, 'menu')) return '/admin/menu/items'
  if (can(user, 'orders')) return '/admin/orders'
  if (can(user, 'settings') || can(user, 'receipt')) return '/admin/settings'
  if (can(user, 'team')) return '/admin/team'
  return '/admin/pos'
}

export const can = (
  user: AppUser | null | undefined,
  permission: StaffPermission,
): boolean => {
  if (!user) return false
  if (user.role === 'super_admin' || user.role === 'admin') return true
  if (user.role !== 'staff') return false
  if (user.active === false) return false
  return user.permissions?.[permission] === true
}
