import Dexie, { type Table } from 'dexie'
import type {
  AppUser,
  Category,
  Company,
  CompanyKitchenReceiptSettings,
  CompanyReceiptSettings,
  CompanyTaxSettings,
  DayState,
  MenuItem,
  ModifierGroup,
  Order,
  OrderSyncStatus,
} from '@/types'

export interface MenuCacheRow {
  /** Composite key `${companyId}_${branchId}` */
  cacheKey: string
  companyId: string
  branchId: string
  categories: Category[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
  updatedAt: number
}

export interface TaxCacheRow {
  cacheKey: string
  companyId: string
  branchId: string
  settings: CompanyTaxSettings | null
  legacyTaxRate?: number
  updatedAt: number
}

export interface ReceiptCacheRow {
  cacheKey: string
  companyId: string
  branchId: string
  settings: CompanyReceiptSettings | null
  updatedAt: number
}

export interface KitchenReceiptCacheRow {
  cacheKey: string
  companyId: string
  branchId: string
  settings: CompanyKitchenReceiptSettings | null
  updatedAt: number
}

export interface CompanyCacheRow {
  companyId: string
  company: Company
  updatedAt: number
}

export interface AuthCacheRow {
  uid: string
  user: AppUser
  updatedAt: number
}

export interface OrderOutboxRow {
  localId: string
  companyId: string
  branchId: string
  order: Order
  syncStatus: OrderSyncStatus
  clientCreatedAt: number
  lastError?: string
  remoteOrderId?: string
}

export interface MetaRow {
  key: string
  value: number
  updatedAt: number
}

/** Binary image bytes keyed by stable remote URL (no query token) for offline POS. */
export interface ImageCacheRow {
  url: string
  /** Raw bytes — more reliable in IndexedDB than Blob across reloads. */
  bytes: ArrayBuffer
  contentType: string
  companyId?: string
  updatedAt: number
}

export interface DayStateCacheRow {
  cacheKey: string
  companyId: string
  branchId: string
  dayState: DayState
  updatedAt: number
}

class PosLocalDb extends Dexie {
  menuCache!: Table<MenuCacheRow, string>
  taxCache!: Table<TaxCacheRow, string>
  receiptCache!: Table<ReceiptCacheRow, string>
  kitchenReceiptCache!: Table<KitchenReceiptCacheRow, string>
  companyCache!: Table<CompanyCacheRow, string>
  authCache!: Table<AuthCacheRow, string>
  orderOutbox!: Table<OrderOutboxRow, string>
  meta!: Table<MetaRow, string>
  imageCache!: Table<ImageCacheRow, string>
  dayStateCache!: Table<DayStateCacheRow, string>

