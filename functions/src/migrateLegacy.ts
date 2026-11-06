import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'

const db = admin.database()

type MenuBag = {
  categories?: Record<string, Record<string, unknown>>
  items?: Record<string, Record<string, unknown>>
  modifierGroups?: Record<string, Record<string, unknown>>
}

const isMenuBag = (v: unknown): v is MenuBag => {
  if (!v || typeof v !== 'object') return false
  const o = v as MenuBag
  return !!(o.categories || o.items || o.modifierGroups)
}

const menuSize = (m: MenuBag | null | undefined) =>
  Object.keys(m?.categories || {}).length +
  Object.keys(m?.items || {}).length +
  Object.keys(m?.modifierGroups || {}).length

/**
 * Find the richest menu source for a company:
 * 1) flat legacy menu/{companyId}/{categories|items|modifierGroups}
 * 2) any nested menu/{companyId}/{key} that looks like a menu bag
 * Prefer excluding the target branch (we want to fill an empty target).
 */
const findMenuSource = (
  menuRoot: Record<string, unknown> | null,
  targetBranchId: string,
): { sourceKey: string | 'flat'; bag: MenuBag } | null => {
  if (!menuRoot) return null

  let best: { sourceKey: string | 'flat'; bag: MenuBag; size: number } | null = null

  if (isMenuBag(menuRoot)) {
    const size = menuSize(menuRoot)
    if (size > 0) best = { sourceKey: 'flat', bag: menuRoot, size }
  }

  for (const [key, val] of Object.entries(menuRoot)) {
    if (key === 'categories' || key === 'items' || key === 'modifierGroups') continue
    if (key === targetBranchId) continue
    if (!isMenuBag(val)) continue
    const size = menuSize(val)
    if (size > 0 && (!best || size > best.size)) {
      best = { sourceKey: key, bag: val, size }
    }
  }

  // If target already has data, nothing to copy unless we found a richer source
  const targetBag = (menuRoot as Record<string, unknown>)[targetBranchId]
  if (isMenuBag(targetBag) && menuSize(targetBag) > 0) {
    if (!best || menuSize(targetBag) >= best.size) return null
  }

  return best ? { sourceKey: best.sourceKey, bag: best.bag } : null
}

const copyMenuBagToBranch = (
  companyId: string,
  branchId: string,
  bag: MenuBag,
  updates: Record<string, unknown>,
) => {
  if (bag.categories) {
    for (const [id, cat] of Object.entries(bag.categories)) {
      updates[`menu/${companyId}/${branchId}/categories/${id}`] = {
        ...cat,
        companyId,
        branchId,
      }
    }
  }
  if (bag.items) {
    for (const [id, item] of Object.entries(bag.items)) {
      updates[`menu/${companyId}/${branchId}/items/${id}`] = {
        ...item,
        companyId,
        branchId,
      }
    }
  }
  if (bag.modifierGroups) {
    for (const [id, g] of Object.entries(bag.modifierGroups)) {
      updates[`menu/${companyId}/${branchId}/modifierGroups/${id}`] = {
        ...g,
        companyId,
        branchId,
      }
    }
  }
}

export interface MigrateLegacyCompanyDataInput {
  companyId: string
  /** Defaults to first active branch */
  branchId?: string
}

export interface MigrateLegacyCompanyDataResult {
  branchId: string
  copied: {
    menu: boolean
    tax: boolean
    receipt: boolean
    kitchenReceipt: boolean
    counters: boolean
    orders: number
  }
  menuSource: string | null
}

/**
 * Admin-privileged copy of legacy (or orphan) company data into a branch.
 * Safe to call repeatedly — skips sections the target already has.
 */
