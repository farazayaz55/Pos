import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useBranches } from '@/hooks/useBranches'
import { updateBranch } from '@/services/branches'
import { createBranch, deleteBranchCallable } from '@/services/functionsApi'
import type { Branch } from '@/types'
import { defaultAdminPath } from '@/utils/permissions'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { cn } from '@/utils/cn'

interface BranchDraft {
  id?: string
  name: string
  location: string
  phone: string
  active: boolean
  sourceBranchId?: string
}

const emptyCreateDraft = (sourceBranchId: string): BranchDraft => ({
  name: '',
  location: '',
  phone: '',
  active: true,
  sourceBranchId,
})

const callableErrorMessage = (e: unknown, fallback: string) => {
  const err = e as { code?: string; message?: string }
  const code = err?.code || ''
  const msg = err?.message || (e instanceof Error ? e.message : '')
  if (
    code === 'functions/not-found' ||
    /not-found|CORS|Failed to fetch|ERR_FAILED/i.test(msg)
  ) {
    return 'Branch functions are not deployed yet. Run: npm run deploy:functions'
  }
  return msg || fallback
}

const BranchesPage = () => {
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { branches, loading } = useBranches(companyId || undefined)
  const [editing, setEditing] = useState<BranchDraft | null>(null)
  const [toDelete, setToDelete] = useState<Branch | null>(null)
  const [saving, setSaving] = useState(false)

  const activeBranches = useMemo(
    () => branches.filter((b) => b.active !== false),
    [branches],
  )

  if (user?.role === 'staff') {
    return <Navigate to={defaultAdminPath(user)} replace />
  }

  const startCreate = () => {
    const source = activeBranches[0]?.id || branches[0]?.id || ''
    if (!source) {
      toast.error('No branch available to copy menu from')
      return
    }
    setEditing(emptyCreateDraft(source))
  }

  const startEdit = (b: Branch) =>
    setEditing({
      id: b.id,
      name: b.name,
      location: b.location,
      phone: b.phone || '',
      active: b.active !== false,
    })

  const onSave = async () => {
    if (!editing || !companyId) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      if (editing.id) {
        await updateBranch(companyId, editing.id, {
          name: editing.name.trim(),
          location: editing.location.trim(),
          phone: editing.phone.trim() || undefined,
          active: editing.active,
        })
        toast.success('Branch updated')
      } else {
        if (!editing.sourceBranchId) {
          toast.error('Select a source branch')
          return
        }
        await createBranch({
          companyId,
          sourceBranchId: editing.sourceBranchId,
          name: editing.name.trim(),
          location: editing.location.trim(),
          phone: editing.phone.trim() || undefined,
        })
        toast.success('Branch created')
      }
      setEditing(null)
    } catch (e) {
      toast.error(callableErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!toDelete || !companyId) return
    if (branches.length <= 1) {
      toast.error('Cannot delete the only branch')
      return
    }
    setSaving(true)
    try {
      await deleteBranchCallable({ companyId, branchId: toDelete.id })
      toast.success('Branch deleted')
      setToDelete(null)
    } catch (e) {
      toast.error(callableErrorMessage(e, 'Delete failed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading branches..." />

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Branches</h1>
          <p className="text-sm text-slate-500">
            Locations for menu, orders, tax, and receipts.
          </p>
        </div>
        <button type="button" onClick={startCreate} className="btn-primary">
          + New branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">No branches yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Location</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">{b.name}</td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                    {b.location || '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">
                    {b.phone || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                        b.active !== false
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {b.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => startEdit(b)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs text-red-600"
                        disabled={branches.length <= 1}
                        onClick={() => setToDelete(b)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {editing.id ? 'Edit branch' : 'New branch'}
            </h2>
            <div className="mt-4 space-y-3">
              {!editing.id && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Copy menu from
                  </span>
                  <select
                    className="input w-full"
                    value={editing.sourceBranchId || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, sourceBranchId: e.target.value })
                    }
                    disabled={saving}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Name *</span>
                <input
                  className="input w-full"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Location</span>
                <input
                  className="input w-full"
                  value={editing.location}
                  onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Phone</span>
                <input
                  className="input w-full"
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  disabled={saving}
                />
              </label>
              {editing.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={editing.active}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    disabled={saving}
                  />
                  Active
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void onSave()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete branch?"
        message={
          toDelete && (
            <span>
              Delete <b>{toDelete.name}</b>? This cannot be undone if the branch has data.
            </span>
          )
        }
        destructive
        confirmLabel="Delete"
        busy={saving}
        onConfirm={() => void onDelete()}
        onCancel={() => !saving && setToDelete(null)}
      />
    </div>
  )
}

export default BranchesPage
