import { ref, get, onValue } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { AppUser } from '@/types'
import { normalizePermissions } from '@/utils/permissions'

export const userRef = (uid: string) => ref(db, `users/${uid}`)

const hydrateUser = (uid: string, val: Omit<AppUser, 'uid'>): AppUser => ({
  uid,
  ...val,
  permissions:
    val.role === 'staff' ? normalizePermissions(val.permissions) : val.permissions,
})

export const getUser = async (uid: string): Promise<AppUser | null> => {
  const snap = await get(userRef(uid))
  const val = snap.val() as Omit<AppUser, 'uid'> | null
  return val ? hydrateUser(uid, val) : null
}

export const subscribeUser = (uid: string, cb: (u: AppUser | null) => void) => {
  return onValue(userRef(uid), (snap) => {
    const val = snap.val() as Omit<AppUser, 'uid'> | null
    cb(val ? hydrateUser(uid, val) : null)
  })
}
