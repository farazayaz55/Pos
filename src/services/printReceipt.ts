import { usePosSettingsStore } from '@/stores/posSettingsStore'
import type {
  CompanyKitchenReceiptSettings,
  CompanyReceiptSettings,
  Order,
} from '@/types'
import {
  formatKitchenReceiptPlainText,
} from '@/utils/kitchenReceiptText'
import type { KitchenItemLookup } from '@/utils/kitchenReceipt'
import {
  formatReceiptPlainText,
  type ReceiptCompanyInfo,
} from '@/utils/receiptText'

export class PrintConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintConfigError'
  }
}

const PX_TO_MICRONS = 25_400 / 96

async function srcToDataUrl(src: string): Promise<string> {
  if (!src || src.startsWith('data:')) return src
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Failed to read image (${res.status})`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to encode image'))
    reader.readAsDataURL(blob)
  })
}

/** Copy computed styles so Tailwind classes aren't needed in the print window. */
function inlineComputedStyles(sourceRoot: HTMLElement, targetRoot: HTMLElement) {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll<HTMLElement>('*'))]
  const targets = [targetRoot, ...Array.from(targetRoot.querySelectorAll<HTMLElement>('*'))]
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    const tgt = targets[i]
    if (!src || !tgt) continue
    const computed = window.getComputedStyle(src)
    let css = ''
    for (let j = 0; j < computed.length; j++) {
      const prop = computed.item(j)
      css += `${prop}:${computed.getPropertyValue(prop)};`
    }
    css += 'color:#000;background-color:transparent;box-shadow:none;'
    tgt.style.cssText = css
    tgt.removeAttribute('class')
  }
  targetRoot.style.backgroundColor = '#fff'
  targetRoot.style.color = '#000'
  targetRoot.style.width = '80mm'
  targetRoot.style.maxWidth = '80mm'
  targetRoot.style.margin = '0'
  targetRoot.style.padding = '2mm 3mm'
  targetRoot.style.boxSizing = 'border-box'
}

async function buildReceiptPrintHtml(
  receipt: HTMLElement,
  title = 'Receipt',
): Promise<{
  html: string
  pageHeightMicrons: number
}> {
  const clone = receipt.cloneNode(true) as HTMLElement
  inlineComputedStyles(receipt, clone)

  const originalImgs = Array.from(receipt.querySelectorAll('img'))
  const clonedImgs = Array.from(clone.querySelectorAll('img'))
  await Promise.all(
    clonedImgs.map(async (img, index) => {
      const src =
        originalImgs[index]?.currentSrc ||
        originalImgs[index]?.src ||
        img.currentSrc ||
        img.src
      if (!src) {
        img.remove()
        return
      }
      try {
        img.src = await srcToDataUrl(src)
        img.removeAttribute('srcset')
      } catch {
        img.remove()
      }
    }),
  )

  const contentHeightPx = Math.max(receipt.scrollHeight, receipt.offsetHeight, 120)
  const pageHeightMicrons = Math.round(contentHeightPx * PX_TO_MICRONS * 1.2 + 8_000)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    max-width: 80mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  hr { border: none; border-top: 1px dashed #000 !important; }
  img { max-width: 56px; height: auto; }
</style>
</head><body>${clone.outerHTML}</body></html>`

  return { html, pageHeightMicrons }
}

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const browserPrintTarget = async (target: 'receipt' | 'kitchen') => {
  const root = document.documentElement
  root.setAttribute('data-print-target', target)
  await waitForPaint()
  try {
    window.print()
  } finally {
    root.removeAttribute('data-print-target')
  }
}

export type PrintReceiptInput = {
  order: Order
  company?: ReceiptCompanyInfo
  receiptSettings?: CompanyReceiptSettings | null
}

/**
 * Print the receipt.
 * Desktop Windows: ESC/POS RAW text laid out like the on-screen receipt.
 * Desktop macOS: HTML print window.
 * Browser: window.print().
 */
export async function printReceipt(input: PrintReceiptInput): Promise<void> {
  const desktop = window.posDesktop
  if (!desktop) {
    await browserPrintTarget('receipt')
    return
  }

  const deviceName = usePosSettingsStore.getState().receiptPrinterName
  if (!deviceName) {
    throw new PrintConfigError(
      'No receipt printer selected. Choose one in Settings before printing.',
    )
  }

  const receipt = document.getElementById('receipt')
  if (!receipt) {
    throw new Error('Receipt is not ready to print')
  }

  await waitForPaint()

  const text = formatReceiptPlainText(
    input.order,
    input.company,
    input.receiptSettings,
  )
  const { html, pageHeightMicrons } = await buildReceiptPrintHtml(receipt)
  const result = await desktop.print({
    deviceName,
    text,
    html,
    pageHeightMicrons,
  })
  if (!result.success) {
    throw new Error(result.error || 'Print failed')
  }
}

export type PrintKitchenReceiptInput = {
  order: Order
  kitchenSettings?: CompanyKitchenReceiptSettings | null
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>
}

/**
 * Print the kitchen ticket on the same receipt printer.
 * Returns false when there are no kitchen lines (nothing to print).
 */
export async function printKitchenReceipt(
  input: PrintKitchenReceiptInput,
): Promise<boolean> {
  const text = formatKitchenReceiptPlainText(
    input.order,
    input.kitchenSettings,
    input.menuByItemId,
  )
  if (!text) return false

  const desktop = window.posDesktop
  if (!desktop) {
    const el = document.getElementById('kitchen-receipt')
    if (!el) throw new Error('Kitchen receipt is not ready to print')
    await browserPrintTarget('kitchen')
    return true
  }

  const deviceName = usePosSettingsStore.getState().receiptPrinterName
  if (!deviceName) {
    throw new PrintConfigError(
      'No receipt printer selected. Choose one in Settings before printing.',
    )
  }

  const receipt = document.getElementById('kitchen-receipt')
  if (!receipt) {
    throw new Error('Kitchen receipt is not ready to print')
  }

  await waitForPaint()

  const { html, pageHeightMicrons } = await buildReceiptPrintHtml(
    receipt,
    'Kitchen',
  )
  const result = await desktop.print({
    deviceName,
    text,
    html,
    pageHeightMicrons,
  })
  if (!result.success) {
    throw new Error(result.error || 'Kitchen print failed')
  }
  return true
}
