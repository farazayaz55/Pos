import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCartStore } from '@/stores/cartStore'
import { usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompany } from '@/hooks/useCompany'
import { useBranches } from '@/hooks/useBranches'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import { useCompanyReceiptSettings } from '@/hooks/useCompanyReceiptSettings'
import { useCompanyKitchenReceiptSettings } from '@/hooks/useCompanyKitchenReceiptSettings'
import { receiptCompanyInfo } from '@/utils/receiptText'
import { canEditCashPosOrder } from '@/services/orders'
import { resolveOrder } from '@/services/localOrders'
import {
  printKitchenReceipt,
  printReceipt,
  PrintConfigError,
} from '@/services/printReceipt'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isLocalOrderId } from '@/localdb/db'
import { formatOrderNumber } from '@/utils/businessDate'
import { filterKitchenItems } from '@/utils/kitchenReceipt'
import type { Order } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ReceiptDocument from '@/components/receipt/ReceiptDocument'
import KitchenReceiptDocument from '@/components/receipt/KitchenReceiptDocument'

const ReceiptPage = () => {
  const { orderId } = useParams()
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const activeBranchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const { company } = useCompany(companyId)
  const { branches } = useBranches(companyId || undefined)
  const { items: menuItems } = useCompanyMenu(
    companyId || undefined,
    activeBranchId || undefined,
  )
  const { settings: receiptSettings } = useCompanyReceiptSettings(
    companyId,
    activeBranchId || undefined,
  )
  const { settings: kitchenSettings } = useCompanyKitchenReceiptSettings(
    companyId,
    activeBranchId || undefined,
  )
  const navigate = useNavigate()
  const loadFromOrder = useCartStore((s) => s.loadFromOrder)
  const cartLines = useCartStore((s) => s.lines)
  const editingOrderId = useCartStore((s) => s.editingOrderId)
  const autoPrint = usePosSettingsStore((s) => s.autoPrint)
  const autoPrintKitchen = usePosSettingsStore((s) => s.autoPrintKitchen)
  const { isOnline } = useOnlineStatus()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [editConfirmOpen, setEditConfirmOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printingKitchen, setPrintingKitchen] = useState(false)

  const menuByItemId = useMemo(() => {
    const map = new Map<string, { id: string; categoryId: string }>()
    for (const item of menuItems) {
      map.set(item.id, { id: item.id, categoryId: item.categoryId })
    }
    return map
  }, [menuItems])

  useEffect(() => {
    if (!companyId || !activeBranchId || !orderId) return
    void (async () => {
      try {
        const o = await resolveOrder(companyId, activeBranchId, orderId)
        setOrder(o)
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId, activeBranchId, orderId])

  const receiptBranch = order
    ? branches.find((b) => b.id === order.branchId) ??
      branches.find((b) => b.id === activeBranchId) ??
      null
    : branches.find((b) => b.id === activeBranchId) ?? null
  const displayCompany =
    company && receiptBranch
      ? {
          ...company,
          location: receiptBranch.location || company.location,
          phone: receiptBranch.phone ?? company.phone,
        }
      : company

  const kitchenItemCount = order
    ? filterKitchenItems(order, kitchenSettings, menuByItemId).length
    : 0

  const handlePrintKitchen = async (receiptOrder: Order) => {
    setPrintingKitchen(true)
    try {
      const printed = await printKitchenReceipt({
        order: receiptOrder,
        kitchenSettings,
        menuByItemId,
      })
      if (!printed) {
        toast('No kitchen items for this order')
      }
    } catch (err) {
      if (err instanceof PrintConfigError) {
        toast.error(err.message)
        navigate('/admin/settings')
      } else {
        toast.error(err instanceof Error ? err.message : 'Kitchen print failed')
      }
    } finally {
      setPrintingKitchen(false)
    }
  }

  const handlePrint = async (receiptOrder: Order, alsoKitchen: boolean) => {
    setPrinting(true)
    try {
      await printReceipt({
        order: receiptOrder,
        company: receiptCompanyInfo(
          company,
          branches.find((b) => b.id === receiptOrder.branchId) ?? receiptBranch,
        ),
        receiptSettings,
      })
      if (alsoKitchen) {
        try {
          await printKitchenReceipt({
            order: receiptOrder,
            kitchenSettings,
            menuByItemId,
          })
        } catch (kitchenErr) {
          if (kitchenErr instanceof PrintConfigError) {
            toast.error(kitchenErr.message)
            navigate('/admin/settings')
          } else {
            toast.error(
              kitchenErr instanceof Error
                ? kitchenErr.message
                : 'Kitchen print failed',
            )
          }
        }
      }
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
      void handlePrint(order, autoPrintKitchen)
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
        <div className="flex flex-wrap gap-2">
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
            onClick={() => void handlePrintKitchen(order)}
            className="btn-secondary"
            disabled={printingKitchen || printing || kitchenItemCount === 0}
          >
            {printingKitchen ? 'Printing…' : 'Print kitchen'}
          </button>
          <button
            onClick={() => void handlePrint(order, true)}
            className="btn-primary"
            disabled={printing || printingKitchen}
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
        company={displayCompany}
        settings={receiptSettings}
      />

      <div className="mx-auto mt-6 max-w-md px-4">
        <p className="no-print mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Kitchen ticket preview
        </p>
        <KitchenReceiptDocument
          order={order}
          settings={kitchenSettings}
          menuByItemId={menuByItemId}
          id="kitchen-receipt"
        />
      </div>
    </div>
  )
}

export default ReceiptPage
