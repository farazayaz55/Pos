import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCartStore } from '@/stores/cartStore'
import { usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompany } from '@/hooks/useCompany'
import { useCompanyReceiptSettings } from '@/hooks/useCompanyReceiptSettings'
import { canEditCashPosOrder } from '@/services/orders'
import { resolveOrder } from '@/services/localOrders'
import { printReceipt, PrintConfigError } from '@/services/printReceipt'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isLocalOrderId } from '@/localdb/db'
import { formatOrderNumber } from '@/utils/businessDate'
import type { Order } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ReceiptDocument from '@/components/receipt/ReceiptDocument'

const ReceiptPage = () => {
  const { orderId } = useParams()
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { company } = useCompany(companyId)
  const { settings: receiptSettings } = useCompanyReceiptSettings(companyId)
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
      await printReceipt({
        order: receiptOrder,
        company,
        receiptSettings,
      })
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

      <ReceiptDocument
        order={order}
        company={company}
        settings={receiptSettings}
      />
    </div>
  )
}

export default ReceiptPage
