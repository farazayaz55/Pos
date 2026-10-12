import { useCallback, useEffect, useRef } from 'react'
import { usePosKioskStore } from '@/stores/posKioskStore'

const KIOSK_DESIRED_KEY = 'pos.kioskDesired'

type KeyboardNavigator = Navigator & {
  keyboard?: {
    lock: (keyCodes?: string[]) => Promise<void>
    unlock: () => void
  }
}

type WakeLockSentinelLike = {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>
  }
}

const fullscreenSupported = () =>
  typeof document !== 'undefined' &&
  typeof document.documentElement.requestFullscreen === 'function'

const cleanupBrowserLocks = async (wakeLockRef: {
  current: WakeLockSentinelLike | null
}) => {
  const nav = navigator as KeyboardNavigator
  try {
    nav.keyboard?.unlock()
  } catch {
    // ignore
  }
  if (wakeLockRef.current) {
    try {
      await wakeLockRef.current.release()
    } catch {
      // ignore
    }
    wakeLockRef.current = null
  }
}

export const usePosKioskMode = () => {
  const active = usePosKioskStore((s) => s.active)
  const setActive = usePosKioskStore((s) => s.setActive)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const exitingRef = useRef(false)

  const releaseLocks = useCallback(async () => {
    await cleanupBrowserLocks(wakeLockRef)
  }, [])

  const exit = useCallback(async () => {
    if (exitingRef.current) return
    exitingRef.current = true
    try {
      sessionStorage.removeItem(KIOSK_DESIRED_KEY)
      await releaseLocks()
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen()
        } catch {
          // ignore
        }
      }
      setActive(false)
    } finally {
      exitingRef.current = false
    }
  }, [releaseLocks, setActive])

  const enter = useCallback(async () => {
    if (!fullscreenSupported()) {
      throw new Error('Fullscreen is not supported in this browser')
    }
    await document.documentElement.requestFullscreen()
    sessionStorage.setItem(KIOSK_DESIRED_KEY, '1')
    setActive(true)

    const nav = navigator as KeyboardNavigator & WakeLockNavigator
    try {
      await nav.keyboard?.lock(['Escape'])
    } catch {
      // Keyboard Lock is Chrome/Edge only; continue without it
    }

    try {
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null
        })
      }
    } catch {
      // Wake Lock may be denied; continue without it
    }
  }, [setActive])

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && usePosKioskStore.getState().active) {
        void (async () => {
          sessionStorage.removeItem(KIOSK_DESIRED_KEY)
          await releaseLocks()
          setActive(false)
        })()
      }
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!usePosKioskStore.getState().active) return
      e.preventDefault()
      e.returnValue = ''
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [releaseLocks, setActive])

  useEffect(() => {
    return () => {
      if (!usePosKioskStore.getState().active) return
      void (async () => {
        await cleanupBrowserLocks(wakeLockRef)
        if (document.fullscreenElement) {
          try {
            await document.exitFullscreen()
          } catch {
            // ignore
          }
        }
        usePosKioskStore.getState().setActive(false)
      })()
    }
  }, [])

  return {
    active,
    supported: fullscreenSupported(),
    desired: typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KIOSK_DESIRED_KEY) === '1',
    enter,
    exit,
  }
}
