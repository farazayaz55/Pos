import type { CartLine, DiscountType } from '@/types'
import { round2 } from './currency'

export const calcLineUnit = (basePrice: number, mods: { priceAdjustment: number }[]): number => {
  const modSum = mods.reduce((s, m) => s + (m.priceAdjustment || 0), 0)
  return round2(basePrice + modSum)
}

export const calcLineTotal = (unit: number, qty: number): number => round2(unit * qty)

export const calcSubtotal = (lines: CartLine[]): number =>
  round2(lines.reduce((s, l) => s + l.lineTotal, 0))

export const calcDiscountAmount = (
  subtotal: number,
  type: DiscountType,
  value: number,
): number => {
  if (type === 'none' || !value || value <= 0) return 0
  if (type === 'flat') return round2(Math.min(value, subtotal))
  if (type === 'percent') return round2((subtotal * Math.min(value, 100)) / 100)
  return 0
}

export const calcTotal = (subtotal: number, discountAmount: number): number =>
  round2(Math.max(0, subtotal - discountAmount))

export const calcChange = (cashReceived: number, total: number): number =>
  round2(Math.max(0, cashReceived - total))
