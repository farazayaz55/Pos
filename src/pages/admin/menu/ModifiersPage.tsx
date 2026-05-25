import { useState } from 'react'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import {
  createModifierGroup,
  deleteModifierGroup,
  deleteModifierOption,
  updateModifierGroup,
  upsertModifierOption,
} from '@/services/menu'
import type { ModifierGroup, ModifierOption } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { generateId } from '@/utils/idGen'
import { formatMoney } from '@/utils/currency'

interface GroupDraft {
  id?: string
  name: string
  required: boolean
  min: number
  max: number
}

const ModifiersPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { modifierGroups, loading } = useCompanyMenu(companyId)
  const [editing, setEditing] = useState<GroupDraft | null>(null)
  const [optionFor, setOptionFor] = useState<{ groupId: string; option: ModifierOption } | null>(
    null,
  )
  const [toDelete, setToDelete] = useState<ModifierGroup | null>(null)
  const [saving, setSaving] = useState(false)

  const startCreateGroup = () =>
    setEditing({ name: '', required: false, min: 0, max: 1 })

  const startEditGroup = (g: ModifierGroup) =>
    setEditing({ id: g.id, name: g.name, required: g.required, min: g.min, max: g.max })

  const onSaveGroup = async () => {
    if (!editing) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      if (editing.id) {
        await updateModifierGroup(companyId, editing.id, {
          name: editing.name.trim(),
          required: editing.required,
          min: editing.min,
          max: editing.max,
        })
        toast.success('Group updated')
      } else {
        await createModifierGroup(companyId, {
          name: editing.name.trim(),
          required: editing.required,
          min: editing.min,
          max: editing.max,
          options: {},
        })
        toast.success('Group created')
      }
      setEditing(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteGroup = async () => {
    if (!toDelete) return
    setSaving(true)
    try {
      await deleteModifierGroup(companyId, toDelete.id)
      toast.success('Group deleted')
      setToDelete(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const startNewOption = (groupId: string) => {
    setOptionFor({
      groupId,
      option: { id: generateId('opt'), name: '', priceAdjustment: 0 },
    })
  }
  const startEditOption = (groupId: string, opt: ModifierOption) => {
    setOptionFor({ groupId, option: { ...opt } })
  }

  const onSaveOption = async () => {
    if (!optionFor) return
    if (!optionFor.option.name.trim()) {
      toast.error('Option name required')
      return
    }
    setSaving(true)
    try {
      await upsertModifierOption(companyId, optionFor.groupId, {
        ...optionFor.option,
        name: optionFor.option.name.trim(),
      })
      toast.success('Option saved')
      setOptionFor(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteOption = async (groupId: string, optionId: string) => {
    try {
      await deleteModifierOption(companyId, groupId, optionId)
      toast.success('Option removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (loading) return <LoadingScreen label="Loading modifiers..." />

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Modifiers</h1>
          <p className="text-sm text-slate-500">
            Define modifier groups (e.g. Size, Add-ons) and their options.
          </p>
        </div>
        <button onClick={startCreateGroup} className="btn-primary">
          + New Group
        </button>
      </div>

      {modifierGroups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">No modifier groups yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {modifierGroups.map((g) => {
            const options = g.options ? Object.values(g.options) : []
            return (
              <div key={g.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{g.name}</h3>
                      <span className={g.required ? 'badge-warn' : 'badge-muted'}>
                        {g.required ? 'Required' : 'Optional'}
                      </span>
                      <span className="badge-muted">
                        Min {g.min} / Max {g.max}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEditGroup(g)} className="btn-secondary text-xs">
                      Edit
                    </button>
                    <button onClick={() => setToDelete(g)} className="btn-danger text-xs">
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">Options</p>
                    <button onClick={() => startNewOption(g.id)} className="btn-ghost text-xs">
                      + Add option
                    </button>
                  </div>
                  {options.length === 0 ? (
                    <p className="text-xs text-slate-500">No options yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {options.map((opt) => (
                        <div
                          key={opt.id}
                          className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
                        >
                          <span>{opt.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-500">
                              {opt.priceAdjustment >= 0 ? '+' : ''}
                              {formatMoney(opt.priceAdjustment)}
                            </span>
                            <button
                              onClick={() => startEditOption(g.id, opt)}
                              className="text-xs text-slate-600 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => onDeleteOption(g.id, opt.id)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">
              {editing.id ? 'Edit Group' : 'New Group'}
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="label">Name *</label>
                <input
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Min selections</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={editing.min}
                    onChange={(e) =>
                      setEditing({ ...editing, min: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <label className="label">Max selections</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={editing.max}
                    onChange={(e) =>
                      setEditing({ ...editing, max: Number(e.target.value) || 1 })
                    }
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={editing.required}
                  onChange={(e) => setEditing({ ...editing, required: e.target.checked })}
                />
                Required (customer must pick)
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => !saving && setEditing(null)}
                className="btn-secondary"
                disabled={saving}
              >
                Cancel
              </button>
              <button onClick={onSaveGroup} className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {optionFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">Option</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="label">Name *</label>
                <input
                  className="input"
                  value={optionFor.option.name}
                  onChange={(e) =>
                    setOptionFor({
                      ...optionFor,
                      option: { ...optionFor.option, name: e.target.value },
                    })
                  }
                />
              </div>
              <div>
                <label className="label">Price adjustment</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={optionFor.option.priceAdjustment}
                  onChange={(e) =>
                    setOptionFor({
                      ...optionFor,
                      option: {
                        ...optionFor.option,
                        priceAdjustment: Number(e.target.value) || 0,
                      },
                    })
                  }
                />
                <p className="mt-1 text-xs text-slate-400">
                  Use negative numbers for discounts.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => !saving && setOptionFor(null)}
                className="btn-secondary"
                disabled={saving}
              >
                Cancel
              </button>
              <button onClick={onSaveOption} className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete modifier group?"
        message={toDelete && <span>Delete <b>{toDelete.name}</b>?</span>}
        destructive
        confirmLabel="Delete"
        busy={saving}
        onConfirm={onDeleteGroup}
        onCancel={() => !saving && setToDelete(null)}
      />
    </div>
  )
}

export default ModifiersPage
