import { get, push, ref, set, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import { migrateLegacyCompanyData } from '@/services/functionsApi'
import type { Branch } from '@/types'

/**
 * One-time migration: companies without branches get a default branch.
 * Legacy menu/orders/tax/receipt are copied onto that branch via an admin
 * Cloud Function (client RTDB rules block reading flat company-level paths).
 */

const backfillStaffBranchIds = async (
  companyId: string,
  branchId: string,
): Promise<void> => {
  const teamSnap = await get(ref(db, `companies/${companyId}/team`))
  const team = teamSnap.val() as Record<
    string,
    { role?: string; branchId?: string }
  > | null
  if (!team) return
  const updates: Record<string, string> = {}
  for (const [uid, member] of Object.entries(team)) {
    if (member.role === 'staff' && !member.branchId) {
      updates[`companies/${companyId}/team/${uid}/branchId`] = branchId
      updates[`users/${uid}/branchId`] = branchId
    }
  }
  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates)
  }
}

const branchMenuLooksEmpty = async (
  companyId: string,
  branchId: string,
): Promise<boolean> => {
  try {
    const snap = await get(ref(db, `menu/${companyId}/${branchId}/items`))
    const items = snap.val() as Record<string, unknown> | null
    return !items || Object.keys(items).length === 0
  } catch {
    return true
  }
}

const copyLegacyViaCallable = async (companyId: string, branchId: string) => {
  const empty = await branchMenuLooksEmpty(companyId, branchId)
  if (!empty) return
  try {
    const result = await migrateLegacyCompanyData({ companyId, branchId })
    const { copied, menuSource } = result.data
    if (copied.menu || copied.tax || copied.receipt || copied.orders > 0) {
      console.info('[migrate] legacy data copied', { branchId, menuSource, copied })
    }
  } catch (e) {
    console.warn('[migrate] migrateLegacyCompanyData failed', e)
  }
}

export const ensureCompanyMigratedToBranches = async (
  companyId: string,
  createdBy = 'migration',
): Promise<string | null> => {
  if (!companyId) return null

  const branchesSnap = await get(ref(db, `companies/${companyId}/branches`))
  if (branchesSnap.exists()) {
    const branches = branchesSnap.val() as Record<string, Omit<Branch, 'id'>>
    const first =
      Object.entries(branches).find(([, b]) => b.active !== false)?.[0] ||
      Object.keys(branches)[0] ||
      null
    if (first) {
      try {
        await backfillStaffBranchIds(companyId, first)
      } catch (e) {
        console.warn('[migrate] staff branch backfill failed', e)
      }
      // Hamilton (etc.) may exist empty — pull legacy/orphan menu into it
      await copyLegacyViaCallable(companyId, first)
    }
    return first
  }

  const companySnap = await get(ref(db, `companies/${companyId}`))
  const company = companySnap.val() as {
    location?: string
    phone?: string
    name?: string
  } | null
  if (!company) return null

  const branchNode = push(ref(db, `companies/${companyId}/branches`))
  const branchId = branchNode.key!
  const now = Date.now()
  const branchName =
    (company.location && company.location.trim()) ||
    (company.name ? `${company.name} Main` : 'Main')

  const branch: Omit<Branch, 'id'> = {
    companyId,
    name: branchName,
    location: company.location || '',
    active: true,
    createdAt: now,
    createdBy,
    ...(company.phone ? { phone: company.phone } : {}),
  }

  await set(ref(db, `companies/${companyId}/branches/${branchId}`), branch)

  await copyLegacyViaCallable(companyId, branchId)

  try {
    await backfillStaffBranchIds(companyId, branchId)
  } catch (e) {
    console.warn('[migrate] staff branch backfill failed', e)
  }

  return branchId
}
