import {
  ref,
  push,
  update,
  remove,
  onValue,
  get,
} from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { listActiveBranchIds } from '@/services/branches'
import type {
  BranchWriteScope,
  Category,
  MenuItem,
  ModifierGroup,
  ModifierOption,
} from '@/types'

const categoriesRef = (companyId: string, branchId: string) =>
  ref(db, `menu/${companyId}/${branchId}/categories`)
const categoryRef = (companyId: string, branchId: string, catId: string) =>
  ref(db, `menu/${companyId}/${branchId}/categories/${catId}`)
const itemsRef = (companyId: string, branchId: string) =>
  ref(db, `menu/${companyId}/${branchId}/items`)
const itemRef = (companyId: string, branchId: string, itemId: string) =>
  ref(db, `menu/${companyId}/${branchId}/items/${itemId}`)
const groupsRef = (companyId: string, branchId: string) =>
  ref(db, `menu/${companyId}/${branchId}/modifierGroups`)
const groupRef = (companyId: string, branchId: string, groupId: string) =>
  ref(db, `menu/${companyId}/${branchId}/modifierGroups/${groupId}`)

const stripUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Partial<T> = {}
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

const recordToArray = <T extends { id: string }>(
  val: Record<string, Omit<T, 'id'>> | null,
): T[] => {
  if (!val) return []
  return Object.entries(val).map(([id, v]) => ({ id, ...v }) as T)
}

const resolveTargetBranchIds = async (
  companyId: string,
  branchId: string,
  scope: BranchWriteScope = 'this',
): Promise<string[]> => {
  if (scope === 'all') return listActiveBranchIds(companyId)
  return [branchId]
}

export const subscribeCategories = (
  companyId: string,
  branchId: string,
  cb: (categories: Category[]) => void,
) => {
  return onValue(categoriesRef(companyId, branchId), (snap) => {
    const list = recordToArray<Category>(snap.val())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    cb(list)
  })
}

export const subscribeItems = (
  companyId: string,
  branchId: string,
  cb: (items: MenuItem[]) => void,
) => {
  return onValue(itemsRef(companyId, branchId), (snap) => {
    const list = recordToArray<MenuItem>(snap.val())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    cb(list)
  })
}

export const subscribeModifierGroups = (
  companyId: string,
  branchId: string,
  cb: (groups: ModifierGroup[]) => void,
) => {
  return onValue(groupsRef(companyId, branchId), (snap) => {
    const list = recordToArray<ModifierGroup>(snap.val())
    list.sort((a, b) => a.name.localeCompare(b.name))
    cb(list)
  })
}

export const createCategory = async (
  companyId: string,
  branchId: string,
  data: Omit<Category, 'id' | 'companyId' | 'branchId' | 'createdAt'>,
  scope: BranchWriteScope = 'this',
): Promise<string> => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const id = push(categoriesRef(companyId, branchId)).key!
  const now = Date.now()
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    updates[`menu/${companyId}/${bid}/categories/${id}`] = {
      companyId,
      branchId: bid,
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      active: data.active ?? true,
      createdAt: now,
      ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    }
  }
  await update(ref(db), updates)
  return id
}

export const updateCategory = async (
  companyId: string,
  branchId: string,
  catId: string,
  patch: Partial<Omit<Category, 'id' | 'companyId' | 'branchId' | 'createdAt'>>,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const clean = stripUndefined(patch as Record<string, unknown>)
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    for (const [k, v] of Object.entries(clean)) {
      updates[`menu/${companyId}/${bid}/categories/${catId}/${k}`] = v
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(db), updates)
}

export const deleteCategory = async (
  companyId: string,
  branchId: string,
  catId: string,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  if (scope === 'this') {
    await remove(categoryRef(companyId, branchId, catId))
    return
  }
  const updates: Record<string, null> = {}
  for (const bid of targets) {
    const snap = await get(categoryRef(companyId, bid, catId))
    if (snap.exists()) updates[`menu/${companyId}/${bid}/categories/${catId}`] = null
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const createItem = async (
  companyId: string,
  branchId: string,
  data: Omit<MenuItem, 'id' | 'companyId' | 'branchId' | 'createdAt'>,
  scope: BranchWriteScope = 'this',
): Promise<string> => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const id = push(itemsRef(companyId, branchId)).key!
  const now = Date.now()
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    updates[`menu/${companyId}/${bid}/items/${id}`] = {
      companyId,
      branchId: bid,
      categoryId: data.categoryId,
      name: data.name,
      basePrice: Number(data.basePrice) || 0,
      available: data.available ?? true,
      variants: data.variants ?? {},
      modifierGroupIds: data.modifierGroupIds ?? [],
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      ...(data.description ? { description: data.description } : {}),
      ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    }
  }
  await update(ref(db), updates)
  return id
}

