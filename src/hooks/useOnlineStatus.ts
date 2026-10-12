import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { db } from '@/lib/firebase'
import { setAppOnline } from '@/utils/onlineGate'

/**
 * Combines browser online flag with Firebase RTDB `.info/connected`.
 * Prefer Firebase when known; fall back to navigator.onLine.
 */
export const useOnlineStatus = () => {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [firebaseConnected, setFirebaseConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true)
    const onOffline = () => setBrowserOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const connectedRef = ref(db, '.info/connected')
    return onValue(connectedRef, (snap) => {
      setFirebaseConnected(snap.val() === true)
    })
  }, [])

  const isOnline =
    firebaseConnected === null ? browserOnline : firebaseConnected && browserOnline

  useEffect(() => {
    setAppOnline(isOnline)
  }, [isOnline])

  return { isOnline, browserOnline, firebaseConnected }
}

/** Non-hook snapshot for services (best-effort). */
export const isBrowserOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine
