import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useAuthStore } from '@/stores/authStore'
import { useCompany } from '@/hooks/useCompany'
import { useBranches } from '@/hooks/useBranches'
import { useOrders } from '@/hooks/useOrders'
import { useDayState } from '@/hooks/useDayState'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { subscribeZReports } from '@/services/dayState'
import { printXzReport } from '@/services/printReport'
import { PrintConfigError } from '@/services/printReceipt'
import {
  aggregateZReports,
  buildXzReportSummary,
  businessDateDaysAgo,
  filterOrdersForPeriod,
  filterZReportsByDateRange,
} from '@/utils/xzReport'
import { businessDateUtc } from '@/utils/businessDate'
import { formatMoney } from '@/utils/currency'
import { receiptCompanyInfo } from '@/utils/receiptText'
import LoadingScreen from '@/components/common/LoadingScreen'
import OpenFloatModal from '@/pages/admin/pos/OpenFloatModal'
import CloseShiftModal from '@/pages/admin/pos/CloseShiftModal'
import type { XzReportSummary, ZReport } from '@/types'

type PeriodPreset = '7' | '30' | 'all' | 'custom'

const formatDateTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

const SummaryGrid = ({
  summary,
  cash,
}: {
  summary: XzReportSummary
  cash?: { actualCash?: number; cashVariance?: number }
}) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <Stat label="Orders" value={String(summary.orderCount)} />
    <Stat label="Gross sales" value={formatMoney(summary.grossSales)} />
    <Stat label="Avg / order" value={formatMoney(summary.avgTicket)} />
    <Stat label="Subtotal" value={formatMoney(summary.subtotal)} />
    <Stat label="Discounts" value={formatMoney(summary.discount)} />
    <Stat label="Tax" value={formatMoney(summary.tax)} />
    <Stat label="Tips" value={formatMoney(summary.tip)} />
    <Stat label="Cash sales" value={formatMoney(summary.cashSales ?? 0)} />
    <Stat label="Card reader" value={formatMoney(summary.byPaymentMethod.card_reader)} />
    <Stat label="Tap to pay" value={formatMoney(summary.byPaymentMethod.tap_to_pay)} />
    <Stat label="Opening float" value={formatMoney(summary.openingFloat ?? 0)} />
    <Stat label="Pay-ins" value={formatMoney(summary.payInTotal ?? 0)} />
    <Stat label="Pay-outs" value={formatMoney(summary.payOutTotal ?? 0)} />
    <Stat label="Expected cash" value={formatMoney(summary.expectedCash ?? 0)} />
    {cash && typeof cash.actualCash === 'number' && (
      <>
        <Stat label="Actual cash" value={formatMoney(cash.actualCash)} />
        <Stat
          label={
            (cash.cashVariance ?? 0) === 0
              ? 'Variance'
              : (cash.cashVariance ?? 0) > 0
                ? 'Overage'
                : 'Shortage'
          }
          value={formatMoney(Math.abs(cash.cashVariance ?? 0))}
        />
      </>
    )}
    <Stat label="Refunds" value={String(summary.refundCount)} />
    <Stat label="Refund total" value={formatMoney(summary.refundTotal)} />
  </div>
)

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-0.5 text-lg font-semibold text-slate-900">{value}</div>
  </div>
)

const XzReportsPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const branchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const user = useAuthStore((s) => s.user)
  const { company } = useCompany(companyId || undefined)
  const { branches } = useBranches(companyId || undefined)
  const branch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId],
  )
  const { orders, loading: ordersLoading } = useOrders(
    companyId || undefined,
    branchId || undefined,
  )
  const { dayState, movements, loading: dayLoading, isOpen } = useDayState(
    companyId || undefined,
    branchId || undefined,
  )
  const { isOnline } = useOnlineStatus()

  const [zReports, setZReports] = useState<ZReport[]>([])
  const [selectedZ, setSelectedZ] = useState<ZReport | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [showOpenFloat, setShowOpenFloat] = useState(false)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('30')
  const [customFrom, setCustomFrom] = useState(() => businessDateDaysAgo(29))
  const [customTo, setCustomTo] = useState(() => businessDateUtc())

  useEffect(() => {
    if (!companyId || !branchId) {
      setZReports([])
      return
    }
    return subscribeZReports(companyId, branchId, setZReports)
  }, [companyId, branchId])

  const periodOrders = useMemo(
    () => filterOrdersForPeriod(orders, dayState),
    [orders, dayState],
  )
  const xSummary = useMemo(
    () =>
      buildXzReportSummary(periodOrders, {
        openingFloat: dayState?.openingFloat ?? 0,
        movements,
      }),
    [periodOrders, dayState?.openingFloat, movements],
  )

  const periodRange = useMemo(() => {
    if (periodPreset === 'all') {
      return { from: null as string | null, to: null as string | null }
    }
    if (periodPreset === 'custom') {
      const from = customFrom || null
      const to = customTo || null
      if (from && to && from > to) {
        return { from: to, to: from }
      }
      return { from, to }
    }
    const to = businessDateUtc()
    const days = periodPreset === '7' ? 6 : 29
    return { from: businessDateDaysAgo(days), to }
  }, [periodPreset, customFrom, customTo])

  const selectPreset = (preset: PeriodPreset) => {
    if (preset === 'custom' && periodPreset !== 'custom') {
      // Seed custom fields from the previous quick range when entering custom.
      if (periodPreset === 'all') {
        setCustomFrom(businessDateDaysAgo(29))
        setCustomTo(businessDateUtc())
      } else {
        const days = periodPreset === '7' ? 6 : 29
        setCustomFrom(businessDateDaysAgo(days))
        setCustomTo(businessDateUtc())
      }
    }
    setPeriodPreset(preset)
  }

  const filteredPeriodReports = useMemo(
    () =>
      filterZReportsByDateRange(zReports, periodRange.from, periodRange.to),
    [zReports, periodRange.from, periodRange.to],
  )

  const periodSummary = useMemo(
    () => aggregateZReports(filteredPeriodReports),
    [filteredPeriodReports],
  )

  const companyInfo = receiptCompanyInfo(company, branch)

  const handlePrintX = async () => {
    if (!dayState || !isOpen) {
      toast.error('No open period')
      return
    }
    setPrinting(true)
    try {
      await printXzReport({
        kind: 'x',
        company: companyInfo,
        branchName: branch?.name,
        dayState,
        summary: xSummary,
        printedByName: user?.name,
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

  const handlePrintZ = async (report: ZReport) => {
    setPrinting(true)
    try {
      await printXzReport({
        kind: 'z',
        company: companyInfo,
        branchName: branch?.name,
        report,
      })
      toast.success('Z Report sent to printer')
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

  const handlePrintPeriodSummary = async () => {
    if (periodSummary.periodCount === 0) {
      toast.error('No Z reports in this range')
      return
    }
    setPrinting(true)
    try {
      await printXzReport({
        kind: 'z_period',
        company: companyInfo,
        branchName: branch?.name,
        summary: periodSummary,
        rangeFrom: periodRange.from ?? periodSummary.fromBusinessDate,
        rangeTo: periodRange.to ?? periodSummary.toBusinessDate,
        printedByName: user?.name,
      })
      toast.success('Period summary sent to printer')
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

  if (!companyId || !branchId) {
    return (
      <div className="p-6 text-sm text-slate-600">
        Select a branch to view X / Z reports.
      </div>
    )
  }

  if (ordersLoading || dayLoading) {
    return <LoadingScreen label="Loading reports..." />
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">X / Z Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          X is a live mid-shift snapshot. Z closes the period after an actual
          cash count, saves the report, and requires a new opening float before
          the next shift.
        </p>
      </div>

      <section className="card mb-6 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Current period (X)
            </h2>
            {isOpen && dayState ? (
              <p className="mt-1 text-sm text-slate-600">
                Business date {dayState.businessDate} · opened{' '}
                {formatDateTime(dayState.openedAt)}
                {dayState.openedByName ? ` by ${dayState.openedByName}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                No open shift. Enter opening float on POS (or below) to start.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isOpen && (
              <button
                type="button"
                className="btn-primary"
                disabled={!isOnline}
                onClick={() => setShowOpenFloat(true)}
              >
                Open shift
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              disabled={!isOpen || printing}
              onClick={() => void handlePrintX()}
            >
              {printing ? 'Printing…' : 'Print X Report'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!isOpen || !isOnline}
              onClick={() => setCloseOpen(true)}
              title={!isOnline ? 'Z Report requires internet' : undefined}
            >
              Run Z Report
            </button>
          </div>
        </div>

        {isOpen ? (
          <>
            <SummaryGrid summary={xSummary} />
            {movements.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">
                  Cash movements
                </h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {movements.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium capitalize text-slate-900">
                          {m.type === 'pay_in' ? 'Cash in' : 'Cash out'}
                        </span>
                        <span className="text-slate-500"> — {m.reason}</span>
                      </div>
                      <div className="font-semibold text-slate-900">
                        {m.type === 'pay_out' ? '−' : '+'}
                        {formatMoney(m.amount)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Open a shift with an opening float to see live expected cash.
          </p>
        )}

        {!isOnline && (
          <p className="mt-3 text-sm text-amber-700">
            You are offline. X Report can still print from local data; opening
            float and Z Report require a connection.
          </p>
        )}
      </section>

      {selectedZ && (
        <section className="card mb-6 border-emerald-200 bg-emerald-50/40 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Z Report detail</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={printing}
                onClick={() => void handlePrintZ(selectedZ)}
              >
                Reprint
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelectedZ(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            Closed {formatDateTime(selectedZ.closedAt)} by {selectedZ.closedByName}
          </p>
          <SummaryGrid summary={selectedZ} cash={selectedZ} />
        </section>
      )}

      <section className="card mb-6 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Period summary
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Combined totals from closed Z reports
              {periodSummary.periodCount > 0
                ? ` · ${periodSummary.periodCount} report${
                    periodSummary.periodCount === 1 ? '' : 's'
                  } · ${
                    periodRange.from ??
                    periodSummary.fromBusinessDate ??
                    '—'
                  } to ${
                    periodRange.to ?? periodSummary.toBusinessDate ?? '—'
                  }`
                : periodPreset === 'custom' &&
                    (periodRange.from || periodRange.to)
                  ? ` · ${periodRange.from ?? '…'} to ${periodRange.to ?? '…'}`
                  : ''}
              . Cash drawer figures are summed across shifts (audit totals).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: '7' as const, label: 'Last 7 days' },
                { id: '30' as const, label: 'Last 30 days' },
                { id: 'all' as const, label: 'All' },
                { id: 'custom' as const, label: 'Custom' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                className={
                  periodPreset === p.id ? 'btn-primary' : 'btn-secondary'
                }
                onClick={() => selectPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={printing || periodSummary.periodCount === 0}
              onClick={() => void handlePrintPeriodSummary()}
            >
              {printing ? 'Printing…' : 'Print summary'}
            </button>
          </div>
        </div>

        {periodPreset === 'custom' && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="period-from">
                From
              </label>
              <input
                id="period-from"
                type="date"
                className="input w-auto"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="period-to">
                To
              </label>
              <input
                id="period-to"
                type="date"
                className="input w-auto"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}

        {periodSummary.periodCount === 0 ? (
          <p className="text-sm text-slate-600">
            No closed Z reports in this date range.
          </p>
        ) : (
          <SummaryGrid
            summary={periodSummary}
            cash={{
              actualCash: periodSummary.actualCash,
              cashVariance: periodSummary.cashVariance,
            }}
          />
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Closed Z Reports
        </h2>
        {zReports.length === 0 ? (
          <p className="text-sm text-slate-600">No Z reports yet for this branch.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {zReports.map((r) => (
              <li
                key={r.periodId}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setSelectedZ(r)}
                >
                  <div className="font-medium text-slate-900">
                    {r.businessDate} · {formatMoney(r.grossSales)}
                  </div>
                  <div className="text-sm text-slate-500">
                    {r.orderCount} orders · expected {formatMoney(r.expectedCash)} ·
                    actual {formatMoney(r.actualCash ?? 0)} · closed{' '}
                    {formatDateTime(r.closedAt)}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={printing}
                  onClick={() => void handlePrintZ(r)}
                >
                  Reprint
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showOpenFloat && !isOpen && (
        <OpenFloatModal
          companyId={companyId}
          branchId={branchId}
          onOpened={() => setShowOpenFloat(false)}
        />
      )}

      {isOpen && dayState && (
        <CloseShiftModal
          open={closeOpen}
          companyId={companyId}
          branchId={branchId}
          dayState={dayState}
          summary={xSummary}
          companyInfo={companyInfo}
          branchName={branch?.name}
          onClose={() => setCloseOpen(false)}
          onClosed={(report) => {
            setCloseOpen(false)
            setSelectedZ(report)
          }}
        />
      )}
    </div>
  )
}

export default XzReportsPage
