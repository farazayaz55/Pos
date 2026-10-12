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
import { businessDateUtc } from '@/utils/businessDate'
import { getTaxSettings } from '@/services/taxSettings'
import { getCompany } from '@/services/companies'

const ordersRef = (companyId: string) => ref(db, `orders/${companyId}`)
const orderRef = (companyId: string, orderId: string) =>
  ref(db, `orders/${companyId}/${orderId}`)
const dailyCounterRef = (companyId: string, orderDate: string) =>
  ref(db, `counters/${companyId}/dailyOrderSeq/${orderDate}`)

const recordToArray = <T extends { id: string }>(
  val: Record<string, Omit<T, 'id'>> | null,
): T[] => {
  if (!val) return []
  return Object.entries(val).map(([id, v]) => ({ id, ...v }) as T)
}

export const subscribeOrders = (companyId: string, cb: (orders: Order[]) => void) => {
  const q = query(ordersRef(companyId), orderByChild('createdAt'))
  return onValue(q, (snap) => {
    const list = recordToArray<Order>(snap.val())
    list.sort((a, b) => b.createdAt - a.createdAt)
    cb(list)
  })
}

export const subscribeOrder = (
  companyId: string,
  orderId: string,
  cb: (o: Order | null) => void,
) => {
  return onValue(orderRef(companyId, orderId), (snap) => {
    const val = snap.val() as Omit<Order, 'id'> | null
    cb(val ? { id: orderId, ...val } : null)
  })
}

export const getOrder = async (companyId: string, orderId: string): Promise<Order | null> => {
  const snap = await get(orderRef(companyId, orderId))
  const val = snap.val() as Omit<Order, 'id'> | null
  return val ? { id: orderId, ...val } : null
}

const nextOrderNumber = async (
  companyId: string,
): Promise<{ orderNumber: number; orderDate: string }> => {
  const orderDate = businessDateUtc()
  const result = await runTransaction(dailyCounterRef(companyId, orderDate), (current) => {
    return (current ?? 0) + 1
  })
  if (!result.committed) throw new Error('Failed to generate order number')
  return { orderNumber: Number(result.snapshot.val()) || 1, orderDate }
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
    ...(l.note ? { note: l.note } : {}),
  }))

const loadTaxComponents = async (companyId: string): Promise<TaxComponent[]> => {
  const [settings, company] = await Promise.all([
    getTaxSettings(companyId),
    getCompany(companyId),
  ])
  return resolveTaxComponents(settings?.components, company?.taxRate)
}

export interface CreateOrderInput {
  companyId: string
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
  const components = await loadTaxComponents(companyId)
  const { tax, taxLines } = calcTax(taxableBase, components)
  const total = calcTotal(taxableBase, tax)
  const change = calcChange(cashReceived, total)
  const { orderNumber, orderDate } = await nextOrderNumber(companyId)

  const node = push(ordersRef(companyId))
  const orderId = node.key!
  const now = Date.now()

  const order: Omit<Order, 'id'> = {
    orderNumber,
    orderDate,
    companyId,
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
  const { orderNumber, orderDate } = await nextOrderNumber(local.companyId)
  const node = push(ordersRef(local.companyId))
  const orderId = node.key!
  const clientLocalId = local.clientLocalId || local.id

  const order: Omit<Order, 'id' | 'syncStatus' | 'syncError'> = {
    orderNumber,
    orderDate,
    companyId: local.companyId,
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
    orderId,
    updatedBy,
    updatedByName,
    lines,
    tableNumber,
    discount,
    cashReceived,
  } = input

  const existing = await getOrder(companyId, orderId)
  if (!existing) throw new Error('Order not found')
  if (!canEditCashPosOrder(existing)) {
    throw new Error('This order cannot be edited')
  }
  if (lines.length === 0) throw new Error('Cart is empty')

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const taxableBase = calcTaxableBase(subtotal, discountAmount)
  const components = await loadTaxComponents(companyId)
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

  await update(orderRef(companyId, orderId), patch)

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
  orderId: string,
  status: OrderStatus,
) => {
  const patch: Record<string, unknown> = { status }
  if (status === 'completed') patch.completedAt = Date.now()
  await update(orderRef(companyId, orderId), patch)
}

export const completeKioskCashOrder = async (
  companyId: string,
  orderId: string,
) => {
  const patch: Record<string, unknown> = {
    status: 'completed',
    paymentStatus: 'paid',
    completedAt: Date.now(),
  }
  await update(orderRef(companyId, orderId), patch)
}
