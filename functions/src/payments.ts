/**
 * Stripe Terminal payments + kiosk order creation.
 *
 * Callable HTTPS Cloud Functions:
 *
 *  - getTerminalConnectionToken: mints a connection token so the kiosk's
 *    mek_stripe_terminal SDK can initialise the Stripe Terminal session.
 *
 *  - createKioskPaymentIntent: creates a card_present PaymentIntent for the
 *    kiosk to retrieve and present to the reader. Server-authoritative on
 *    company status; client supplies an idempotencyKey to make this safe
 *    against retries during reader timeouts.
 *
 *  - createKioskOrder: only call AFTER the kiosk's SDK reports the
 *    PaymentIntent succeeded. The function re-prices the order from the live
 *    RTDB menu (defence-in-depth against client tampering), confirms the
 *    PaymentIntent with Stripe (source of truth for "was the customer
 *    charged?"), runs a transaction on
 *    /counters/{companyId}/dailyOrderSeq/{YYYY-MM-DD} to mint the
 *    human-friendly daily order number, and writes the
 *    /orders/{companyId}/{orderId} record using the Admin SDK (which
 *    bypasses RTDB rules — kiosk anonymous auth is intentionally NOT
 *    allowed to write orders directly).
 *
 *  - getKioskOrder: lets authenticated kiosk clients read an order by id
 *    (RTDB rules deny direct order reads for anonymous kiosk auth).
 *
 *  - refundOrder: full-order refund for company admins. Cash orders are
 *    marked refunded in RTDB; card orders also create a Stripe refund on
 *    the original PaymentIntent.
 *
 *  Idempotency: callers MUST send an idempotencyKey. Both createKioskPaymentIntent
 *  and createKioskOrder are idempotent on (paymentIntentId or idempotencyKey)
 *  so a flaky network never produces a double charge or a duplicate order.
 *  refundOrder is idempotent on already-refunded orders and uses a Stripe
 *  idempotency key for card refunds.
 */

import {
  onCall,
  HttpsError,
  type CallableRequest,
} from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import Stripe from 'stripe'
import { mintPeriodOrderNumber } from './dayClose'

const db = admin.database()

let stripeSingleton: Stripe | null = null

const stripeClient = (): Stripe => {
  if (stripeSingleton) return stripeSingleton
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new HttpsError(
      'failed-precondition',
      'STRIPE_SECRET_KEY env var is not set on the Cloud Function.',
    )
  }
  stripeSingleton = new Stripe(key, { apiVersion: '2025-02-24.acacia' })
  return stripeSingleton
}

const requireAuth = (req: CallableRequest<unknown>): string => {
  const uid = req.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required.')
  }
  return uid
}

const requireCompanyAdmin = (
  req: CallableRequest<unknown>,
  companyId: string,
): string => {
  const uid = requireAuth(req)
  const role = req.auth?.token?.role
  const tokenCompanyId = req.auth?.token?.companyId
  if (role === 'super_admin') return uid
  if (role === 'admin' && tokenCompanyId === companyId) return uid
  if (role === 'staff' && tokenCompanyId === companyId) {
    const permissions = req.auth?.token?.permissions as
      | { pos?: boolean }
      | undefined
    if (permissions?.pos === true) return uid
  }
  throw new HttpsError('permission-denied', 'Company admin required.')
}

const assertCompanyActive = async (companyId: string): Promise<Company> => {
  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required.')
  }
  const snap = await db.ref(`companies/${companyId}`).get()
  const c = snap.val() as Company | null
  if (!c) {
    throw new HttpsError('not-found', 'Unknown companyId.')
  }
  if (c.active === false) {
    throw new HttpsError('permission-denied', 'Company is not active.')
  }
  return c
}

interface Company {
  name?: string
  active?: boolean
  taxRate?: number
  currency?: string
  stripeLocationId?: string
}

interface ModifierOption {
  id: string
  name: string
  priceAdjustment: number
}

interface ModifierGroup {
  id?: string
  companyId?: string
  name: string
  required?: boolean
  min?: number
  max?: number
  options?: Record<string, ModifierOption>
}

interface ItemVariantDoc {
  id?: string
  name: string
  price: number
  sortOrder?: number
}

interface MenuItemDoc {
  id?: string
  companyId?: string
  categoryId: string
  name: string
  basePrice: number
  available?: boolean
  variants?: Record<string, ItemVariantDoc>
  modifierGroupIds?: string[]
}

