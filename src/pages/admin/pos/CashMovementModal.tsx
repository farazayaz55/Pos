import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import VirtualKeyboard from '@/components/common/VirtualKeyboard'
import { useAuthStore } from '@/stores/authStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { addCashMovement } from '@/services/dayState'
import { formatMoney } from '@/utils/currency'
import type { CashMovementType } from '@/types'

interface Props {
  open: boolean
  type: CashMovementType
  companyId: string
  branchId: string
  onClose: () => void
}

const CashMovementModal = ({
  open,
  type,
  companyId,
  branchId,
  onClose,
}: Props) => {
  const user = useAuthStore((s) => s.user)
  const { isOnline } = useOnlineStatus()
  const [cashInput, setCashInput] = useState('')
  const [reason, setReason] = useState('')
  const [replaceOnNextKey, setReplaceOnNextKey] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setCashInput('')
      setReason('')
      setReplaceOnNextKey(true)
      setSubmitting(false)
    }
  }, [open, type])

  const amount = useMemo(() => Number(cashInput) || 0, [cashInput])
  const title = type === 'pay_in' ? 'Cash in' : 'Cash out'
  const hint =
    type === 'pay_in'
      ? 'Add cash to the drawer (e.g. from safe).'
      : 'Remove cash from the drawer (e.g. grocery expense, drop to safe).'

  if (!open) return null

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Not signed in')
      return
    }
    if (!isOnline) {
      toast.error('Cash movements require an internet connection')
      return
    }
    if (!(amount > 0)) {
      toast.error('Enter an amount greater than zero')
      return
    }
    if (!reason.trim()) {
      toast.error('Enter a reason')
      return
    }
    setSubmitting(true)
    try {
      await addCashMovement({
        companyId,
        branchId,
        type,
        amount,
        reason: reason.trim(),
        createdBy: user.uid,
        createdByName: user.name,
      })
      toast.success(
        type === 'pay_in'
          ? `Cash in ${formatMoney(amount)} recorded`
          : `Cash out ${formatMoney(amount)} recorded`,
      )
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record movement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{hint}</p>

        <div className="mt-4">
          <label className="label">Amount</label>
          <input
            type="text"
            inputMode="none"
            readOnly
            className="input text-lg font-semibold"
            value={cashInput}
            autoFocus
          />
          <VirtualKeyboard
            mode="numeric"
            value={cashInput}
            onChange={setCashInput}
            replaceOnNextKey={replaceOnNextKey}
            onReplaceConsumed={() => setReplaceOnNextKey(false)}
            className="mt-3"
          />
        </div>

        <div className="mt-4">
          <label className="label">Reason</label>
          <input
            type="text"
            className="input"
            placeholder={
              type === 'pay_in' ? 'e.g. From safe' : 'e.g. Grocery expense'
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-[2]"
            disabled={submitting || !isOnline || !(amount > 0)}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Saving…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CashMovementModal
