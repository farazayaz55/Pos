import type {
  CashMovement,
  DayState,
  Order,
  PaymentMethod,
  XzPaymentBreakdown,
  XzReportSummary,
  ZPeriodSummary,
  ZReport,
} from '@/types'
import { businessDateUtc } from '@/utils/businessDate'
import { round2 } from '@/utils/currency'

const emptyBreakdown = (): XzPaymentBreakdown => ({
  cash: 0,
  card_reader: 0,
  tap_to_pay: 0,
})

export const isRevenueOrder = (o: Order): boolean =>
  o.paymentStatus === 'paid' && o.status === 'completed'

export const isRefundedOrder = (o: Order): boolean =>
  o.paymentStatus === 'refunded'

/** Orders belonging to the current open reporting period. */
export const filterOrdersForPeriod = (
  orders: Order[],
  dayState: DayState | null | undefined,
): Order[] => {
  if (!dayState?.periodId) return []
  const { periodId, openedAt } = dayState
  return orders.filter((o) => {
    if (o.reportPeriodId) return o.reportPeriodId === periodId
    // Legacy orders without reportPeriodId: include if created during this period.
    return o.createdAt >= openedAt
  })
}

export const sumMovements = (
  movements: CashMovement[],
): { payInTotal: number; payOutTotal: number } => {
  let payInTotal = 0
  let payOutTotal = 0
  for (const m of movements) {
    if (m.type === 'pay_in') payInTotal += m.amount || 0
    else if (m.type === 'pay_out') payOutTotal += m.amount || 0
  }
  return {
    payInTotal: round2(payInTotal),
    payOutTotal: round2(payOutTotal),
  }
}

/**
 * Expected drawer cash:
 * openingFloat + cashSales − cashRefunds + payIns − payOuts
 */
export const calcExpectedCash = (input: {
  openingFloat: number
  cashSales: number
  cashRefundTotal: number
  payInTotal: number
  payOutTotal: number
}): number =>
  round2(
    (input.openingFloat || 0) +
      (input.cashSales || 0) -
      (input.cashRefundTotal || 0) +
      (input.payInTotal || 0) -
      (input.payOutTotal || 0),
  )

export const buildXzReportSummary = (
  orders: Order[],
  opts?: {
    openingFloat?: number
    movements?: CashMovement[]
  },
): XzReportSummary => {
  const revenue = orders.filter(isRevenueOrder)
  const refunds = orders.filter(isRefundedOrder)
  const openingFloat = opts?.openingFloat ?? 0
  const { payInTotal, payOutTotal } = sumMovements(opts?.movements ?? [])

  const byPaymentMethod = emptyBreakdown()
  let subtotal = 0
  let discount = 0
  let tax = 0
  let tip = 0
  let total = 0
  let cashReceived = 0
  let changeGiven = 0
  let cashSales = 0

  for (const o of revenue) {
    subtotal += o.subtotal || 0
    discount += o.discount?.amount || 0
    tax += o.tax || 0
    tip += o.tip || 0
    total += o.total || 0
    const method = o.paymentMethod as PaymentMethod
    if (method in byPaymentMethod) {
      byPaymentMethod[method] = round2(byPaymentMethod[method] + (o.total || 0))
    }
    if (o.paymentMethod === 'cash') {
      cashReceived += o.cashReceived || 0
      changeGiven += o.change || 0
      cashSales += o.total || 0
    }
  }

  let refundTotal = 0
  let cashRefundTotal = 0
  for (const o of refunds) {
    refundTotal += o.total || 0
    if (o.paymentMethod === 'cash') {
      cashRefundTotal += o.total || 0
    }
  }

  const orderCount = revenue.length
  const grossSales = round2(total)
  const cashSalesR = round2(cashSales)
  const cashRefundR = round2(cashRefundTotal)
  const expectedCash = calcExpectedCash({
    openingFloat,
    cashSales: cashSalesR,
    cashRefundTotal: cashRefundR,
    payInTotal,
    payOutTotal,
  })

  return {
    orderCount,
    grossSales,
    avgTicket: orderCount ? round2(grossSales / orderCount) : 0,
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    tip: round2(tip),
    total: grossSales,
    byPaymentMethod,
    cashReceived: round2(cashReceived),
    changeGiven: round2(changeGiven),
    cashSales: cashSalesR,
    cashRefundTotal: cashRefundR,
    refundCount: refunds.length,
    refundTotal: round2(refundTotal),
    openingFloat: round2(openingFloat),
    payInTotal,
    payOutTotal,
    expectedCash,
  }
}

