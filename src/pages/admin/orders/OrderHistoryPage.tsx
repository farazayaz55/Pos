import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCartStore } from '@/stores/cartStore'
import { useOrders } from '@/hooks/useOrders'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { canEditCashPosOrder, completeKioskCashOrder } from '@/services/orders'
import { refundOrder } from '@/services/functionsApi'
import { retryOutboxOrder, syncPendingOrdersWithToast } from '@/localdb/syncOrders'
import { isLocalOrderId } from '@/localdb/db'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import type { Order } from '@/types'

const formatDateTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

const isToday = (ts: number) => {
  const d = new Date(ts)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

const isRevenueOrder = (o: Order) =>
  o.paymentStatus === 'paid' && o.status === 'completed'

type DateFilter = 'all' | 'today' | '7d'

const isPendingSync = (o: Order) =>
  o.syncStatus === 'pending' ||
  o.syncStatus === 'syncing' ||
  o.syncStatus === 'error' ||
  isLocalOrderId(o.id)

const OrderHistoryPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { orders, loading } = useOrders(companyId)
  const { isOnline } = useOnlineStatus()
  const navigate = useNavigate()
  const loadFromOrder = useCartStore((s) => s.loadFromOrder)
  const cartLines = useCartStore((s) => s.lines)
  const editingOrderId = useCartStore((s) => s.editingOrderId)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [selected, setSelected] = useState<Order | null>(null)
  const [updating, setUpdating] = useState(false)
  const [refundConfirm, setRefundConfirm] = useState<Order | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [editConfirm, setEditConfirm] = useState<Order | null>(null)
  const [syncing, setSyncing] = useState(false)

  const filtered = useMemo(() => {
    const now = Date.now()
    return orders.filter((o) => {
      if (dateFilter === 'today' && !isToday(o.createdAt)) return false
      if (dateFilter === '7d' && now - o.createdAt > 7 * 24 * 60 * 60 * 1000) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !String(o.orderNumber).includes(q) &&
          !formatOrderNumber(o.orderNumber).includes(q) &&
          !(o.tableNumber || '').toLowerCase().includes(q) &&
          !o.createdByName.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [orders, dateFilter, search])

  const stats = useMemo(() => {
    const revenueOrders = filtered.filter(isRevenueOrder)
    const total = revenueOrders.reduce((s, o) => s + o.total, 0)
    return {
      count: revenueOrders.length,
      revenue: total,
      avg: revenueOrders.length ? total / revenueOrders.length : 0,
    }
  }, [filtered])

  if (loading) return <LoadingScreen label="Loading orders..." />

  const handleMarkPaid = async (order: Order) => {
    if (!companyId) return
    setUpdating(true)
    try {
      await completeKioskCashOrder(companyId, order.id)
      toast.success(`Order #${formatOrderNumber(order.orderNumber)} completed`)
      setSelected(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update order'
      toast.error(msg)
    } finally {
      setUpdating(false)
    }
  }

  const handleRefund = async () => {
    if (!companyId || !refundConfirm) return
    if (!isOnline) {
      toast.error('Refunds require an internet connection')
      return
    }
    if (isPendingSync(refundConfirm)) {
      toast.error('Wait until this order has synced before refunding')
      return
    }
    setRefunding(true)
    try {
      const result = await refundOrder({
        companyId,
        orderId: refundConfirm.id,
      })
      if (result.data.alreadyRefunded) {
        toast.success(`Order #${formatOrderNumber(refundConfirm.orderNumber)} was already refunded`)
      } else {
        toast.success(`Order #${formatOrderNumber(refundConfirm.orderNumber)} refunded`)
      }
      setRefundConfirm(null)
      setSelected(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to refund order'
      toast.error(msg)
    } finally {
      setRefunding(false)
    }
  }

  const startEdit = (order: Order) => {
    if (!isPendingSync(order) && !isOnline) {
      toast.error('Editing synced orders requires an internet connection')
      return
    }
    loadFromOrder(order)
    setEditConfirm(null)
    setSelected(null)
    toast.success(`Editing order #${formatOrderNumber(order.orderNumber)}`)
    navigate('/admin/pos')
  }

  const handleEditRequest = (order: Order) => {
    const cartBusy =
      cartLines.length > 0 && editingOrderId !== order.id
    if (cartBusy) {
      setEditConfirm(order)
      return
    }
    startEdit(order)
  }

  const handleRetrySync = async (order: Order) => {
    if (!isOnline) {
      toast.error('Connect to the internet to sync')
      return
    }
    setSyncing(true)
    try {
      await retryOutboxOrder(order.clientLocalId || order.id)
      setSelected(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncAll = async () => {
    if (!isOnline) {
      toast.error('Connect to the internet to sync')
      return
    }
    setSyncing(true)
    try {
      await syncPendingOrdersWithToast(companyId)
    } finally {
      setSyncing(false)
    }
  }

  const pendingCount = orders.filter(isPendingSync).length

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500">All orders including kiosk cash.</p>
        </div>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={!isOnline || syncing}
            className="btn-secondary text-xs"
          >
            {syncing
              ? 'Syncing…'
              : `Retry sync (${pendingCount})`}
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Orders" value={String(stats.count)} />
        <StatCard label="Revenue" value={formatMoney(stats.revenue)} />
        <StatCard label="Avg / order" value={formatMoney(stats.avg)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search order #, table, cashier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-xs"
        />
        <div className="flex gap-1">
          {(['today', '7d', 'all'] as DateFilter[]).map((d) => (
            <button
              key={d}
              onClick={() => setDateFilter(d)}
              className={
                dateFilter === d
                  ? 'rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white'
                  : 'rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200'
              }
            >
              {d === 'today' ? 'Today' : d === '7d' ? 'Last 7 days' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">No orders match.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Order #</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Cashier</th>
                  <th className="px-4 py-2 text-left">Table</th>
                  <th className="px-4 py-2 text-right">Items</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-semibold">#{formatOrderNumber(o.orderNumber)}</td>
                    <td className="px-4 py-2 text-slate-600">{formatDateTime(o.createdAt)}</td>
                    <td className="px-4 py-2 text-slate-600">{o.createdByName}</td>
                    <td className="px-4 py-2 text-slate-600">{o.tableNumber || '—'}</td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {o.items.reduce((s, it) => s + it.quantity, 0)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{formatMoney(o.total)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={
                            o.status === 'completed'
                              ? 'badge-success'
                              : o.status === 'cancelled'
                                ? 'badge-muted'
                                : 'badge-warn'
                          }
                        >
                          {o.paymentStatus === 'refunded' ? 'refunded' : o.status}
                        </span>
                        {o.syncStatus === 'error' && (
                          <span className="badge-warn">sync failed</span>
                        )}
                        {(o.syncStatus === 'pending' || o.syncStatus === 'syncing') && (
                          <span className="badge-warn">pending sync</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setSelected(o)}
                          className="text-xs text-brand-700 hover:underline"
                        >
                          View
                        </button>
                        <Link
                          to={`/admin/receipt/${o.id}`}
                          className="text-xs text-slate-600 hover:underline"
                        >
                          Receipt
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <OrderDetailDrawer
          order={selected}
          onClose={() => setSelected(null)}
          onMarkPaid={() => handleMarkPaid(selected)}
          onRefund={() => setRefundConfirm(selected)}
          onEdit={() => handleEditRequest(selected)}
          onRetrySync={() => void handleRetrySync(selected)}
          updating={updating || syncing}
          isOnline={isOnline}
        />
      )}

      <ConfirmDialog
        open={!!editConfirm}
        title={`Replace current cart?`}
        message={
          <>
            Your cart has items. Load order #{editConfirm ? formatOrderNumber(editConfirm.orderNumber) : ''} for editing
            and discard the current cart?
          </>
        }
        confirmLabel="Edit order"
        onConfirm={() => editConfirm && startEdit(editConfirm)}
        onCancel={() => setEditConfirm(null)}
      />

      <ConfirmDialog
        open={!!refundConfirm}
        title={`Refund order #${refundConfirm ? formatOrderNumber(refundConfirm.orderNumber) : ''}?`}
        message={
          refundConfirm?.paymentMethod === 'cash' ? (
            <>
              This marks the order as refunded. Return{' '}
              <b>{formatMoney(refundConfirm.total)}</b> cash to the customer.
            </>
          ) : (
            <>
              Stripe will reverse the card charge of{' '}
              <b>{formatMoney(refundConfirm?.total ?? 0)}</b>.
            </>
          )
        }
        confirmLabel="Refund"
        destructive
        busy={refunding}
        onConfirm={() => void handleRefund()}
        onCancel={() => !refunding && setRefundConfirm(null)}
      />
    </div>
  )
}

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="card p-4">
    <p className="text-xs uppercase text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
  </div>
)

const OrderDetailDrawer = ({
  order,
  onClose,
  onMarkPaid,
  onRefund,
  onEdit,
  onRetrySync,
  updating,
  isOnline,
}: {
  order: Order
  onClose: () => void
  onMarkPaid: () => void
  onRefund: () => void
  onEdit: () => void
  onRetrySync: () => void
  updating: boolean
  isOnline: boolean
}) => {
  const pendingSync = isPendingSync(order)

  const canMarkPaid =
    order.orderSource === 'kiosk' &&
    order.paymentMethod === 'cash' &&
    order.paymentStatus === 'pending' &&
    order.status === 'pending' &&
    isOnline

  const canRefund =
    order.status === 'completed' &&
    order.paymentStatus === 'paid' &&
    !pendingSync &&
    isOnline

  const canEdit =
    canEditCashPosOrder(order) && (pendingSync || isOnline)

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/50">
      <div className="flex w-full max-w-md flex-col bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-xs text-slate-500">Order</p>
            <h3 className="text-lg font-bold">#{formatOrderNumber(order.orderNumber)}</h3>
          </div>
          <button onClick={onClose} className="btn-ghost p-1">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
            <div>
              <p className="text-slate-500">Date</p>
              <p className="font-medium">{formatDateTime(order.createdAt)}</p>
            </div>
            <div>
              <p className="text-slate-500">Cashier</p>
              <p className="font-medium">{order.createdByName}</p>
            </div>
            {order.tableNumber && (
              <div>
                <p className="text-slate-500">Table</p>
                <p className="font-medium">{order.tableNumber}</p>
              </div>
            )}
            <div>
              <p className="text-slate-500">Status</p>
              <p className="font-medium">{order.status}</p>
            </div>
            <div>
              <p className="text-slate-500">Payment</p>
              <p className="font-medium">
                {order.paymentStatus} ({order.paymentMethod.replace('_', ' ')})
              </p>
            </div>
            {pendingSync && (
              <div className="col-span-2">
                <p className="text-slate-500">Sync</p>
                <p className="font-medium">
                  {order.syncStatus === 'error'
                    ? `Failed${order.syncError ? `: ${order.syncError}` : ''}`
                    : order.syncStatus === 'syncing'
                      ? 'Syncing…'
                      : 'Pending sync'}
                </p>
              </div>
            )}
            {order.refundedAt && (
              <div className="col-span-2">
                <p className="text-slate-500">Refunded</p>
                <p className="font-medium">
                  {formatDateTime(order.refundedAt)}
                  {order.refundedByName ? ` by ${order.refundedByName}` : ''}
                </p>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Items</h4>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {order.items.map((it) => (
                <li key={it.lineId} className="p-3">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {it.quantity} x {it.itemName}
                    </span>
                    <span className="font-bold">{formatMoney(it.lineTotal)}</span>
                  </div>
                  {(it.modifiers?.length ?? 0) > 0 && (
                    <ul className="mt-1 pl-3 text-xs text-slate-500">
                      {(it.modifiers ?? []).map((m, idx) => (
                        <li key={idx}>+ {m.optionName}</li>
                      ))}
                    </ul>
                  )}
                  {it.note && (
                    <p className="mt-1 pl-3 text-xs italic text-slate-400">"{it.note}"</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotal)}</span>
            </div>
            {order.discount.amount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount</span>
                <span>-{formatMoney(order.discount.amount)}</span>
              </div>
            )}
            {(order.taxLines ?? []).map((line) => (
              <div
                key={`${line.name}-${line.rate}`}
                className="flex justify-between text-slate-600"
              >
                <span>
                  {line.name} ({Math.round(line.rate * 10000) / 100}%)
                </span>
                <span>{formatMoney(line.amount)}</span>
              </div>
            ))}
            {!(order.taxLines && order.taxLines.length > 0) &&
              order.tax != null &&
              order.tax > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span>{formatMoney(order.tax)}</span>
                </div>
              )}
            {order.tip != null && order.tip > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Tip</span>
                <span>{formatMoney(order.tip)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
              <span>Total</span>
              <span>{formatMoney(order.total)}</span>
            </div>
            {order.paymentMethod === 'cash' && (
              <>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Cash</span>
                  <span>{formatMoney(order.cashReceived ?? 0)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Change</span>
                  <span>{formatMoney(order.change ?? 0)}</span>
                </div>
              </>
            )}
            {order.paymentMethod !== 'cash' && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Payment</span>
                <span className="capitalize">{order.paymentMethod.replace('_', ' ')}</span>
              </div>
            )}
          </div>

          {order.discount.amount > 0 && order.discount.appliedByName && (
            <p className="text-xs text-slate-500">
              Discount applied by <b>{order.discount.appliedByName}</b>
              {order.discount.at && <> on {formatDateTime(order.discount.at)}</>}
            </p>
          )}
        </div>
        <div className="space-y-2 border-t border-slate-200 p-4">
          {canMarkPaid ? (
            <button
              onClick={onMarkPaid}
              className="btn-primary w-full"
              disabled={updating}
            >
              {updating ? 'Completing...' : 'Mark Paid & Complete'}
            </button>
          ) : (
            <>
              <Link
                to={`/admin/receipt/${order.id}`}
                className="btn-primary w-full"
                onClick={onClose}
              >
                Open Receipt
              </Link>
              {pendingSync && (
                <button
                  onClick={onRetrySync}
                  className="btn-secondary w-full"
                  disabled={updating || !isOnline}
                >
                  {updating ? 'Syncing…' : 'Retry sync'}
                </button>
              )}
              {canEdit && (
                <button
                  onClick={onEdit}
                  className="btn-secondary w-full"
                  disabled={updating}
                >
                  Edit Order
                </button>
              )}
              {canRefund && (
                <button
                  onClick={onRefund}
                  className="btn-danger w-full"
                  disabled={updating}
                >
                  Refund
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrderHistoryPage
