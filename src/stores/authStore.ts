import { create } from 'zustand'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Unsubscribe,
  type User as FirebaseUser,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getUser, subscribeUser } from '@/services/users'
import { setSuperAdminClaim, syncMyClaims } from '@/services/functionsApi'
import { clearAuthCache, getAuthCache, saveAuthCache } from '@/localdb/db'
import { isAppOnline } from '@/utils/onlineGate'
import { permissionsEqual } from '@/utils/permissions'
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

const claimsNeedSync = (
  appUser: AppUser,
  claims: {
    role?: string
    companyId?: string
    branchId?: string
    permissions?: AppUser['permissions']
  },
): 'super' | 'admin' | 'staff' | null => {
  if (appUser.role === 'super_admin' && claims.role !== 'super_admin') return 'super'
  if (
    appUser.role === 'admin' &&
    (claims.role !== 'admin' || claims.companyId !== appUser.companyId)
  ) {
    return 'admin'
  }
  if (
    appUser.role === 'staff' &&
    (claims.role !== 'staff' ||
      claims.companyId !== appUser.companyId ||
      claims.branchId !== appUser.branchId ||
      !permissionsEqual(claims.permissions, appUser.permissions))
  ) {
    return 'staff'
  }
  return null
}

const syncClaimsForUser = async (fbUser: FirebaseUser, appUser: AppUser) => {
  const tokenResult = await fbUser.getIdTokenResult()
  const claims = tokenResult.claims as {
    role?: string
    companyId?: string
    branchId?: string
    permissions?: AppUser['permissions']
  }
  const need = claimsNeedSync(appUser, claims)
  if (!need) return

  try {
    if (need === 'super') {
      await setSuperAdminClaim({})
    } else {
      await syncMyClaims({})
    }
    await fbUser.getIdToken(true)
  } catch (err) {
    console.warn('[auth] claim sync failed:', err)
    try {
      await fbUser.getIdToken(true)
    } catch {
      // ignore
    }
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
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
    // Best-effort: IndexedDB may be unavailable
    void clearAuthCache(uid)
    set({ user: null, loading: false, error: null })
  },

  init: () => {
    let unsubProfile: Unsubscribe | undefined

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      unsubProfile?.()
      unsubProfile = undefined

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

        // Best-effort offline cache; never block sign-in on IndexedDB
        void saveAuthCache(appUser)

        if (appUser.role === 'staff' && appUser.active === false) {
          set({
            user: null,
            initialized: true,
            loading: false,
            error: 'Your account has been deactivated. Contact your manager.',
          })
          await fbSignOut(auth)
          void clearAuthCache(fbUser.uid)
          return
        }

        await syncClaimsForUser(fbUser, appUser)

        set({ user: appUser, initialized: true, loading: false, error: null })

        // Keep permissions/branch in sync when an admin updates this staff member.
        unsubProfile = subscribeUser(fbUser.uid, (updated) => {
          void (async () => {
            if (!updated) {
              set({
                user: null,
                error: 'Your account has no role assigned. Contact a Super Admin.',
              })
              await fbSignOut(auth)
              return
            }

            if (updated.role === 'staff' && updated.active === false) {
              set({
                user: null,
                error: 'Your account has been deactivated. Contact your manager.',
              })
              await fbSignOut(auth)
              void clearAuthCache(fbUser.uid)
              return
            }

            const prev = get().user
            const accessChanged =
              !prev ||
              prev.role !== updated.role ||
              prev.branchId !== updated.branchId ||
              prev.companyId !== updated.companyId ||
              !permissionsEqual(prev.permissions, updated.permissions)

            void saveAuthCache(updated)

            if (accessChanged) {
              await syncClaimsForUser(fbUser, updated)
            }

            set({ user: updated, error: null })
          })()
        })
      } catch (e) {
        console.error('[auth] failed to hydrate user', e)
        try {
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
        } catch (cacheErr) {
          console.warn('[auth] local cache unavailable', cacheErr)
        }
        set({ user: null, initialized: true, loading: false })
      }
    })

    return () => {
      unsubProfile?.()
      unsubAuth()
    }
  },
}))