interface KioskModifierInput {
  groupId: string
  optionId: string
}

interface KioskLineInput {
  itemId: string
  quantity: number
  variantId?: string
  modifiers?: KioskModifierInput[]
  note?: string
}

interface PricedLine {
  lineId: string
  itemId: string
  itemName: string
  categoryId?: string
  basePrice: number
  variantId?: string
  variantName?: string
  quantity: number
  modifiers: {
    groupId: string
    groupName: string
    optionId: string
    optionName: string
    priceAdjustment: number
  }[]
  note?: string
  unitPrice: number
  lineTotal: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

type TaxConditionType = 'always' | 'taxableBaseLte' | 'taxableBaseGt'

interface TaxComponent {
  id: string
  name: string
  rate: number
  conditionType: TaxConditionType
  conditionAmount?: number
  active?: boolean
  sortOrder?: number
}

interface OrderTaxLine {
  name: string
  rate: number
  amount: number
}

const conditionMatches = (component: TaxComponent, taxableBase: number): boolean => {
  switch (component.conditionType) {
    case 'always':
      return true
    case 'taxableBaseLte':
      return taxableBase <= Number(component.conditionAmount)
    case 'taxableBaseGt':
      return taxableBase > Number(component.conditionAmount)
    default:
      return false
  }
}

const resolveTaxComponents = (
  components: Record<string, TaxComponent> | null | undefined,
  legacyTaxRate?: number,
): TaxComponent[] => {
  const list = components ? Object.values(components) : []
  const active = list
    .filter((c) => c && c.active !== false && Number(c.rate) > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  if (active.length > 0) return active
  const rate = Number(legacyTaxRate)
  if (rate > 0) {
    return [
      {
        id: 'legacy',
        name: 'Tax',
        rate,
        conditionType: 'always',
        active: true,
        sortOrder: 0,
      },
    ]
  }
  return []
}

const calcTax = (
  taxableBase: number,
  components: TaxComponent[],
): { tax: number; taxLines: OrderTaxLine[] } => {
  const base = Math.max(0, taxableBase)
  const taxLines: OrderTaxLine[] = []
  for (const c of components) {
    if (!conditionMatches(c, base)) continue
    const amount = round2(base * Number(c.rate))
    if (amount <= 0) continue
    taxLines.push({ name: c.name, rate: Number(c.rate), amount })
  }
  const tax = round2(taxLines.reduce((s, l) => s + l.amount, 0))
  return { tax, taxLines }
}

const loadCompanyTaxComponents = async (
  companyId: string,
  branchId: string,
  legacyTaxRate?: number,
): Promise<TaxComponent[]> => {
  const snap = await db.ref(`taxSettings/${companyId}/${branchId}`).get()
  const settings = snap.val() as { components?: Record<string, TaxComponent> } | null
  return resolveTaxComponents(settings?.components, legacyTaxRate)
}

const sanitizeQty = (q: unknown): number => {
  const n = Math.floor(Number(q))
  if (!Number.isFinite(n) || n < 1 || n > 99) {
    throw new HttpsError('invalid-argument', 'Invalid line quantity.')
  }
  return n
}

const priceLines = async (
  companyId: string,
  branchId: string,
  rawLines: KioskLineInput[],
): Promise<{
  lines: PricedLine[]
  subtotal: number
}> => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpsError('invalid-argument', 'lines is empty.')
  }
  if (rawLines.length > 50) {
    throw new HttpsError('invalid-argument', 'Too many lines.')
  }

  const [itemsSnap, groupsSnap] = await Promise.all([
    db.ref(`menu/${companyId}/${branchId}/items`).get(),
    db.ref(`menu/${companyId}/${branchId}/modifierGroups`).get(),
  ])
  const itemsMap = (itemsSnap.val() ?? {}) as Record<string, MenuItemDoc>
  const groupsMap = (groupsSnap.val() ?? {}) as Record<string, ModifierGroup>

  const priced: PricedLine[] = []
  let subtotal = 0
  let lineCounter = 0

