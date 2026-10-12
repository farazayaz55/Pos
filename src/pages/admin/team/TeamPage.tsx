import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompany } from '@/hooks/useCompany'
import { subscribeCompanyTeam } from '@/services/team'
import {
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from '@/services/functionsApi'
import type { StaffPermissions, TeamMember } from '@/types'
import {
  PERMISSION_LABELS,
  STAFF_PERMISSIONS,
  defaultStaffPermissions,
} from '@/utils/permissions'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { cn } from '@/utils/cn'

interface MemberDraft {
  uid?: string
  name: string
  email: string
  password: string
  permissions: StaffPermissions
  active: boolean
}

const emptyDraft = (): MemberDraft => ({
  name: '',
  email: '',
  password: '',
  permissions: defaultStaffPermissions(),
  active: true,
})

const permissionSummary = (m: TeamMember) => {
  if (m.role === 'admin') return 'Full access'
  const keys = STAFF_PERMISSIONS.filter((k) => m.permissions?.[k])
  if (!keys.length) return 'No permissions'
  return keys.map((k) => PERMISSION_LABELS[k]).join(', ')
}

const TeamPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { company } = useCompany(companyId || undefined)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<MemberDraft | null>(null)
  const [toDelete, setToDelete] = useState<TeamMember | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!companyId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeCompanyTeam(companyId, (list) => {
      setMembers(list)
      setLoading(false)
    })
    return () => unsub()
  }, [companyId])

  const displayMembers: TeamMember[] = (() => {
    if (!company?.adminUid) return members
    if (members.some((m) => m.uid === company.adminUid)) return members
    const owner: TeamMember = {
      uid: company.adminUid,
      name: company.adminName,
      email: company.adminEmail,
      role: 'admin',
      createdAt: company.createdAt,
      active: true,
    }
    return [owner, ...members]
  })()

  const startCreate = () => setEditing(emptyDraft())

  const startEdit = (m: TeamMember) => {
    if (m.role === 'admin') return
    setEditing({
      uid: m.uid,
      name: m.name,
      email: m.email,
      password: '',
      permissions: {
        pos: !!m.permissions?.pos,
        menu: !!m.permissions?.menu,
        orders: !!m.permissions?.orders,
        settings: !!m.permissions?.settings,
        team: !!m.permissions?.team,
      },
      active: m.active !== false,
    })
  }

  const togglePerm = (key: keyof StaffPermissions) => {
    if (!editing) return
    setEditing({
      ...editing,
      permissions: {
        ...editing.permissions,
        [key]: !editing.permissions[key],
      },
    })
  }

  const onSave = async () => {
    if (!editing || !companyId) return
    if (!editing.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!editing.uid && !editing.email.trim()) {
      toast.error('Email is required')
      return
    }
    if (!editing.uid && editing.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (editing.uid && editing.password && editing.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (!STAFF_PERMISSIONS.some((k) => editing.permissions[k])) {
      toast.error('Select at least one permission')
      return
    }

    setSaving(true)
    try {
      if (editing.uid) {
        await updateTeamMember({
          companyId,
          uid: editing.uid,
          name: editing.name.trim(),
          permissions: editing.permissions,
          active: editing.active,
          ...(editing.password ? { password: editing.password } : {}),
        })
        toast.success('Team member updated')
      } else {
        await createTeamMember({
          companyId,
          name: editing.name.trim(),
          email: editing.email.trim(),
          password: editing.password,
          permissions: editing.permissions,
        })
        toast.success('Team member created')
      }
      setEditing(null)
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : 'Save failed'
      toast.error(msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, ''))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!toDelete || !companyId) return
    setSaving(true)
    try {
      await deleteTeamMember({ companyId, uid: toDelete.uid })
      toast.success('Team member removed')
      setToDelete(null)
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : 'Delete failed'
      toast.error(msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, ''))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading team..." />

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Team</h1>
          <p className="mt-1 text-sm text-slate-500">
            Invite staff and choose what each person can access.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={startCreate}>
          Add member
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Access</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayMembers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No team members yet.
                </td>
              </tr>
            )}
            {displayMembers.map((m) => {
              const isOwner = m.role === 'admin'
              return (
                <tr key={m.uid} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{m.name}</div>
                    {isOwner && (
                      <span className="mt-0.5 inline-block text-[11px] font-medium text-brand-700">
                        Owner
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.email}</td>
                  <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">
                    {permissionSummary(m)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                        m.active !== false
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {m.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isOwner ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => startEdit(m)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs text-red-600"
                          onClick={() => setToDelete(m)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {editing.uid ? 'Edit team member' : 'Add team member'}
            </h2>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Name</span>
                <input
                  className="input w-full"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  disabled={saving}
                />
              </label>
              {!editing.uid && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
                  <input
                    type="email"
                    className="input w-full"
                    value={editing.email}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                    disabled={saving}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {editing.uid ? 'New password (optional)' : 'Password'}
                </span>
                <input
                  type="password"
                  className="input w-full"
                  value={editing.password}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  disabled={saving}
                  autoComplete="new-password"
                />
              </label>

              <fieldset>
                <legend className="mb-2 text-xs font-medium text-slate-600">Permissions</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {STAFF_PERMISSIONS.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={editing.permissions[key]}
                        onChange={() => togglePerm(key)}
                        disabled={saving}
                      />
                      {PERMISSION_LABELS[key]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {editing.uid && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
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
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Remove team member?"
        message={
          toDelete
            ? `Remove ${toDelete.name} (${toDelete.email})? They will no longer be able to sign in.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        busy={saving}
        onConfirm={() => void onDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

export default TeamPage
