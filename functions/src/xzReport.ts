export type PaymentMethod = 'cash' | 'card_reader' | 'tap_to_pay'

export interface OrderLike {
  reportPeriodId?: string
  createdAt: number
  paymentStatus?: string
  status?: string
  paymentMethod?: PaymentMethod | string
  subtotal?: number
  discount?: { amount?: number }
  tax?: number
  tip?: number
  total?: number
  cashReceived?: number
  change?: number
}

export interface CashMovementLike {
  type?: 'pay_in' | 'pay_out' | string
  amount?: number
}

export interface XzPaymentBreakdown {
  cash: number
  card_reader: number
  tap_to_pay: number
}

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
  cashSales: number
  cashRefundTotal: number
  refundCount: number
  refundTotal: number
  openingFloat: number
  payInTotal: number
  payOutTotal: number
  expectedCash: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const emptyBreakdown = (): XzPaymentBreakdown => ({
  cash: 0,
  card_reader: 0,
  tap_to_pay: 0,
})

export const isRevenueOrder = (o: OrderLike): boolean =>
  o.paymentStatus === 'paid' && o.status === 'completed'

export const isRefundedOrder = (o: OrderLike): boolean =>
  o.paymentStatus === 'refunded'

export const filterOrdersForPeriod = (
  orders: OrderLike[],
  periodId: string,
  openedAt: number,
): OrderLike[] =>
  orders.filter((o) => {
    if (o.reportPeriodId) return o.reportPeriodId === periodId
    return o.createdAt >= openedAt
  })

export const sumMovements = (
  movements: CashMovementLike[],
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
  orders: OrderLike[],
  opts?: {
    openingFloat?: number
    movements?: CashMovementLike[]
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
    if (method === 'cash' || method === 'card_reader' || method === 'tap_to_pay') {
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
