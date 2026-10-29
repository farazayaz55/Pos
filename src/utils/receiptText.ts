import type {
  CompanyReceiptSettings,
  Order,
  ReceiptAlign,
  ReceiptBlock,
} from '@/types'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import { resolveReceiptBlocks } from '@/utils/receiptBlocks'

/** Characters per line for 80mm font A (POS-80). */
export const RECEIPT_CHARS = 42

export type ReceiptCompanyInfo = {
  name?: string
  location?: string
  phone?: string
  logoUrl?: string
} | null

/** Prefer branch address/phone on receipts when a branch is known. */
export const receiptCompanyInfo = (
  company: { name?: string; location?: string; phone?: string; logoUrl?: string } | null | undefined,
  branch?: { location?: string; phone?: string } | null,
): ReceiptCompanyInfo => {
  if (!company && !branch) return null
  const location = branch?.location?.trim() || company?.location
  const phone = branch?.phone || company?.phone
  return {
    name: company?.name,
    logoUrl: company?.logoUrl,
    ...(location ? { location } : {}),
    ...(phone ? { phone } : {}),
  }
}

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

/** Right-align text within a fixed thermal width. */
export const rightLine = (text: string, width = RECEIPT_CHARS): string => {
  const t = clip(text.trim(), width)
  const pad = Math.max(0, width - t.length)
  return `${' '.repeat(pad)}${t}`
}

/** Left-align (clipped) within a fixed thermal width. */
export const leftLine = (text: string, width = RECEIPT_CHARS): string =>
  clip(text.trim(), width)

