export const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

export const formatMoney = (value: number): string => {
  if (!Number.isFinite(value)) return currency.format(0)
  return currency.format(value)
}

export const round2 = (n: number): number => Math.round(n * 100) / 100
