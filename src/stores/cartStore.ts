import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartLine, CartModifierSelection, DiscountType } from '@/types'
import { generateId } from '@/utils/idGen'
import {
  calcDiscountAmount,
  calcLineTotal,
  calcLineUnit,
  calcSubtotal,
  calcTotal,
} from '@/utils/orderCalc'

interface AddLineInput {
  itemId: string
  itemName: string
  basePrice: number
  imageUrl?: string
  quantity: number
  modifiers: CartModifierSelection[]
  note?: string
}

interface CartState {
  companyId: string | null
  lines: CartLine[]
  tableNumber: string
  discountType: DiscountType
  discountValue: number

  setCompanyId: (companyId: string | null) => void
  addLine: (input: AddLineInput) => void
  updateLineQuantity: (lineId: string, qty: number) => void
  removeLine: (lineId: string) => void
  setTableNumber: (n: string) => void
  setDiscount: (type: DiscountType, value: number) => void
  clear: () => void

  subtotal: () => number
  discountAmount: () => number
  total: () => number
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
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      companyId: null,
      lines: [],
      tableNumber: '',
      discountType: 'none',
      discountValue: 0,

      setCompanyId: (companyId) => {
        const current = get().companyId
        if (current !== companyId) {
          set({
            companyId,
            lines: [],
            tableNumber: '',
            discountType: 'none',
            discountValue: 0,
          })
        }
      },

      addLine: (input) => {
        const newLine = buildLine(input)
        set((s) => ({ lines: [...s.lines, newLine] }))
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

      clear: () =>
        set({
          lines: [],
          tableNumber: '',
          discountType: 'none',
          discountValue: 0,
        }),

      subtotal: () => calcSubtotal(get().lines),
      discountAmount: () => {
        const s = get()
        return calcDiscountAmount(calcSubtotal(s.lines), s.discountType, s.discountValue)
      },
      total: () => {
        const s = get()
        const sub = calcSubtotal(s.lines)
        return calcTotal(sub, calcDiscountAmount(sub, s.discountType, s.discountValue))
      },
    }),
    {
      name: 'pos.cart',
      partialize: (state) => ({
        companyId: state.companyId,
        lines: state.lines,
        tableNumber: state.tableNumber,
        discountType: state.discountType,
        discountValue: state.discountValue,
      }),
    },
  ),
)
