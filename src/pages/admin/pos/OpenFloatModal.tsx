import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import VirtualKeyboard from '@/components/common/VirtualKeyboard'
import { useAuthStore } from '@/stores/authStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { openBusinessDay } from '@/services/dayState'
import { formatMoney } from '@/utils/currency'

interface Props {
  companyId: string
  branchId: string
  onOpened: () => void
}

const OpenFloatModal = ({ companyId, branchId, onOpened }: Props) => {
  const user = useAuthStore((s) => s.user)
  const { isOnline } = useOnlineStatus()
  const [cashInput, setCashInput] = useState('0')
  const [replaceOnNextKey, setReplaceOnNextKey] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setCashInput('0')
    setReplaceOnNextKey(true)
  }, [companyId, branchId])

  const openingFloat = useMemo(() => Number(cashInput) || 0, [cashInput])

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Not signed in')
      return
    }
    if (!isOnline) {
      toast.error('Opening float requires an internet connection')
      return
    }
    if (openingFloat < 0) {
      toast.error('Opening float cannot be negative')
      return
    }
    setSubmitting(true)
    try {
      await openBusinessDay({
        companyId,
        branchId,
        openingFloat,
        openedBy: user.uid,
        openedByName: user.name,
      })
      toast.success(`Shift opened with ${formatMoney(openingFloat)} float`)
      onOpened()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open shift')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/70 p-0 sm:items-center sm:p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold">Opening float</h2>
        <p className="mt-1 text-sm text-slate-600">
          Enter the starting cash in the drawer before taking orders. This is
          not sales revenue.
        </p>

        {!isOnline && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            You are offline. Connect to open a shift.
          </p>
        )}

        <div className="mt-4">
          <label className="label">Opening float</label>
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

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          Starting cash: <b>{formatMoney(openingFloat)}</b>
        </div>

        <button
          type="button"
          className="btn-primary mt-6 w-full"
          disabled={submitting || !isOnline}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Opening…' : 'Start shift'}
        </button>
      </div>
    </div>
  )
}

export default OpenFloatModal
