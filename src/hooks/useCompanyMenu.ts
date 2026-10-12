import { useEffect, useRef, useState } from 'react'
import {
  subscribeCategories,
  subscribeItems,
  subscribeModifierGroups,
} from '@/services/menu'
import { getMenuCache, saveMenuCache, getCompanyCache } from '@/localdb/db'
import { prefetchMenuImages } from '@/localdb/imageCache'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import type { Category, MenuItem, ModifierGroup } from '@/types'

export const useCompanyMenu = (companyId: string | undefined) => {
  const { isOnline } = useOnlineStatus()
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(false)
  const [liveReady, setLiveReady] = useState(false)
  const latest = useRef({
    categories: [] as Category[],
    items: [] as MenuItem[],
    modifierGroups: [] as ModifierGroup[],
  })

  useEffect(() => {
    if (!companyId) {
      setCategories([])
      setItems([])
      setModifierGroups([])
      setLoading(false)
      setFromCache(false)
      setLiveReady(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setFromCache(false)
    setLiveReady(false)
    latest.current = { categories: [], items: [], modifierGroups: [] }

    void (async () => {
      const cached = await getMenuCache(companyId)
      if (cancelled || !cached) return
      latest.current = {
        categories: cached.categories,
        items: cached.items,
        modifierGroups: cached.modifierGroups,
      }
      setCategories(cached.categories)
      setItems(cached.items)
      setModifierGroups(cached.modifierGroups)
      setFromCache(true)
      setLoading(false)
      const companyRow = await getCompanyCache(companyId)
      if (!cancelled) {
        void prefetchMenuImages(
          companyId,
          cached.categories,
          cached.items,
          companyRow?.company,
        )
      }
    })()

    let received = 0
    const persist = () => {
      void (async () => {
        await saveMenuCache(
          companyId,
          latest.current.categories,
          latest.current.items,
          latest.current.modifierGroups,
        )
        const companyRow = await getCompanyCache(companyId)
        await prefetchMenuImages(
          companyId,
          latest.current.categories,
          latest.current.items,
          companyRow?.company,
        )
      })()
    }
    const markReady = () => {
      received += 1
      if (received >= 3) {
        setLoading(false)
        setFromCache(false)
        setLiveReady(true)
        persist()
      }
    }

    const unsubCats = subscribeCategories(companyId, (v) => {
      latest.current.categories = v
      setCategories(v)
      markReady()
    })
    const unsubItems = subscribeItems(companyId, (v) => {
      latest.current.items = v
      setItems(v)
      markReady()
    })
    const unsubGroups = subscribeModifierGroups(companyId, (v) => {
      latest.current.modifierGroups = v
      setModifierGroups(v)
      markReady()
    })

    const offlineTimer = window.setTimeout(() => {
      if (cancelled) return
      const hasCache =
        latest.current.items.length + latest.current.categories.length > 0
      if (hasCache) setLoading(false)
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(offlineTimer)
      unsubCats()
      unsubItems()
      unsubGroups()
    }
  }, [companyId])

  return {
    categories,
    items,
    modifierGroups,
    loading,
    /** True when POS is offline (menu may be from IndexedDB cache). */
    fromCache: !isOnline && (fromCache || liveReady || items.length > 0 || categories.length > 0),
  }
}
