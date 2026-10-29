import { useEffect, useState } from 'react'
import { subscribeBranches } from '@/services/branches'
import { ensureCompanyMigratedToBranches } from '@/services/migrateBranches'
import type { Branch } from '@/types'

export const useBranches = (companyId: string | undefined) => {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [migrated, setMigrated] = useState(false)

  useEffect(() => {
    if (!companyId) {
      setBranches([])
      setLoading(false)
      setMigrated(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        await ensureCompanyMigratedToBranches(companyId)
      } catch (e) {
        console.warn('[useBranches] migration failed', e)
      }
      if (!cancelled) setMigrated(true)
    })()

    const unsub = subscribeBranches(companyId, (list) => {
      if (cancelled) return
      setBranches(list)
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [companyId])

  return { branches, loading, migrated }
}
