import { useMemo, useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyTaxSettings } from '@/hooks/useCompanyTaxSettings'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import { calcTax, calcTotal } from '@/utils/orderCalc'
import { cn } from '@/utils/cn'

interface Props {
  onCheckout: () => void
}

const CartPanel = ({ onCheckout }: Props) => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const branchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const { components } = useCompanyTaxSettings(companyId, branchId || undefined)
  const lines = useCartStore((s) => s.lines)
  const tableNumber = useCartStore((s) => s.tableNumber)
  const setTableNumber = useCartStore((s) => s.setTableNumber)
  const discountType = useCartStore((s) => s.discountType)
  const discountValue = useCartStore((s) => s.discountValue)
  const setDiscount = useCartStore((s) => s.setDiscount)
  const updateLineQuantity = useCartStore((s) => s.updateLineQuantity)
  const removeLine = useCartStore((s) => s.removeLine)
  const clear = useCartStore((s) => s.clear)
  const cancelEdit = useCartStore((s) => s.cancelEdit)
  const editingOrderId = useCartStore((s) => s.editingOrderId)
  const editingOrderNumber = useCartStore((s) => s.editingOrderNumber)
  const subtotal = useCartStore((s) => s.subtotal())
  const discountAmount = useCartStore((s) => s.discountAmount())
  const taxableBase = useCartStore((s) => s.taxableBase())

  const { tax, taxLines } = useMemo(
    () => calcTax(taxableBase, components),
    [taxableBase, components],
  )
  const total = useMemo(() => calcTotal(taxableBase, tax), [taxableBase, tax])

  const [showDiscount, setShowDiscount] = useState(discountType !== 'none')

  const isEmpty = lines.length === 0
  const isEditing = !!editingOrderId

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {isEditing ? `Editing #${formatOrderNumber(editingOrderNumber!)}` : 'Current Order'}
        </h2>
        <div className="flex items-center gap-3">
          {isEditing && (
            <button
              onClick={() => cancelEdit()}
              className="text-xs font-medium text-slate-600 hover:underline"
            >
              Cancel edit
            </button>
          )}
          {!isEmpty && (
            <button
              onClick={() => clear()}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-slate-200 px-4 py-3">
        <label className="label">Table number (optional)</label>
        <input
          className="input"
          placeholder="e.g. 12"
          value={tableNumber}
          onChange={(e) => setTableNumber(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
            Add items from the menu to start an order.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => (
              <li key={l.lineId} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{l.itemName}</p>
                    {l.variantName && (
                      <p className="mt-0.5 text-xs text-slate-500">{l.variantName}</p>
                    )}
                    {l.modifiers.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5">
                        {l.modifiers.map((m, idx) => (
                          <li key={idx} className="text-xs text-slate-500">
                            {m.groupName}: {m.optionName}
                            {m.priceAdjustment !== 0 && (
                              <span>
                                {' '}({m.priceAdjustment > 0 ? '+' : ''}
                                {formatMoney(m.priceAdjustment)})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.note && (
                      <p className="mt-0.5 text-xs italic text-slate-400">"{l.note}"</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeLine(l.lineId)}
                    className="text-slate-300 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateLineQuantity(l.lineId, l.quantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      -
                    </button>
                    <span className="w-7 text-center text-sm font-semibold">{l.quantity}</span>
                    <button
                      onClick={() => updateLineQuantity(l.lineId, l.quantity + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-sm font-bold text-slate-900">
                    {formatMoney(l.lineTotal)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
        <button
          onClick={() => setShowDiscount((v) => !v)}
          className="mb-2 flex w-full items-center justify-between text-xs font-medium text-slate-600"
        >
          <span>{discountAmount > 0 ? 'Edit discount' : 'Add discount'}</span>
          <span>{showDiscount ? '−' : '+'}</span>
        </button>
        {showDiscount && (
          <div className="mb-3 flex gap-2">
            <select
              className="input flex-1"
              value={discountType}
              onChange={(e) =>
                setDiscount(e.target.value as 'flat' | 'percent' | 'none', discountValue)
              }
            >
              <option value="none">No discount</option>
              <option value="flat">Flat</option>
              <option value="percent">%</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              className={cn('input flex-1', discountType === 'none' && 'opacity-50')}
              placeholder="0"
              disabled={discountType === 'none'}
              value={discountValue || ''}
              onChange={(e) => setDiscount(discountType, Number(e.target.value) || 0)}
            />
          </div>
        )}

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>
                Discount
                {discountType === 'percent' ? ` (${discountValue}%)` : ''}
              </span>
              <span>-{formatMoney(discountAmount)}</span>
            </div>
          )}
          {taxLines.map((line) => (
            <div key={`${line.name}-${line.rate}`} className="flex justify-between text-slate-600">
              <span>
                {line.name} ({Math.round(line.rate * 10000) / 100}%)
              </span>
              <span>{formatMoney(line.amount)}</span>
            </div>
          ))}
          {taxLines.length === 0 && tax > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Tax</span>
              <span>{formatMoney(tax)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        <button
          onClick={onCheckout}
          disabled={isEmpty}
          className="btn-primary mt-3 w-full"
        >
          {isEditing ? 'Save Order →' : 'Place Order →'}
        </button>
      </div>
    </div>
  )
}

export default CartPanel
