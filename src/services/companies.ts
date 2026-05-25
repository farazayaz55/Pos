import { ref, get, onValue, update, remove } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { Company } from '@/types'

export const companiesRef = () => ref(db, 'companies')
export const companyRef = (companyId: string) => ref(db, `companies/${companyId}`)

export const subscribeCompanies = (cb: (companies: Company[]) => void) => {
  return onValue(companiesRef(), (snap) => {
    const val = snap.val() as Record<string, Omit<Company, 'id'>> | null
    if (!val) {
      cb([])
      return
    }
    const list: Company[] = Object.entries(val).map(([id, c]) => ({ id, ...c }))
    list.sort((a, b) => b.createdAt - a.createdAt)
    cb(list)
  })
}

export const subscribeCompany = (companyId: string, cb: (c: Company | null) => void) => {
  return onValue(companyRef(companyId), (snap) => {
    const val = snap.val() as Omit<Company, 'id'> | null
    cb(val ? { id: companyId, ...val } : null)
  })
}

export const getCompany = async (companyId: string): Promise<Company | null> => {
  const snap = await get(companyRef(companyId))
  const val = snap.val() as Omit<Company, 'id'> | null
  return val ? { id: companyId, ...val } : null
}

export const updateCompany = async (
  companyId: string,
  patch: Partial<Omit<Company, 'id' | 'adminUid' | 'createdAt' | 'createdBy'>>,
) => {
  await update(companyRef(companyId), patch)
}

export const removeCompanyNode = async (companyId: string) => {
  await remove(companyRef(companyId))
}
