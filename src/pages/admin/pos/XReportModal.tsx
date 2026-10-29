import { useState } from 'react'
import toast from 'react-hot-toast'
import { printXzReport } from '@/services/printReport'
import { PrintConfigError } from '@/services/printReceipt'
import { formatMoney } from '@/utils/currency'
import type { DayState, XzReportSummary } from '@/types'
import type { ReceiptCompanyInfo } from '@/utils/receiptText'

interface Props {
  open: boolean
  dayState: DayState
  summary: XzReportSummary
  companyInfo?: ReceiptCompanyInfo
  branchName?: string
  printedByName?: string
  onClose: () => void
}

const XReportModal = ({
  open,
  dayState,
  summary,
  companyInfo,
  branchName,
  printedByName,
  onClose,
}: Props) => {
  const [printing, setPrinting] = useState(false)

  if (!open) return null

  const handlePrint = async () => {
    setPrinting(true)
    try {
      await printXzReport({
        kind: 'x',
        company: companyInfo,
        branchName,
        dayState,
        summary,
        printedByName,
      })
      toast.success('X Report sent to printer')
    } catch (err) {
      if (err instanceof PrintConfigError) {
        toast.error(err.message)
      } else {
        toast.error(err instanceof Error ? err.message : 'Print failed')
      }
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold">X Report</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mid-shift snapshot. The day stays open.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Orders" value={String(summary.orderCount)} />
          <Stat label="Gross sales" value={formatMoney(summary.grossSales)} />
          <Stat label="Opening float" value={formatMoney(summary.openingFloat)} />
          <Stat label="Cash sales" value={formatMoney(summary.cashSales)} />
          <Stat label="Pay-ins" value={formatMoney(summary.payInTotal)} />
          <Stat label="Pay-outs" value={formatMoney(summary.payOutTotal)} />
          <Stat
            label="Expected cash"
            value={formatMoney(summary.expectedCash)}
            wide
          />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Opened {new Date(dayState.openedAt).toLocaleString()} ·{' '}
          {dayState.businessDate}
        </p>

        <div className="mt-6 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary flex-[2]"
            disabled={printing}
            onClick={() => void handlePrint()}
          >
            {printing ? 'Printing…' : 'Print X Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Stat = ({
  label,
  value,
  wide,
}: {
  label: string
  value: string
  wide?: boolean
}) => (
  <div
    className={`rounded-lg border border-slate-200 bg-white px-3 py-2 ${
      wide ? 'col-span-2' : ''
    }`}
  >
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-0.5 font-semibold text-slate-900">{value}</div>
  </div>
)

export default XReportModal