  constructor() {
    super('pos-local')
    this.version(1).stores({
      menuCache: 'companyId',
      taxCache: 'companyId',
      companyCache: 'companyId',
      authCache: 'uid',
      orderOutbox: 'localId, companyId, syncStatus, clientCreatedAt',
      meta: 'key',
    })
    this.version(2).stores({
      menuCache: 'companyId',
      taxCache: 'companyId',
      companyCache: 'companyId',
      authCache: 'uid',
      orderOutbox: 'localId, companyId, syncStatus, clientCreatedAt',
      meta: 'key',
      imageCache: 'url, companyId, updatedAt',
    })
    // v3: store ArrayBuffer instead of Blob; clear old rows so they re-download
    this.version(3)
      .stores({
        menuCache: 'companyId',
        taxCache: 'companyId',
        companyCache: 'companyId',
        authCache: 'uid',
        orderOutbox: 'localId, companyId, syncStatus, clientCreatedAt',
        meta: 'key',
        imageCache: 'url, companyId, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx.table('imageCache').clear()
      })
    this.version(4).stores({
      menuCache: 'companyId',
      taxCache: 'companyId',
      receiptCache: 'companyId',
      companyCache: 'companyId',
      authCache: 'uid',
      orderOutbox: 'localId, companyId, syncStatus, clientCreatedAt',
      meta: 'key',
      imageCache: 'url, companyId, updatedAt',
    })
    // v5: branch-scoped caches and outbox
    this.version(5)
      .stores({
        menuCache: 'cacheKey, companyId, branchId',
        taxCache: 'cacheKey, companyId, branchId',
        receiptCache: 'cacheKey, companyId, branchId',
        companyCache: 'companyId',
        authCache: 'uid',
        orderOutbox: 'localId, companyId, branchId, syncStatus, clientCreatedAt',
        meta: 'key',
        imageCache: 'url, companyId, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx.table('menuCache').clear()
        await tx.table('taxCache').clear()
        await tx.table('receiptCache').clear()
        await tx.table('orderOutbox').clear()
      })
    // v6: cache open reporting period for offline order numbers
    this.version(6).stores({
      menuCache: 'cacheKey, companyId, branchId',
      taxCache: 'cacheKey, companyId, branchId',
      receiptCache: 'cacheKey, companyId, branchId',
      companyCache: 'companyId',
      authCache: 'uid',
      orderOutbox: 'localId, companyId, branchId, syncStatus, clientCreatedAt',
      meta: 'key',
      imageCache: 'url, companyId, updatedAt',
      dayStateCache: 'cacheKey, companyId, branchId',
    })
    // v7: kitchen receipt include/exclude settings cache
    this.version(7).stores({
      menuCache: 'cacheKey, companyId, branchId',
      taxCache: 'cacheKey, companyId, branchId',
      receiptCache: 'cacheKey, companyId, branchId',
      kitchenReceiptCache: 'cacheKey, companyId, branchId',
      companyCache: 'companyId',
      authCache: 'uid',
      orderOutbox: 'localId, companyId, branchId, syncStatus, clientCreatedAt',
      meta: 'key',
      imageCache: 'url, companyId, updatedAt',
      dayStateCache: 'cacheKey, companyId, branchId',
    })
  }
}

export const localDb = new PosLocalDb()

const isIndexedDbOpenError = (e: unknown) => {
  const name =
    e && typeof e === 'object' && 'name' in e
      ? String((e as { name: unknown }).name)
      : ''
  const message = e instanceof Error ? e.message : String(e)
  const inner =
    e && typeof e === 'object' && 'inner' in e
      ? (e as { inner: unknown }).inner
      : undefined
  const innerName =
    inner && typeof inner === 'object' && 'name' in inner
      ? String((inner as { name: unknown }).name)
      : ''
  const innerMessage =
    inner instanceof Error
      ? inner.message
      : inner && typeof inner === 'object' && 'message' in inner
        ? String((inner as { message: unknown }).message)
        : ''
  const looksLikeBackingStore =
    /Internal error opening backing store/i.test(message) ||
    /Internal error opening backing store/i.test(innerMessage)
  return (
    name === 'DatabaseClosedError' ||
    name === 'InvalidStateError' ||
    name === 'OpenFailedError' ||
    name === 'UnknownError' ||
    innerName === 'UnknownError' ||
    /DatabaseClosed/i.test(name) ||
    looksLikeBackingStore
  )
}

let reopenPromise: Promise<boolean> | null = null

/** Reopen Dexie; if the backing store is corrupt, delete and recreate. */
async function tryReopenLocalDb(): Promise<boolean> {
  if (reopenPromise) return reopenPromise
  reopenPromise = (async () => {
    try {
      if (localDb.isOpen()) {
        localDb.close()
      }
      await localDb.open()
      return true
    } catch (err) {
      console.warn('[localdb] open failed, attempting delete+recreate', err)
      try {
        await Dexie.delete('pos-local')
        await localDb.open()
        return true
      } catch (recreateErr) {
        console.warn('[localdb] IndexedDB unavailable', recreateErr)
        return false
      }
    } finally {
      reopenPromise = null
    }
  })()
  return reopenPromise
}

/**
 * Run a local DB op; on IndexedDB open/closed failures, try reopen (or recreate)
 * once, then give up without throwing when recovery fails.
 */
export async function withLocalDb<T>(op: () => Promise<T>): Promise<T | undefined> {
  try {
    return await op()
  } catch (e) {
    if (!isIndexedDbOpenError(e)) throw e
    console.warn('[localdb] IndexedDB error, attempting recovery', e)
    const ok = await tryReopenLocalDb()
    if (!ok) return undefined
    try {
      return await op()
    } catch (retryErr) {
      console.warn('[localdb] operation failed after reopen', retryErr)
      return undefined
    }
  }
}

/**
 * Like withLocalDb, but throws a clear error when IndexedDB cannot be recovered.
 * Use for checkout / outbox writes that must not silently no-op.
 */
export async function requireLocalDb<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    if (!isIndexedDbOpenError(e)) throw e
    console.warn('[localdb] IndexedDB error, attempting recovery', e)
    const ok = await tryReopenLocalDb()
    if (!ok) {
      throw new Error(
        'Local storage is unavailable. Close other POS windows, restart the app, and try again.',
      )
    }
    try {
      return await op()
    } catch (retryErr) {
      if (isIndexedDbOpenError(retryErr)) {
        throw new Error(
          'Local storage is unavailable. Close other POS windows, restart the app, and try again.',
        )
      }
      throw retryErr
    }
  }
}

