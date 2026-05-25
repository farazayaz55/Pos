import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CompanyContextState {
  /** The companyId currently being managed in the admin area. */
  activeCompanyId: string | null
  /** True when a super admin is viewing another company. */
  isImpersonating: boolean
  setActiveCompany: (companyId: string | null, isImpersonating?: boolean) => void
  clear: () => void
}

export const useCompanyContextStore = create<CompanyContextState>()(
  persist(
    (set) => ({
      activeCompanyId: null,
      isImpersonating: false,
      setActiveCompany: (companyId, isImpersonating = false) =>
        set({ activeCompanyId: companyId, isImpersonating }),
      clear: () => set({ activeCompanyId: null, isImpersonating: false }),
    }),
    { name: 'pos.companyContext' },
  ),
)