  for (const raw of rawLines) {
    if (!raw || typeof raw.itemId !== 'string') {
      throw new HttpsError('invalid-argument', 'Invalid line.')
    }
    const item = itemsMap[raw.itemId]
    if (!item) {
      throw new HttpsError('failed-precondition', `Item ${raw.itemId} no longer exists.`)
    }
    if (item.available === false) {
      throw new HttpsError('failed-precondition', `Item ${item.name} is unavailable.`)
    }

    const qty = sanitizeQty(raw.quantity)

    const variantsMap = item.variants ?? {}
    const variantIds = Object.keys(variantsMap)
    const hasVariants = variantIds.length > 0
    let basePrice = Number(item.basePrice) || 0
    let variantId: string | undefined
    let variantName: string | undefined

    if (hasVariants) {
      if (!raw.variantId || typeof raw.variantId !== 'string') {
        throw new HttpsError(
          'failed-precondition',
          `Item ${item.name} requires a size/variant.`,
        )
      }
      const variant = variantsMap[raw.variantId]
      if (!variant) {
        throw new HttpsError(
          'failed-precondition',
          `Variant ${raw.variantId} no longer exists on ${item.name}.`,
        )
      }
      variantId = raw.variantId
      variantName = variant.name
      basePrice = Number(variant.price) || 0
    } else if (raw.variantId) {
      throw new HttpsError(
        'failed-precondition',
        `Item ${item.name} has no variants.`,
      )
    }

    const allowedGroupIds = new Set(item.modifierGroupIds ?? [])
    const groupSelectionCounts: Record<string, number> = {}
    const pricedMods: PricedLine['modifiers'] = []

    for (const m of raw.modifiers ?? []) {
      if (!m || typeof m.groupId !== 'string' || typeof m.optionId !== 'string') {
        throw new HttpsError('invalid-argument', 'Invalid modifier reference.')
      }
      if (!allowedGroupIds.has(m.groupId)) {
        throw new HttpsError(
          'failed-precondition',
          `Modifier group ${m.groupId} not allowed on item ${item.name}.`,
        )
      }
      const group = groupsMap[m.groupId]
      if (!group) {
        throw new HttpsError('failed-precondition', `Unknown modifier group ${m.groupId}.`)
      }
      const opt = group.options?.[m.optionId]
      if (!opt) {
        throw new HttpsError(
          'failed-precondition',
          `Option ${m.optionId} no longer exists.`,
        )
      }
      pricedMods.push({
        groupId: m.groupId,
        groupName: group.name,
        optionId: m.optionId,
        optionName: opt.name,
        priceAdjustment: Number(opt.priceAdjustment) || 0,
      })
      groupSelectionCounts[m.groupId] = (groupSelectionCounts[m.groupId] ?? 0) + 1
    }

    for (const groupId of allowedGroupIds) {
      const g = groupsMap[groupId]
      if (!g) continue
      const count = groupSelectionCounts[groupId] ?? 0
      const min = g.min ?? 0
      const max = g.max ?? 1
      if (g.required && count < min) {
        throw new HttpsError(
          'failed-precondition',
          `Group ${g.name} requires at least ${min} selection(s).`,
        )
      }
      if (count > max) {
        throw new HttpsError(
          'failed-precondition',
          `Group ${g.name} accepts at most ${max} selection(s).`,
        )
      }
    }

    const unit = round2(
      basePrice + pricedMods.reduce((s, m) => s + m.priceAdjustment, 0),
    )
    const lineTotal = round2(unit * qty)
    subtotal = round2(subtotal + lineTotal)

    const lineId = `k_${Date.now().toString(36)}_${(lineCounter++).toString(36)}`
    priced.push({
      lineId,
      itemId: raw.itemId,
      itemName: item.name,
      ...(item.categoryId ? { categoryId: String(item.categoryId) } : {}),
      basePrice,
      quantity: qty,
      modifiers: pricedMods,
      ...(variantId ? { variantId } : {}),
      ...(variantName ? { variantName } : {}),
      ...(raw.note ? { note: String(raw.note).slice(0, 200) } : {}),
      unitPrice: unit,
      lineTotal,
    })
  }

  return { lines: priced, subtotal }
}

interface GetTokenResult {
  secret: string
}

export const getTerminalConnectionToken = onCall<
  Record<string, never>,
  Promise<GetTokenResult>
>(async (req) => {
  requireAuth(req)
  const stripe = stripeClient()
  const token = await stripe.terminal.connectionTokens.create()
  return { secret: token.secret }
})

