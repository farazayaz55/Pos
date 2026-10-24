import { get, onValue, ref, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { CompanyReceiptSettings, ReceiptBlock } from '@/types'
import {
  cleanReceiptBlocksForSave,
  parseReceiptSettingsPayload,
} from '@/utils/receiptBlocks'

export const receiptSettingsRef = (companyId: string) =>
  ref(db, `receiptSettings/${companyId}`)

export type ReceiptSettingsError = {
  code?: string
  message: string
}

export const subscribeReceiptSettings = (
  companyId: string,
  cb: (settings: CompanyReceiptSettings | null) => void,
  onError?: (error: ReceiptSettingsError) => void,
) => {
  return onValue(
    receiptSettingsRef(companyId),
    (snap) => {
      const val = snap.val() as Omit<CompanyReceiptSettings, 'companyId'> | null
      cb(parseReceiptSettingsPayload(companyId, val))
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
): Promise<CompanyReceiptSettings | null> => {
  const snap = await get(receiptSettingsRef(companyId))
  const val = snap.val() as Omit<CompanyReceiptSettings, 'companyId'> | null
  return parseReceiptSettingsPayload(companyId, val)
}

export const saveReceiptSettings = async (
  companyId: string,
  blocks: ReceiptBlock[],
  updatedBy: string,
): Promise<void> => {
  const payload: Omit<CompanyReceiptSettings, 'companyId'> = {
    blocks: cleanReceiptBlocksForSave(blocks),
    updatedAt: Date.now(),
    updatedBy,
  }
  await set(receiptSettingsRef(companyId), payload)
}
