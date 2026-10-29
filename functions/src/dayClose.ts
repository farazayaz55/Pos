import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import {
  buildXzReportSummary,
  filterOrdersForPeriod,
  type OrderLike,
  type CashMovementLike,
} from './xzReport'

const db = admin.database()

interface StaffPermissions {
  pos: boolean
  menu: boolean
  orders: boolean
  settings: boolean
  receipt: boolean
  team: boolean
  reports: boolean
}

interface RtdbUser {
  role?: string
  companyId?: string
  branchId?: string
  permissions?: StaffPermissions
  active?: boolean
  name?: string
  email?: string
}

interface DayState {
  periodId: string
  businessDate: string
  openedAt: number
  status: 'open' | 'closed'
  openingFloat: number
  openedBy?: string
  openedByName?: string
  closedAt?: number
  closedBy?: string
  closedByName?: string
}

interface ZReport {
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
  orderCount: number
  grossSales: number
  avgTicket: number
  subtotal: number
  discount: number
  tax: number
  tip: number
  total: number
  byPaymentMethod: {
    cash: number
    card_reader: number
    tap_to_pay: number
  }
  cashReceived: number
  changeGiven: number
  cashSales: number
  cashRefundTotal: number
  refundCount: number
  refundTotal: number
  openingFloat: number
  payInTotal: number
  payOutTotal: number
  expectedCash: number
  actualCash: number
  cashVariance: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const normalizePermissions = (input: unknown): StaffPermissions => {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    pos: !!src.pos,
    menu: !!src.menu,
    orders: !!src.orders,
    settings: !!src.settings,
    receipt: !!src.receipt,
    team: !!src.team,
    reports: !!src.reports,
  }
}

const requireCloseAccess = async (
  req: CallableRequest<unknown>,
  companyId: string,
  branchId: string,
): Promise<{ uid: string; name: string }> => {
  const uid = req.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required.')
  }
  if (!companyId || !branchId) {
    throw new HttpsError('invalid-argument', 'companyId and branchId are required.')
  }

  const snap = await db.ref(`users/${uid}`).get()
  const data = snap.val() as RtdbUser | null
  if (!data?.role) {
    throw new HttpsError('permission-denied', 'No role assigned.')
  }

  if (data.role === 'super_admin') {
    return { uid, name: data.name || 'Super Admin' }
  }

  if (data.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Company access required.')
  }

  if (data.role === 'admin') {
    return { uid, name: data.name || 'Admin' }
  }

  if (data.role === 'staff') {
    if (data.active === false) {
      throw new HttpsError('permission-denied', 'Account is inactive.')
    }
    const perms = normalizePermissions(data.permissions)
    if (!perms.reports && !perms.pos) {
      throw new HttpsError('permission-denied', 'POS or Reports permission required.')
    }
    if (data.branchId && data.branchId !== branchId) {
      throw new HttpsError('permission-denied', 'Branch access required.')
    }
    return { uid, name: data.name || 'Staff' }
  }

  throw new HttpsError('permission-denied', 'Close-day access required.')
}

const requireOpenDayStateAdmin = async (
  companyId: string,
  branchId: string,
): Promise<DayState> => {
  const snap = await db.ref(`dayState/${companyId}/${branchId}`).get()
  const current = snap.val() as DayState | null
  if (!current || current.status !== 'open' || !current.periodId) {
    throw new HttpsError(
      'failed-precondition',
      'No open shift. Enter opening float on the POS before closing.',
    )
  }
  if (typeof current.openingFloat !== 'number') {
    throw new HttpsError(
      'failed-precondition',
      'Open shift is missing opening float. Re-open the shift.',
    )
  }
  return current
}

interface CloseBusinessDayInput {
  companyId: string
  branchId: string
  actualCash: number
}

interface CloseBusinessDayResult {
  report: ZReport
  dayState: DayState
}

export const closeBusinessDay = onCall<
  CloseBusinessDayInput,
  Promise<CloseBusinessDayResult>
>(async (req) => {
  const { companyId, branchId } = req.data || ({} as CloseBusinessDayInput)
  const actualCash = round2(Number(req.data?.actualCash) || 0)
  if (!Number.isFinite(actualCash) || actualCash < 0) {
    throw new HttpsError('invalid-argument', 'actualCash must be a non-negative number.')
  }

  const caller = await requireCloseAccess(req, companyId, branchId)

  const branchSnap = await db.ref(`companies/${companyId}/branches/${branchId}`).get()
  if (!branchSnap.exists()) {
    throw new HttpsError('not-found', 'Branch not found.')
  }

  const dayState = await requireOpenDayStateAdmin(companyId, branchId)
  const periodId = dayState.periodId

  const existingSnap = await db.ref(`zReports/${companyId}/${branchId}/${periodId}`).get()
  if (existingSnap.exists()) {
    throw new HttpsError('failed-precondition', 'This period is already closed.')
  }

  const [ordersSnap, movementsSnap] = await Promise.all([
    db.ref(`orders/${companyId}/${branchId}`).get(),
    db.ref(`cashMovements/${companyId}/${branchId}/${periodId}`).get(),
  ])

  const ordersRaw = ordersSnap.val() as Record<string, OrderLike> | null
  const orders: OrderLike[] = ordersRaw ? Object.values(ordersRaw) : []

  const movementsRaw = movementsSnap.val() as Record<string, CashMovementLike> | null
  const movements: CashMovementLike[] = movementsRaw ? Object.values(movementsRaw) : []

  const periodOrders = filterOrdersForPeriod(orders, periodId, dayState.openedAt)
  const summary = buildXzReportSummary(periodOrders, {
    openingFloat: dayState.openingFloat,
    movements,
  })
  const closedAt = Date.now()
  const cashVariance = round2(actualCash - summary.expectedCash)

  const report: ZReport = {
    id: periodId,
    companyId,
    branchId,
    periodId,
    businessDate: dayState.businessDate,
    openedAt: dayState.openedAt,
    closedAt,
    closedBy: caller.uid,
    closedByName: caller.name,
    reportType: 'z',
    ...summary,
    actualCash,
    cashVariance,
  }

  const closedDayState: DayState = {
    ...dayState,
    status: 'closed',
    closedAt,
    closedBy: caller.uid,
    closedByName: caller.name,
  }

  // Persist Z first so a failed dayState update can still block re-close.
  await db.ref(`zReports/${companyId}/${branchId}/${periodId}`).set(report)
  await db.ref(`dayState/${companyId}/${branchId}`).set(closedDayState)
  await db.ref(`counters/${companyId}/${branchId}/dailyOrderSeq/${periodId}`).set(null)

  return { report, dayState: closedDayState }
})

/**
 * Mint order number for an already-open period.
 * Does not auto-open — POS/kiosk must open float first.
 */
export async function mintPeriodOrderNumber(
  companyId: string,
  branchId: string,
): Promise<{ orderNumber: number; orderDate: string; reportPeriodId: string }> {
  const dayState = await requireOpenDayStateAdmin(companyId, branchId)
  const counterRef = db.ref(
    `counters/${companyId}/${branchId}/dailyOrderSeq/${dayState.periodId}`,
  )
  const txn = await counterRef.transaction((current: number | null) => (current ?? 0) + 1)
  if (!txn.committed) {
    throw new HttpsError('aborted', 'Failed to mint order number.')
  }
  return {
    orderNumber: Number(txn.snapshot.val()) || 1,
    orderDate: dayState.businessDate,
    reportPeriodId: dayState.periodId,
  }
}
