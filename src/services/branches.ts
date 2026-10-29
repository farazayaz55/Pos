import { get, onValue, ref, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { Branch } from '@/types'

export const branchesRef = (companyId: string) =>
  ref(db, `companies/${companyId}/branches`)

export const branchRef = (companyId: string, branchId: string) =>
  ref(db, `companies/${companyId}/branches/${branchId}`)

const recordToArray = (
  companyId: string,
  val: Record<string, Omit<Branch, 'id'>> | null,
): Branch[] => {
  if (!val) return []
  return Object.entries(val).map(([id, v]) => ({
    id,
    companyId: v.companyId || companyId,
    name: v.name,
    location: v.location ?? '',
    phone: v.phone,
    active: v.active !== false,
    createdAt: v.createdAt ?? 0,
    createdBy: v.createdBy ?? '',
  }))
}

export const subscribeBranches = (
  companyId: string,
  cb: (branches: Branch[]) => void,
) => {
  return onValue(branchesRef(companyId), (snap) => {
    const list = recordToArray(companyId, snap.val())
    list.sort((a, b) => a.name.localeCompare(b.name))
    cb(list)
  })
}

export const getBranchesOnce = async (companyId: string): Promise<Branch[]> => {
  const snap = await get(branchesRef(companyId))
  const list = recordToArray(companyId, snap.val())
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

export const getBranch = async (
  companyId: string,
  branchId: string,
): Promise<Branch | null> => {
  const snap = await get(branchRef(companyId, branchId))
  const val = snap.val() as Omit<Branch, 'id'> | null
  if (!val) return null
  return {
    id: branchId,
    companyId: val.companyId || companyId,
    name: val.name,
    location: val.location ?? '',
    phone: val.phone,
    active: val.active !== false,
    createdAt: val.createdAt ?? 0,
    createdBy: val.createdBy ?? '',
  }
}

export const updateBranch = async (
  companyId: string,
  branchId: string,
  patch: Partial<Pick<Branch, 'name' | 'location' | 'phone' | 'active'>>,
) => {
  const clean: Record<string, string | boolean | null> = {}
  if (patch.name !== undefined) clean.name = patch.name
  if (patch.location !== undefined) clean.location = patch.location
  if (patch.phone !== undefined) clean.phone = patch.phone || null
  if (patch.active !== undefined) clean.active = patch.active
  if (Object.keys(clean).length === 0) return
  await update(branchRef(companyId, branchId), clean)
}

/** Active branch ids for multi-path “all branches” writes. */
export const listActiveBranchIds = async (companyId: string): Promise<string[]> => {
  const branches = await getBranchesOnce(companyId)
  return branches.filter((b) => b.active !== false).map((b) => b.id)
}
