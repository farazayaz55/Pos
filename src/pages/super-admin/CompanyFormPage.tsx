import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { createCompanyAdmin, updateCompanyAdmin } from '@/services/functionsApi'
import { getCompany, updateCompany } from '@/services/companies'
import { uploadCompanyLogo } from '@/services/menu'

interface Props {
  mode: 'create' | 'edit'
}

const baseSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  location: z.string().min(2, 'Location is required'),
  phone: z.string().optional().or(z.literal('')),
  adminName: z.string().min(2, 'Admin name is required'),
  adminEmail: z.string().email('Valid email required'),
  password: z.string().optional().or(z.literal('')),
  confirmPassword: z.string().optional().or(z.literal('')),
  active: z.boolean(),
})

type FormValues = z.infer<typeof baseSchema>

const buildSchema = (mode: 'create' | 'edit') =>
  baseSchema
    .superRefine((v, ctx) => {
      const needPassword = mode === 'create' || !!v.password
      if (needPassword) {
        if (!v.password || v.password.length < 6) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['password'],
            message: 'Min 6 characters',
          })
        }
        if (v.password !== v.confirmPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['confirmPassword'],
            message: 'Passwords do not match',
          })
        }
      }
    })

const CompanyFormPage = ({ mode }: Props) => {
  const { companyId } = useParams()
  const navigate = useNavigate()
  const isCreate = mode === 'create'

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [existingLogo, setExistingLogo] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(!isCreate)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: {
      companyName: '',
      location: '',
      phone: '',
      adminName: '',
      adminEmail: '',
      password: '',
      confirmPassword: '',
      active: true,
    },
  })

  useEffect(() => {
    if (isCreate || !companyId) return
    void (async () => {
      const c = await getCompany(companyId)
      if (!c) {
        toast.error('Company not found')
        navigate('/super-admin/companies')
        return
      }
      reset({
        companyName: c.name,
        location: c.location,
        phone: c.phone || '',
        adminName: c.adminName,
        adminEmail: c.adminEmail,
        password: '',
        confirmPassword: '',
        active: c.active,
      })
      setExistingLogo(c.logoUrl)
      setLoading(false)
    })()
  }, [isCreate, companyId, reset, navigate])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null)
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true)
    try {
      if (isCreate) {
        const result = await createCompanyAdmin({
          companyName: values.companyName,
          location: values.location,
          phone: values.phone || undefined,
          adminName: values.adminName,
          adminEmail: values.adminEmail,
          password: values.password as string,
        })
        const newCompanyId = result.data.companyId
        if (logoFile) {
          try {
            const logoUrl = await uploadCompanyLogo(newCompanyId, logoFile)
            await updateCompany(newCompanyId, { logoUrl })
          } catch (err) {
            console.warn('Logo upload failed; company created without logo.', err)
            toast('Company created, but logo upload failed.')
          }
        }
        toast.success('Company created')
        navigate('/super-admin/companies')
      } else {
        if (!companyId) return
        let logoUrl = existingLogo
        if (logoFile) {
          logoUrl = await uploadCompanyLogo(companyId, logoFile)
        }
        await updateCompany(companyId, {
          name: values.companyName,
          location: values.location,
          phone: values.phone || undefined,
          adminName: values.adminName,
          active: values.active,
          ...(logoUrl ? { logoUrl } : {}),
        })
        if (values.adminName || values.password) {
          await updateCompanyAdmin({
            companyId,
            adminName: values.adminName,
            password: values.password || undefined,
          })
        }
        toast.success('Company updated')
        navigate('/super-admin/companies')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link to="/super-admin/companies" className="text-sm text-slate-500 hover:text-slate-900">
          &larr; Back to companies
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {isCreate ? 'New Company' : 'Edit Company'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5 p-6" noValidate>
        <div>
          <label className="label">Company Logo</label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
              {logoPreview || existingLogo ? (
                <img
                  src={logoPreview || existingLogo}
                  alt="logo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-slate-400">Logo</span>
              )}
            </div>
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="block text-sm"
              />
              <p className="mt-1 text-xs text-slate-400">PNG/JPG/SVG up to 5MB.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Company Name *</label>
            <input className="input" {...register('companyName')} />
            {errors.companyName && (
              <p className="mt-1 text-xs text-red-600">{errors.companyName.message}</p>
            )}
          </div>
          <div>
            <label className="label">Location *</label>
            <input className="input" {...register('location')} />
            {errors.location && (
              <p className="mt-1 text-xs text-red-600">{errors.location.message}</p>
            )}
          </div>
          <div>
            <label className="label">Phone (optional)</label>
            <input className="input" {...register('phone')} />
          </div>
          {!isCreate && (
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('active')} className="h-4 w-4" />
                Active
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Admin Account</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Admin Name *</label>
              <input className="input" {...register('adminName')} />
              {errors.adminName && (
                <p className="mt-1 text-xs text-red-600">{errors.adminName.message}</p>
              )}
            </div>
            <div>
              <label className="label">
                Admin Email {isCreate ? '*' : '(read-only)'}
              </label>
              <input
                type="email"
                className="input"
                disabled={!isCreate}
                {...register('adminEmail')}
              />
              {errors.adminEmail && (
                <p className="mt-1 text-xs text-red-600">{errors.adminEmail.message}</p>
              )}
            </div>
            <div>
              <label className="label">
                Password {isCreate ? '*' : '(leave blank to keep)'}
              </label>
              <input type="password" className="input" {...register('password')} />
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>
            <div>
              <label className="label">
                Confirm Password {isCreate ? '*' : ''}
              </label>
              <input type="password" className="input" {...register('confirmPassword')} />
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link to="/super-admin/companies" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving...' : isCreate ? 'Create Company' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default CompanyFormPage