interface CreatePaymentIntentInput {
  companyId: string
  amount: number
  currency?: string
  idempotencyKey: string
}

interface CreatePaymentIntentResult {
  clientSecret: string
  paymentIntentId: string
  amount: number
  currency: string
}

export const createKioskPaymentIntent = onCall<
  CreatePaymentIntentInput,
  Promise<CreatePaymentIntentResult>
>(async (req) => {
  requireAuth(req)
  const { companyId, amount, currency, idempotencyKey } =
    req.data || ({} as CreatePaymentIntentInput)

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 50) {
    throw new HttpsError(
      'invalid-argument',
      'amount must be an integer in the smallest currency unit and >= 50.',
    )
  }
  const amountInt = Math.round(amount)
  const cur = (currency || 'usd').toLowerCase()
  if (!/^[a-z]{3}$/.test(cur)) {
    throw new HttpsError('invalid-argument', 'currency must be ISO 4217 (3-letter).')
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 100) {
    throw new HttpsError('invalid-argument', 'idempotencyKey required.')
  }

  const company = await assertCompanyActive(companyId)

  const stripe = stripeClient()
  const intent = await stripe.paymentIntents.create(
    {
      amount: amountInt,
      currency: cur,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        companyId,
        companyName: company.name ?? '',
        source: 'restaurant_os_kiosk',
        idempotencyKey,
      },
    },
    { idempotencyKey: `kiosk_pi_${companyId}_${idempotencyKey}` },
  )

  return {
    clientSecret: intent.client_secret ?? '',
    paymentIntentId: intent.id,
    amount: amountInt,
    currency: cur,
  }
})

interface CreateOrderInput {
  companyId: string
  branchId: string
  paymentIntentId?: string
  paymentMethod: 'card_reader' | 'tap_to_pay' | 'cash'
  lines: KioskLineInput[]
  tableNumber?: string
  tipAmount?: number
  idempotencyKey: string
}

interface CreateOrderResult {
  orderId: string
  orderNumber: number
  total: number
  alreadyExisted: boolean
}

export const createKioskOrder = onCall<
  CreateOrderInput,
  Promise<CreateOrderResult>
