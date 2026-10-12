import type {
  CartLine,
  DiscountType,
  OrderTaxLine,
  TaxComponent,
} from '@/types'
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

export const calcTaxableBase = (subtotal: number, discountAmount: number): number =>
  round2(Math.max(0, subtotal - discountAmount))

const conditionMatches = (component: TaxComponent, taxableBase: number): boolean => {
  switch (component.conditionType) {
    case 'always':
      return true
    case 'taxableBaseLte':
      return taxableBase <= Number(component.conditionAmount)
    case 'taxableBaseGt':
      return taxableBase > Number(component.conditionAmount)
    default:
      return false
  }
}

/** Active components from settings, or a single legacy company.taxRate fallback. */
export const resolveTaxComponents = (
  components: TaxComponent[] | Record<string, TaxComponent> | null | undefined,
  legacyTaxRate?: number,
): TaxComponent[] => {
  const list = Array.isArray(components)
    ? components
    : components
      ? Object.values(components)
      : []
  const active = list
    .filter((c) => c && c.active !== false && Number(c.rate) > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  if (active.length > 0) return active
  const rate = Number(legacyTaxRate)
  if (rate > 0) {
    return [
      {
        id: 'legacy',
        name: 'Tax',
        rate,
        conditionType: 'always',
        active: true,
        sortOrder: 0,
      },
    ]
  }
  return []
}

export const calcTax = (
  taxableBase: number,
  components: TaxComponent[],
): { tax: number; taxLines: OrderTaxLine[] } => {
  const base = Math.max(0, taxableBase)
  const taxLines: OrderTaxLine[] = []
  for (const c of components) {
    if (!conditionMatches(c, base)) continue
    const amount = round2(base * Number(c.rate))
    if (amount <= 0) continue
    taxLines.push({ name: c.name, rate: Number(c.rate), amount })
  }
  const tax = round2(taxLines.reduce((s, l) => s + l.amount, 0))
  return { tax, taxLines }
}

/** Order total from taxable base + tax (tip is added separately by callers). */
export const calcTotal = (taxableBase: number, taxAmount = 0): number =>
  round2(Math.max(0, taxableBase) + Math.max(0, taxAmount))

export const calcChange = (cashReceived: number, total: number): number =>
  round2(Math.max(0, cashReceived - total))
