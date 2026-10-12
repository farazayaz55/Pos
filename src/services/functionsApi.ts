import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import type { StaffPermissions } from '@/types'

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

export interface RefundOrderInput {
  companyId: string
  orderId: string
}

export interface RefundOrderResult {
  ok: true
  alreadyRefunded: boolean
  stripeRefundId?: string
}

export const refundOrder = httpsCallable<RefundOrderInput, RefundOrderResult>(
  functions,
  'refundOrder',
)

export interface CreateTeamMemberInput {
  companyId: string
  name: string
  email: string
  password: string
  permissions: StaffPermissions
}

export interface CreateTeamMemberResult {
  uid: string
}

export const createTeamMember = httpsCallable<
  CreateTeamMemberInput,
  CreateTeamMemberResult
>(functions, 'createTeamMember')

export interface UpdateTeamMemberInput {
  companyId: string
  uid: string
  name?: string
  password?: string
  permissions?: StaffPermissions
  active?: boolean
}

export const updateTeamMember = httpsCallable<UpdateTeamMemberInput, { ok: true }>(
  functions,
  'updateTeamMember',
)

export interface DeleteTeamMemberInput {
  companyId: string
  uid: string
}

export const deleteTeamMember = httpsCallable<DeleteTeamMemberInput, { ok: true }>(
  functions,
  'deleteTeamMember',
)
