import { useEffect, useState } from 'react'
import { subscribeOrders } from '@/services/orders'
import type { Order } from '@/types'

export const useOrders = (companyId: string | undefined) => {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeOrders(companyId, (v) => {
      setOrders(v)
      setLoading(false)
    })
    return () => unsub()
  }, [companyId])

  return { orders, loading }
}
