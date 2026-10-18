import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCartStore } from '@/stores/cartStore'
import { usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompany } from '@/hooks/useCompany'
import { canEditCashPosOrder } from '@/services/orders'
import { resolveOrder } from '@/services/localOrders'
import { printReceipt, PrintConfigError } from '@/services/printReceipt'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isLocalOrderId } from '@/localdb/db'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import type { Order } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import CachedImage from '@/components/common/CachedImage'

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const ReceiptPage = () => {
  const { orderId } = useParams()
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { company } = useCompany(companyId)
  const navigate = useNavigate()
  const loadFromOrder = useCartStore((s) => s.loadFromOrder)
  const cartLines = useCartStore((s) => s.lines)
  const editingOrderId = useCartStore((s) => s.editingOrderId)
  const autoPrint = usePosSettingsStore((s) => s.autoPrint)
  const { isOnline } = useOnlineStatus()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [editConfirmOpen, setEditConfirmOpen] = useState(false)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!companyId || !orderId) return
    void (async () => {
      try {
        const o = await resolveOrder(companyId, orderId)
        setOrder(o)
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId, orderId])

  const handlePrint = async (receiptOrder: Order) => {
    setPrinting(true)
    try {
      await printReceipt({ order: receiptOrder, company })
    } catch (err) {
      if (err instanceof PrintConfigError) {
        toast.error(err.message)
        navigate('/admin/settings')
      } else {
        toast.error(err instanceof Error ? err.message : 'Print failed')
      }
    } finally {
      setPrinting(false)
    }
  }

  useEffect(() => {
    if (!order || !autoPrint) return
    const t = setTimeout(() => {
      void handlePrint(order)
    }, 350)
    return () => clearTimeout(t)
    // Print once when the receipt order loads (or autoPrint toggles on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, autoPrint])

  const startEdit = (o: Order) => {
    loadFromOrder(o)
    setEditConfirmOpen(false)
    toast.success(`Editing order #${formatOrderNumber(o.orderNumber)}`)
    navigate('/admin/pos')
  }

  const handleEditRequest = () => {
    if (!order) return
    const cartBusy = cartLines.length > 0 && editingOrderId !== order.id
    if (cartBusy) {
      setEditConfirmOpen(true)
      return
    }
    startEdit(order)
  }

  if (loading) return <LoadingScreen label="Loading receipt..." />
  if (!order) {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-500">Order not found.</p>
        <Link to="/admin/pos" className="btn-primary mt-4 inline-flex">
          Back to POS
        </Link>
      </div>
    )
  }

  const isLocalPending =
    isLocalOrderId(order.id) ||
    order.syncStatus === 'pending' ||
    order.syncStatus === 'syncing' ||
    order.syncStatus === 'error'
  const canEdit =
    canEditCashPosOrder(order) && (isLocalPending || isOnline)

  return (
    <div className="min-h-full bg-slate-100 py-6">
      <div className="no-print mx-auto mb-4 flex max-w-md flex-wrap justify-between gap-2 px-4">
        <button onClick={() => navigate('/admin/pos')} className="btn-secondary">
          &larr; New order
        </button>
        <div className="flex gap-2">
          {canEdit && (
            <button
              onClick={handleEditRequest}
              className="btn-secondary"
              disabled={!isLocalPending && !isOnline}
            >
              Edit Order
            </button>
          )}
          <button
            onClick={() => void handlePrint(order)}
            className="btn-primary"
            disabled={printing}
          >
            {printing ? 'Printing…' : 'Print'}
          </button>
        </div>
      </div>

      {isLocalPending && (
        <div className="no-print mx-auto mb-3 max-w-md px-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {order.syncStatus === 'error'
              ? `Sync failed${order.syncError ? `: ${order.syncError}` : ''}. Will retry when online.`
              : 'Pending sync — provisional order # until uploaded.'}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={editConfirmOpen}
        title="Replace current cart?"
        message={
          <>
            Your cart has items. Load order #{formatOrderNumber(order.orderNumber)} for editing and
            discard the current cart?
          </>
        }
        confirmLabel="Edit order"
        onConfirm={() => startEdit(order)}
        onCancel={() => setEditConfirmOpen(false)}
      />

      <div
        id="receipt"
        className="mx-auto max-w-[320px] bg-white p-4 font-mono text-[12px] leading-snug text-slate-900 shadow"
      >
        <div className="text-center">
          {company?.logoUrl && (
            <CachedImage
              src={company.logoUrl}
              companyId={companyId}
              alt=""
              className="mx-auto mb-2 h-14 w-14 rounded object-cover"
            />
          )}
          <h1 className="text-base font-bold uppercase">{company?.name || 'Restaurant'}</h1>
          {company?.location && (
            <p className="text-[11px]">{company.location}</p>
          )}
          {company?.phone && <p className="text-[11px]">{company.phone}</p>}
        </div>

        <hr className="my-2 border-dashed border-slate-300" />

        <div className="space-y-0.5">
          <div className="flex justify-between">
            <span>Order #</span>
            <span className="font-bold">{formatOrderNumber(order.orderNumber)}</span>
          </div>
          <div className="flex justify-between">
            <span>Date</span>
            <span>{formatDate(order.createdAt)}</span>
          </div>
          {order.tableNumber && (
            <div className="flex justify-between">
              <span>Table</span>
              <span>{order.tableNumber}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Cashier</span>
            <span>{order.createdByName}</span>
          </div>
        </div>

        <hr className="my-2 border-dashed border-slate-300" />

        <table className="w-full">
          <tbody>
            {order.items.map((it) => (
              <tr key={it.lineId} className="align-top">
                <td className="py-1">
                  <div className="font-semibold">
                    {it.quantity} x {it.itemName}
                  </div>
                  {(it.modifiers?.length ?? 0) > 0 && (
                    <ul className="pl-3 text-[11px] text-slate-600">
                      {(it.modifiers ?? []).map((m, idx) => (
                        <li key={idx}>
                          + {m.optionName}
                          {m.priceAdjustment !== 0 &&
                            ` (${m.priceAdjustment > 0 ? '+' : ''}${formatMoney(m.priceAdjustment)})`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {it.note && (
                    <p className="pl-3 text-[11px] italic">"{it.note}"</p>
                  )}
                </td>
                <td className="whitespace-nowrap py-1 text-right font-semibold">
                  {formatMoney(it.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="my-2 border-dashed border-slate-300" />

        <div className="space-y-0.5">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          {order.discount.amount > 0 && (
            <div className="flex justify-between">
              <span>
                Discount
                {order.discount.type === 'percent' ? ` (${order.discount.value}%)` : ''}
              </span>
              <span>-{formatMoney(order.discount.amount)}</span>
            </div>
          )}
          {(order.taxLines ?? []).map((line) => (
            <div key={`${line.name}-${line.rate}`} className="flex justify-between">
              <span>
                {line.name} ({Math.round(line.rate * 10000) / 100}%)
              </span>
              <span>{formatMoney(line.amount)}</span>
            </div>
          ))}
          {!(order.taxLines && order.taxLines.length > 0) &&
            order.tax != null &&
            order.tax > 0 && (
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{formatMoney(order.tax)}</span>
              </div>
            )}
          {order.tip != null && order.tip > 0 && (
            <div className="flex justify-between">
              <span>Tip</span>
              <span>{formatMoney(order.tip)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>TOTAL</span>
            <span>{formatMoney(order.total)}</span>
          </div>
          {order.paymentStatus === 'refunded' ? (
            <div className="flex justify-between font-bold uppercase">
              <span>Status</span>
              <span>Refunded</span>
            </div>
          ) : order.paymentMethod === 'cash' ? (
            order.paymentStatus === 'pending' ? (
              <>
                <div className="flex justify-between">
                  <span>Cash due</span>
                  <span>{formatMoney(order.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Status</span>
                  <span className="uppercase">Pending</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Cash</span>
                  <span>{formatMoney(order.cashReceived ?? 0)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Change</span>
                  <span>{formatMoney(order.change ?? 0)}</span>
                </div>
              </>
            )
          ) : (
            <div className="flex justify-between">
              <span>Paid</span>
              <span className="capitalize">{order.paymentMethod.replace('_', ' ')}</span>
            </div>
          )}
        </div>

        <hr className="my-2 border-dashed border-slate-300" />
        {order.paymentStatus === 'refunded' ? (
          <>
            <p className="text-center text-sm font-bold uppercase tracking-wide">
              REFUNDED
            </p>
            {order.refundedAt && (
              <p className="text-center text-[10px] text-slate-500">
                {formatDate(order.refundedAt)}
                {order.refundedByName ? ` · ${order.refundedByName}` : ''}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-center text-[11px]">Thank you!</p>
            <p className="text-center text-[10px] text-slate-500">
              {order.paymentMethod === 'cash'
                ? order.paymentStatus === 'pending'
                  ? 'Payment pending'
                  : 'Paid in cash'
                : order.orderSource === 'kiosk'
                  ? 'Self-service kiosk order'
                  : 'Paid by card'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default ReceiptPage
