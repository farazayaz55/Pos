import { useEffect, useRef } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { syncPendingOrdersWithToast } from '@/localdb/syncOrders'

/** Drains the cash-order outbox whenever connectivity returns. */
export const useOrderSync = (
  companyId: string | undefined,
  branchId: string | undefined,
) => {
  const { isOnline } = useOnlineStatus()
  const lastOnline = useRef(false)

  useEffect(() => {
    if (!isOnline) {
      lastOnline.current = false
      return
    }
    const justReconnected = !lastOnline.current
    lastOnline.current = true
    if (!justReconnected && (!companyId || !branchId)) return
    void syncPendingOrdersWithToast(companyId, branchId)
  }, [isOnline, companyId, branchId])
}