export const branchCacheKey = (companyId: string, branchId: string) =>
  `${companyId}_${branchId}`

export const menuCacheKey = (companyId: string, branchId: string) =>
  branchCacheKey(companyId, branchId)

export const counterMetaKey = (
  companyId: string,
  branchId: string,
  periodId: string,
) => `counter:${companyId}:${branchId}:${periodId}`

export const saveMenuCache = async (
  companyId: string,
  branchId: string,
  categories: Category[],
  items: MenuItem[],
  modifierGroups: ModifierGroup[],
) => {
  await withLocalDb(() =>
    localDb.menuCache.put({
      cacheKey: menuCacheKey(companyId, branchId),
      companyId,
      branchId,
      categories,
      items,
      modifierGroups,
      updatedAt: Date.now(),
    }),
  )
}

export const getMenuCache = async (companyId: string, branchId: string) =>
  withLocalDb(() => localDb.menuCache.get(menuCacheKey(companyId, branchId)))

export const saveTaxCache = async (
  companyId: string,
  branchId: string,
  settings: CompanyTaxSettings | null,
  legacyTaxRate?: number,
) => {
  await withLocalDb(() =>
    localDb.taxCache.put({
      cacheKey: branchCacheKey(companyId, branchId),
      companyId,
      branchId,
      settings,
      legacyTaxRate,
      updatedAt: Date.now(),
    }),
  )
}

export const getTaxCache = async (companyId: string, branchId: string) =>
  withLocalDb(() => localDb.taxCache.get(branchCacheKey(companyId, branchId)))

export const saveReceiptCache = async (
  companyId: string,
  branchId: string,
  settings: CompanyReceiptSettings | null,
) => {
  await withLocalDb(() =>
    localDb.receiptCache.put({
      cacheKey: branchCacheKey(companyId, branchId),
      companyId,
      branchId,
      settings,
      updatedAt: Date.now(),
    }),
  )
}

export const getReceiptCache = async (companyId: string, branchId: string) =>
  withLocalDb(() => localDb.receiptCache.get(branchCacheKey(companyId, branchId)))

export const saveKitchenReceiptCache = async (
  companyId: string,
  branchId: string,
  settings: CompanyKitchenReceiptSettings | null,
) => {
  await withLocalDb(() =>
    localDb.kitchenReceiptCache.put({
      cacheKey: branchCacheKey(companyId, branchId),
      companyId,
      branchId,
      settings,
      updatedAt: Date.now(),
    }),
  )
}

export const getKitchenReceiptCache = async (companyId: string, branchId: string) =>
  withLocalDb(() =>
    localDb.kitchenReceiptCache.get(branchCacheKey(companyId, branchId)),
  )

export const saveCompanyCache = async (company: Company) => {
  await withLocalDb(() =>
    localDb.companyCache.put({
      companyId: company.id,
      company,
      updatedAt: Date.now(),
    }),
  )
}

export const getCompanyCache = async (companyId: string) =>
  withLocalDb(() => localDb.companyCache.get(companyId))

export const saveAuthCache = async (user: AppUser) => {
  try {
    await withLocalDb(() =>
      localDb.authCache.put({
        uid: user.uid,
        user,
        updatedAt: Date.now(),
      }),
    )
  } catch (e) {
    console.warn('[localdb] saveAuthCache failed', e)
  }
}

