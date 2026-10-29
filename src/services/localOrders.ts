import {
  createAndCompleteOrder,
  updateCompletedCashOrder,
  type CreateOrderInput,
  type UpdateCashOrderInput,
} from '@/services/orders'
import {
  getCounterMeta,
  getOutboxOrder,
  getOutboxRow,
  getTaxCache,
  isLocalOrderId,
  listUnsyncedOutbox,
  localDb,
  putOutboxOrder,
  setCounterMeta,
  withLocalDb,
} from '@/localdb/db'
import { isBrowserOnline } from '@/hooks/useOnlineStatus'
import { generateId } from '@/utils/idGen'
import {
  requireCachedOpenDayState,
  requireOpenDayState,
} from '@/services/dayState'
import {
  calcChange,
  calcDiscountAmount,
  calcSubtotal,
  calcTax,
  calcTaxableBase,
  calcTotal,
  resolveTaxComponents,
} from '@/utils/orderCalc'
import type { DayState, Order, TaxComponent } from '@/types'

const resolveOfflineDayState = async (
  companyId: string,
  branchId: string,
): Promise<DayState> => {
  if (isBrowserOnline()) {
    try {
      return await requireOpenDayState(companyId, branchId)
    } catch {
      // fall through to cache only — never invent a new period offline
    }
  }
  return requireCachedOpenDayState(companyId, branchId)
}

const nextProvisionalNumber = async (
  companyId: string,
  branchId: string,
  periodId: string,
) => {
  const lastKnown = await getCounterMeta(companyId, branchId, periodId)
  const pending =
    (await withLocalDb(() =>
      localDb.orderOutbox
        .where('branchId')
        .equals(branchId)
        .filter(
          (r) =>
            r.companyId === companyId &&
            r.syncStatus !== 'synced' &&
            (r.order.reportPeriodId || '') === periodId,
        )
        .count(),
    )) ?? 0
  return lastKnown + pending + 1
}

const loadCachedTaxComponents = async (
  companyId: string,
  branchId: string,
): Promise<TaxComponent[]> => {
  const cached = await getTaxCache(companyId, branchId)
  return resolveTaxComponents(cached?.settings?.components, cached?.legacyTaxRate)
}

const buildOfflineOrder = async (input: CreateOrderInput): Promise<Order> => {
  const {
    companyId,
    branchId,
    createdBy,
    createdByName,
    lines,
    tableNumber,
    discount,
    cashReceived,
  } = input

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const taxableBase = calcTaxableBase(subtotal, discountAmount)
  const components = await loadCachedTaxComponents(companyId, branchId)
  const { tax, taxLines } = calcTax(taxableBase, components)
  const total = calcTotal(taxableBase, tax)
  const change = calcChange(cashReceived, total)
  const dayState = await resolveOfflineDayState(companyId, branchId)
  const orderNumber = await nextProvisionalNumber(
    companyId,
    branchId,
    dayState.periodId,
  )
  const localId = generateId('local')
  const now = Date.now()

  const order: Order = {
    id: localId,
    orderNumber,
    orderDate: dayState.businessDate,
    reportPeriodId: dayState.periodId,
    companyId,
    branchId,
    items: lines.map((l) => ({
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
    })),
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
    clientLocalId: localId,
    syncStatus: 'pending',
    ...(tableNumber ? { tableNumber } : {}),
  }

  await putOutboxOrder({
    localId,
    companyId,
    branchId,
    order,
    syncStatus: 'pending',
    clientCreatedAt: now,
  })

  return order
}

const updateOfflineOutboxOrder = async (
  input: UpdateCashOrderInput,
): Promise<Order> => {
  const row = await getOutboxRow(input.orderId)
  if (!row || row.syncStatus === 'synced') {
    throw new Error('Local order not found or already synced')
  }

  const {
    updatedBy,
    updatedByName,
    lines,
    tableNumber,
    discount,
    cashReceived,
  } = input

  if (lines.length === 0) throw new Error('Cart is empty')

  const subtotal = calcSubtotal(lines)
  const discountAmount = calcDiscountAmount(subtotal, discount.type, discount.value)
  const taxableBase = calcTaxableBase(subtotal, discountAmount)
  const components = await loadCachedTaxComponents(input.companyId, input.branchId)
  const { tax, taxLines } = calcTax(taxableBase, components)
  const total = calcTotal(taxableBase, tax)
  const change = calcChange(cashReceived, total)
  const now = Date.now()

  const order: Order = {
    ...row.order,
    branchId: input.branchId,
    items: lines.map((l) => ({
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
    })),
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
    syncStatus: row.syncStatus === 'error' ? 'pending' : row.syncStatus,
    syncError: undefined,
    ...(tableNumber ? { tableNumber } : { tableNumber: undefined }),
  }

  await putOutboxOrder({
    ...row,
    branchId: input.branchId,
    order,
    syncStatus:
      order.syncStatus === 'syncing' ? 'pending' : (order.syncStatus ?? 'pending'),
    lastError: undefined,
  })

  return order
}

export const placeCashOrder = async (input: CreateOrderInput): Promise<Order> => {
  if (!isBrowserOnline()) {
    return buildOfflineOrder(input)
  }

  try {
    const localId = generateId('local')
    const order = await createAndCompleteOrder({
      ...input,
      clientLocalId: localId,
    })
    // Counter cache is optional — never fail Complete & Print after a paid order.
    if (order.reportPeriodId) {
      void setCounterMeta(
        order.companyId,
        order.branchId,
        order.reportPeriodId,
        order.orderNumber,
      )
    } else if (order.orderDate) {
      void setCounterMeta(
        order.companyId,
        order.branchId,
        order.orderDate,
        order.orderNumber,
      )
    }
    return order
  } catch (e) {
    if (!isBrowserOnline()) {
      return buildOfflineOrder(input)
    }
    throw e
  }
}

export const placeCashOrderUpdate = async (
  input: UpdateCashOrderInput,
): Promise<Order> => {
  if (isLocalOrderId(input.orderId)) {
    return updateOfflineOutboxOrder(input)
  }

  if (!isBrowserOnline()) {
    throw new Error('Editing synced orders requires an internet connection')
  }

  return updateCompletedCashOrder(input)
}

export const resolveOrder = async (
  companyId: string,
  branchId: string,
  orderId: string,
): Promise<Order | null> => {
  if (isLocalOrderId(orderId)) {
    return getOutboxOrder(orderId)
  }

  const { getOrder } = await import('@/services/orders')
  try {
    const remote = await getOrder(companyId, branchId, orderId)
    if (remote) return remote
  } catch {
    // offline or RTDB error — try outbox by remote id
  }

  const byRemote = await withLocalDb(() =>
    localDb.orderOutbox
      .where('branchId')
      .equals(branchId)
      .filter(
        (r) =>
          r.companyId === companyId &&
          (r.remoteOrderId === orderId || r.localId === orderId),
      )
      .first(),
  )
  if (!byRemote) return null
  return {
    ...byRemote.order,
    id: byRemote.remoteOrderId || byRemote.localId,
    syncStatus: byRemote.syncStatus,
    syncError: byRemote.lastError,
  }
}

export const getUnsyncedOrders = async (
  companyId: string,
  branchId: string,
): Promise<Order[]> => {
  const rows = await listUnsyncedOutbox(companyId, branchId)
  return rows
    .map((r) => ({
      ...r.order,
      id: r.localId,
      syncStatus: r.syncStatus,
      syncError: r.lastError,
      clientLocalId: r.localId,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
