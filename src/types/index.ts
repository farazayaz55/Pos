export type UserRole = 'super_admin' | 'admin' | 'staff'

export type StaffPermission =
  | 'pos'
  | 'menu'
  | 'orders'
  | 'settings'
  | 'receipt'
  | 'team'

export interface StaffPermissions {
  pos: boolean
  menu: boolean
  orders: boolean
  settings: boolean
  receipt: boolean
  team: boolean
}

export type ReceiptAlign = 'left' | 'center' | 'right'

export type ReceiptBlockType =
  | 'text'
  | 'logo'
  | 'companyName'
  | 'companyLocation'
  | 'companyPhone'
  | 'divider'
  | 'orderNumber'
  | 'date'
  | 'table'
  | 'cashier'
  | 'lineItems'
  | 'subtotal'
  | 'discount'
  | 'tax'
  | 'tip'
  | 'total'
  | 'payment'
  | 'thankYou'

export interface ReceiptBlock {
  id: string
  type: ReceiptBlockType
  text?: string
  align?: ReceiptAlign
  label?: string
}

/** @deprecated Prefer ReceiptBlock text entries in blocks. */
export interface ReceiptTextLine {
  id: string
  text: string
  align: ReceiptAlign
}

export interface CompanyReceiptSettings {
  companyId: string
  blocks: ReceiptBlock[]
  /** @deprecated migrated on read into blocks */
  headerLines?: ReceiptTextLine[]
  /** @deprecated migrated on read into blocks */
  footerLines?: ReceiptTextLine[]
  updatedAt?: number
  updatedBy?: string
}

export interface AppUser {
  uid: string
  email: string
  name: string
  role: UserRole
  companyId?: string
  password?: string
  permissions?: StaffPermissions
  active?: boolean
  createdAt: number
}

/** Denormalized roster entry under companies/{companyId}/team/{uid} */
export interface TeamMember {
  uid: string
  name: string
  email: string
  role: 'admin' | 'staff'
  permissions?: StaffPermissions
  createdAt: number
  active: boolean
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

/** When a tax component applies relative to the post-discount taxable base. */
export type TaxConditionType = 'always' | 'taxableBaseLte' | 'taxableBaseGt'

export interface TaxComponent {
  id: string
  name: string
  /** Decimal rate, e.g. 0.13 for 13%. */
  rate: number
  conditionType: TaxConditionType
  /** Required when conditionType is taxableBaseLte or taxableBaseGt. */
  conditionAmount?: number
  active: boolean
  sortOrder: number
}

export interface CompanyTaxSettings {
  companyId: string
  components: Record<string, TaxComponent>
  updatedAt?: number
  updatedBy?: string
}

export interface OrderTaxLine {
  name: string
  rate: number
  amount: number
}

export type OrderStatus = 'pending' | 'completed' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'refunded'
export type PaymentMethod = 'cash' | 'card_reader' | 'tap_to_pay'
export type OrderSource = 'pos' | 'kiosk'
/** Client-only outbox state; never persisted to RTDB. */
export type OrderSyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

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
  /** UTC calendar day (YYYY-MM-DD) the orderNumber was minted for. */
  orderDate?: string
  companyId: string
  items: OrderItemSnapshot[]
  tableNumber?: string
  subtotal: number
  discount: DiscountInfo
  tax?: number
  /** Snapshot of tax components applied at checkout. */
  taxLines?: OrderTaxLine[]
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
  updatedAt?: number
  updatedBy?: string
  updatedByName?: string
  orderSource?: OrderSource
  /** Stable client id used for offline outbox idempotency. */
  clientLocalId?: string
  /** Client-only; never written to RTDB. */
  syncStatus?: OrderSyncStatus
  /** Client-only last sync error message. */
  syncError?: string
  stripePaymentIntentId?: string
  refundedAt?: number
  refundedBy?: string
  refundedByName?: string
  stripeRefundId?: string
  kds?: KdsState
}
