import {
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get,
} from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { Category, MenuItem, ModifierGroup, ModifierOption } from '@/types'

const categoriesRef = (companyId: string) => ref(db, `menu/${companyId}/categories`)
const categoryRef = (companyId: string, catId: string) =>
  ref(db, `menu/${companyId}/categories/${catId}`)
const itemsRef = (companyId: string) => ref(db, `menu/${companyId}/items`)
const itemRef = (companyId: string, itemId: string) =>
  ref(db, `menu/${companyId}/items/${itemId}`)
const groupsRef = (companyId: string) => ref(db, `menu/${companyId}/modifierGroups`)
const groupRef = (companyId: string, groupId: string) =>
  ref(db, `menu/${companyId}/modifierGroups/${groupId}`)

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

export const subscribeCategories = (
  companyId: string,
  cb: (categories: Category[]) => void,
) => {
  return onValue(categoriesRef(companyId), (snap) => {
    const list = recordToArray<Category>(snap.val())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    cb(list)
  })
}

export const subscribeItems = (companyId: string, cb: (items: MenuItem[]) => void) => {
  return onValue(itemsRef(companyId), (snap) => {
    const list = recordToArray<MenuItem>(snap.val())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    cb(list)
  })
}

export const subscribeModifierGroups = (
  companyId: string,
  cb: (groups: ModifierGroup[]) => void,
) => {
  return onValue(groupsRef(companyId), (snap) => {
    const list = recordToArray<ModifierGroup>(snap.val())
    list.sort((a, b) => a.name.localeCompare(b.name))
    cb(list)
  })
}

export const createCategory = async (
  companyId: string,
  data: Omit<Category, 'id' | 'companyId' | 'createdAt'>,
): Promise<string> => {
  const node = push(categoriesRef(companyId))
  const id = node.key!
  const payload: Omit<Category, 'id'> = {
    companyId,
    name: data.name,
    sortOrder: data.sortOrder ?? 0,
    active: data.active ?? true,
    createdAt: Date.now(),
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
  }
  await set(node, payload)
  return id
}

export const updateCategory = async (
  companyId: string,
  catId: string,
  patch: Partial<Omit<Category, 'id' | 'companyId' | 'createdAt'>>,
) => {
  await update(categoryRef(companyId, catId), stripUndefined(patch))
}

export const deleteCategory = async (companyId: string, catId: string) => {
  await remove(categoryRef(companyId, catId))
}

export const createItem = async (
  companyId: string,
  data: Omit<MenuItem, 'id' | 'companyId' | 'createdAt'>,
): Promise<string> => {
  const node = push(itemsRef(companyId))
  const id = node.key!
  const payload: Omit<MenuItem, 'id'> = {
    companyId,
    categoryId: data.categoryId,
    name: data.name,
    basePrice: Number(data.basePrice) || 0,
    available: data.available ?? true,
    modifierGroupIds: data.modifierGroupIds ?? [],
    sortOrder: data.sortOrder ?? 0,
    createdAt: Date.now(),
    ...(data.description ? { description: data.description } : {}),
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
  }
  await set(node, payload)
  return id
}

export const updateItem = async (
  companyId: string,
  itemId: string,
  patch: Partial<Omit<MenuItem, 'id' | 'companyId' | 'createdAt'>>,
) => {
  await update(itemRef(companyId, itemId), stripUndefined(patch))
}

export const toggleItemAvailability = async (
  companyId: string,
  itemId: string,
  available: boolean,
) => {
  await update(itemRef(companyId, itemId), { available })
}

export const deleteItem = async (companyId: string, itemId: string) => {
  await remove(itemRef(companyId, itemId))
}

export const createModifierGroup = async (
  companyId: string,
  data: Omit<ModifierGroup, 'id' | 'companyId' | 'createdAt'>,
): Promise<string> => {
  const node = push(groupsRef(companyId))
  const id = node.key!
  const payload: Omit<ModifierGroup, 'id'> = {
    companyId,
    name: data.name,
    required: data.required ?? false,
    min: data.min ?? 0,
    max: data.max ?? 1,
    options: data.options ?? {},
    createdAt: Date.now(),
  }
  await set(node, payload)
  return id
}

export const updateModifierGroup = async (
  companyId: string,
  groupId: string,
  patch: Partial<Omit<ModifierGroup, 'id' | 'companyId' | 'createdAt'>>,
) => {
  await update(groupRef(companyId, groupId), stripUndefined(patch))
}

export const deleteModifierGroup = async (companyId: string, groupId: string) => {
  await remove(groupRef(companyId, groupId))
}

export const upsertModifierOption = async (
  companyId: string,
  groupId: string,
  option: ModifierOption,
) => {
  await update(ref(db, `menu/${companyId}/modifierGroups/${groupId}/options/${option.id}`), {
    id: option.id,
    name: option.name,
    priceAdjustment: Number(option.priceAdjustment) || 0,
  })
}

export const deleteModifierOption = async (
  companyId: string,
  groupId: string,
  optionId: string,
) => {
  await remove(ref(db, `menu/${companyId}/modifierGroups/${groupId}/options/${optionId}`))
}

export const getCategoriesOnce = async (companyId: string): Promise<Category[]> => {
  const snap = await get(categoriesRef(companyId))
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
