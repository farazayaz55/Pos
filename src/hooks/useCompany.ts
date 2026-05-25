import { useEffect, useState } from 'react'
import { subscribeCompany } from '@/services/companies'
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
    setLoading(true)
    const unsub = subscribeCompany(companyId, (c) => {
      setCompany(c)
      setLoading(false)
    })
    return () => unsub()
  }, [companyId])

  return { company, loading }
}
