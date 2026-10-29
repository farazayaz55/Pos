import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import VirtualKeyboard from '@/components/common/VirtualKeyboard'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { closeBusinessDay } from '@/services/dayState'
import { printXzReport } from '@/services/printReport'
import { PrintConfigError } from '@/services/printReceipt'
import { formatMoney, round2 } from '@/utils/currency'
import type { DayState, XzReportSummary, ZReport } from '@/types'
import type { ReceiptCompanyInfo } from '@/utils/receiptText'

interface Props {
  open: boolean
  companyId: string
  branchId: string
  dayState: DayState
  summary: XzReportSummary
  companyInfo?: ReceiptCompanyInfo
  branchName?: string
  onClose: () => void
  onClosed: (report: ZReport) => void
}

const CloseShiftModal = ({
  open,
  companyId,
  branchId,
  dayState,
  summary,
  companyInfo,
  branchName,
  onClose,
  onClosed,
}: Props) => {
  const { isOnline } = useOnlineStatus()
  const [cashInput, setCashInput] = useState('')
  const [replaceOnNextKey, setReplaceOnNextKey] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setCashInput(summary.expectedCash.toFixed(2))
      setReplaceOnNextKey(true)
      setSubmitting(false)
    }
  }, [open, summary.expectedCash])

  const actualCash = useMemo(() => Number(cashInput) || 0, [cashInput])
  const variance = useMemo(
    () => round2(actualCash - summary.expectedCash),
    [actualCash, summary.expectedCash],
  )

  if (!open) return null

  const handleSubmit = async () => {
    if (!isOnline) {
      toast.error('Closing the shift requires an internet connection')
      return
    }
    if (actualCash < 0) {
      toast.error('Actual cash cannot be negative')
      return
    }
    setSubmitting(true)
    try {
      const { report } = await closeBusinessDay(companyId, branchId, actualCash)
      toast.success('Shift closed')
      onClosed(report)
      try {
        await printXzReport({
          kind: 'z',
          company: companyInfo,
          branchName,
          report,
        })
      } catch (printErr) {
        if (printErr instanceof PrintConfigError) {
          toast.error(printErr.message)
        } else {
          toast.error(
            printErr instanceof Error
              ? printErr.message
              : 'Day closed but print failed',
          )
        }
      }
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Failed to close shift'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold">Close shift (Z)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Count the drawer and enter the actual cash. This saves the Z report and
          ends the period.
        </p>

        <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <Row
            label="Opening float"
            value={formatMoney(dayState.openingFloat ?? 0)}
          />
          <Row label="Cash sales" value={formatMoney(summary.cashSales)} />
          <Row
            label="Cash refunds"
            value={`−${formatMoney(summary.cashRefundTotal)}`}
          />
          <Row label="Pay-ins" value={formatMoney(summary.payInTotal)} />
          <Row label="Pay-outs" value={`−${formatMoney(summary.payOutTotal)}`} />
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <span>Expected cash</span>
            <span>{formatMoney(summary.expectedCash)}</span>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Actual cash count</label>
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

        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            variance === 0
              ? 'bg-emerald-50 text-emerald-900'
              : variance > 0
                ? 'bg-sky-50 text-sky-900'
                : 'bg-red-50 text-red-900'
          }`}
        >
          {variance === 0
            ? 'Drawer matches expected cash.'
            : variance > 0
              ? `Overage: ${formatMoney(variance)}`
              : `Shortage: ${formatMoney(Math.abs(variance))}`}
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
            disabled={submitting || !isOnline}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Closing…' : 'Close & print Z'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-slate-700">
    <span>{label}</span>
    <span>{value}</span>
  </div>
)

export default CloseShiftModal
