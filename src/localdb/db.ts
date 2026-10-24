import Dexie, { type Table } from 'dexie'
import type {
  AppUser,
  Category,
  Company,
  CompanyReceiptSettings,
  CompanyTaxSettings,
  MenuItem,
  ModifierGroup,
  Order,
  OrderSyncStatus,
} from '@/types'

export interface MenuCacheRow {
  companyId: string
  categories: Category[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
  updatedAt: number
}

export interface TaxCacheRow {
  companyId: string
  settings: CompanyTaxSettings | null
  legacyTaxRate?: number
  updatedAt: number
}

export interface ReceiptCacheRow {
  companyId: string
  settings: CompanyReceiptSettings | null
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

class PosLocalDb extends Dexie {
  menuCache!: Table<MenuCacheRow, string>
  taxCache!: Table<TaxCacheRow, string>
  receiptCache!: Table<ReceiptCacheRow, string>
  companyCache!: Table<CompanyCacheRow, string>
  authCache!: Table<AuthCacheRow, string>
  orderOutbox!: Table<OrderOutboxRow, string>
  meta!: Table<MetaRow, string>
  imageCache!: Table<ImageCacheRow, string>

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
  }
}

export const localDb = new PosLocalDb()

export const menuCacheKey = (companyId: string) => companyId

export const counterMetaKey = (companyId: string, orderDate: string) =>
  `counter:${companyId}:${orderDate}`

export const saveMenuCache = async (
  companyId: string,
  categories: Category[],
  items: MenuItem[],
  modifierGroups: ModifierGroup[],
) => {
  await localDb.menuCache.put({
    companyId,
    categories,
    items,
    modifierGroups,
    updatedAt: Date.now(),
  })
}

export const getMenuCache = (companyId: string) =>
  localDb.menuCache.get(companyId)

export const saveTaxCache = async (
  companyId: string,
  settings: CompanyTaxSettings | null,
  legacyTaxRate?: number,
) => {
  await localDb.taxCache.put({
    companyId,
    settings,
    legacyTaxRate,
    updatedAt: Date.now(),
  })
}

export const getTaxCache = (companyId: string) => localDb.taxCache.get(companyId)

export const saveReceiptCache = async (
  companyId: string,
  settings: CompanyReceiptSettings | null,
) => {
  await localDb.receiptCache.put({
    companyId,
    settings,
    updatedAt: Date.now(),
  })
}

export const getReceiptCache = (companyId: string) =>
  localDb.receiptCache.get(companyId)

export const saveCompanyCache = async (company: Company) => {
  await localDb.companyCache.put({
    companyId: company.id,
    company,
    updatedAt: Date.now(),
  })
}

export const getCompanyCache = (companyId: string) =>
  localDb.companyCache.get(companyId)

export const saveAuthCache = async (user: AppUser) => {
  await localDb.authCache.put({
    uid: user.uid,
    user,
    updatedAt: Date.now(),
  })
}

export const getAuthCache = (uid: string) => localDb.authCache.get(uid)

export const clearAuthCache = async (uid?: string) => {
  if (uid) {
    await localDb.authCache.delete(uid)
    return
  }
  await localDb.authCache.clear()
}

export const getCounterMeta = async (companyId: string, orderDate: string) => {
  const row = await localDb.meta.get(counterMetaKey(companyId, orderDate))
  return row?.value ?? 0
}

export const setCounterMeta = async (
  companyId: string,
  orderDate: string,
  value: number,
) => {
  const key = counterMetaKey(companyId, orderDate)
  const existing = await localDb.meta.get(key)
  if (existing && existing.value >= value) return
  await localDb.meta.put({ key, value, updatedAt: Date.now() })
}

export const listPendingOutbox = (companyId?: string) => {
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
}

export const listUnsyncedOutbox = (companyId: string) =>
  localDb.orderOutbox
    .where('companyId')
    .equals(companyId)
    .filter((r) => r.syncStatus !== 'synced')
    .toArray()

export const getOutboxOrder = async (localId: string): Promise<Order | null> => {
  const row = await localDb.orderOutbox.get(localId)
  if (!row) return null
  return {
    ...row.order,
    syncStatus: row.syncStatus,
    syncError: row.lastError,
  }
}

export const isLocalOrderId = (orderId: string) => orderId.startsWith('local_')