export async function migrateLegacyCompanyDataAdmin(
  companyId: string,
  branchId: string,
): Promise<MigrateLegacyCompanyDataResult> {
  const updates: Record<string, unknown> = {}
  const copied = {
    menu: false,
    tax: false,
    receipt: false,
    kitchenReceipt: false,
    counters: false,
    orders: 0,
  }
  let menuSource: string | null = null

  const menuRoot = (await db.ref(`menu/${companyId}`).get()).val() as Record<
    string,
    unknown
  > | null
  const source = findMenuSource(menuRoot, branchId)
  if (source) {
    copyMenuBagToBranch(companyId, branchId, source.bag, updates)
    copied.menu = true
    menuSource = source.sourceKey
    if (source.sourceKey === 'flat') {
      updates[`menu/${companyId}/categories`] = null
      updates[`menu/${companyId}/items`] = null
      updates[`menu/${companyId}/modifierGroups`] = null
    }
  }

  const targetTax = (await db.ref(`taxSettings/${companyId}/${branchId}`).get()).val()
  if (!targetTax) {
    const taxRoot = (await db.ref(`taxSettings/${companyId}`).get()).val() as Record<
      string,
      unknown
    > | null
    if (taxRoot && typeof taxRoot === 'object' && 'components' in taxRoot) {
      updates[`taxSettings/${companyId}/${branchId}`] = taxRoot
      copied.tax = true
    } else if (taxRoot) {
      // Prefer any other branch's tax
      for (const [key, val] of Object.entries(taxRoot)) {
        if (key === branchId) continue
        if (val && typeof val === 'object' && 'components' in (val as object)) {
          updates[`taxSettings/${companyId}/${branchId}`] = val
          copied.tax = true
          break
        }
      }
    }
  }

  const targetReceipt = (
    await db.ref(`receiptSettings/${companyId}/${branchId}`).get()
  ).val()
  if (!targetReceipt) {
    const receiptRoot = (await db.ref(`receiptSettings/${companyId}`).get()).val() as Record<
      string,
      unknown
    > | null
    if (
      receiptRoot &&
      typeof receiptRoot === 'object' &&
      ('blocks' in receiptRoot || 'headerLines' in receiptRoot)
    ) {
      updates[`receiptSettings/${companyId}/${branchId}`] = receiptRoot
      copied.receipt = true
    } else if (receiptRoot) {
      for (const [key, val] of Object.entries(receiptRoot)) {
        if (key === branchId) continue
        if (
          val &&
          typeof val === 'object' &&
          ('blocks' in (val as object) || 'headerLines' in (val as object))
        ) {
          updates[`receiptSettings/${companyId}/${branchId}`] = val
          copied.receipt = true
          break
        }
      }
    }
  }

  const targetKitchen = (
    await db.ref(`kitchenReceiptSettings/${companyId}/${branchId}`).get()
  ).val()
  if (!targetKitchen) {
    const kitchenRoot = (
      await db.ref(`kitchenReceiptSettings/${companyId}`).get()
    ).val() as Record<string, unknown> | null
    if (kitchenRoot && typeof kitchenRoot === 'object') {
      if ('includeCategoryIds' in kitchenRoot || 'excludeItemIds' in kitchenRoot) {
        updates[`kitchenReceiptSettings/${companyId}/${branchId}`] = kitchenRoot
        copied.kitchenReceipt = true
      } else {
        for (const [key, val] of Object.entries(kitchenRoot)) {
          if (key === branchId) continue
          if (val && typeof val === 'object') {
            updates[`kitchenReceiptSettings/${companyId}/${branchId}`] = val
            copied.kitchenReceipt = true
            break
          }
        }
      }
    }
  }

  const targetCounter = (
    await db.ref(`counters/${companyId}/${branchId}/dailyOrderSeq`).get()
  ).val()
  if (targetCounter == null) {
    const countersRoot = (await db.ref(`counters/${companyId}`).get()).val() as Record<
      string,
      unknown
    > | null
    if (countersRoot && typeof countersRoot === 'object' && 'dailyOrderSeq' in countersRoot) {
      updates[`counters/${companyId}/${branchId}/dailyOrderSeq`] = countersRoot.dailyOrderSeq
      updates[`counters/${companyId}/dailyOrderSeq`] = null
      copied.counters = true
    }
  }

  // Legacy flat orders: each child has companyId field
  const ordersRoot = (await db.ref(`orders/${companyId}`).get()).val() as Record<
    string,
    unknown
  > | null
  if (ordersRoot && typeof ordersRoot === 'object') {
    const targetOrders = (
      await db.ref(`orders/${companyId}/${branchId}`).get()
    ).val()
    if (!targetOrders) {
      for (const [orderId, order] of Object.entries(ordersRoot)) {
        if (!order || typeof order !== 'object') continue
        // Skip nested branch bags
        if (
          !('companyId' in (order as object)) &&
          !('orderNumber' in (order as object))
        ) {
          continue
        }
        updates[`orders/${companyId}/${branchId}/${orderId}`] = {
          ...(order as Record<string, unknown>),
          branchId,
        }
        updates[`orders/${companyId}/${orderId}`] = null
        copied.orders += 1
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates)
  }

  return { branchId, copied, menuSource }
}

export const runMigrateLegacyCompanyData = async (
  req: CallableRequest<MigrateLegacyCompanyDataInput>,
  requireCompanyManager: (
    req: CallableRequest<unknown>,
    companyId: string,
  ) => Promise<{ uid: string; role: string }>,
): Promise<MigrateLegacyCompanyDataResult> => {
  const { companyId, branchId: requestedBranchId } =
    req.data || ({} as MigrateLegacyCompanyDataInput)
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required.')
  }

  const caller = await requireCompanyManager(req, companyId)
  if (caller.role === 'staff') {
    throw new HttpsError('permission-denied', 'Company admin required.')
  }

  const branchesSnap = await db.ref(`companies/${companyId}/branches`).get()
  const branches = branchesSnap.val() as Record<string, { active?: boolean }> | null
  if (!branches || Object.keys(branches).length === 0) {
    throw new HttpsError('failed-precondition', 'No branches exist for this company.')
  }

  const branchId =
    requestedBranchId && branches[requestedBranchId]
      ? requestedBranchId
      : Object.entries(branches).find(([, b]) => b.active !== false)?.[0] ||
        Object.keys(branches)[0]

  return migrateLegacyCompanyDataAdmin(companyId, branchId)
}
