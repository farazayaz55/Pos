import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import type { BranchWriteScope } from '@/types'
import BranchWriteScopeToggle from '@/components/common/BranchWriteScopeToggle'
import {
  createItem,
  deleteItem,
  toggleItemAvailability,
  updateItem,
  uploadMenuImage,
} from '@/services/menu'
import type { ItemVariant, MenuItem } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import CachedImage from '@/components/common/CachedImage'
import { ensureImageCached } from '@/localdb/imageCache'
import { formatMoney } from '@/utils/currency'
import { generateId } from '@/utils/idGen'
import { itemHasVariants, lowestVariantPrice, sortedVariants } from '@/utils/variants'

interface VariantDraft {
  id: string
  name: string
  price: number
  sortOrder: number
}

interface ItemDraft {
  id?: string
  categoryId: string
  name: string
  description: string
  basePrice: number
  imageUrl?: string
  imageFile?: File | null
  available: boolean
  variants: VariantDraft[]
  modifierGroupIds: string[]
  sortOrder: number
}

const newDraft = (categoryId: string, sortOrder: number): ItemDraft => ({
  categoryId,
  name: '',
  description: '',
  basePrice: 0,
  available: true,
  variants: [],
  modifierGroupIds: [],
  sortOrder,
})

const variantsToRecord = (list: VariantDraft[]): Record<string, ItemVariant> => {
  const out: Record<string, ItemVariant> = {}
  list.forEach((v, idx) => {
    out[v.id] = {
      id: v.id,
      name: v.name.trim(),
      price: Number(v.price) || 0,
      sortOrder: v.sortOrder ?? idx,
    }
  })
  return out
}

