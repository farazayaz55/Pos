import { get, onValue, ref, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { CompanyKitchenReceiptSettings } from '@/types'

export const kitchenReceiptSettingsRef = (companyId: string, branchId: string) =>
  ref(db, `kitchenReceiptSettings/${companyId}/${branchId}`)

export type KitchenReceiptSettingsError = {
  code?: string
  message: string
}

const normalizeIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export const parseKitchenReceiptSettingsPayload = (
  companyId: string,
  branchId: string,
  val: Omit<CompanyKitchenReceiptSettings, 'companyId' | 'branchId'> | null,
): CompanyKitchenReceiptSettings | null => {
  if (!val) return null
  return {
    companyId,
    branchId,
    excludedCategoryIds: normalizeIdList(val.excludedCategoryIds),
    excludedItemIds: normalizeIdList(val.excludedItemIds),
    includedItemIds: normalizeIdList(val.includedItemIds),
    ...(typeof val.updatedAt === 'number' ? { updatedAt: val.updatedAt } : {}),
    ...(typeof val.updatedBy === 'string' ? { updatedBy: val.updatedBy } : {}),
  }
}

export const emptyKitchenReceiptSettings = (
  companyId: string,
  branchId: string,
): CompanyKitchenReceiptSettings => ({
  companyId,
  branchId,
  excludedCategoryIds: [],
  excludedItemIds: [],
  includedItemIds: [],
})

export const subscribeKitchenReceiptSettings = (
  companyId: string,
  branchId: string,
  cb: (settings: CompanyKitchenReceiptSettings | null) => void,
  onError?: (error: KitchenReceiptSettingsError) => void,
) => {
  return onValue(
    kitchenReceiptSettingsRef(companyId, branchId),
    (snap) => {
      const val = snap.val() as Omit<
        CompanyKitchenReceiptSettings,
        'companyId' | 'branchId'
      > | null
      cb(parseKitchenReceiptSettingsPayload(companyId, branchId, val))
    },
    (err) => {
      onError?.({
        code: (err as { code?: string }).code,
        message: err.message || 'Failed to load kitchen receipt settings',
      })
      cb(null)
    },
  )
}

export const getKitchenReceiptSettings = async (
  companyId: string,
  branchId: string,
): Promise<CompanyKitchenReceiptSettings | null> => {
  const snap = await get(kitchenReceiptSettingsRef(companyId, branchId))
  const val = snap.val() as Omit<
    CompanyKitchenReceiptSettings,
    'companyId' | 'branchId'
  > | null
  return parseKitchenReceiptSettingsPayload(companyId, branchId, val)
}

export const saveKitchenReceiptSettings = async (
  companyId: string,
  branchId: string,
  settings: Pick<
    CompanyKitchenReceiptSettings,
    'excludedCategoryIds' | 'excludedItemIds' | 'includedItemIds'
  >,
  updatedBy: string,
): Promise<void> => {
  const payload: Omit<CompanyKitchenReceiptSettings, 'companyId' | 'branchId'> = {
    excludedCategoryIds: normalizeIdList(settings.excludedCategoryIds),
    excludedItemIds: normalizeIdList(settings.excludedItemIds),
    includedItemIds: normalizeIdList(settings.includedItemIds),
    updatedAt: Date.now(),
    updatedBy,
  }
  await set(kitchenReceiptSettingsRef(companyId, branchId), payload)
}