>(async (req) => {
  requireAuth(req)
  const {
    companyId,
    branchId,
    paymentIntentId,
    paymentMethod,
    lines,
    tableNumber,
    tipAmount,
    idempotencyKey,
  } = req.data || ({} as CreateOrderInput)

  const isCash = paymentMethod === 'cash'

  if (!branchId || typeof branchId !== 'string') {
    throw new HttpsError('invalid-argument', 'branchId is required.')
  }
  if (!isCash && (!paymentIntentId || typeof paymentIntentId !== 'string')) {
    throw new HttpsError('invalid-argument', 'paymentIntentId required.')
  }
  if (
    paymentMethod !== 'card_reader' &&
    paymentMethod !== 'tap_to_pay' &&
    paymentMethod !== 'cash'
  ) {
    throw new HttpsError('invalid-argument', 'paymentMethod invalid.')
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new HttpsError('invalid-argument', 'idempotencyKey required.')
  }

  // Everything from here on can throw raw exceptions (Stripe errors, RTDB
  // index errors, etc.). Without this wrapper the v2 functions framework
  // turns them into a generic `INTERNAL` and the kiosk has no way to know
  // _what_ went wrong. Log the full error server-side and surface a
  // descriptive message to the client.
  try {
    const company = await assertCompanyActive(companyId)
    const branchSnap = await db.ref(`companies/${companyId}/branches/${branchId}`).get()
    if (!branchSnap.exists()) {
      throw new HttpsError('not-found', 'Branch not found.')
    }
    const tip = round2(Math.max(0, Number(tipAmount) || 0))

    const dedupeKey = isCash ? idempotencyKey : paymentIntentId
    const existingSnap = await db
      .ref(`orders/${companyId}/${branchId}`)
      .orderByChild(isCash ? 'kioskIdempotencyKey' : 'stripePaymentIntentId')
      .equalTo(dedupeKey as string)
      .limitToFirst(1)
      .get()
    const existing = existingSnap.val() as Record<string, OrderRecord> | null
    if (existing) {
      const [existingId, existingOrder] = Object.entries(existing)[0]
      return {
        orderId: existingId,
        orderNumber: existingOrder.orderNumber,
        total: existingOrder.total,
        alreadyExisted: true,
      }
    }

    const { lines: pricedLines, subtotal } = await priceLines(companyId, branchId, lines)
    const taxComponents = await loadCompanyTaxComponents(
      companyId,
      branchId,
      company.taxRate,
    )
    const { tax, taxLines } = calcTax(subtotal, taxComponents)
    const total = round2(subtotal + tax + tip)
    const totalInCents = Math.round(total * 100)

    if (!isCash) {
      const stripe = stripeClient()
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId as string)

      if (intent.metadata?.companyId && intent.metadata.companyId !== companyId) {
        throw new HttpsError(
          'permission-denied',
          'PaymentIntent does not belong to this company.',
        )
      }
      if (intent.status !== 'succeeded') {
        throw new HttpsError(
          'failed-precondition',
          `PaymentIntent status is ${intent.status}, refusing to create order.`,
        )
      }
      if (intent.amount !== totalInCents) {
        throw new HttpsError(
          'failed-precondition',
          `Amount mismatch: charged ${intent.amount}, order total ${totalInCents}.`,
        )
      }
    }

    const { orderNumber, orderDate, reportPeriodId } = await mintPeriodOrderNumber(
      companyId,
      branchId,
    )

    const node = db.ref(`orders/${companyId}/${branchId}`).push()
    const orderId = node.key as string
    const now = Date.now()

    const itemsSnapshot = pricedLines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemName: l.itemName,
      basePrice: l.basePrice,
      quantity: l.quantity,
      modifiers: l.modifiers,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      ...(l.variantId ? { variantId: l.variantId } : {}),
      ...(l.variantName ? { variantName: l.variantName } : {}),
      ...(l.note ? { note: l.note } : {}),
    }))

    const order: OrderRecord = {
      orderNumber,
      orderDate,
      reportPeriodId,
      companyId,
      branchId,
      items: itemsSnapshot,
      subtotal,
      discount: { type: 'none', value: 0, amount: 0 },
      tax,
      ...(taxLines.length > 0 ? { taxLines } : {}),
      tip,
      total,
      paymentMethod,
      paymentStatus: isCash ? 'pending' : 'paid',
      status: isCash ? 'pending' : 'completed',
      cashReceived: 0,
      change: 0,
      createdBy: req.auth?.uid ?? 'kiosk',
      createdByName: 'Kiosk',
      createdAt: now,
      orderSource: 'kiosk',
      ...(isCash ? { kioskIdempotencyKey: idempotencyKey } : {}),
      ...(isCash ? {} : { stripePaymentIntentId: paymentIntentId }),
      kds: { status: 'queued', queuedAt: now },
      ...(tableNumber ? { tableNumber: String(tableNumber).slice(0, 16) } : {}),
    }

    await node.set(order)

    return {
      orderId,
      orderNumber,
      total,
      alreadyExisted: false,
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    logger.error('[createKioskOrder] unhandled error', {
      companyId,
      paymentIntentId,
      message: msg,
      stack,
    })
    throw new HttpsError('internal', `createKioskOrder failed: ${msg}`)
  }
})

interface GetKioskOrderInput {
  companyId: string
  branchId: string
  orderId: string
}

interface GetKioskOrderResult {
  orderId: string
  orderNumber: number
  total: number
  paymentMethod: 'cash' | 'card_reader' | 'tap_to_pay'
  paymentStatus: 'pending' | 'paid' | 'refunded'
  status: 'pending' | 'completed' | 'cancelled'
  items: unknown[]
  subtotal: number
  tax?: number
  tip?: number
  createdAt: number
}

export const getKioskOrder = onCall<GetKioskOrderInput, Promise<GetKioskOrderResult>>(
  async (req) => {
    requireAuth(req)
    const { companyId, branchId, orderId } = req.data || ({} as GetKioskOrderInput)
    if (!companyId || !branchId || !orderId) {
      throw new HttpsError(
        'invalid-argument',
        'companyId, branchId and orderId are required.',
      )
    }

    await assertCompanyActive(companyId)

    const snap = await db.ref(`orders/${companyId}/${branchId}/${orderId}`).get()
    const order = snap.val() as OrderRecord | null
    if (!order) {
      throw new HttpsError('not-found', 'Order not found.')
    }

    return {
      orderId,
      orderNumber: order.orderNumber,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      tax: order.tax,
      tip: order.tip,
      createdAt: order.createdAt,
    }
  },
)

