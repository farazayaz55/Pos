import { useEffect, useState } from 'react'
import {
  isDayOpen,
  subscribeCashMovements,
  subscribeDayState,
} from '@/services/dayState'
import type { CashMovement, DayState } from '@/types'

export const useDayState = (companyId?: string, branchId?: string) => {
  const [dayState, setDayState] = useState<DayState | null>(null)
  const [loading, setLoading] = useState(true)
  const [movements, setMovements] = useState<CashMovement[]>([])

  useEffect(() => {
    if (!companyId || !branchId) {
      setDayState(null)
      setMovements([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeDayState(companyId, branchId, (s) => {
      setDayState(s)
      setLoading(false)
    })
    return () => unsub()
  }, [companyId, branchId])

  const periodId = isDayOpen(dayState) ? dayState.periodId : null

  useEffect(() => {
    if (!companyId || !branchId || !periodId) {
      setMovements([])
      return
    }
    return subscribeCashMovements(companyId, branchId, periodId, setMovements)
  }, [companyId, branchId, periodId])

  return {
    dayState,
    movements,
    loading,
    isOpen: isDayOpen(dayState),
  }
}
