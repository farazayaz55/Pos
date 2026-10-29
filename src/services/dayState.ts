import {
  ref,
  get,
  onValue,
  push,
  set,
  runTransaction,
  query,
  orderByChild,
} from 'firebase/database'
import { db } from '@/lib/firebase'
import { businessDateUtc } from '@/utils/businessDate'
import { makePeriodId } from '@/utils/xzReport'
import { closeBusinessDay as closeBusinessDayCallable } from '@/services/functionsApi'
import { saveDayStateCache, getDayStateCache } from '@/localdb/db'
import { round2 } from '@/utils/currency'
import type { CashMovement, CashMovementType, DayState, ZReport } from '@/types'

export const DAY_NOT_OPEN_MESSAGE =
  'Open the shift and enter opening float before taking orders.'

const dayStateRef = (companyId: string, branchId: string) =>
  ref(db, `dayState/${companyId}/${branchId}`)

const zReportsRef = (companyId: string, branchId: string) =>
  ref(db, `zReports/${companyId}/${branchId}`)

const zReportRef = (companyId: string, branchId: string, periodId: string) =>
  ref(db, `zReports/${companyId}/${branchId}/${periodId}`)

const movementsRef = (companyId: string, branchId: string, periodId: string) =>
  ref(db, `cashMovements/${companyId}/${branchId}/${periodId}`)

const recordToArray = <T extends { id: string }>(
  val: Record<string, Omit<T, 'id'>> | null,
): T[] => {
  if (!val) return []
  return Object.entries(val).map(([id, v]) => ({ id, ...v }) as T)
}

export const isDayOpen = (state: DayState | null | undefined): state is DayState =>
  !!state &&
  state.status === 'open' &&
  !!state.periodId &&
  typeof state.openingFloat === 'number'

export const getDayState = async (
  companyId: string,
  branchId: string,
): Promise<DayState | null> => {
  const snap = await get(dayStateRef(companyId, branchId))
  return (snap.val() as DayState | null) ?? null
}

export const subscribeDayState = (
  companyId: string,
  branchId: string,
  cb: (state: DayState | null) => void,
) => {
  return onValue(dayStateRef(companyId, branchId), (snap) => {
    const state = (snap.val() as DayState | null) ?? null
    if (isDayOpen(state)) {
      void saveDayStateCache(companyId, branchId, state)
    }
    cb(state)
  })
}

/** Require an already-open reporting period (hard gate — does not auto-open). */
export const requireOpenDayState = async (
  companyId: string,
  branchId: string,
): Promise<DayState> => {
  const state = await getDayState(companyId, branchId)
  if (!isDayOpen(state)) {
    throw new Error(DAY_NOT_OPEN_MESSAGE)
  }
  await saveDayStateCache(companyId, branchId, state)
  return state
}

/** Offline: use cached open day only — never invent a new period. */
export const requireCachedOpenDayState = async (
  companyId: string,
  branchId: string,
): Promise<DayState> => {
  const cached = await getDayStateCache(companyId, branchId)
  if (!isDayOpen(cached)) {
    throw new Error(DAY_NOT_OPEN_MESSAGE)
  }
  return cached
}

export interface OpenBusinessDayInput {
  companyId: string
  branchId: string
  openingFloat: number
  openedBy: string
  openedByName: string
}

export const openBusinessDay = async (
  input: OpenBusinessDayInput,
): Promise<DayState> => {
  const { companyId, branchId, openedBy, openedByName } = input
  const openingFloat = round2(Number(input.openingFloat) || 0)
  if (openingFloat < 0) {
    throw new Error('Opening float cannot be negative')
  }

  const result = await runTransaction(dayStateRef(companyId, branchId), (current) => {
    const cur = current as DayState | null
    // Treat missing float as not properly open (legacy auto-open periods).
    if (cur && cur.status === 'open' && cur.periodId && typeof cur.openingFloat === 'number') {
      return cur
    }
    const now = Date.now()
    const businessDate = businessDateUtc(now)
    const next: DayState = {
      periodId: makePeriodId(businessDate, now),
      businessDate,
      openedAt: now,
      status: 'open',
      openingFloat,
      openedBy,
      openedByName,
    }
    return next
  })

  if (!result.committed) {
    throw new Error('Failed to open business day')
  }
  const val = result.snapshot.val() as DayState | null
  if (!isDayOpen(val)) {
    throw new Error('Failed to open business day')
  }

  await saveDayStateCache(companyId, branchId, val)
  return val
}

export interface AddCashMovementInput {
  companyId: string
  branchId: string
  type: CashMovementType
  amount: number
  reason: string
  createdBy: string
  createdByName: string
}

export const addCashMovement = async (
  input: AddCashMovementInput,
): Promise<CashMovement> => {
  const dayState = await requireOpenDayState(input.companyId, input.branchId)
  const amount = round2(Number(input.amount) || 0)
  if (!(amount > 0)) {
    throw new Error('Amount must be greater than zero')
  }
  const reason = input.reason.trim()
  if (!reason) {
    throw new Error('Reason is required')
  }

  const listRef = movementsRef(input.companyId, input.branchId, dayState.periodId)
  const newRef = push(listRef)
  const movement: Omit<CashMovement, 'id'> = {
    periodId: dayState.periodId,
    type: input.type,
    amount,
    reason,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: Date.now(),
  }
  await set(newRef, movement)
  return { id: newRef.key!, ...movement }
}

export const subscribeCashMovements = (
  companyId: string,
  branchId: string,
  periodId: string,
  cb: (movements: CashMovement[]) => void,
) => {
  const q = query(movementsRef(companyId, branchId, periodId), orderByChild('createdAt'))
  return onValue(q, (snap) => {
    const list = recordToArray<CashMovement>(snap.val())
    list.sort((a, b) => a.createdAt - b.createdAt)
    cb(list)
  })
}

export const getCashMovements = async (
  companyId: string,
  branchId: string,
  periodId: string,
): Promise<CashMovement[]> => {
  const snap = await get(movementsRef(companyId, branchId, periodId))
  const list = recordToArray<CashMovement>(snap.val())
  list.sort((a, b) => a.createdAt - b.createdAt)
  return list
}

export const subscribeZReports = (
  companyId: string,
  branchId: string,
  cb: (reports: ZReport[]) => void,
) => {
  const q = query(zReportsRef(companyId, branchId), orderByChild('closedAt'))
  return onValue(q, (snap) => {
    const list = recordToArray<ZReport>(snap.val())
    list.sort((a, b) => b.closedAt - a.closedAt)
    cb(list)
  })
}

export const getZReport = async (
  companyId: string,
  branchId: string,
  periodId: string,
): Promise<ZReport | null> => {
  const snap = await get(zReportRef(companyId, branchId, periodId))
  const val = snap.val() as Omit<ZReport, 'id'> | null
  return val ? { id: periodId, ...val } : null
}

export interface CloseBusinessDayResult {
  report: ZReport
  dayState: DayState
}

export const closeBusinessDay = async (
  companyId: string,
  branchId: string,
  actualCash: number,
): Promise<CloseBusinessDayResult> => {
  const result = await closeBusinessDayCallable({
    companyId,
    branchId,
    actualCash: round2(Number(actualCash) || 0),
  })
  const data = result.data
  if (data.dayState) {
    await saveDayStateCache(companyId, branchId, data.dayState)
  }
  return data
}
