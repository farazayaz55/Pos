import toast from 'react-hot-toast'
import { pushCompletedCashOrder } from '@/services/orders'
import {
  listPendingOutbox,
  localDb,
  setCounterMeta,
  type OrderOutboxRow,
} from '@/localdb/db'
import { formatOrderNumber } from '@/utils/businessDate'

let syncing = false

const syncOne = async (row: OrderOutboxRow): Promise<boolean> => {
  if (row.remoteOrderId) {
    await localDb.orderOutbox.update(row.localId, {
      syncStatus: 'synced',
      lastError: undefined,
    })
    return true
  }

  await localDb.orderOutbox.update(row.localId, {
    syncStatus: 'syncing',
    lastError: undefined,
  })

  try {
    const remote = await pushCompletedCashOrder({
      ...row.order,
      clientLocalId: row.localId,
    })
    if (remote.orderDate) {
      await setCounterMeta(remote.companyId, remote.orderDate, remote.orderNumber)
    }
    await localDb.orderOutbox.update(row.localId, {
      syncStatus: 'synced',
      remoteOrderId: remote.id,
      order: {
        ...row.order,
        id: remote.id,
        orderNumber: remote.orderNumber,
        orderDate: remote.orderDate,
        clientLocalId: row.localId,
        syncStatus: 'synced',
        syncError: undefined,
      },
      lastError: undefined,
    })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    await localDb.orderOutbox.update(row.localId, {
      syncStatus: 'error',
      lastError: msg,
    })
    return false
  }
}

/**
 * Drain pending/error outbox rows to RTDB.
 * Returns how many synced successfully.
 */
export const syncPendingOrders = async (companyId?: string): Promise<number> => {
  if (syncing) return 0
  syncing = true
  try {
    const rows = await listPendingOutbox(companyId)
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

export const syncPendingOrdersWithToast = async (companyId?: string) => {
  const synced = await syncPendingOrders(companyId)
  if (synced > 0) {
    toast.success(
      synced === 1 ? '1 order synced' : `${synced} orders synced`,
    )
  }
  return synced
}

export const retryOutboxOrder = async (localId: string) => {
  const row = await localDb.orderOutbox.get(localId)
  if (!row) throw new Error('Local order not found')
  if (row.syncStatus === 'synced') return
  await localDb.orderOutbox.update(localId, {
    syncStatus: 'pending',
    lastError: undefined,
  })
  const ok = await syncOne({ ...row, syncStatus: 'pending', lastError: undefined })
  if (ok) {
    const updated = await localDb.orderOutbox.get(localId)
    toast.success(
      `Order #${formatOrderNumber(updated?.order.orderNumber ?? row.order.orderNumber)} synced`,
    )
  } else {
    const failed = await localDb.orderOutbox.get(localId)
    throw new Error(failed?.lastError || 'Sync failed')
  }
}
