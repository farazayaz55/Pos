import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { subscribeOrders } from '@/services/orders'
import { localDb, setCounterMeta } from '@/localdb/db'
import type { Order } from '@/types'

export const useOrders = (
  companyId: string | undefined,
  branchId: string | undefined,
) => {
  const [remoteOrders, setRemoteOrders] = useState<Order[]>([])
  const [localOrders, setLocalOrders] = useState<Order[]>([])
  const [remoteLoading, setRemoteLoading] = useState(true)
  const [localReady, setLocalReady] = useState(false)

  useEffect(() => {
    if (!companyId || !branchId) {
      setRemoteOrders([])
      setRemoteLoading(false)
      return
    }
    setRemoteLoading(true)
    const unsub = subscribeOrders(companyId, branchId, (v) => {
      setRemoteOrders(v)
      setRemoteLoading(false)
      for (const o of v) {
        if (o.reportPeriodId) {
          void setCounterMeta(companyId, branchId, o.reportPeriodId, o.orderNumber)
        }
      }
    })
    return () => unsub()
  }, [companyId, branchId])

  useEffect(() => {
    if (!companyId || !branchId) {
      setLocalOrders([])
      setLocalReady(true)
      return
    }
    setLocalReady(false)
    const obs = liveQuery(() =>
      localDb.orderOutbox
        .where('branchId')
        .equals(branchId)
        .filter((r) => r.companyId === companyId && r.syncStatus !== 'synced')
        .toArray(),
    )
    const sub = obs.subscribe({
      next: (rows) => {
        setLocalOrders(
          rows
            .map((r) => ({
              ...r.order,
              id: r.localId,
              syncStatus: r.syncStatus,
              syncError: r.lastError,
              clientLocalId: r.localId,
            }))
            .sort((a, b) => b.createdAt - a.createdAt),
        )
        setLocalReady(true)
      },
      error: () => setLocalReady(true),
    })
    return () => sub.unsubscribe()
  }, [companyId, branchId])

  const orders = useMemo(() => {
    const remoteLocalIds = new Set(
      remoteOrders.map((o) => o.clientLocalId).filter(Boolean) as string[],
    )
    const locals = localOrders.filter(
      (o) => !remoteLocalIds.has(o.clientLocalId || o.id),
    )
    return [...locals, ...remoteOrders].sort((a, b) => b.createdAt - a.createdAt)
  }, [remoteOrders, localOrders])

  const loading = remoteLoading && !localReady && localOrders.length === 0

  return { orders, loading }
}
