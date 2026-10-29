import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CompanyContextState {
  /** The companyId currently being managed in the admin area. */
  activeCompanyId: string | null
  /** Active branch within the company (required for POS/menu/orders). */
  activeBranchId: string | null
  /** True when a super admin is viewing another company. */
  isImpersonating: boolean
  setActiveCompany: (
    companyId: string | null,
    isImpersonating?: boolean,
    branchId?: string | null,
  ) => void
  setActiveBranch: (branchId: string | null) => void
  clear: () => void
}

export const useCompanyContextStore = create<CompanyContextState>()(
  persist(
    (set) => ({
      activeCompanyId: null,
      activeBranchId: null,
      isImpersonating: false,
      setActiveCompany: (companyId, isImpersonating = false, branchId) =>
        set((s) => ({
          activeCompanyId: companyId,
          isImpersonating,
          activeBranchId:
            branchId !== undefined
              ? branchId
              : companyId === s.activeCompanyId
                ? s.activeBranchId
                : null,
        })),
      setActiveBranch: (branchId) => set({ activeBranchId: branchId }),
      clear: () =>
        set({ activeCompanyId: null, activeBranchId: null, isImpersonating: false }),
    }),
    { name: 'pos.companyContext' },
  ),
)
