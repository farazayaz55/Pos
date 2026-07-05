import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompany } from '@/hooks/useCompany'
import { getOrder } from '@/services/orders'
import { formatMoney } from '@/utils/currency'
import type { Order } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'

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
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId || !orderId) return
    void (async () => {
      try {
        const o = await getOrder(companyId, orderId)
        setOrder(o)
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId, orderId])

  useEffect(() => {
    if (order) {
      const t = setTimeout(() => window.print(), 350)
      return () => clearTimeout(t)
    }
  }, [order])

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

  return (
    <div className="min-h-full bg-slate-100 py-6">
      <div className="no-print mx-auto mb-4 flex max-w-md justify-between px-4">
        <button onClick={() => navigate('/admin/pos')} className="btn-secondary">
          &larr; New order
        </button>
        <button onClick={() => window.print()} className="btn-primary">
          Print
        </button>
      </div>

      <div
        id="receipt"
        className="mx-auto max-w-[320px] bg-white p-4 font-mono text-[12px] leading-snug text-slate-900 shadow"
      >
        <div className="text-center">
          {company?.logoUrl && (
            <img
              src={company.logoUrl}
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
            <span className="font-bold">{order.orderNumber}</span>
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
          <div className="flex justify-between text-base font-bold">
            <span>TOTAL</span>
            <span>{formatMoney(order.total)}</span>
          </div>
          {order.paymentMethod === 'cash' ? (
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
      </div>
    </div>
  )
}

export default ReceiptPage
