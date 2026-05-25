import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import {
  createItem,
  deleteItem,
  toggleItemAvailability,
  updateItem,
  uploadMenuImage,
} from '@/services/menu'
import type { MenuItem } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { formatMoney } from '@/utils/currency'

interface ItemDraft {
  id?: string
  categoryId: string
  name: string
  description: string
  basePrice: number
  imageUrl?: string
  imageFile?: File | null
  available: boolean
  modifierGroupIds: string[]
  sortOrder: number
}

const newDraft = (categoryId: string, sortOrder: number): ItemDraft => ({
  categoryId,
  name: '',
  description: '',
  basePrice: 0,
  available: true,
  modifierGroupIds: [],
  sortOrder,
})

const ItemsPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { categories, items, modifierGroups, loading } = useCompanyMenu(companyId)
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
      modifierGroupIds: i.modifierGroupIds || [],
      sortOrder: i.sortOrder,
    })

  const onSave = async () => {
    if (!editing || !companyId) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (editing.basePrice < 0 || Number.isNaN(editing.basePrice)) {
      toast.error('Price must be a positive number')
      return
    }
    setSaving(true)
    try {
      let imageUrl = editing.imageUrl
      if (editing.imageFile) {
        imageUrl = await uploadMenuImage(companyId, editing.imageFile, 'items')
      }
      if (editing.id) {
        await updateItem(companyId, editing.id, {
          categoryId: editing.categoryId,
          name: editing.name.trim(),
          description: editing.description.trim() || undefined,
          basePrice: editing.basePrice,
          available: editing.available,
          modifierGroupIds: editing.modifierGroupIds,
          sortOrder: editing.sortOrder,
          ...(imageUrl ? { imageUrl } : {}),
        })
        toast.success('Item updated')
      } else {
        await createItem(companyId, {
          categoryId: editing.categoryId,
          name: editing.name.trim(),
          description: editing.description.trim() || undefined,
          basePrice: editing.basePrice,
          available: editing.available,
          modifierGroupIds: editing.modifierGroupIds,
          sortOrder: editing.sortOrder,
          imageUrl,
        })
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
    if (!toDelete || !companyId) return
    setSaving(true)
    try {
      await deleteItem(companyId, toDelete.id)
      toast.success('Item deleted')
      setToDelete(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const onToggle = async (item: MenuItem) => {
    try {
      await toggleItemAvailability(companyId, item.id, !item.available)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toggle failed')
    }
  }

  if (loading) return <LoadingScreen label="Loading items..." />

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Items</h1>
          <p className="text-sm text-slate-500">
            Manage menu items, pricing, modifiers, and availability.
          </p>
        </div>
        <button onClick={startCreate} className="btn-primary">
          + New Item
        </button>
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
            return (
              <div key={item.id} className="card overflow-hidden">
                <div className="relative flex h-32 items-center justify-center bg-slate-50">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
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
                      {formatMoney(item.basePrice)}
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
  const toggleGroup = (id: string) => {
    const exists = draft.modifierGroupIds.includes(id)
    setDraft({
      ...draft,
      modifierGroupIds: exists
        ? draft.modifierGroupIds.filter((g) => g !== id)
        : [...draft.modifierGroupIds, id],
    })
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
                  <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
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
            <label className="label">Base Price *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={draft.basePrice}
              onChange={(e) =>
                setDraft({ ...draft, basePrice: Number(e.target.value) || 0 })
              }
            />
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
            <label className="label">Modifier Groups</label>
            {modifierGroups.length === 0 ? (
              <p className="text-xs text-slate-500">
                No modifier groups defined. Create some in the Modifiers section.
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
