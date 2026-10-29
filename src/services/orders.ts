import {
  ref,
  push,
  set,
  update,
  onValue,
  get,
  runTransaction,
  query,
  orderByChild,
} from 'firebase/database'
import { db } from '@/lib/firebase'
import type {
  CartLine,
  DiscountInfo,
  Order,
  OrderItemSnapshot,
  OrderStatus,
  TaxComponent,
} from '@/types'
import {
  calcDiscountAmount,
  calcSubtotal,
  calcTax,
  calcTaxableBase,
  calcTotal,
  calcChange,
  resolveTaxComponents,
} from '@/utils/orderCalc'
import { getTaxSettings } from '@/services/taxSettings'
import { getCompany } from '@/services/companies'
import { requireOpenDayState } from '@/services/dayState'

const ordersRef = (companyId: string, branchId: string) =>
  ref(db, `orders/${companyId}/${branchId}`)
const orderRef = (companyId: string, branchId: string, orderId: string) =>
  ref(db, `orders/${companyId}/${branchId}/${orderId}`)
const dailyCounterRef = (companyId: string, branchId: string, periodId: string) =>
  ref(db, `counters/${companyId}/${branchId}/dailyOrderSeq/${periodId}`)

const recordToArray = <T extends { id: string }>(
  val: Record<string, Omit<T, 'id'>> | null,
): T[] => {
  if (!val) return []
  return Object.entries(val).map(([id, v]) => ({ id, ...v }) as T)
}

export const subscribeOrders = (
  companyId: string,
  branchId: string,
  cb: (orders: Order[]) => void,
) => {
  const q = query(ordersRef(companyId, branchId), orderByChild('createdAt'))
  return onValue(q, (snap) => {
    const list = recordToArray<Order>(snap.val())
    list.sort((a, b) => b.createdAt - a.createdAt)
    cb(list)
  })
}

export const subscribeOrder = (
  companyId: string,
  branchId: string,
  orderId: string,
  cb: (o: Order | null) => void,
) => {
  return onValue(orderRef(companyId, branchId, orderId), (snap) => {
    const val = snap.val() as Omit<Order, 'id'> | null
    cb(val ? { id: orderId, ...val } : null)
  })
}

export const getOrder = async (
  companyId: string,
  branchId: string,
  orderId: string,
): Promise<Order | null> => {
  const snap = await get(orderRef(companyId, branchId, orderId))
  const val = snap.val() as Omit<Order, 'id'> | null
  return val ? { id: orderId, ...val } : null
}

const nextOrderNumber = async (
  companyId: string,
  branchId: string,
): Promise<{ orderNumber: number; orderDate: string; reportPeriodId: string }> => {
  const dayState = await requireOpenDayState(companyId, branchId)
  const result = await runTransaction(
    dailyCounterRef(companyId, branchId, dayState.periodId),
    (current) => {
      return (current ?? 0) + 1
    },
  )
  if (!result.committed) throw new Error('Failed to generate order number')
  return {
    orderNumber: Number(result.snapshot.val()) || 1,
    orderDate: dayState.businessDate,
    reportPeriodId: dayState.periodId,
  }
}

const linesToSnapshot = (lines: CartLine[]): OrderItemSnapshot[] =>
  lines.map((l) => ({
    lineId: l.lineId,
    itemId: l.itemId,
    itemName: l.itemName,
    basePrice: l.basePrice,
    quantity: l.quantity,
    modifiers: l.modifiers,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    ...(l.categoryId ? { categoryId: l.categoryId } : {}),
    ...(l.variantId ? { variantId: l.variantId } : {}),
    ...(l.variantName ? { variantName: l.variantName } : {}),
    ...(l.note ? { note: l.note } : {}),
  }))

const loadTaxComponents = async (
  companyId: string,
  branchId: string,
): Promise<TaxComponent[]> => {
  const [settings, company] = await Promise.all([
    getTaxSettings(companyId, branchId),
    getCompany(companyId),
  ])
  return resolveTaxComponents(settings?.components, company?.taxRate)
}

export interface CreateOrderInput {
  companyId: string
  branchId: string
  createdBy: string
  createdByName: string
  lines: CartLine[]
  tableNumber?: string
  discount: DiscountInfo
  cashReceived: number
  clientLocalId?: string
}

export const createAndCompleteOrder = async (input: CreateOrderInput): Promise<Order> => {
  const {
    companyId,
    branchId,
    createdBy,
    createdByName,
    lines,
    tableNumber,
    discount,
    cashReceived,
    clientLocalId,
  } = input

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const taxableBase = calcTaxableBase(subtotal, discountAmount)
  const components = await loadTaxComponents(companyId, branchId)
  const { tax, taxLines } = calcTax(taxableBase, components)
  const total = calcTotal(taxableBase, tax)
  const change = calcChange(cashReceived, total)
  const { orderNumber, orderDate, reportPeriodId } = await nextOrderNumber(
    companyId,
    branchId,
  )

  const node = push(ordersRef(companyId, branchId))
  const orderId = node.key!
  const now = Date.now()

  const order: Omit<Order, 'id'> = {
    orderNumber,
    orderDate,
    reportPeriodId,
    companyId,
    branchId,
    items: linesToSnapshot(lines),
    subtotal,
    discount: {
      ...discount,
      amount: discountAmount,
      ...(discount.type !== 'none'
        ? {
            appliedBy: createdBy,
            appliedByName: createdByName,
            at: now,
          }
        : {}),
    },
    tax,
    ...(taxLines.length > 0 ? { taxLines } : {}),
    total,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashReceived,
    change,
    createdBy,
    createdByName,
    createdAt: now,
    completedAt: now,
    orderSource: 'pos',
    ...(tableNumber ? { tableNumber } : {}),
    ...(clientLocalId ? { clientLocalId } : {}),
  }

  await set(node, order)
  return { id: orderId, ...order }
}

/**
 * Push an already-computed cash order (e.g. offline outbox) to RTDB,
 * minting a real daily order number. Strips client-only sync fields.
 */
export const pushCompletedCashOrder = async (local: Order): Promise<Order> => {
  const branchId = local.branchId
  if (!branchId) throw new Error('Order is missing branchId')
  const { orderNumber, orderDate, reportPeriodId } = await nextOrderNumber(
    local.companyId,
    branchId,
  )
  const node = push(ordersRef(local.companyId, branchId))
  const orderId = node.key!
  const clientLocalId = local.clientLocalId || local.id

  const order: Omit<Order, 'id' | 'syncStatus' | 'syncError'> = {
    orderNumber,
    orderDate,
    reportPeriodId,
    companyId: local.companyId,
    branchId,
    items: local.items,
    subtotal: local.subtotal,
    discount: local.discount,
    total: local.total,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashReceived: local.cashReceived,
    change: local.change,
    createdBy: local.createdBy,
    createdByName: local.createdByName,
    createdAt: local.createdAt,
    completedAt: local.completedAt ?? local.createdAt,
    orderSource: local.orderSource ?? 'pos',
    clientLocalId,
    ...(local.tax != null ? { tax: local.tax } : {}),
    ...(local.taxLines && local.taxLines.length > 0 ? { taxLines: local.taxLines } : {}),
    ...(local.tableNumber ? { tableNumber: local.tableNumber } : {}),
    ...(local.tip != null ? { tip: local.tip } : {}),
    ...(local.updatedAt != null ? { updatedAt: local.updatedAt } : {}),
    ...(local.updatedBy ? { updatedBy: local.updatedBy } : {}),
    ...(local.updatedByName ? { updatedByName: local.updatedByName } : {}),
  }

  await set(node, order)
  return { id: orderId, ...order }
}

export const canEditCashPosOrder = (order: Order): boolean =>
  order.paymentMethod === 'cash' &&
  order.paymentStatus === 'paid' &&
  order.status === 'completed' &&
  order.orderSource !== 'kiosk'

export interface UpdateCashOrderInput {
  companyId: string
  branchId: string
  orderId: string
  updatedBy: string
  updatedByName: string
  lines: CartLine[]
  tableNumber?: string
  discount: DiscountInfo
  cashReceived: number
}

export const updateCompletedCashOrder = async (
  input: UpdateCashOrderInput,
): Promise<Order> => {
  const {
    companyId,
    branchId,
    orderId,
    updatedBy,
    updatedByName,
    lines,
    tableNumber,
    discount,
    cashReceived,
  } = input

  const existing = await getOrder(companyId, branchId, orderId)
  if (!existing) throw new Error('Order not found')
  if (!canEditCashPosOrder(existing)) {
    throw new Error('This order cannot be edited')
  }
  if (lines.length === 0) throw new Error('Cart is empty')

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const taxableBase = calcTaxableBase(subtotal, discountAmount)
  const components = await loadTaxComponents(companyId, branchId)
  const { tax, taxLines } = calcTax(taxableBase, components)
  const total = calcTotal(taxableBase, tax)
  const change = calcChange(cashReceived, total)
  const now = Date.now()

  const patch: Record<string, unknown> = {
    items: linesToSnapshot(lines),
    subtotal,
    discount: {
      type: discount.type,
      value: discount.value,
      amount: discountAmount,
      ...(discount.type !== 'none'
        ? {
            appliedBy: updatedBy,
            appliedByName: updatedByName,
            at: now,
          }
        : {}),
    },
    tax,
    taxLines: taxLines.length > 0 ? taxLines : null,
    total,
    cashReceived,
    change,
    updatedAt: now,
    updatedBy,
    updatedByName,
    tableNumber: tableNumber || null,
  }

  await update(orderRef(companyId, branchId, orderId), patch)

  return {
    ...existing,
    items: linesToSnapshot(lines),
    subtotal,
    discount: {
      type: discount.type,
      value: discount.value,
      amount: discountAmount,
      ...(discount.type !== 'none'
        ? {
            appliedBy: updatedBy,
            appliedByName: updatedByName,
            at: now,
          }
        : {}),
    },
    tax,
    taxLines: taxLines.length > 0 ? taxLines : undefined,
    total,
    cashReceived,
    change,
    updatedAt: now,
    updatedBy,
    updatedByName,
    ...(tableNumber ? { tableNumber } : { tableNumber: undefined }),
  }
}

export const updateOrderStatus = async (
  companyId: string,
  branchId: string,
  orderId: string,
  status: OrderStatus,
) => {
  const patch: Record<string, unknown> = { status }
  if (status === 'completed') patch.completedAt = Date.now()
  await update(orderRef(companyId, branchId, orderId), patch)
}

export const completeKioskCashOrder = async (
  companyId: string,
  branchId: string,
  orderId: string,
) => {
  const patch: Record<string, unknown> = {
    status: 'completed',
    paymentStatus: 'paid',
    completedAt: Date.now(),
  }
  await update(orderRef(companyId, branchId, orderId), patch)
}
