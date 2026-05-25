import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

export interface CreateCompanyAdminInput {
  companyName: string
  location: string
  phone?: string
  logoUrl?: string
  adminName: string
  adminEmail: string
  password: string
}

export interface CreateCompanyAdminResult {
  companyId: string
  adminUid: string
}

export const createCompanyAdmin = httpsCallable<
  CreateCompanyAdminInput,
  CreateCompanyAdminResult
>(functions, 'createCompanyAdmin')

export interface DeleteCompanyInput {
  companyId: string
}

export const deleteCompanyCallable = httpsCallable<DeleteCompanyInput, { ok: true }>(
  functions,
  'deleteCompany',
)

export const setSuperAdminClaim = httpsCallable<Record<string, never>, { ok: true }>(
  functions,
  'setSuperAdminClaim',
)

export interface UpdateCompanyAdminInput {
  companyId: string
  adminName?: string
  password?: string
}

export const updateCompanyAdmin = httpsCallable<
  UpdateCompanyAdminInput,
  { ok: true }
>(functions, 'updateCompanyAdmin')