export const makePeriodId = (businessDate: string, openedAt: number): string =>
  `${businessDate}-${openedAt}`

/** Inclusive YYYY-MM-DD range; omit from/to for an open end. */
export const filterZReportsByDateRange = (
  reports: ZReport[],
  fromBusinessDate?: string | null,
  toBusinessDate?: string | null,
): ZReport[] =>
  reports.filter((r) => {
    if (fromBusinessDate && r.businessDate < fromBusinessDate) return false
    if (toBusinessDate && r.businessDate > toBusinessDate) return false
    return true
  })

/** UTC calendar date N days before `now` (inclusive window helper). */
export const businessDateDaysAgo = (
  days: number,
  now: number = Date.now(),
): string => {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - days)
  return businessDateUtc(d.getTime())
}

export const aggregateZReports = (reports: ZReport[]): ZPeriodSummary => {
  const byPaymentMethod = emptyBreakdown()
  let orderCount = 0
  let grossSales = 0
  let subtotal = 0
  let discount = 0
  let tax = 0
  let tip = 0
  let cashReceived = 0
  let changeGiven = 0
  let cashSales = 0
  let cashRefundTotal = 0
  let refundCount = 0
  let refundTotal = 0
  let openingFloat = 0
  let payInTotal = 0
  let payOutTotal = 0
  let expectedCash = 0
  let actualCash = 0
  let cashVariance = 0
  let fromBusinessDate: string | null = null
  let toBusinessDate: string | null = null

  for (const r of reports) {
    orderCount += r.orderCount || 0
    grossSales += r.grossSales || 0
    subtotal += r.subtotal || 0
    discount += r.discount || 0
    tax += r.tax || 0
    tip += r.tip || 0
    cashReceived += r.cashReceived || 0
    changeGiven += r.changeGiven || 0
    cashSales += r.cashSales || 0
    cashRefundTotal += r.cashRefundTotal || 0
    refundCount += r.refundCount || 0
    refundTotal += r.refundTotal || 0
    openingFloat += r.openingFloat || 0
    payInTotal += r.payInTotal || 0
    payOutTotal += r.payOutTotal || 0
    expectedCash += r.expectedCash || 0
    actualCash += r.actualCash || 0
    cashVariance += r.cashVariance || 0
    byPaymentMethod.cash = round2(
      byPaymentMethod.cash + (r.byPaymentMethod?.cash || 0),
    )
    byPaymentMethod.card_reader = round2(
      byPaymentMethod.card_reader + (r.byPaymentMethod?.card_reader || 0),
    )
    byPaymentMethod.tap_to_pay = round2(
      byPaymentMethod.tap_to_pay + (r.byPaymentMethod?.tap_to_pay || 0),
    )
    if (!fromBusinessDate || r.businessDate < fromBusinessDate) {
      fromBusinessDate = r.businessDate
    }
    if (!toBusinessDate || r.businessDate > toBusinessDate) {
      toBusinessDate = r.businessDate
    }
  }

  const gross = round2(grossSales)
  return {
    periodCount: reports.length,
    fromBusinessDate,
    toBusinessDate,
    orderCount,
    grossSales: gross,
    avgTicket: orderCount ? round2(gross / orderCount) : 0,
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    tip: round2(tip),
    total: gross,
    byPaymentMethod,
    cashReceived: round2(cashReceived),
    changeGiven: round2(changeGiven),
    cashSales: round2(cashSales),
    cashRefundTotal: round2(cashRefundTotal),
    refundCount,
    refundTotal: round2(refundTotal),
    openingFloat: round2(openingFloat),
    payInTotal: round2(payInTotal),
    payOutTotal: round2(payOutTotal),
    expectedCash: round2(expectedCash),
    actualCash: round2(actualCash),
    cashVariance: round2(cashVariance),
  }
}
