import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { subscribeCompanies } from '@/services/companies'
import { deleteCompanyCallable } from '@/services/functionsApi'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import type { Company } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import ConfirmDialog from '@/components/common/ConfirmDialog'

const CompaniesPage = () => {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<Company | null>(null)
  const [deleting, setDeleting] = useState(false)
  const setActiveCompany = useCompanyContextStore((s) => s.setActiveCompany)
  const navigate = useNavigate()

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const filtered = companies.filter(
    (c) =>
      !query ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.location.toLowerCase().includes(query.toLowerCase()) ||
      c.adminEmail.toLowerCase().includes(query.toLowerCase()),
  )

  const onView = (c: Company) => {
    setActiveCompany(c.id, true, null)
    navigate('/admin/pos')
  }

  const onDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteCompanyCallable({ companyId: toDelete.id })
      toast.success(`Deleted ${toDelete.name}`)
      setToDelete(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete company'
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading companies..." />

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
          <p className="text-sm text-slate-500">
            Manage restaurant companies on the platform.
          </p>
        </div>
        <Link to="/super-admin/companies/new" className="btn-primary">
          + New Company
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by name, location, or admin email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">
            {query ? 'No companies match your search.' : 'No companies yet. Create your first one.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="card overflow-hidden">
              <div className="flex h-32 items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100">
                {c.logoUrl ? (
                  <img src={c.logoUrl} alt={c.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-brand-600">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{c.name}</h3>
                    <p className="text-xs text-slate-500">{c.location}</p>
                  </div>
                  <span className={c.active ? 'badge-success' : 'badge-muted'}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="mt-3 space-y-0.5 text-xs text-slate-600">
                  <p>
                    <span className="text-slate-400">Admin:</span> {c.adminName}
                  </p>
                  <p>
                    <span className="text-slate-400">Email:</span> {c.adminEmail}
                  </p>
                  {c.phone && (
                    <p>
                      <span className="text-slate-400">Phone:</span> {c.phone}
                    </p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => onView(c)} className="btn-primary flex-1 text-xs">
                    View
                  </button>
                  <Link
                    to={`/super-admin/companies/${c.id}/edit`}
                    className="btn-secondary flex-1 text-xs"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => setToDelete(c)}
                    className="btn-danger flex-1 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this company?"
        message={
          toDelete && (
            <span>
              This permanently removes <b>{toDelete.name}</b>, its menu, orders, and admin
              account. This cannot be undone.
            </span>
          )
        }
        destructive
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={onDelete}
        onCancel={() => !deleting && setToDelete(null)}
      />
    </div>
  )
}

export default CompaniesPage
