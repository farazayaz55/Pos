import { useEffect, useState } from 'react'
import {
  emptyKitchenReceiptSettings,
  subscribeKitchenReceiptSettings,
  type KitchenReceiptSettingsError,
} from '@/services/kitchenReceiptSettings'
import {
  getKitchenReceiptCache,
  saveKitchenReceiptCache,
} from '@/localdb/db'
import type { CompanyKitchenReceiptSettings } from '@/types'

export const useCompanyKitchenReceiptSettings = (
  companyId: string | undefined,
  branchId: string | undefined,
) => {
  const [settings, setSettings] = useState<CompanyKitchenReceiptSettings | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<KitchenReceiptSettingsError | null>(null)

  useEffect(() => {
    if (!companyId || !branchId) {
      setSettings(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const cached = await getKitchenReceiptCache(companyId, branchId)
        if (cancelled || !cached) return
        setSettings(cached.settings)
        setLoading(false)
      } catch {
        // Ignore cache failures; network subscribe still runs.
      }
    })()

    const unsub = subscribeKitchenReceiptSettings(
      companyId,
      branchId,
      (s) => {
        setSettings(s)
        setLoading(false)
        void saveKitchenReceiptCache(companyId, branchId, s)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
      unsub()
    }
  }, [companyId, branchId])

  return {
    settings:
      settings ??
      (companyId && branchId
        ? emptyKitchenReceiptSettings(companyId, branchId)
        : null),
    loading,
    error,
  }
}
