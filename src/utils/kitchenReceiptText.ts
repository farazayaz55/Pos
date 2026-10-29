import type { CompanyKitchenReceiptSettings, Order } from '@/types'
import { formatOrderNumber } from '@/utils/businessDate'
import {
  filterKitchenItems,
  type KitchenItemLookup,
} from '@/utils/kitchenReceipt'
import {
  RECEIPT_CHARS,
  alignLine,
  leftLine,
} from '@/utils/receiptText'

const divider = (width = RECEIPT_CHARS) => '-'.repeat(width)

export const formatKitchenReceiptPlainText = (
  order: Order,
  settings?: CompanyKitchenReceiptSettings | null,
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>,
): string | null => {
  const items = filterKitchenItems(order, settings, menuByItemId)
  if (items.length === 0) return null

  const lines: string[] = []
  lines.push(alignLine('KITCHEN', 'center'))
  lines.push(alignLine(`#${formatOrderNumber(order.orderNumber)}`, 'center'))
  if (order.tableNumber) {
    lines.push(alignLine(`Table ${order.tableNumber}`, 'center'))
  }
  lines.push(divider())

  for (const item of items) {
    const name = item.variantName
      ? `${item.itemName} (${item.variantName})`
      : item.itemName
    lines.push(leftLine(`${item.quantity} x ${name}`))
    for (const mod of item.modifiers ?? []) {
      lines.push(leftLine(`  + ${mod.optionName}`))
    }
    if (item.note?.trim()) {
      lines.push(leftLine(`  "${item.note.trim()}"`))
    }
  }

  lines.push('')
  return lines.join('\n')
}
