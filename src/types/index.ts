export type UserRole = 'super_admin' | 'admin' | 'staff'

export type StaffPermission =
  | 'pos'
  | 'menu'
  | 'orders'
  | 'settings'
  | 'receipt'
  | 'team'
  | 'reports'

export interface StaffPermissions {
  pos: boolean
  menu: boolean
  orders: boolean
  settings: boolean
  receipt: boolean
  team: boolean
  reports: boolean
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
  branchId: string
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
  /** Required for staff; omitted for company admin (all branches). */
  branchId?: string
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
  /** Required for staff; omitted for company admin. */
  branchId?: string
  permissions?: StaffPermissions
  createdAt: number
  active: boolean
}

export interface Company {
  id: string
  name: string
  logoUrl?: string
  /** @deprecated Prefer branch.location; kept for migration / HQ display. */
  location: string
  adminUid: string
  adminEmail: string
  adminName: string
  /** @deprecated Prefer branch.phone */
  phone?: string
  active: boolean
  createdAt: number
  createdBy: string
  taxRate?: number
  currency?: string
  stripeLocationId?: string
}

/** Location under companies/{companyId}/branches/{branchId} */
export interface Branch {
  id: string
  companyId: string
  name: string
  location: string
  phone?: string
  active: boolean
  createdAt: number
  createdBy: string
}

/** Menu/tax write target for company admins. */
export type BranchWriteScope = 'this' | 'all'

export interface Category {
  id: string
  companyId: string
  branchId: string
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
  branchId: string
  name: string
  required: boolean
  min: number
  max: number
  options: Record<string, ModifierOption>
  createdAt: number
}

/** Per-item size/variant with absolute price (replaces basePrice when selected). */
export interface ItemVariant {
  id: string
  name: string
  price: number
  sortOrder: number
}

export interface MenuItem {
  id: string
  companyId: string
  branchId: string
  categoryId: string
  name: string
  description?: string
  /** No-variant price; when variants exist, synced to lowest variant for display. */
  basePrice: number
  imageUrl?: string
  available: boolean
  /** Per-item absolute-price variants (Size S/M/L). Empty/missing = use basePrice. */
  variants?: Record<string, ItemVariant>
  /** Shared company-wide add-on groups. */
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
  /** Menu category at add time — used for kitchen receipt filtering. */
  categoryId?: string
  /** Absolute price for the line (variant.price or item.basePrice). */
  basePrice: number
  variantId?: string
  variantName?: string
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
  branchId: string
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
  /** Menu category at order time — used for kitchen receipt filtering. */
  categoryId?: string
  /** Absolute price for the line (variant.price or item.basePrice). */
  basePrice: number
  variantId?: string
  variantName?: string
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
  unitPrice: number
  lineTotal: number
}

/** Branch settings controlling which items appear on kitchen tickets. */
export interface CompanyKitchenReceiptSettings {
  companyId: string
  branchId: string
  /** Categories omitted from kitchen tickets by default. */
  excludedCategoryIds: string[]
  /** Items always omitted (even if category included). */
  excludedItemIds: string[]
  /** Items always included (even if category excluded). */
  includedItemIds: string[]
  updatedAt?: number
  updatedBy?: string
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
  /** Reporting period this order belongs to (X/Z reports). */
  reportPeriodId?: string
  companyId: string
  branchId: string
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

/** Open or just-closed business reporting period for a branch. */
export interface DayState {
  periodId: string
  businessDate: string
  openedAt: number
  status: 'open' | 'closed'
  /** Starting cash in the drawer (not revenue). Required for a valid open shift. */
  openingFloat?: number
  openedBy?: string
  openedByName?: string
  closedAt?: number
  closedBy?: string
  closedByName?: string
}

export type CashMovementType = 'pay_in' | 'pay_out'

/** Cash added to or removed from the drawer during an open period. */
export interface CashMovement {
  id: string
  periodId: string
  type: CashMovementType
  amount: number
  reason: string
  createdBy: string
  createdByName: string
  createdAt: number
}

export interface XzPaymentBreakdown {
  cash: number
  card_reader: number
  tap_to_pay: number
}

/** Aggregated sales snapshot for an X or Z report. */
export interface XzReportSummary {
  orderCount: number
  grossSales: number
  avgTicket: number
  subtotal: number
  discount: number
  tax: number
  tip: number
  total: number
  byPaymentMethod: XzPaymentBreakdown
  cashReceived: number
  changeGiven: number
  /** Net cash sales (paid cash order totals) in the period. */
  cashSales: number
  /** Cash refunds returned to customers in the period. */
  cashRefundTotal: number
  refundCount: number
  refundTotal: number
  openingFloat: number
  payInTotal: number
  payOutTotal: number
  expectedCash: number
}

export interface ZReport extends XzReportSummary {
  id: string
  companyId: string
  branchId: string
  periodId: string
  businessDate: string
  openedAt: number
  closedAt: number
  closedBy: string
  closedByName: string
  reportType: 'z'
  actualCash?: number
  cashVariance?: number
}

/** Sum of closed Z reports over a date range (audit totals, not one drawer). */
export interface ZPeriodSummary extends XzReportSummary {
  periodCount: number
  fromBusinessDate: string | null
  toBusinessDate: string | null
  actualCash: number
  cashVariance: number
}
