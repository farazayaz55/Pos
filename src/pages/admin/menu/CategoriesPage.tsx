import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import type { BranchWriteScope } from '@/types'
import BranchWriteScopeToggle from '@/components/common/BranchWriteScopeToggle'
import {
  createCategory,
  deleteCategory,
  updateCategory,
  uploadMenuImage,
} from '@/services/menu'
import type { Category } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import CachedImage from '@/components/common/CachedImage'
import { ensureImageCached } from '@/localdb/imageCache'

interface CategoryDraft {
  id?: string
  name: string
  imageUrl?: string
  imageFile?: File | null
  sortOrder: number
  active: boolean
}

const emptyDraft = (sortOrder: number): CategoryDraft => ({
  name: '',
  sortOrder,
  active: true,
})

const CategoriesPage = () => {
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const branchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const { categories, loading } = useCompanyMenu(companyId, branchId || undefined)
  const [writeScope, setWriteScope] = useState<BranchWriteScope>('this')
  const [editing, setEditing] = useState<CategoryDraft | null>(null)
  const [toDelete, setToDelete] = useState<Category | null>(null)
  const [saving, setSaving] = useState(false)
  const showScopeToggle = user?.role === 'admin' || user?.role === 'super_admin'

  const startCreate = () =>
    setEditing(emptyDraft(categories.length ? Math.max(...categories.map((c) => c.sortOrder)) + 1 : 0))

  const startEdit = (c: Category) =>
    setEditing({
      id: c.id,
      name: c.name,
      imageUrl: c.imageUrl,
      sortOrder: c.sortOrder,
      active: c.active,
    })

  const onSave = async () => {
    if (!editing || !companyId || !branchId) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      let imageUrl = editing.imageUrl
      if (editing.imageFile) {
        imageUrl = await uploadMenuImage(companyId, editing.imageFile, 'categories')
        if (imageUrl) void ensureImageCached(imageUrl, companyId, { force: true })
      }
      if (editing.id) {
        await updateCategory(
          companyId,
          branchId,
          editing.id,
          {
            name: editing.name.trim(),
            sortOrder: editing.sortOrder,
            active: editing.active,
            ...(imageUrl ? { imageUrl } : {}),
          },
          writeScope,
        )
        toast.success('Category updated')
      } else {
        await createCategory(
          companyId,
          branchId,
          {
            name: editing.name.trim(),
            sortOrder: editing.sortOrder,
            active: editing.active,
            imageUrl,
          },
          writeScope,
        )
        toast.success('Category created')
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
      await deleteCategory(companyId, branchId, toDelete.id, writeScope)
      toast.success('Category deleted')
      setToDelete(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading categories..." />

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Categories</h1>
          <p className="text-sm text-slate-500">Group items into menu categories.</p>
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
            + New Category
          </button>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">No categories yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <div key={c.id} className="card overflow-hidden">
              <div className="flex h-28 items-center justify-center bg-slate-50">
                {c.imageUrl ? (
                  <CachedImage
                    src={c.imageUrl}
                    companyId={companyId}
                    alt={c.name}
                    className="h-full w-full object-cover"
                    fallback={
                      <span className="text-2xl font-bold text-slate-300">
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                    }
                  />
                ) : (
                  <span className="text-2xl font-bold text-slate-300">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">Sort: {c.sortOrder}</p>
                  </div>
                  <span className={c.active ? 'badge-success' : 'badge-muted'}>
                    {c.active ? 'Active' : 'Hidden'}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => startEdit(c)} className="btn-secondary flex-1 text-xs">
                    Edit
                  </button>
                  <button onClick={() => setToDelete(c)} className="btn-danger flex-1 text-xs">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CategoryDrawer
          draft={editing}
          setDraft={setEditing}
          onClose={() => !saving && setEditing(null)}
          onSave={onSave}
          saving={saving}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete category?"
        message={
          toDelete && (
            <span>
              Delete <b>{toDelete.name}</b>? Items in this category will keep their data but
              may become orphaned.
            </span>
          )
        }
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
  draft: CategoryDraft
  setDraft: (d: CategoryDraft) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}

const CategoryDrawer = ({ draft, setDraft, onClose, onSave, saving }: DrawerProps) => {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-lg font-semibold">
          {draft.id ? 'Edit Category' : 'New Category'}
        </h3>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Image (optional)</label>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
                {draft.imageFile ? (
                  <img
                    src={URL.createObjectURL(draft.imageFile)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
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
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Active
              </label>
            </div>
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

export default CategoriesPage
