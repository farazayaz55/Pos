import { useEffect, useState } from 'react'
import {
  subscribeCategories,
  subscribeItems,
  subscribeModifierGroups,
} from '@/services/menu'
import type { Category, MenuItem, ModifierGroup } from '@/types'

export const useCompanyMenu = (companyId: string | undefined) => {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      setCategories([])
      setItems([])
      setModifierGroups([])
      setLoading(false)
      return
    }
    setLoading(true)
    let received = 0
    const markReady = () => {
      received += 1
      if (received >= 3) setLoading(false)
    }
    const unsubCats = subscribeCategories(companyId, (v) => {
      setCategories(v)
      markReady()
    })
    const unsubItems = subscribeItems(companyId, (v) => {
      setItems(v)
      markReady()
    })
    const unsubGroups = subscribeModifierGroups(companyId, (v) => {
      setModifierGroups(v)
      markReady()
    })
    return () => {
      unsubCats()
      unsubItems()
      unsubGroups()
    }
  }, [companyId])

  return { categories, items, modifierGroups, loading }
}
