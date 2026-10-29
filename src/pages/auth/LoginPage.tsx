import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { defaultAdminPath } from '@/utils/permissions'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Minimum 6 characters'),
})

type FormValues = z.infer<typeof schema>

const LoginPage = () => {
  const { user, signIn, loading, error } = useAuthStore()
  const setActiveCompany = useCompanyContextStore((s) => s.setActiveCompany)
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (user) {
      if ((user.role === 'admin' || user.role === 'staff') && user.companyId) {
        setActiveCompany(
          user.companyId,
          false,
          user.role === 'staff' ? (user.branchId ?? null) : undefined,
        )
      }
    }
  }, [user, setActiveCompany])

  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    const target =
      from && from !== '/login'
        ? from
        : defaultAdminPath(user)
    return <Navigate to={target} replace />
  }

  const onSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true)
      await signIn(values.email, values.password)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Login failed'
      toast.error(msg.replace('Firebase: ', ''))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen px-4 py-10 bg-gradient-to-br from-brand-50 via-white to-slate-100">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="flex items-center justify-center w-12 h-12 text-white rounded-xl bg-brand-600 shadow-card">
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
              <path d="M4 6h16v3H4zM4 11h16v3H4zM4 16h11v3H4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">POS Console</h1>
        </div>

        <div className="p-6 card">
          <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
          <p className="mb-6 text-sm text-slate-500">
            please sign in to continue 
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                placeholder="you@restaurant.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>

            {error && !submitting && (
              <div className="px-3 py-2 text-xs text-red-700 border border-red-200 rounded-md bg-red-50">
                {error.replace('Firebase: ', '')}
              </div>
            )}

            <button
              type="submit"
              className="w-full btn-primary"
              disabled={submitting || loading}
            >
              {submitting || loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-xs text-center text-slate-400">
          Need access? Contact your Super Admin.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
