import type { ItemVariant, MenuItem } from '@/types'

/** Sorted list of variants for an item (by sortOrder, then name). */
export const sortedVariants = (
  variants: Record<string, ItemVariant> | null | undefined,
): ItemVariant[] => {
  if (!variants) return []
  return Object.values(variants).sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
  )
}

export const itemHasVariants = (item: Pick<MenuItem, 'variants'>): boolean =>
  sortedVariants(item.variants).length > 0

/** Lowest absolute variant price, or null if no variants. */
export const lowestVariantPrice = (
  variants: Record<string, ItemVariant> | null | undefined,
): number | null => {
  const list = sortedVariants(variants)
  if (list.length === 0) return null
  return Math.min(...list.map((v) => Number(v.price) || 0))
}
