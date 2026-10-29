import { get, onValue, ref, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { CompanyReceiptSettings, ReceiptBlock } from '@/types'
import {
  cleanReceiptBlocksForSave,
  parseReceiptSettingsPayload,
} from '@/utils/receiptBlocks'

export const receiptSettingsRef = (companyId: string, branchId: string) =>
  ref(db, `receiptSettings/${companyId}/${branchId}`)

export type ReceiptSettingsError = {
  code?: string
  message: string
}

export const subscribeReceiptSettings = (
  companyId: string,
  branchId: string,
  cb: (settings: CompanyReceiptSettings | null) => void,
  onError?: (error: ReceiptSettingsError) => void,
) => {
  return onValue(
    receiptSettingsRef(companyId, branchId),
    (snap) => {
      const val = snap.val() as Omit<CompanyReceiptSettings, 'companyId' | 'branchId'> | null
      cb(parseReceiptSettingsPayload(companyId, branchId, val))
    },
    (err) => {
      onError?.({
        code: (err as { code?: string }).code,
        message: err.message || 'Failed to load receipt settings',
      })
      cb(null)
    },
  )
}

export const getReceiptSettings = async (
  companyId: string,
  branchId: string,
): Promise<CompanyReceiptSettings | null> => {
  const snap = await get(receiptSettingsRef(companyId, branchId))
  const val = snap.val() as Omit<CompanyReceiptSettings, 'companyId' | 'branchId'> | null
  return parseReceiptSettingsPayload(companyId, branchId, val)
}

export const saveReceiptSettings = async (
  companyId: string,
  branchId: string,
  blocks: ReceiptBlock[],
  updatedBy: string,
): Promise<void> => {
  const payload: Omit<CompanyReceiptSettings, 'companyId' | 'branchId'> = {
    blocks: cleanReceiptBlocksForSave(blocks),
    updatedAt: Date.now(),
    updatedBy,
  }
  await set(receiptSettingsRef(companyId, branchId), payload)
}
