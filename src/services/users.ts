import { ref, get, onValue } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { AppUser } from '@/types'

export const userRef = (uid: string) => ref(db, `users/${uid}`)

export const getUser = async (uid: string): Promise<AppUser | null> => {
  const snap = await get(userRef(uid))
  const val = snap.val() as Omit<AppUser, 'uid'> | null
  return val ? { uid, ...val } : null
}

export const subscribeUser = (uid: string, cb: (u: AppUser | null) => void) => {
  return onValue(userRef(uid), (snap) => {
    const val = snap.val() as Omit<AppUser, 'uid'> | null
    cb(val ? { uid, ...val } : null)
  })
}
