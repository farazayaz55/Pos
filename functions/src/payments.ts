/**
 * Stripe Terminal payments + kiosk order creation.
 *
 * Three callable HTTPS Cloud Functions:
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
 *    charged?"), runs the existing /counters/{companyId}/orderSeq
 *    transaction to mint the human-friendly order number, and writes the
 *    /orders/{companyId}/{orderId} record using the Admin SDK (which
 *    bypasses RTDB rules — kiosk anonymous auth is intentionally NOT
 *    allowed to write orders directly).
 *
 *  Idempotency: callers MUST send an idempotencyKey. Both createKioskPaymentIntent
 *  and createKioskOrder are idempotent on (paymentIntentId or idempotencyKey)
 *  so a flaky network never produces a double charge or a duplicate order.
 */

import {
  onCall,
  HttpsError,
  type CallableRequest,
} from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import Stripe from 'stripe'

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

interface MenuItemDoc {
  id?: string
  companyId?: string
  categoryId: string
  name: string
  basePrice: number
  available?: boolean
  modifierGroupIds?: string[]
}

interface KioskModifierInput {
  groupId: string
  optionId: string
}

interface KioskLineInput {
  itemId: string
  quantity: number
  modifiers?: KioskModifierInput[]
  note?: string
}

interface PricedLine {
  lineId: string
  itemId: string
  itemName: string
  basePrice: number
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

const sanitizeQty = (q: unknown): number => {
  const n = Math.floor(Number(q))
  if (!Number.isFinite(n) || n < 1 || n > 99) {
    throw new HttpsError('invalid-argument', 'Invalid line quantity.')
  }
  return n
}

const priceLines = async (
  companyId: string,
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
    db.ref(`menu/${companyId}/items`).get(),
    db.ref(`menu/${companyId}/modifierGroups`).get(),
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

    const basePrice = Number(item.basePrice) || 0
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
      basePrice,
      quantity: qty,
      modifiers: pricedMods,
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
    paymentIntentId,
    paymentMethod,
    lines,
    tableNumber,
    tipAmount,
    idempotencyKey,
  } = req.data || ({} as CreateOrderInput)

  const isCash = paymentMethod === 'cash'

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
    const taxRate = Number(company.taxRate) > 0 ? Number(company.taxRate) : 0
    const tip = round2(Math.max(0, Number(tipAmount) || 0))

    const dedupeKey = isCash ? idempotencyKey : paymentIntentId
    const existingSnap = await db
      .ref(`orders/${companyId}`)
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

    const { lines: pricedLines, subtotal } = await priceLines(companyId, lines)
    const tax = round2(subtotal * taxRate)
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

    const counterRef = db.ref(`counters/${companyId}/orderSeq`)
    const txn = await counterRef.transaction((current) => (current ?? 0) + 1)
    if (!txn.committed) {
      throw new HttpsError('aborted', 'Failed to mint order number.')
    }
    const orderNumber = Number(txn.snapshot.val()) || 1

    const node = db.ref(`orders/${companyId}`).push()
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
      ...(l.note ? { note: l.note } : {}),
    }))

    const order: OrderRecord = {
      orderNumber,
      companyId,
      items: itemsSnapshot,
      subtotal,
      discount: { type: 'none', value: 0, amount: 0 },
      tax,
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

interface OrderRecord {
  orderNumber: number
  companyId: string
  items: unknown[]
  subtotal: number
  discount: { type: 'none' | 'flat' | 'percent'; value: number; amount: number }
  tax?: number
  tip?: number
  total: number
  paymentMethod: 'cash' | 'card_reader' | 'tap_to_pay'
  paymentStatus: 'pending' | 'paid'
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
  kds?: { status: 'queued' | 'in_progress' | 'ready' | 'served'; queuedAt: number }
}