export const getAuthCache = async (
  uid: string,
): Promise<AuthCacheRow | undefined> => {
  try {
    return await withLocalDb(() => localDb.authCache.get(uid))
  } catch (e) {
    console.warn('[localdb] getAuthCache failed', e)
    return undefined
  }
}

export const clearAuthCache = async (uid?: string) => {
  try {
    await withLocalDb(async () => {
      if (uid) {
        await localDb.authCache.delete(uid)
        return
      }
      await localDb.authCache.clear()
    })
  } catch (e) {
    console.warn('[localdb] clearAuthCache failed', e)
  }
}

export const getCounterMeta = async (
  companyId: string,
  branchId: string,
  periodId: string,
) => {
  const row = await withLocalDb(() =>
    localDb.meta.get(counterMetaKey(companyId, branchId, periodId)),
  )
  return row?.value ?? 0
}

/** Best-effort local counter cache — never blocks checkout on IndexedDB failure. */
export const setCounterMeta = async (
  companyId: string,
  branchId: string,
  periodId: string,
  value: number,
) => {
  try {
    await withLocalDb(async () => {
      const key = counterMetaKey(companyId, branchId, periodId)
      const existing = await localDb.meta.get(key)
      if (existing && existing.value >= value) return
      await localDb.meta.put({ key, value, updatedAt: Date.now() })
    })
  } catch (e) {
    console.warn('[localdb] setCounterMeta failed', e)
  }
}

export const clearCounterMeta = async (
  companyId: string,
  branchId: string,
  periodId: string,
) => {
  await withLocalDb(() =>
    localDb.meta.delete(counterMetaKey(companyId, branchId, periodId)),
  )
}

export const saveDayStateCache = async (
  companyId: string,
  branchId: string,
  dayState: DayState,
) => {
  await withLocalDb(() =>
    localDb.dayStateCache.put({
      cacheKey: branchCacheKey(companyId, branchId),
      companyId,
      branchId,
      dayState,
      updatedAt: Date.now(),
    }),
  )
}

export const getDayStateCache = async (
  companyId: string,
  branchId: string,
): Promise<DayState | null> => {
  const row = await withLocalDb(() =>
    localDb.dayStateCache.get(branchCacheKey(companyId, branchId)),
  )
  return row?.dayState ?? null
}

export const listPendingOutbox = async (
  companyId?: string,
  branchId?: string,
): Promise<OrderOutboxRow[]> => {
  const rows = await withLocalDb(() => {
    if (companyId && branchId) {
      return localDb.orderOutbox
        .where('branchId')
        .equals(branchId)
        .filter(
          (r) =>
            r.companyId === companyId &&
            (r.syncStatus === 'pending' || r.syncStatus === 'error'),
        )
        .toArray()
    }
    if (companyId) {
      return localDb.orderOutbox
        .where('companyId')
        .equals(companyId)
        .filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'error')
        .toArray()
    }
    return localDb.orderOutbox
      .filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'error')
      .toArray()
  })
  return rows ?? []
}

export const listUnsyncedOutbox = async (
  companyId: string,
  branchId: string,
): Promise<OrderOutboxRow[]> => {
  const rows = await withLocalDb(() =>
    localDb.orderOutbox
      .where('branchId')
      .equals(branchId)
      .filter((r) => r.companyId === companyId && r.syncStatus !== 'synced')
      .toArray(),
  )
  return rows ?? []
}

export const getOutboxOrder = async (localId: string): Promise<Order | null> => {
  const row = await withLocalDb(() => localDb.orderOutbox.get(localId))
  if (!row) return null
  return {
    ...row.order,
    syncStatus: row.syncStatus,
    syncError: row.lastError,
  }
}

export const putOutboxOrder = async (row: OrderOutboxRow) => {
  await requireLocalDb(() => localDb.orderOutbox.put(row))
}

export const getOutboxRow = async (localId: string) =>
  requireLocalDb(() => localDb.orderOutbox.get(localId))

export const updateOutboxRow = async (
  localId: string,
  changes: Partial<OrderOutboxRow>,
) => {
  await requireLocalDb(() => localDb.orderOutbox.update(localId, changes))
}

export const isLocalOrderId = (orderId: string) => orderId.startsWith('local_')
