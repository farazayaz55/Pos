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
import { clearAuthCache, getAuthCache, saveAuthCache } from '@/localdb/db'
import { isAppOnline } from '@/utils/onlineGate'
import type { AppUser } from '@/types'

export const OFFLINE_SIGNOUT_MESSAGE =
  'Cannot sign out while offline. Stay signed in so the POS keeps working without internet.'

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
    if (!isAppOnline()) {
      const msg = OFFLINE_SIGNOUT_MESSAGE
      set({ error: msg })
      throw new Error(msg)
    }
    const uid = auth.currentUser?.uid
    await fbSignOut(auth)
    await clearAuthCache(uid)
    set({ user: null, loading: false, error: null })
  },

  init: () => {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        set({ user: null, initialized: true, loading: false })
        return
      }
      try {
        let appUser: AppUser | null = null
        try {
          appUser = await getUser(fbUser.uid)
        } catch (err) {
          console.warn('[auth] getUser failed, trying local cache', err)
          const cached = await getAuthCache(fbUser.uid)
          if (cached) {
            set({
              user: cached.user,
              initialized: true,
              loading: false,
              error: null,
            })
            return
          }
          throw err
        }

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

        await saveAuthCache(appUser)

        if (appUser.role === 'staff' && appUser.active === false) {
          set({
            user: null,
            initialized: true,
            loading: false,
            error: 'Your account has been deactivated. Contact your manager.',
          })
          await fbSignOut(auth)
          await clearAuthCache(fbUser.uid)
          return
        }

        const tokenResult = await fbUser.getIdTokenResult()
        const claims = tokenResult.claims as {
          role?: string
          companyId?: string
          permissions?: AppUser['permissions']
        }

        const needSuperClaim =
          appUser.role === 'super_admin' && claims.role !== 'super_admin'
        const needAdminClaim =
          appUser.role === 'admin' &&
          (claims.role !== 'admin' || claims.companyId !== appUser.companyId)
        const needStaffClaim =
          appUser.role === 'staff' &&
          (claims.role !== 'staff' ||
            claims.companyId !== appUser.companyId ||
            JSON.stringify(claims.permissions ?? {}) !==
              JSON.stringify(appUser.permissions ?? {}))

        if (needSuperClaim) {
          try {
            await setSuperAdminClaim({})
            await fbUser.getIdToken(true)
          } catch (err) {
            console.warn('[auth] setSuperAdminClaim failed:', err)
          }
        } else if (needAdminClaim || needStaffClaim) {
          try {
            await fbUser.getIdToken(true)
          } catch {
            // ignore
          }
        }

        set({ user: appUser, initialized: true, loading: false, error: null })
      } catch (e) {
        console.error('[auth] failed to hydrate user', e)
        const cached = await getAuthCache(fbUser.uid)
        if (cached) {
          set({
            user: cached.user,
            initialized: true,
            loading: false,
            error: null,
          })
          return
        }
        set({ user: null, initialized: true, loading: false })
      }
    })
  },
}))