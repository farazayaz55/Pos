import type { CartLine, OrderTaxLine } from '@/types'

export type CustomerDisplayPhase = 'idle' | 'ordering' | 'thanks'

export interface CustomerDisplayLine {
  lineId: string
  itemName: string
  quantity: number
  lineTotal: number
  modifiers: { optionName: string; priceAdjustment: number }[]
  note?: string
}

export interface CustomerDisplayState {
  phase: CustomerDisplayPhase
  companyName?: string
  companyLogoUrl?: string
  tableNumber?: string
  lines: CustomerDisplayLine[]
  subtotal: number
  discountAmount: number
  taxLines: OrderTaxLine[]
  tax: number
  total: number
  /** Shown during thanks phase. */
  orderNumber?: number
  thanksTotal?: number
}

export const emptyCustomerDisplayState = (): CustomerDisplayState => ({
  phase: 'idle',
  lines: [],
  subtotal: 0,
  discountAmount: 0,
  taxLines: [],
  tax: 0,
  total: 0,
})

export const cartLinesToDisplayLines = (lines: CartLine[]): CustomerDisplayLine[] =>
  lines.map((l) => ({
    lineId: l.lineId,
    itemName: l.itemName,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    modifiers: (l.modifiers ?? []).map((m) => ({
      optionName: m.optionName,
      priceAdjustment: m.priceAdjustment,
    })),
    ...(l.note ? { note: l.note } : {}),
  }))
