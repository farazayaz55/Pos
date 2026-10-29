import type {
  CompanyKitchenReceiptSettings,
  MenuItem,
  Order,
  OrderItemSnapshot,
} from '@/types'

export type KitchenItemLookup = Pick<MenuItem, 'id' | 'categoryId'>

export const resolveKitchenCategoryId = (
  item: OrderItemSnapshot,
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>,
): string | undefined => {
  if (item.categoryId) return item.categoryId
  if (!menuByItemId) return undefined
  const found =
    menuByItemId instanceof Map
      ? menuByItemId.get(item.itemId)
      : menuByItemId[item.itemId]
  return found?.categoryId
}

/** Item override wins over category exclusion. Unknown category → include. */
export const shouldIncludeOnKitchenReceipt = (
  item: OrderItemSnapshot,
  settings: CompanyKitchenReceiptSettings | null | undefined,
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>,
): boolean => {
  const excludedCategories = new Set(settings?.excludedCategoryIds ?? [])
  const excludedItems = new Set(settings?.excludedItemIds ?? [])
  const includedItems = new Set(settings?.includedItemIds ?? [])

  if (includedItems.has(item.itemId)) return true
  if (excludedItems.has(item.itemId)) return false

  const categoryId = resolveKitchenCategoryId(item, menuByItemId)
  if (categoryId && excludedCategories.has(categoryId)) return false
  return true
}

export const filterKitchenItems = (
  order: Order,
  settings: CompanyKitchenReceiptSettings | null | undefined,
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>,
): OrderItemSnapshot[] =>
  (order.items ?? []).filter((item) =>
    shouldIncludeOnKitchenReceipt(item, settings, menuByItemId),
  )