export const alignLine = (
  text: string,
  align: ReceiptAlign = 'center',
  width = RECEIPT_CHARS,
): string => {
  if (align === 'left') return leftLine(text, width)
  if (align === 'right') return rightLine(text, width)
  return centerLine(text, width)
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

export const receiptAlignClass = (align: ReceiptAlign = 'center'): string => {
  if (align === 'left') return 'text-left'
  if (align === 'right') return 'text-right'
  return 'text-center'
}

const fieldLine = (
  label: string,
  value: string,
  align: ReceiptAlign = 'left',
): string => {
  if (align === 'center') return centerLine(`${label}: ${value}`)
  if (align === 'right') return rightLine(`${label}: ${value}`)
  return padLine(label, value)
}

const defaultLabel = (block: ReceiptBlock, fallback: string) =>
  block.label?.trim() || fallback

const paymentSubtitle = (order: Order): string =>
  order.paymentMethod === 'cash'
    ? order.paymentStatus === 'pending'
      ? 'Payment pending'
      : 'Paid in cash'
    : order.orderSource === 'kiosk'
      ? 'Self-service kiosk order'
      : 'Paid by card'

const appendBlockLines = (
  lines: string[],
  block: ReceiptBlock,
  order: Order,
  company?: ReceiptCompanyInfo,
) => {
  const align = block.align ?? 'left'

  switch (block.type) {
    case 'text': {
      if (!block.text?.trim()) return
      lines.push(alignLine(block.text, block.align ?? 'center'))
      return
    }
    case 'logo':
      return
    case 'companyName':
      lines.push(
        alignLine(
          (company?.name || 'Restaurant').toUpperCase(),
          block.align ?? 'center',
        ),
      )
      return
    case 'companyLocation':
      if (!company?.location) return
      lines.push(alignLine(company.location, block.align ?? 'center'))
      return
    case 'companyPhone':
      if (!company?.phone) return
      lines.push(alignLine(company.phone, block.align ?? 'center'))
      return
    case 'divider':
      lines.push(divider())
      return
    case 'orderNumber':
      lines.push(
        fieldLine(
          defaultLabel(block, 'Order #'),
          formatOrderNumber(order.orderNumber),
          align,
        ),
      )
      return
    case 'date':
      lines.push(
        fieldLine(defaultLabel(block, 'Date'), formatDate(order.createdAt), align),
      )
      return
    case 'table':
      if (!order.tableNumber) return
      lines.push(
        fieldLine(defaultLabel(block, 'Table'), order.tableNumber, align),
      )
      return
    case 'cashier':
      lines.push(
        fieldLine(defaultLabel(block, 'Cashier'), order.createdByName, align),
      )
      return
    case 'lineItems':
      for (const it of order.items) {
        const name = it.variantName
          ? `${it.itemName} (${it.variantName})`
          : it.itemName
        lines.push(padLine(`${it.quantity} x ${name}`, formatMoney(it.lineTotal)))
        for (const m of it.modifiers ?? []) {
          const adj =
            m.priceAdjustment !== 0
              ? ` (${m.priceAdjustment > 0 ? '+' : ''}${formatMoney(m.priceAdjustment)})`
              : ''
          lines.push(`  + ${m.optionName}${adj}`)
        }
        if (it.note) lines.push(`  "${it.note}"`)
      }
      return
    case 'subtotal':
      lines.push(
        fieldLine(
          defaultLabel(block, 'Subtotal'),
          formatMoney(order.subtotal),
          align,
        ),
      )
      return
    case 'discount': {
      if (!(order.discount.amount > 0)) return
      const label =
        block.label?.trim() ||
        (order.discount.type === 'percent'
          ? `Discount (${order.discount.value}%)`
          : 'Discount')
      lines.push(fieldLine(label, `-${formatMoney(order.discount.amount)}`, align))
      return
    }
    case 'tax':
      if (order.taxLines && order.taxLines.length > 0) {
        for (const tax of order.taxLines) {
          lines.push(
            fieldLine(
              `${tax.name} (${Math.round(tax.rate * 10000) / 100}%)`,
              formatMoney(tax.amount),
              align,
            ),
          )
        }
      } else if (order.tax != null && order.tax > 0) {
        lines.push(
          fieldLine(defaultLabel(block, 'Tax'), formatMoney(order.tax), align),
        )
      }
      return
    case 'tip':
      if (!(order.tip != null && order.tip > 0)) return
      lines.push(
        fieldLine(defaultLabel(block, 'Tip'), formatMoney(order.tip), align),
      )
      return
    case 'total':
      lines.push(
        fieldLine(defaultLabel(block, 'TOTAL'), formatMoney(order.total), align),
      )
      return
    case 'payment':
      if (order.paymentStatus === 'refunded') {
        lines.push(fieldLine('Status', 'Refunded', align))
      } else if (order.paymentMethod === 'cash') {
        if (order.paymentStatus === 'pending') {
          lines.push(fieldLine('Cash due', formatMoney(order.total), align))
          lines.push(fieldLine('Status', 'Pending', align))
        } else {
          lines.push(
            fieldLine('Cash', formatMoney(order.cashReceived ?? 0), align),
          )
          lines.push(fieldLine('Change', formatMoney(order.change ?? 0), align))
        }
      } else {
        lines.push(
          fieldLine('Paid', order.paymentMethod.replace('_', ' '), align),
        )
      }
      return
    case 'thankYou': {
      const a = block.align ?? 'center'
      if (order.paymentStatus === 'refunded') {
        lines.push(alignLine('REFUNDED', a))
        if (order.refundedAt) {
          const who = order.refundedByName ? ` · ${order.refundedByName}` : ''
          lines.push(alignLine(`${formatDate(order.refundedAt)}${who}`, a))
        }
      } else {
        lines.push(alignLine(block.text?.trim() || 'Thank you!', a))
        lines.push(alignLine(paymentSubtitle(order), a))
      }
      return
    }
    default:
      return
  }
}

/**
 * Build ESC/POS plain text from the configured receipt block template.
 */
export function formatReceiptPlainText(
  order: Order,
  company?: ReceiptCompanyInfo,
  settings?: CompanyReceiptSettings | null,
): string {
  const blocks = resolveReceiptBlocks(settings)
  const lines: string[] = []
  for (const block of blocks) {
    appendBlockLines(lines, block, order, company)
  }
  return lines.join('\n')
}
