import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyTaxSettings } from '@/hooks/useCompanyTaxSettings'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { placeCashOrder, placeCashOrderUpdate } from '@/services/localOrders'
import { isLocalOrderId } from '@/localdb/db'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import { calcChange, calcTax, calcTotal } from '@/utils/orderCalc'

interface Props {
  open: boolean
  onClose: () => void
}

const QUICK_CASH = [10, 20, 50, 100]

const CheckoutModal = ({ open, onClose }: Props) => {
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId)
  const { components } = useCompanyTaxSettings(companyId || undefined)
  const { isOnline } = useOnlineStatus()
  const lines = useCartStore((s) => s.lines)
  const tableNumber = useCartStore((s) => s.tableNumber)
  const discountType = useCartStore((s) => s.discountType)
  const discountValue = useCartStore((s) => s.discountValue)
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
  const clear = useCartStore((s) => s.clear)
  const navigate = useNavigate()

  const [cashInput, setCashInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isEditing = !!editingOrderId

  useEffect(() => {
    if (open) {
      setCashInput(total.toFixed(2))
      setSubmitting(false)
    }
  }, [open, total])

  const cashReceived = useMemo(() => Number(cashInput) || 0, [cashInput])
  const change = useMemo(() => calcChange(cashReceived, total), [cashReceived, total])
  const insufficient = cashReceived < total

  if (!open) return null

  const handleSubmit = async () => {
    if (!companyId || !user) {
      toast.error('Missing company context')
      return
    }
    if (lines.length === 0) {
      toast.error('Cart is empty')
      return
    }
    if (insufficient) {
      toast.error('Cash received is less than total')
      return
    }
    if (isEditing && !isLocalOrderId(editingOrderId) && !isOnline) {
      toast.error('Editing synced orders requires an internet connection')
      return
    }
    setSubmitting(true)
    try {
      const discount = {
        type: discountType,
        value: discountValue,
        amount: discountAmount,
      }
      const order = isEditing
        ? await placeCashOrderUpdate({
            companyId,
            orderId: editingOrderId,
            updatedBy: user.uid,
            updatedByName: user.name,
            lines,
            tableNumber: tableNumber || undefined,
            discount,
            cashReceived,
          })
        : await placeCashOrder({
            companyId,
            createdBy: user.uid,
            createdByName: user.name,
            lines,
            tableNumber: tableNumber || undefined,
            discount,
            cashReceived,
          })
      clear()
      onClose()
      const pendingSync = order.syncStatus === 'pending' || order.syncStatus === 'error'
      toast.success(
        isEditing
          ? `Order #${formatOrderNumber(order.orderNumber)} updated`
          : pendingSync
            ? `Order #${formatOrderNumber(order.orderNumber)} saved offline`
            : `Order #${formatOrderNumber(order.orderNumber)} completed`,
      )
      navigate(`/admin/receipt/${order.id}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to complete order'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold">Cash Payment</h2>
        <p className="mt-1 text-xs text-slate-500">
          {isEditing
            ? `Updating order #${formatOrderNumber(editingOrderNumber!)}. Re-enter cash received.`
            : isOnline
              ? 'Order will be marked completed on submit.'
              : 'Offline — order will be saved locally and synced when online.'}
        </p>

        <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Discount</span>
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
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
            <span>Total Due</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Cash Received</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input text-lg font-semibold"
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_CASH.map((v) => (
              <button
                key={v}
                onClick={() => setCashInput(String(Math.max(total, v)))}
                className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium hover:bg-slate-200"
              >
                ${v}
              </button>
            ))}
            <button
              onClick={() => setCashInput(total.toFixed(2))}
              className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium hover:bg-slate-200"
            >
              Exact
            </button>
          </div>
        </div>

        <div className="mt-4 flex justify-between rounded-lg bg-emerald-50 p-3 text-emerald-900">
          <span className="text-sm">Change</span>
          <span className="text-lg font-bold">{formatMoney(change)}</span>
        </div>

        {insufficient && (
          <p className="mt-2 text-xs text-red-600">
            Cash received is less than the total.
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary flex-[2]"
            disabled={submitting || insufficient}
          >
            {submitting
              ? 'Processing...'
              : isEditing
                ? 'Save & Print'
                : 'Complete & Print'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CheckoutModal
