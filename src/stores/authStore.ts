import { create } from 'zustand'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Unsubscribe,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getUser } from '@/services/users'
import { setSuperAdminClaim } from '@/services/functionsApi'
import type { AppUser } from '@/types'

interface AuthState {
  initialized: boolean
  loading: boolean
  user: AppUser | null
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  init: () => Unsubscribe
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  loading: false,
  user: null,
  error: null,

  signIn: async (email, password) => {
    set({ loading: true, error: null })
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in failed'
      set({ error: msg, loading: false })
      throw e
    }
  },

  signOut: async () => {
    await fbSignOut(auth)
    set({ user: null, loading: false, error: null })
  },

  init: () => {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        set({ user: null, initialized: true, loading: false })
        return
      }
      try {
        const appUser = await getUser(fbUser.uid)
        if (!appUser) {
          set({
            user: null,
            initialized: true,
            loading: false,
            error: 'Your account has no role assigned. Contact a Super Admin.',
          })
          await fbSignOut(auth)
          return
        }

        const tokenResult = await fbUser.getIdTokenResult()
        const claims = tokenResult.claims as { role?: string; companyId?: string }

        const needSuperClaim =
          appUser.role === 'super_admin' && claims.role !== 'super_admin'
        const needAdminClaim =
          appUser.role === 'admin' &&
          (claims.role !== 'admin' || claims.companyId !== appUser.companyId)

        if (needSuperClaim) {
          try {
            await setSuperAdminClaim({})
            await fbUser.getIdToken(true)
          } catch (err) {
            console.warn('[auth] setSuperAdminClaim failed:', err)
          }
        } else if (needAdminClaim) {
          try {
            await fbUser.getIdToken(true)
          } catch {
            // ignore
          }
        }

        set({ user: appUser, initialized: true, loading: false, error: null })
      } catch (e) {
        console.error('[auth] failed to hydrate user', e)
        set({ user: null, initialized: true, loading: false })
      }
    })
  },
}))
