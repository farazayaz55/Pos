import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { createAndCompleteOrder } from '@/services/orders'
import { formatMoney } from '@/utils/currency'
import { calcChange } from '@/utils/orderCalc'

interface Props {
  open: boolean
  onClose: () => void
}

const QUICK_CASH = [10, 20, 50, 100]

const CheckoutModal = ({ open, onClose }: Props) => {
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId)
  const lines = useCartStore((s) => s.lines)
  const tableNumber = useCartStore((s) => s.tableNumber)
  const discountType = useCartStore((s) => s.discountType)
  const discountValue = useCartStore((s) => s.discountValue)
  const subtotal = useCartStore((s) => s.subtotal())
  const discountAmount = useCartStore((s) => s.discountAmount())
  const total = useCartStore((s) => s.total())
  const clear = useCartStore((s) => s.clear)
  const navigate = useNavigate()

  const [cashInput, setCashInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
    setSubmitting(true)
    try {
      const order = await createAndCompleteOrder({
        companyId,
        createdBy: user.uid,
        createdByName: user.name,
        lines,
        tableNumber: tableNumber || undefined,
        discount: {
          type: discountType,
          value: discountValue,
          amount: discountAmount,
        },
        cashReceived,
      })
      clear()
      onClose()
      toast.success(`Order #${order.orderNumber} completed`)
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
          Order will be marked completed on submit.
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
            {submitting ? 'Processing...' : 'Complete & Print'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CheckoutModal
