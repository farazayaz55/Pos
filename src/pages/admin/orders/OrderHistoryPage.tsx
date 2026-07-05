import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useOrders } from '@/hooks/useOrders'
import { completeKioskCashOrder } from '@/services/orders'
import { formatMoney } from '@/utils/currency'
import LoadingScreen from '@/components/common/LoadingScreen'
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

type DateFilter = 'all' | 'today' | '7d'

const OrderHistoryPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { orders, loading } = useOrders(companyId)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [selected, setSelected] = useState<Order | null>(null)
  const [updating, setUpdating] = useState(false)

  const filtered = useMemo(() => {
    const now = Date.now()
    return orders.filter((o) => {
      if (dateFilter === 'today' && !isToday(o.createdAt)) return false
      if (dateFilter === '7d' && now - o.createdAt > 7 * 24 * 60 * 60 * 1000) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !String(o.orderNumber).includes(q) &&
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
    const total = filtered.reduce((s, o) => s + o.total, 0)
    return {
      count: filtered.length,
      revenue: total,
      avg: filtered.length ? total / filtered.length : 0,
    }
  }, [filtered])

  if (loading) return <LoadingScreen label="Loading orders..." />

  const handleMarkPaid = async (order: Order) => {
    if (!companyId) return
    setUpdating(true)
    try {
      await completeKioskCashOrder(companyId, order.id)
      toast.success(`Order #${order.orderNumber} completed`)
      setSelected(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update order'
      toast.error(msg)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
        <p className="text-sm text-slate-500">All orders including kiosk cash.</p>
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
                    <td className="px-4 py-2 font-semibold">#{o.orderNumber}</td>
                    <td className="px-4 py-2 text-slate-600">{formatDateTime(o.createdAt)}</td>
                    <td className="px-4 py-2 text-slate-600">{o.createdByName}</td>
                    <td className="px-4 py-2 text-slate-600">{o.tableNumber || '—'}</td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {o.items.reduce((s, it) => s + it.quantity, 0)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{formatMoney(o.total)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          o.status === 'completed'
                            ? 'badge-success'
                            : o.status === 'cancelled'
                              ? 'badge-muted'
                              : 'badge-warn'
                        }
                      >
                        {o.status}
                      </span>
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
          updating={updating}
        />
      )}
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
  updating,
}: {
  order: Order
  onClose: () => void
  onMarkPaid: () => void
  updating: boolean
}) => (
  <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/50">
    <div className="flex w-full max-w-md flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <div>
          <p className="text-xs text-slate-500">Order</p>
          <h3 className="text-lg font-bold">#{order.orderNumber}</h3>
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
      <div className="border-t border-slate-200 p-4">
        {order.orderSource === 'kiosk' &&
        order.paymentMethod === 'cash' &&
        order.paymentStatus === 'pending' &&
        order.status === 'pending' ? (
          <button
            onClick={onMarkPaid}
            className="btn-primary w-full"
            disabled={updating}
          >
            {updating ? 'Completing...' : 'Mark Paid & Complete'}
          </button>
        ) : (
          <Link
            to={`/admin/receipt/${order.id}`}
            className="btn-primary w-full"
            onClick={onClose}
          >
            Open Receipt
          </Link>
        )}
      </div>
    </div>
  </div>
)

export default OrderHistoryPage
