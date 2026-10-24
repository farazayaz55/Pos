import type {
  CompanyReceiptSettings,
  ReceiptAlign,
  ReceiptBlock,
  ReceiptBlockType,
  ReceiptTextLine,
} from '@/types'
import { generateId } from '@/utils/idGen'

export const RECEIPT_BLOCK_TYPES: ReceiptBlockType[] = [
  'text',
  'logo',
  'companyName',
  'companyLocation',
  'companyPhone',
  'divider',
  'orderNumber',
  'date',
  'table',
  'cashier',
  'lineItems',
  'subtotal',
  'discount',
  'tax',
  'tip',
  'total',
  'payment',
  'thankYou',
]

export const RECEIPT_BLOCK_LABELS: Record<ReceiptBlockType, string> = {
  text: 'Custom text',
  logo: 'Logo',
  companyName: 'Company name',
  companyLocation: 'Location',
  companyPhone: 'Phone',
  divider: 'Divider',
  orderNumber: 'Order #',
  date: 'Date',
  table: 'Table',
  cashier: 'Cashier',
  lineItems: 'Line items',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  tip: 'Tip',
  total: 'Total',
  payment: 'Payment',
  thankYou: 'Thank you / refund',
}

const BLOCK_TYPE_SET = new Set<string>(RECEIPT_BLOCK_TYPES)

const defaultAlignFor = (type: ReceiptBlockType): ReceiptAlign => {
  if (
    type === 'text' ||
    type === 'companyName' ||
    type === 'companyLocation' ||
    type === 'companyPhone' ||
    type === 'thankYou' ||
    type === 'logo'
  ) {
    return 'center'
  }
  return 'left'
}

export const createReceiptBlock = (
  type: ReceiptBlockType,
  patch?: Partial<ReceiptBlock>,
): ReceiptBlock => ({
  id: generateId('rb'),
  type,
  align: defaultAlignFor(type),
  ...(type === 'text' ? { text: '' } : {}),
  ...patch,
})

/** Default layout matching the historic hard-coded receipt. */
export const defaultReceiptBlocks = (): ReceiptBlock[] => [
  createReceiptBlock('logo'),
  createReceiptBlock('companyName'),
  createReceiptBlock('companyLocation'),
  createReceiptBlock('companyPhone'),
  createReceiptBlock('divider'),
  createReceiptBlock('orderNumber'),
  createReceiptBlock('date'),
  createReceiptBlock('table'),
  createReceiptBlock('cashier'),
  createReceiptBlock('divider'),
  createReceiptBlock('lineItems'),
  createReceiptBlock('divider'),
  createReceiptBlock('subtotal'),
  createReceiptBlock('discount'),
  createReceiptBlock('tax'),
  createReceiptBlock('tip'),
  createReceiptBlock('total'),
  createReceiptBlock('payment'),
  createReceiptBlock('divider'),
  createReceiptBlock('thankYou'),
]

const normalizeAlign = (value: unknown, fallback: ReceiptAlign): ReceiptAlign => {
  if (value === 'left' || value === 'right' || value === 'center') return value
  return fallback
}

const normalizeLegacyLines = (raw: unknown): ReceiptTextLine[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      if (!text) return null
      return {
        id: typeof row.id === 'string' && row.id ? row.id : generateId('rl'),
        text,
        align: normalizeAlign(row.align, 'center'),
      }
    })
    .filter((line): line is ReceiptTextLine => line != null)
}

const normalizeBlock = (item: unknown): ReceiptBlock | null => {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const type = row.type
  if (typeof type !== 'string' || !BLOCK_TYPE_SET.has(type)) return null
  const blockType = type as ReceiptBlockType
  const block: ReceiptBlock = {
    id: typeof row.id === 'string' && row.id ? row.id : generateId('rb'),
    type: blockType,
    align: normalizeAlign(row.align, defaultAlignFor(blockType)),
  }
  if (typeof row.text === 'string') block.text = row.text
  if (typeof row.label === 'string' && row.label.trim()) {
    block.label = row.label.trim()
  }
  return block
}

const normalizeBlocks = (raw: unknown): ReceiptBlock[] => {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeBlock).filter((b): b is ReceiptBlock => b != null)
}

const migrateLegacyToBlocks = (
  headerLines: ReceiptTextLine[],
  footerLines: ReceiptTextLine[],
): ReceiptBlock[] => {
  const blocks = defaultReceiptBlocks()
  const headerBlocks = headerLines.map((line) =>
    createReceiptBlock('text', { id: line.id, text: line.text, align: line.align }),
  )
  const footerBlocks = footerLines.map((line) =>
    createReceiptBlock('text', { id: line.id, text: line.text, align: line.align }),
  )

  const phoneIdx = blocks.findIndex((b) => b.type === 'companyPhone')
  const insertAt = phoneIdx >= 0 ? phoneIdx + 1 : 0
  blocks.splice(insertAt, 0, ...headerBlocks)

  const thankIdx = blocks.findIndex((b) => b.type === 'thankYou')
  if (thankIdx >= 0) {
    blocks.splice(thankIdx + 1, 0, ...footerBlocks)
  } else {
    blocks.push(...footerBlocks)
  }
  return blocks
}

/**
 * Normalize stored settings into a concrete block list.
 * Migrates deprecated headerLines/footerLines when blocks are absent.
 */
export const resolveReceiptBlocks = (
  settings: CompanyReceiptSettings | null | undefined,
): ReceiptBlock[] => {
  if (!settings) return defaultReceiptBlocks()

  const blocks = normalizeBlocks(settings.blocks)
  if (blocks.length > 0) return blocks

  const headerLines = normalizeLegacyLines(settings.headerLines)
  const footerLines = normalizeLegacyLines(settings.footerLines)
  if (headerLines.length > 0 || footerLines.length > 0) {
    return migrateLegacyToBlocks(headerLines, footerLines)
  }

  return defaultReceiptBlocks()
}

export const parseReceiptSettingsPayload = (
  companyId: string,
  val: Omit<CompanyReceiptSettings, 'companyId'> | null,
): CompanyReceiptSettings | null => {
  if (!val) return null
  const blocks = normalizeBlocks(val.blocks)
  const headerLines = normalizeLegacyLines(val.headerLines)
  const footerLines = normalizeLegacyLines(val.footerLines)
  return {
    companyId,
    blocks:
      blocks.length > 0
        ? blocks
        : headerLines.length > 0 || footerLines.length > 0
          ? migrateLegacyToBlocks(headerLines, footerLines)
          : [],
    ...(headerLines.length ? { headerLines } : {}),
    ...(footerLines.length ? { footerLines } : {}),
    updatedAt: val.updatedAt,
    updatedBy: val.updatedBy,
  }
}

export const cleanReceiptBlocksForSave = (blocks: ReceiptBlock[]): ReceiptBlock[] =>
  blocks
    .map((block) => {
      const type = block.type
      if (!BLOCK_TYPE_SET.has(type)) return null
      const cleaned: ReceiptBlock = {
        id: block.id || generateId('rb'),
        type,
        align: normalizeAlign(block.align, defaultAlignFor(type)),
      }
      if (type === 'text') {
        const text = (block.text ?? '').trim()
        if (!text) return null
        cleaned.text = text
      } else if (block.text?.trim()) {
        cleaned.text = block.text.trim()
      }
      if (block.label?.trim()) cleaned.label = block.label.trim()
      return cleaned
    })
    .filter((b): b is ReceiptBlock => b != null)

/** Whether align control is meaningful for this block type. */
export const blockSupportsAlign = (type: ReceiptBlockType): boolean =>
  type !== 'logo' && type !== 'divider' && type !== 'lineItems'

/** Whether a custom label override makes sense. */
export const blockSupportsLabel = (type: ReceiptBlockType): boolean =>
  type === 'orderNumber' ||
  type === 'date' ||
  type === 'table' ||
  type === 'cashier' ||
  type === 'subtotal' ||
  type === 'discount' ||
  type === 'tax' ||
  type === 'tip' ||
  type === 'total'
