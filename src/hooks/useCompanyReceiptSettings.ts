import { useEffect, useState } from 'react'
import {
  subscribeReceiptSettings,
  type ReceiptSettingsError,
} from '@/services/receiptSettings'
import { getReceiptCache, saveReceiptCache } from '@/localdb/db'
import type { CompanyReceiptSettings } from '@/types'
import { resolveReceiptBlocks } from '@/utils/receiptBlocks'

export const useCompanyReceiptSettings = (
  companyId: string | undefined,
  branchId: string | undefined,
) => {
  const [settings, setSettings] = useState<CompanyReceiptSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ReceiptSettingsError | null>(null)

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
        const cached = await getReceiptCache(companyId, branchId)
        if (cancelled || !cached) return
        setSettings(cached.settings)
        setLoading(false)
      } catch {
        // Ignore cache failures; network subscribe still runs.
      }
    })()

    const unsub = subscribeReceiptSettings(
      companyId,
      branchId,
      (s) => {
        setSettings(s)
        setLoading(false)
        void saveReceiptCache(companyId, branchId, s)
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
    settings,
    blocks: resolveReceiptBlocks(settings),
    loading,
    error,
  }
}