export const updateItem = async (
  companyId: string,
  branchId: string,
  itemId: string,
  patch: Partial<Omit<MenuItem, 'id' | 'companyId' | 'branchId' | 'createdAt'>>,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const clean = stripUndefined(patch as Record<string, unknown>)
  if (scope === 'this') {
    await update(itemRef(companyId, branchId, itemId), clean)
    return
  }
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    const snap = await get(itemRef(companyId, bid, itemId))
    if (!snap.exists()) continue
    for (const [k, v] of Object.entries(clean)) {
      updates[`menu/${companyId}/${bid}/items/${itemId}/${k}`] = v
    }
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const toggleItemAvailability = async (
  companyId: string,
  branchId: string,
  itemId: string,
  available: boolean,
  scope: BranchWriteScope = 'this',
) => {
  await updateItem(companyId, branchId, itemId, { available }, scope)
}

export const deleteItem = async (
  companyId: string,
  branchId: string,
  itemId: string,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  if (scope === 'this') {
    await remove(itemRef(companyId, branchId, itemId))
    return
  }
  const updates: Record<string, null> = {}
  for (const bid of targets) {
    const snap = await get(itemRef(companyId, bid, itemId))
    if (snap.exists()) updates[`menu/${companyId}/${bid}/items/${itemId}`] = null
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const createModifierGroup = async (
  companyId: string,
  branchId: string,
  data: Omit<ModifierGroup, 'id' | 'companyId' | 'branchId' | 'createdAt'>,
  scope: BranchWriteScope = 'this',
): Promise<string> => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const id = push(groupsRef(companyId, branchId)).key!
  const now = Date.now()
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    updates[`menu/${companyId}/${bid}/modifierGroups/${id}`] = {
      companyId,
      branchId: bid,
      name: data.name,
      required: data.required ?? false,
      min: data.min ?? 0,
      max: data.max ?? 1,
      options: data.options ?? {},
      createdAt: now,
    }
  }
  await update(ref(db), updates)
  return id
}

export const updateModifierGroup = async (
  companyId: string,
  branchId: string,
  groupId: string,
  patch: Partial<Omit<ModifierGroup, 'id' | 'companyId' | 'branchId' | 'createdAt'>>,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const clean = stripUndefined(patch as Record<string, unknown>)
  if (scope === 'this') {
    await update(groupRef(companyId, branchId, groupId), clean)
    return
  }
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    const snap = await get(groupRef(companyId, bid, groupId))
    if (!snap.exists()) continue
    for (const [k, v] of Object.entries(clean)) {
      updates[`menu/${companyId}/${bid}/modifierGroups/${groupId}/${k}`] = v
    }
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const deleteModifierGroup = async (
  companyId: string,
  branchId: string,
  groupId: string,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  if (scope === 'this') {
    await remove(groupRef(companyId, branchId, groupId))
    return
  }
  const updates: Record<string, null> = {}
  for (const bid of targets) {
    const snap = await get(groupRef(companyId, bid, groupId))
    if (snap.exists()) updates[`menu/${companyId}/${bid}/modifierGroups/${groupId}`] = null
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const upsertModifierOption = async (
  companyId: string,
  branchId: string,
  groupId: string,
  option: ModifierOption,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  const payload = {
    id: option.id,
    name: option.name,
    priceAdjustment: Number(option.priceAdjustment) || 0,
  }
  if (scope === 'this') {
    await update(
      ref(db, `menu/${companyId}/${branchId}/modifierGroups/${groupId}/options/${option.id}`),
      payload,
    )
    return
  }
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    const snap = await get(groupRef(companyId, bid, groupId))
    if (!snap.exists()) continue
    updates[`menu/${companyId}/${bid}/modifierGroups/${groupId}/options/${option.id}`] = payload
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const deleteModifierOption = async (
  companyId: string,
  branchId: string,
  groupId: string,
  optionId: string,
  scope: BranchWriteScope = 'this',
) => {
  const targets = await resolveTargetBranchIds(companyId, branchId, scope)
  if (scope === 'this') {
    await remove(
      ref(db, `menu/${companyId}/${branchId}/modifierGroups/${groupId}/options/${optionId}`),
    )
    return
  }
  const updates: Record<string, null> = {}
  for (const bid of targets) {
    const snap = await get(
      ref(db, `menu/${companyId}/${bid}/modifierGroups/${groupId}/options/${optionId}`),
    )
    if (snap.exists()) {
      updates[`menu/${companyId}/${bid}/modifierGroups/${groupId}/options/${optionId}`] = null
    }
  }
  if (Object.keys(updates).length > 0) await update(ref(db), updates)
}

export const getCategoriesOnce = async (
  companyId: string,
  branchId: string,
): Promise<Category[]> => {
  const snap = await get(categoriesRef(companyId, branchId))
  return recordToArray<Category>(snap.val())
}

export const uploadMenuImage = async (
  companyId: string,
  file: File,
  subfolder: 'categories' | 'items' = 'items',
): Promise<string> => {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `menu/${companyId}/${subfolder}/${Date.now()}_${safeName}`
  const r = storageRef(storage, path)
  await uploadBytes(r, file, { contentType: file.type })
  return getDownloadURL(r)
}

export const uploadCompanyLogo = async (companyId: string, file: File): Promise<string> => {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `companies/${companyId}/logo/${Date.now()}_${safeName}`
  const r = storageRef(storage, path)
  await uploadBytes(r, file, { contentType: file.type })
  return getDownloadURL(r)
}

export const deleteStorageFile = async (url: string) => {
  try {
    const r = storageRef(storage, url)
    await deleteObject(r)
  } catch {
    // ignore missing
  }
}