const ItemsPage = () => {
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const branchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const { categories, items, modifierGroups, loading } = useCompanyMenu(
    companyId,
    branchId || undefined,
  )
  const [writeScope, setWriteScope] = useState<BranchWriteScope>('this')
  const showScopeToggle = user?.role === 'admin' || user?.role === 'super_admin'
  const [activeCat, setActiveCat] = useState<string>('all')
  const [editing, setEditing] = useState<ItemDraft | null>(null)
  const [toDelete, setToDelete] = useState<MenuItem | null>(null)
  const [saving, setSaving] = useState(false)

  const visible = useMemo(
    () => (activeCat === 'all' ? items : items.filter((i) => i.categoryId === activeCat)),
    [items, activeCat],
  )

  const startCreate = () => {
    if (categories.length === 0) {
      toast.error('Create a category first')
      return
    }
    const defaultCat = activeCat !== 'all' ? activeCat : categories[0].id
    const ordersInCat = items.filter((i) => i.categoryId === defaultCat)
    const nextOrder = ordersInCat.length
      ? Math.max(...ordersInCat.map((i) => i.sortOrder)) + 1
      : 0
    setEditing(newDraft(defaultCat, nextOrder))
  }

  const startEdit = (i: MenuItem) =>
    setEditing({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description || '',
      basePrice: i.basePrice,
      imageUrl: i.imageUrl,
      available: i.available,
      variants: sortedVariants(i.variants).map((v) => ({
        id: v.id,
        name: v.name,
        price: v.price,
        sortOrder: v.sortOrder,
      })),
      modifierGroupIds: i.modifierGroupIds || [],
      sortOrder: i.sortOrder,
    })

  const onSave = async () => {
    if (!editing || !companyId || !branchId) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }

    const cleanedVariants = editing.variants
      .map((v, idx) => ({
        ...v,
        name: v.name.trim(),
        price: Number(v.price) || 0,
        sortOrder: idx,
      }))
      .filter((v) => v.name.length > 0)

    for (const v of cleanedVariants) {
      if (v.price < 0 || Number.isNaN(v.price)) {
        toast.error(`Variant "${v.name}" needs a valid price`)
        return
      }
    }

    const hasVariants = cleanedVariants.length > 0
    let basePrice = Number(editing.basePrice) || 0
    if (hasVariants) {
      basePrice = Math.min(...cleanedVariants.map((v) => v.price))
    } else if (basePrice < 0 || Number.isNaN(basePrice)) {
      toast.error('Price must be a positive number')
      return
    }

    setSaving(true)
    try {
      let imageUrl = editing.imageUrl
      if (editing.imageFile) {
        imageUrl = await uploadMenuImage(companyId, editing.imageFile, 'items')
        if (imageUrl) void ensureImageCached(imageUrl, companyId, { force: true })
      }
      const variants = variantsToRecord(cleanedVariants)
      const payload = {
        categoryId: editing.categoryId,
        name: editing.name.trim(),
        description: editing.description.trim() || undefined,
        basePrice,
        available: editing.available,
        variants,
        modifierGroupIds: editing.modifierGroupIds,
        sortOrder: editing.sortOrder,
        ...(imageUrl ? { imageUrl } : {}),
      }
      if (editing.id) {
        await updateItem(companyId, branchId, editing.id, payload, writeScope)
        toast.success('Item updated')
      } else {
        await createItem(companyId, branchId, payload, writeScope)
        toast.success('Item created')
      }
      setEditing(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!toDelete || !companyId || !branchId) return
    setSaving(true)
    try {
      await deleteItem(companyId, branchId, toDelete.id, writeScope)
      toast.success('Item deleted')
      setToDelete(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const onToggle = async (item: MenuItem) => {
    if (!branchId) return
    try {
      await toggleItemAvailability(
        companyId,
        branchId,
        item.id,
        !item.available,
        writeScope,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toggle failed')
    }
  }

  if (loading) return <LoadingScreen label="Loading items..." />

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Items</h1>
          <p className="text-sm text-slate-500">
            Manage menu items, variants, add-ons, and availability.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showScopeToggle && (
            <BranchWriteScopeToggle
              value={writeScope}
              onChange={setWriteScope}
              disabled={saving}
            />
          )}
          <button onClick={startCreate} className="btn-primary">
            + New Item
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCat('all')}
          className={
            activeCat === 'all'
              ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
              : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
          }
        >
          All ({items.length})
        </button>
        {categories.map((c) => {
          const count = items.filter((i) => i.categoryId === c.id).length
          return (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={
                activeCat === c.id
                  ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
              }
            >
              {c.name} ({count})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">No items yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((item) => {
            const cat = categories.find((c) => c.id === item.categoryId)
            const hasVars = itemHasVariants(item)
            const fromPrice = hasVars
              ? lowestVariantPrice(item.variants) ?? item.basePrice
              : item.basePrice
            return (
              <div key={item.id} className="card overflow-hidden">
                <div className="relative flex h-32 items-center justify-center bg-slate-50">
                  {item.imageUrl ? (
                    <CachedImage
                      src={item.imageUrl}
                      companyId={companyId}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      fallback={
                        <span className="text-2xl font-bold text-slate-300">
                          {item.name.slice(0, 2).toUpperCase()}
                        </span>
                      }
                    />
                  ) : (
                    <span className="text-2xl font-bold text-slate-300">
                      {item.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {!item.available && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 text-xs font-semibold text-white">
                      Unavailable
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-sm font-bold text-brand-600">
                      {hasVars ? `from ${formatMoney(fromPrice)}` : formatMoney(item.basePrice)}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">{cat?.name || '—'}</p>
                  {item.description && (
                    <p className="line-clamp-2 text-xs text-slate-600">{item.description}</p>
                  )}
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={item.available}
                      onChange={() => onToggle(item)}
                      className="h-4 w-4"
                    />
                    <span>Available</span>
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => startEdit(item)} className="btn-secondary flex-1 text-xs">
                      Edit
                    </button>
                    <button onClick={() => setToDelete(item)} className="btn-danger flex-1 text-xs">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <ItemDrawer
          draft={editing}
          setDraft={setEditing}
          categories={categories}
          modifierGroups={modifierGroups}
          onClose={() => !saving && setEditing(null)}
          onSave={onSave}
          saving={saving}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete item?"
        message={toDelete && <span>Delete <b>{toDelete.name}</b>? This cannot be undone.</span>}
        destructive
        confirmLabel="Delete"
        busy={saving}
        onConfirm={onDelete}
        onCancel={() => !saving && setToDelete(null)}
      />
    </div>
  )
}

interface DrawerProps {
  draft: ItemDraft
  setDraft: (d: ItemDraft) => void
  categories: { id: string; name: string }[]
  modifierGroups: { id: string; name: string }[]
  onClose: () => void
  onSave: () => void
  saving: boolean
}

const ItemDrawer = ({
  draft,
  setDraft,
  categories,
  modifierGroups,
  onClose,
  onSave,
  saving,
}: DrawerProps) => {
  const hasVariants = draft.variants.length > 0

  const toggleGroup = (id: string) => {
    const exists = draft.modifierGroupIds.includes(id)
    setDraft({
      ...draft,
      modifierGroupIds: exists
        ? draft.modifierGroupIds.filter((g) => g !== id)
        : [...draft.modifierGroupIds, id],
    })
  }

  const addVariant = () => {
    setDraft({
      ...draft,
      variants: [
        ...draft.variants,
        {
          id: generateId('var'),
          name: '',
          price: draft.basePrice || 0,
          sortOrder: draft.variants.length,
        },
      ],
    })
  }

  const updateVariant = (id: string, patch: Partial<VariantDraft>) => {
    setDraft({
      ...draft,
      variants: draft.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    })
  }

  const removeVariant = (id: string) => {
    setDraft({
      ...draft,
      variants: draft.variants.filter((v) => v.id !== id),
    })
  }

  const moveVariant = (id: string, dir: -1 | 1) => {
    const idx = draft.variants.findIndex((v) => v.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= draft.variants.length) return
    const copy = [...draft.variants]
    const [row] = copy.splice(idx, 1)
    copy.splice(next, 0, row)
    setDraft({ ...draft, variants: copy.map((v, i) => ({ ...v, sortOrder: i })) })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="card my-8 w-full max-w-2xl p-6">
        <h3 className="text-lg font-semibold">{draft.id ? 'Edit Item' : 'New Item'}</h3>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Image</label>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
                {draft.imageFile ? (
                  <img src={URL.createObjectURL(draft.imageFile)} alt="" className="h-full w-full object-cover" />
                ) : draft.imageUrl ? (
                  <CachedImage
                    src={draft.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[10px] text-slate-400">Image</span>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="text-sm"
                onChange={(e) =>
                  setDraft({ ...draft, imageFile: e.target.files?.[0] || null })
                }
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Name *</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Category *</label>
            <select
              className="input"
              value={draft.categoryId}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              {hasVariants ? 'Display price (from lowest variant)' : 'Base Price *'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={
                hasVariants
                  ? Math.min(...draft.variants.map((v) => Number(v.price) || 0))
                  : draft.basePrice
              }
              disabled={hasVariants}
              onChange={(e) =>
                setDraft({ ...draft, basePrice: Number(e.target.value) || 0 })
              }
            />
            {hasVariants && (
              <p className="mt-1 text-xs text-slate-400">
                Saved automatically from the cheapest variant.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Sort order</label>
            <input
              type="number"
              className="input"
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.available}
                onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
              />
              Available
            </label>
          </div>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <label className="label mb-0">Variants (size / price)</label>
                <p className="text-xs text-slate-500">
                  Absolute prices per size (e.g. Small, Medium, Large). Required at POS when set.
                </p>
              </div>
              <button type="button" onClick={addVariant} className="btn-secondary text-xs">
                + Add variant
              </button>
            </div>
            {draft.variants.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                No variants — item uses a single base price.
              </p>
            ) : (
              <div className="space-y-2">
                {draft.variants.map((v, idx) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2"
                  >
                    <input
                      className="input min-w-[8rem] flex-1"
                      placeholder="Name (e.g. Medium)"
                      value={v.name}
                      onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input w-28"
                      placeholder="Price"
                      value={v.price}
                      onChange={(e) =>
                        updateVariant(v.id, { price: Number(e.target.value) || 0 })
                      }
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs"
                        disabled={idx === 0}
                        onClick={() => moveVariant(v.id, -1)}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs"
                        disabled={idx === draft.variants.length - 1}
                        onClick={() => moveVariant(v.id, 1)}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-2 text-xs"
                        onClick={() => removeVariant(v.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="label">Add-ons (shared modifier groups)</label>
            {modifierGroups.length === 0 ? (
              <p className="text-xs text-slate-500">
                No add-on groups defined. Create some in the Modifiers section.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {modifierGroups.map((g) => {
                  const active = draft.modifierGroupIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      className={
                        active
                          ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                          : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
                      }
                    >
                      {g.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={onSave} className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ItemsPage
