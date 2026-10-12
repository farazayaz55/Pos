import { useEffect, useState } from 'react'
import { subscribeCompany } from '@/services/companies'
import { getCompanyCache, saveCompanyCache } from '@/localdb/db'
import { ensureImageCached } from '@/localdb/imageCache'
import type { Company } from '@/types'

export const useCompany = (companyId: string | undefined) => {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      setCompany(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      const cached = await getCompanyCache(companyId)
      if (cancelled || !cached) return
      setCompany(cached.company)
      setLoading(false)
    })()

    const unsub = subscribeCompany(companyId, (c) => {
      setCompany(c)
      setLoading(false)
      if (c) {
        void (async () => {
          await saveCompanyCache(c)
          if (c.logoUrl) await ensureImageCached(c.logoUrl, companyId)
        })()
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [companyId])

  return { company, loading }
}