interface RefundOrderInput {
  companyId: string
  branchId: string
  orderId: string
}

interface RefundOrderResult {
  ok: true
  alreadyRefunded: boolean
  stripeRefundId?: string
}

export const refundOrder = onCall<RefundOrderInput, Promise<RefundOrderResult>>(
  async (req) => {
    const { companyId, branchId, orderId } = req.data || ({} as RefundOrderInput)
    if (!companyId || typeof companyId !== 'string') {
      throw new HttpsError('invalid-argument', 'companyId is required.')
    }
    if (!branchId || typeof branchId !== 'string') {
      throw new HttpsError('invalid-argument', 'branchId is required.')
    }
    if (!orderId || typeof orderId !== 'string') {
      throw new HttpsError('invalid-argument', 'orderId is required.')
    }

    const uid = requireCompanyAdmin(req, companyId)
    await assertCompanyActive(companyId)

    const orderRef = db.ref(`orders/${companyId}/${branchId}/${orderId}`)
    const snap = await orderRef.get()
    const order = snap.val() as OrderRecord | null
    if (!order) {
      throw new HttpsError('not-found', 'Order not found.')
    }

    if (order.paymentStatus === 'refunded' || order.status === 'cancelled') {
      return {
        ok: true as const,
        alreadyRefunded: true,
        ...(order.stripeRefundId ? { stripeRefundId: order.stripeRefundId } : {}),
      }
    }

    if (order.status !== 'completed' || order.paymentStatus !== 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'Only completed paid orders can be refunded.',
      )
    }

    const isCard =
      order.paymentMethod === 'card_reader' || order.paymentMethod === 'tap_to_pay'

    let stripeRefundId: string | undefined
    if (isCard) {
      if (!order.stripePaymentIntentId) {
        throw new HttpsError(
          'failed-precondition',
          'Card order is missing stripePaymentIntentId.',
        )
      }
      try {
        const stripe = stripeClient()
        const refund = await stripe.refunds.create(
          { payment_intent: order.stripePaymentIntentId },
          { idempotencyKey: `refund_${companyId}_${orderId}` },
        )
        stripeRefundId = refund.id
      } catch (err) {
        if (err instanceof HttpsError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('[refundOrder] Stripe refund failed', {
          companyId,
          orderId,
          paymentIntentId: order.stripePaymentIntentId,
          message: msg,
        })
        throw new HttpsError('internal', `Stripe refund failed: ${msg}`)
      }
    }

    const userSnap = await db.ref(`users/${uid}`).get()
    const user = userSnap.val() as { name?: string } | null
    const refundedByName = user?.name || 'Admin'
    const now = Date.now()

    const patch: Record<string, unknown> = {
      status: 'cancelled',
      paymentStatus: 'refunded',
      refundedAt: now,
      refundedBy: uid,
      refundedByName,
    }
    if (stripeRefundId) patch.stripeRefundId = stripeRefundId

    await orderRef.update(patch)

    return {
      ok: true as const,
      alreadyRefunded: false,
      ...(stripeRefundId ? { stripeRefundId } : {}),
    }
  },
)

interface OrderRecord {
  orderNumber: number
  /** UTC calendar day (YYYY-MM-DD) the orderNumber was minted for. */
  orderDate?: string
  reportPeriodId?: string
  companyId: string
  branchId: string
  items: unknown[]
  subtotal: number
  discount: { type: 'none' | 'flat' | 'percent'; value: number; amount: number }
  tax?: number
  taxLines?: OrderTaxLine[]
  tip?: number
  total: number
  paymentMethod: 'cash' | 'card_reader' | 'tap_to_pay'
  paymentStatus: 'pending' | 'paid' | 'refunded'
  status: 'pending' | 'completed' | 'cancelled'
  cashReceived?: number
  change?: number
  createdBy: string
  createdByName: string
  createdAt: number
  completedAt?: number
  tableNumber?: string
  orderSource?: 'pos' | 'kiosk'
  stripePaymentIntentId?: string
  kioskIdempotencyKey?: string
  refundedAt?: number
  refundedBy?: string
  refundedByName?: string
  stripeRefundId?: string
  kds?: { status: 'queued' | 'in_progress' | 'ready' | 'served'; queuedAt: number }
}
