import { get, push, ref, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { Branch } from '@/types'

/**
 * One-time migration: companies without branches get a default branch,
 * and legacy flat menu/orders/tax/receipt/counters are moved under it.
 * Staff users without branchId are assigned to the default branch.
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

  const updates: Record<string, unknown> = {
    [`companies/${companyId}/branches/${branchId}`]: branch,
  }

  const [menuSnap, ordersSnap, countersSnap, taxSnap, receiptSnap] =
    await Promise.all([
      get(ref(db, `menu/${companyId}`)),
      get(ref(db, `orders/${companyId}`)),
      get(ref(db, `counters/${companyId}`)),
      get(ref(db, `taxSettings/${companyId}`)),
      get(ref(db, `receiptSettings/${companyId}`)),
    ])

  const menuVal = menuSnap.val()
  if (menuVal && typeof menuVal === 'object') {
    if (
      'categories' in menuVal ||
      'items' in menuVal ||
      'modifierGroups' in menuVal
    ) {
      const cats = (menuVal as { categories?: Record<string, Record<string, unknown>> })
        .categories
      const items = (menuVal as { items?: Record<string, Record<string, unknown>> }).items
      const groups = (
        menuVal as { modifierGroups?: Record<string, Record<string, unknown>> }
      ).modifierGroups

      if (cats) {
        for (const [id, cat] of Object.entries(cats)) {
          updates[`menu/${companyId}/${branchId}/categories/${id}`] = {
            ...cat,
            branchId,
          }
        }
      }
      if (items) {
        for (const [id, item] of Object.entries(items)) {
          updates[`menu/${companyId}/${branchId}/items/${id}`] = {
            ...item,
            branchId,
          }
        }
      }
      if (groups) {
        for (const [id, g] of Object.entries(groups)) {
          updates[`menu/${companyId}/${branchId}/modifierGroups/${id}`] = {
            ...g,
            branchId,
          }
        }
      }
      updates[`menu/${companyId}/categories`] = null
      updates[`menu/${companyId}/items`] = null
      updates[`menu/${companyId}/modifierGroups`] = null
    }
  }

  const ordersVal = ordersSnap.val()
  if (ordersVal && typeof ordersVal === 'object') {
    const sample = Object.values(ordersVal)[0] as { companyId?: string } | undefined
    if (sample && typeof sample === 'object' && 'companyId' in sample) {
      for (const [orderId, order] of Object.entries(
        ordersVal as Record<string, Record<string, unknown>>,
      )) {
        updates[`orders/${companyId}/${branchId}/${orderId}`] = {
          ...order,
          branchId,
        }
        updates[`orders/${companyId}/${orderId}`] = null
      }
    }
  }

  const countersVal = countersSnap.val()
  if (countersVal && typeof countersVal === 'object' && 'dailyOrderSeq' in countersVal) {
    updates[`counters/${companyId}/${branchId}/dailyOrderSeq`] = (
      countersVal as { dailyOrderSeq: unknown }
    ).dailyOrderSeq
    updates[`counters/${companyId}/dailyOrderSeq`] = null
  }

  const taxVal = taxSnap.val()
  if (taxVal && typeof taxVal === 'object' && 'components' in taxVal) {
    updates[`taxSettings/${companyId}/${branchId}`] = taxVal
    // Clear legacy: RTDB can't null a parent that we also write children under
    // after nested paths — delete leaf markers instead by overwriting parent later.
    // Multi-path: writing branch child then nulling parent would wipe child.
    // So only null legacy if we're using multi-location carefully:
    // Leave legacy tax at companyId; new path takes precedence in clients.
  }

  const receiptVal = receiptSnap.val()
  if (
    receiptVal &&
    typeof receiptVal === 'object' &&
    ('blocks' in receiptVal || 'headerLines' in receiptVal)
  ) {
    updates[`receiptSettings/${companyId}/${branchId}`] = receiptVal
  }

  const teamSnap = await get(ref(db, `companies/${companyId}/team`))
  const team = teamSnap.val() as Record<
    string,
    { role?: string; branchId?: string }
  > | null
  if (team) {
    for (const [uid, member] of Object.entries(team)) {
      if (member.role === 'staff' && !member.branchId) {
        updates[`companies/${companyId}/team/${uid}/branchId`] = branchId
        updates[`users/${uid}/branchId`] = branchId
      }
    }
  }

  await update(ref(db), updates)

  // Clear legacy flat tax/receipt after nested write (separate update)
  const cleanup: Record<string, null> = {}
  if (taxVal && typeof taxVal === 'object' && 'components' in taxVal) {
    // Only clear if parent isn't already nested — check components at root
    cleanup[`taxSettings/${companyId}/components`] = null
    cleanup[`taxSettings/${companyId}/updatedAt`] = null
    cleanup[`taxSettings/${companyId}/updatedBy`] = null
  }
  if (
    receiptVal &&
    typeof receiptVal === 'object' &&
    ('blocks' in receiptVal || 'headerLines' in receiptVal)
  ) {
    cleanup[`receiptSettings/${companyId}/blocks`] = null
    cleanup[`receiptSettings/${companyId}/headerLines`] = null
    cleanup[`receiptSettings/${companyId}/footerLines`] = null
    cleanup[`receiptSettings/${companyId}/updatedAt`] = null
    cleanup[`receiptSettings/${companyId}/updatedBy`] = null
  }
  if (Object.keys(cleanup).length > 0) {
    await update(ref(db), cleanup)
  }

  return branchId
}
