export type UserRole = 'super_admin' | 'admin'

export interface AppUser {
  uid: string
  email: string
  name: string
  role: UserRole
  companyId?: string
  createdAt: number
}

export interface Company {
  id: string
  name: string
  logoUrl?: string
  location: string
  adminUid: string
  adminEmail: string
  adminName: string
  phone?: string
  active: boolean
  createdAt: number
  createdBy: string
  taxRate?: number
  currency?: string
  stripeLocationId?: string
}

export interface Category {
  id: string
  companyId: string
  name: string
  imageUrl?: string
  sortOrder: number
  active: boolean
  createdAt: number
}

export interface ModifierOption {
  id: string
  name: string
  priceAdjustment: number
}

export interface ModifierGroup {
  id: string
  companyId: string
  name: string
  required: boolean
  min: number
  max: number
  options: Record<string, ModifierOption>
  createdAt: number
}

export interface MenuItem {
  id: string
  companyId: string
  categoryId: string
  name: string
  description?: string
  basePrice: number
  imageUrl?: string
  available: boolean
  modifierGroupIds: string[]
  sortOrder: number
  createdAt: number
}

export interface CartModifierSelection {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  priceAdjustment: number
}

export interface CartLine {
  lineId: string
  itemId: string
  itemName: string
  basePrice: number
  imageUrl?: string
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
  unitPrice: number
  lineTotal: number
}

export type DiscountType = 'flat' | 'percent' | 'none'

export interface DiscountInfo {
  type: DiscountType
  value: number
  amount: number
  appliedBy?: string
  appliedByName?: string
  at?: number
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid'
export type PaymentMethod = 'cash' | 'card_reader' | 'tap_to_pay'
export type OrderSource = 'pos' | 'kiosk'

export interface OrderItemSnapshot {
  lineId: string
  itemId: string
  itemName: string
  basePrice: number
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
  unitPrice: number
  lineTotal: number
}

export interface KdsState {
  status: 'queued' | 'in_progress' | 'ready' | 'served'
  queuedAt: number
}

export interface Order {
  id: string
  orderNumber: number
  companyId: string
  items: OrderItemSnapshot[]
  tableNumber?: string
  subtotal: number
  discount: DiscountInfo
  tax?: number
  tip?: number
  total: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  status: OrderStatus
  cashReceived?: number
  change?: number
  createdBy: string
  createdByName: string
  createdAt: number
  completedAt?: number
  orderSource?: OrderSource
  stripePaymentIntentId?: string
  kds?: KdsState
}
