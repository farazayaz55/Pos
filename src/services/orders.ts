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
} from '@/types'
import {
  calcDiscountAmount,
  calcSubtotal,
  calcTotal,
  calcChange,
} from '@/utils/orderCalc'

const ordersRef = (companyId: string) => ref(db, `orders/${companyId}`)
const orderRef = (companyId: string, orderId: string) =>
  ref(db, `orders/${companyId}/${orderId}`)
const counterRef = (companyId: string) => ref(db, `counters/${companyId}/orderSeq`)

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

const nextOrderNumber = async (companyId: string): Promise<number> => {
  const result = await runTransaction(counterRef(companyId), (current) => {
    return (current ?? 0) + 1
  })
  if (!result.committed) throw new Error('Failed to generate order number')
  return Number(result.snapshot.val()) || 1
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

export interface CreateOrderInput {
  companyId: string
  createdBy: string
  createdByName: string
  lines: CartLine[]
  tableNumber?: string
  discount: DiscountInfo
  cashReceived: number
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
  } = input

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const total = calcTotal(subtotal, discountAmount)
  const change = calcChange(cashReceived, total)
  const orderNumber = await nextOrderNumber(companyId)

  const node = push(ordersRef(companyId))
  const orderId = node.key!
  const now = Date.now()

  const order: Omit<Order, 'id'> = {
    orderNumber,
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
    ...(tableNumber ? { tableNumber } : {}),
  }

  await set(node, order)
  return { id: orderId, ...order }
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
