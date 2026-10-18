import type { Order } from '@/types'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'

/** Characters per line for 80mm font A (POS-80). */
export const RECEIPT_CHARS = 42

export type ReceiptCompanyInfo = {
  name?: string
  location?: string
  phone?: string
} | null

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

/** Center text within a fixed thermal width. */
export const centerLine = (text: string, width = RECEIPT_CHARS): string => {
  const t = clip(text.trim(), width)
  const pad = Math.max(0, Math.floor((width - t.length) / 2))
  return `${' '.repeat(pad)}${t}`
}

/** Label left, value right on one line (matches app flex justify-between). */
export const padLine = (
  left: string,
  right: string,
  width = RECEIPT_CHARS,
): string => {
  const r = clip(right.trim(), width)
  const maxLeft = Math.max(0, width - r.length - 1)
  const l = clip(left.trim(), maxLeft)
  const spaces = Math.max(1, width - l.length - r.length)
  return `${l}${' '.repeat(spaces)}${r}`
}

const divider = (width = RECEIPT_CHARS) => '-'.repeat(width)

/**
 * Build ESC/POS plain text that mirrors the on-screen receipt layout:
 * centered header, same-line label/value rows, right-aligned prices.
 */
export function formatReceiptPlainText(
  order: Order,
  company?: ReceiptCompanyInfo,
): string {
  const lines: string[] = []

  lines.push(centerLine((company?.name || 'Restaurant').toUpperCase()))
  if (company?.location) lines.push(centerLine(company.location))
  if (company?.phone) lines.push(centerLine(company.phone))
  lines.push(divider())

  lines.push(padLine('Order #', formatOrderNumber(order.orderNumber)))
  lines.push(padLine('Date', formatDate(order.createdAt)))
  if (order.tableNumber) {
    lines.push(padLine('Table', order.tableNumber))
  }
  lines.push(padLine('Cashier', order.createdByName))
  lines.push(divider())

  for (const it of order.items) {
    lines.push(padLine(`${it.quantity} x ${it.itemName}`, formatMoney(it.lineTotal)))
    for (const m of it.modifiers ?? []) {
      const adj =
        m.priceAdjustment !== 0
          ? ` (${m.priceAdjustment > 0 ? '+' : ''}${formatMoney(m.priceAdjustment)})`
          : ''
      lines.push(`  + ${m.optionName}${adj}`)
    }
    if (it.note) {
      lines.push(`  "${it.note}"`)
    }
  }

  lines.push(divider())
  lines.push(padLine('Subtotal', formatMoney(order.subtotal)))

  if (order.discount.amount > 0) {
    const label =
      order.discount.type === 'percent'
        ? `Discount (${order.discount.value}%)`
        : 'Discount'
    lines.push(padLine(label, `-${formatMoney(order.discount.amount)}`))
  }

  if (order.taxLines && order.taxLines.length > 0) {
    for (const tax of order.taxLines) {
      lines.push(
        padLine(
          `${tax.name} (${Math.round(tax.rate * 10000) / 100}%)`,
          formatMoney(tax.amount),
        ),
      )
    }
  } else if (order.tax != null && order.tax > 0) {
    lines.push(padLine('Tax', formatMoney(order.tax)))
  }

  if (order.tip != null && order.tip > 0) {
    lines.push(padLine('Tip', formatMoney(order.tip)))
  }

  lines.push(padLine('TOTAL', formatMoney(order.total)))

  if (order.paymentStatus === 'refunded') {
    lines.push(padLine('Status', 'Refunded'))
  } else if (order.paymentMethod === 'cash') {
    if (order.paymentStatus === 'pending') {
      lines.push(padLine('Cash due', formatMoney(order.total)))
      lines.push(padLine('Status', 'Pending'))
    } else {
      lines.push(padLine('Cash', formatMoney(order.cashReceived ?? 0)))
      lines.push(padLine('Change', formatMoney(order.change ?? 0)))
    }
  } else {
    lines.push(
      padLine('Paid', order.paymentMethod.replace('_', ' ')),
    )
  }

  lines.push(divider())

  if (order.paymentStatus === 'refunded') {
    lines.push(centerLine('REFUNDED'))
    if (order.refundedAt) {
      const who = order.refundedByName ? ` · ${order.refundedByName}` : ''
      lines.push(centerLine(`${formatDate(order.refundedAt)}${who}`))
    }
  } else {
    lines.push(centerLine('Thank you!'))
    const footer =
      order.paymentMethod === 'cash'
        ? order.paymentStatus === 'pending'
          ? 'Payment pending'
          : 'Paid in cash'
        : order.orderSource === 'kiosk'
          ? 'Self-service kiosk order'
          : 'Paid by card'
    lines.push(centerLine(footer))
  }

  return lines.join('\n')
}
