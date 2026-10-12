import { useEffect, useMemo, useState } from 'react'
import { subscribeTaxSettings } from '@/services/taxSettings'
import { useCompany } from '@/hooks/useCompany'
import { getTaxCache, saveTaxCache } from '@/localdb/db'
import type { CompanyTaxSettings, TaxComponent } from '@/types'
import { resolveTaxComponents } from '@/utils/orderCalc'

export const useCompanyTaxSettings = (companyId: string | undefined) => {
  const { company, loading: companyLoading } = useCompany(companyId)
  const [settings, setSettings] = useState<CompanyTaxSettings | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  useEffect(() => {
    if (!companyId) {
      setSettings(null)
      setLoadingSettings(false)
      return
    }

    let cancelled = false
    setLoadingSettings(true)

    void (async () => {
      const cached = await getTaxCache(companyId)
      if (cancelled || !cached) return
      setSettings(cached.settings)
      setLoadingSettings(false)
    })()

    const unsub = subscribeTaxSettings(companyId, (s) => {
      setSettings(s)
      setLoadingSettings(false)
      void saveTaxCache(companyId, s, company?.taxRate)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [companyId, company?.taxRate])

  useEffect(() => {
    if (!companyId || company?.taxRate == null) return
    void saveTaxCache(companyId, settings, company.taxRate)
  }, [companyId, company?.taxRate, settings])

  const components: TaxComponent[] = useMemo(
    () => resolveTaxComponents(settings?.components, company?.taxRate),
    [settings, company?.taxRate],
  )

  return {
    settings,
    components,
    loading: loadingSettings || companyLoading,
  }
}
