import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartLine, CartModifierSelection, DiscountType, Order } from '@/types'
import { generateId } from '@/utils/idGen'
import {
  calcDiscountAmount,
  calcLineTotal,
  calcLineUnit,
  calcSubtotal,
  calcTaxableBase,
  calcTotal,
} from '@/utils/orderCalc'

interface AddLineInput {
  itemId: string
  itemName: string
  categoryId?: string
  /** Absolute line base (variant.price or item.basePrice). */
  basePrice: number
  variantId?: string
  variantName?: string
  imageUrl?: string
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
}

/** Parent item + selected modifier options; options become independent lines. */
export interface AddItemWithSplitModifiersInput {
  itemId: string
  itemName: string
  categoryId?: string
  basePrice: number
  variantId?: string
  variantName?: string
  imageUrl?: string
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
}

interface CartState {
  companyId: string | null
  branchId: string | null
  lines: CartLine[]
  tableNumber: string
  discountType: DiscountType
  discountValue: number
  editingOrderId: string | null
  editingOrderNumber: number | null

  setCompanyId: (companyId: string | null) => void
  setBranchId: (branchId: string | null) => void
  addLine: (input: AddLineInput) => void
  /** Parent at base price, then one independent line per selected modifier option. */
  addItemWithSplitModifiers: (input: AddItemWithSplitModifiersInput) => void
  updateLineQuantity: (lineId: string, qty: number) => void
  removeLine: (lineId: string) => void
  setTableNumber: (n: string) => void
  setDiscount: (type: DiscountType, value: number) => void
  loadFromOrder: (order: Order) => void
  cancelEdit: () => void
  clear: () => void

  subtotal: () => number
  discountAmount: () => number
  /** Post-discount amount before tax. */
  taxableBase: () => number
  /** Total including optional tax amount (default 0). */
  total: (taxAmount?: number) => number
}

const emptyCartFields = {
  lines: [] as CartLine[],
  tableNumber: '',
  discountType: 'none' as DiscountType,
  discountValue: 0,
  editingOrderId: null as string | null,
  editingOrderNumber: null as number | null,
}

const buildLine = (input: AddLineInput): CartLine => {
  const unitPrice = calcLineUnit(input.basePrice, input.modifiers)
  const lineTotal = calcLineTotal(unitPrice, input.quantity)
  return {
    lineId: generateId('ln'),
    itemId: input.itemId,
    itemName: input.itemName,
    basePrice: input.basePrice,
    quantity: input.quantity,
    modifiers: input.modifiers,
    unitPrice,
    lineTotal,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.variantId ? { variantId: input.variantId } : {}),
    ...(input.variantName ? { variantName: input.variantName } : {}),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      companyId: null,
      branchId: null,
      ...emptyCartFields,

      setCompanyId: (companyId) => {
        const current = get().companyId
        if (current !== companyId) {
          set({
            companyId,
            branchId: null,
            ...emptyCartFields,
          })
        }
      },

      setBranchId: (branchId) => {
        const current = get().branchId
        if (current !== branchId) {
          set({
            branchId,
            ...emptyCartFields,
          })
        }
      },

      addLine: (input) => {
        const newLine = buildLine(input)
        set((s) => ({ lines: [...s.lines, newLine] }))
      },

      addItemWithSplitModifiers: (input) => {
        const parent = buildLine({
          itemId: input.itemId,
          itemName: input.itemName,
          basePrice: input.basePrice,
          quantity: input.quantity,
          modifiers: [],
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          ...(input.variantId ? { variantId: input.variantId } : {}),
          ...(input.variantName ? { variantName: input.variantName } : {}),
          ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
          ...(input.note ? { note: input.note } : {}),
        })
        const addonLines = input.modifiers.map((m) =>
          buildLine({
            itemId: m.optionId,
            itemName: m.optionName,
            basePrice: m.priceAdjustment,
            quantity: input.quantity,
            modifiers: [],
            ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          }),
        )
        set((s) => ({ lines: [...s.lines, parent, ...addonLines] }))
      },

      updateLineQuantity: (lineId, qty) => {
        if (qty <= 0) {
          set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) }))
          return
        }
        set((s) => ({
          lines: s.lines.map((l) =>
            l.lineId === lineId
              ? { ...l, quantity: qty, lineTotal: calcLineTotal(l.unitPrice, qty) }
              : l,
          ),
        }))
      },

      removeLine: (lineId) =>
        set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),

      setTableNumber: (n) => set({ tableNumber: n }),

      setDiscount: (type, value) =>
        set({ discountType: type, discountValue: value }),

      loadFromOrder: (order) => {
        const lines: CartLine[] = order.items.map((it) => ({
          lineId: it.lineId,
          itemId: it.itemId,
          itemName: it.itemName,
          basePrice: it.basePrice,
          quantity: it.quantity,
          modifiers: it.modifiers ?? [],
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          ...(it.categoryId ? { categoryId: it.categoryId } : {}),
          ...(it.variantId ? { variantId: it.variantId } : {}),
          ...(it.variantName ? { variantName: it.variantName } : {}),
          ...(it.note ? { note: it.note } : {}),
        }))
        set({
          companyId: order.companyId,
          branchId: order.branchId,
          lines,
          tableNumber: order.tableNumber ?? '',
          discountType: order.discount.type,
          discountValue: order.discount.value,
          editingOrderId: order.id,
          editingOrderNumber: order.orderNumber,
        })
      },

      cancelEdit: () => set({ ...emptyCartFields }),

      clear: () => set({ ...emptyCartFields }),

      subtotal: () => calcSubtotal(get().lines),
      discountAmount: () => {
        const s = get()
        return calcDiscountAmount(calcSubtotal(s.lines), s.discountType, s.discountValue)
      },
      taxableBase: () => {
        const s = get()
        const sub = calcSubtotal(s.lines)
        return calcTaxableBase(
          sub,
          calcDiscountAmount(sub, s.discountType, s.discountValue),
        )
      },
      total: (taxAmount = 0) => {
        const s = get()
        const sub = calcSubtotal(s.lines)
        const base = calcTaxableBase(
          sub,
          calcDiscountAmount(sub, s.discountType, s.discountValue),
        )
        return calcTotal(base, taxAmount)
      },
    }),
    {
      name: 'pos.cart',
      partialize: (state) => ({
        companyId: state.companyId,
        branchId: state.branchId,
        lines: state.lines,
        tableNumber: state.tableNumber,
        discountType: state.discountType,
        discountValue: state.discountValue,
        editingOrderId: state.editingOrderId,
        editingOrderNumber: state.editingOrderNumber,
      }),
    },
  ),
)
