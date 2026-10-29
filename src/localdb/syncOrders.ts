import toast from 'react-hot-toast'
import { pushCompletedCashOrder } from '@/services/orders'
import {
  getOutboxRow,
  listPendingOutbox,
  setCounterMeta,
  updateOutboxRow,
  type OrderOutboxRow,
} from '@/localdb/db'
import { formatOrderNumber } from '@/utils/businessDate'

let syncing = false

const syncOne = async (row: OrderOutboxRow): Promise<boolean> => {
  if (row.remoteOrderId) {
    await updateOutboxRow(row.localId, {
      syncStatus: 'synced',
      lastError: undefined,
    })
    return true
  }

  await updateOutboxRow(row.localId, {
    syncStatus: 'syncing',
    lastError: undefined,
  })

  try {
    const remote = await pushCompletedCashOrder({
      ...row.order,
      branchId: row.branchId || row.order.branchId,
      clientLocalId: row.localId,
    })
    if (remote.reportPeriodId) {
      void setCounterMeta(
        remote.companyId,
        remote.branchId,
        remote.reportPeriodId,
        remote.orderNumber,
      )
    } else if (remote.orderDate) {
      void setCounterMeta(
        remote.companyId,
        remote.branchId,
        remote.orderDate,
        remote.orderNumber,
      )
    }
    await updateOutboxRow(row.localId, {
      syncStatus: 'synced',
      remoteOrderId: remote.id,
      order: {
        ...row.order,
        id: remote.id,
        orderNumber: remote.orderNumber,
        orderDate: remote.orderDate,
        branchId: remote.branchId,
        clientLocalId: row.localId,
        syncStatus: 'synced',
        syncError: undefined,
      },
      lastError: undefined,
    })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    try {
      await updateOutboxRow(row.localId, {
        syncStatus: 'error',
        lastError: msg,
      })
    } catch {
      // IndexedDB may still be down; surface the original sync error
    }
    return false
  }
}

/**
 * Drain pending/error outbox rows to RTDB.
 * Returns how many synced successfully.
 */
export const syncPendingOrders = async (
  companyId?: string,
  branchId?: string,
): Promise<number> => {
  if (syncing) return 0
  syncing = true
  try {
    const rows = await listPendingOutbox(companyId, branchId)
    rows.sort((a, b) => a.clientCreatedAt - b.clientCreatedAt)
    let synced = 0
    for (const row of rows) {
      const ok = await syncOne(row)
      if (ok) synced += 1
    }
    return synced
  } finally {
    syncing = false
  }
}

export const syncPendingOrdersWithToast = async (
  companyId?: string,
  branchId?: string,
) => {
  const synced = await syncPendingOrders(companyId, branchId)
  if (synced > 0) {
    toast.success(
      synced === 1 ? '1 order synced' : `${synced} orders synced`,
    )
  }
  return synced
}

export const retryOutboxOrder = async (localId: string) => {
  const row = await getOutboxRow(localId)
  if (!row) throw new Error('Local order not found')
  if (row.syncStatus === 'synced') return
  await updateOutboxRow(localId, {
    syncStatus: 'pending',
    lastError: undefined,
  })
  const ok = await syncOne({ ...row, syncStatus: 'pending', lastError: undefined })
  if (ok) {
    const updated = await getOutboxRow(localId)
    toast.success(
      `Order #${formatOrderNumber(updated?.order.orderNumber ?? row.order.orderNumber)} synced`,
    )
  } else {
    const failed = await getOutboxRow(localId)
    throw new Error(failed?.lastError || 'Sync failed')
  }
}
