import type { DayState, XzReportSummary, ZPeriodSummary, ZReport } from '@/types'
import { formatMoney } from '@/utils/currency'
import {
  RECEIPT_CHARS,
  centerLine,
  padLine,
  type ReceiptCompanyInfo,
} from '@/utils/receiptText'

const divider = (width = RECEIPT_CHARS) => '-'.repeat(width)

const formatDateTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

type CashCountExtras = {
  actualCash?: number
  cashVariance?: number
}

const formatSummaryBody = (
  summary: XzReportSummary,
  cash?: CashCountExtras,
  opts?: { periodTotals?: boolean },
): string[] => {
  const lines: string[] = [
    padLine('Orders', String(summary.orderCount)),
    padLine('Gross sales', formatMoney(summary.grossSales)),
    padLine('Avg / order', formatMoney(summary.avgTicket)),
    divider(),
    padLine('Subtotal', formatMoney(summary.subtotal)),
    padLine('Discounts', formatMoney(summary.discount)),
    padLine('Tax', formatMoney(summary.tax)),
    padLine('Tips', formatMoney(summary.tip)),
    padLine('TOTAL', formatMoney(summary.total)),
    divider(),
    centerLine('By payment'),
    padLine('Cash', formatMoney(summary.byPaymentMethod.cash)),
    padLine('Card reader', formatMoney(summary.byPaymentMethod.card_reader)),
    padLine('Tap to pay', formatMoney(summary.byPaymentMethod.tap_to_pay)),
    divider(),
    padLine('Cash tendered', formatMoney(summary.cashReceived)),
    padLine('Change given', formatMoney(summary.changeGiven)),
    padLine('Cash sales', formatMoney(summary.cashSales ?? 0)),
    padLine('Cash refunds', formatMoney(summary.cashRefundTotal ?? 0)),
    padLine('Refunds', `${summary.refundCount}`),
    padLine('Refund total', formatMoney(summary.refundTotal)),
    divider(),
    centerLine(
      opts?.periodTotals ? 'Cash drawer (period totals)' : 'Cash drawer',
    ),
    padLine('Opening float', formatMoney(summary.openingFloat ?? 0)),
    padLine('Pay-ins', formatMoney(summary.payInTotal ?? 0)),
    padLine('Pay-outs', formatMoney(summary.payOutTotal ?? 0)),
    padLine('Expected cash', formatMoney(summary.expectedCash ?? 0)),
  ]
  if (cash && typeof cash.actualCash === 'number') {
    lines.push(padLine('Actual cash', formatMoney(cash.actualCash)))
    const v = cash.cashVariance ?? 0
    const label =
      v === 0 ? 'Variance' : v > 0 ? 'Overage' : 'Shortage'
    lines.push(padLine(label, formatMoney(Math.abs(v))))
  }
  return lines
}

export type XReportPrintInput = {
  kind: 'x'
  company?: ReceiptCompanyInfo
  branchName?: string
  dayState: DayState
  summary: XzReportSummary
  printedAt?: number
  printedByName?: string
}

export type ZReportPrintInput = {
  kind: 'z'
  company?: ReceiptCompanyInfo
  branchName?: string
  report: ZReport
}

export type ZPeriodReportPrintInput = {
  kind: 'z_period'
  company?: ReceiptCompanyInfo
  branchName?: string
  summary: ZPeriodSummary
  /** Preset window bounds (may be wider than dates with data). */
  rangeFrom?: string | null
  rangeTo?: string | null
  printedAt?: number
  printedByName?: string
}

export type XzReportPrintInput =
  | XReportPrintInput
  | ZReportPrintInput
  | ZPeriodReportPrintInput

const titleFor = (kind: XzReportPrintInput['kind']): string => {
  if (kind === 'x') return 'X REPORT'
  if (kind === 'z_period') return 'Z PERIOD SUMMARY'
  return 'Z REPORT'
}

const endLabelFor = (kind: XzReportPrintInput['kind']): string => {
  if (kind === 'x') return 'End of X Report'
  if (kind === 'z_period') return 'End of Z Period Summary'
  return 'End of Z Report'
}

export const formatXzReportPlainText = (input: XzReportPrintInput): string => {
  const lines: string[] = []
  lines.push(centerLine(titleFor(input.kind)))
  if (input.company?.name) lines.push(centerLine(input.company.name))
  if (input.branchName) lines.push(centerLine(input.branchName))
  lines.push(divider())

  if (input.kind === 'x') {
    const { dayState, summary, printedAt = Date.now(), printedByName } = input
    lines.push(padLine('Business date', dayState.businessDate))
    lines.push(padLine('Period opened', formatDateTime(dayState.openedAt)))
    lines.push(padLine('Printed', formatDateTime(printedAt)))
    if (printedByName) lines.push(padLine('By', printedByName))
    lines.push(centerLine('(read-only — day stays open)'))
    lines.push(divider())
    lines.push(...formatSummaryBody(summary))
  } else if (input.kind === 'z_period') {
    const {
      summary,
      rangeFrom,
      rangeTo,
      printedAt = Date.now(),
      printedByName,
    } = input
    const from =
      rangeFrom || summary.fromBusinessDate || '—'
    const to = rangeTo || summary.toBusinessDate || '—'
    lines.push(padLine('From', from))
    lines.push(padLine('To', to))
    lines.push(padLine('Z reports', String(summary.periodCount)))
    if (summary.fromBusinessDate && summary.toBusinessDate) {
      lines.push(
        padLine(
          'Data span',
          `${summary.fromBusinessDate} – ${summary.toBusinessDate}`,
        ),
      )
    }
    lines.push(padLine('Printed', formatDateTime(printedAt)))
    if (printedByName) lines.push(padLine('By', printedByName))
    lines.push(centerLine('(sum of closed Z reports)'))
    lines.push(divider())
    lines.push(
      ...formatSummaryBody(
        summary,
        {
          actualCash: summary.actualCash,
          cashVariance: summary.cashVariance,
        },
        { periodTotals: true },
      ),
    )
  } else {
    const { report } = input
    lines.push(padLine('Business date', report.businessDate))
    lines.push(padLine('Period opened', formatDateTime(report.openedAt)))
    lines.push(padLine('Closed', formatDateTime(report.closedAt)))
    lines.push(padLine('Closed by', report.closedByName))
    lines.push(centerLine('*** DAY CLOSED ***'))
    lines.push(divider())
    lines.push(...formatSummaryBody(report, report))
  }

  lines.push(divider())
  lines.push(centerLine(endLabelFor(input.kind)))
  lines.push('')
  lines.push('')
  return lines.join('\n')
}
