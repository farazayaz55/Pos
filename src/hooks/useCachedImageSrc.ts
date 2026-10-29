import { useEffect, useState } from 'react'
import {
  ensureImageCached,
  getCachedObjectUrl,
} from '@/localdb/imageCache'

/**
 * Resolves a remote image URL to a local blob: URL when cached.
 *
 * Important: always check IndexedDB before using the remote URL, so navigating
 * away and back while offline still shows cached images.
 */
export const useCachedImageSrc = (
  remoteUrl: string | undefined | null,
  companyId?: string,
): { src: string | undefined; ready: boolean } => {
  const [src, setSrc] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(!remoteUrl)

  useEffect(() => {
    if (!remoteUrl) {
      setSrc(undefined)
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)
    setSrc(undefined)

    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine

    void (async () => {
      try {
        // 1) Prefer local cache (works offline after tab switch / remount)
        const cached = await getCachedObjectUrl(remoteUrl)
        if (cancelled) return
        if (cached) {
          setSrc(cached)
          setReady(true)
          // Refresh cache in background when online
          if (browserOnline) void ensureImageCached(remoteUrl, companyId)
          return
        }

        if (!browserOnline) {
          setSrc(undefined)
          setReady(true)
          return
        }

        // 2) Online miss: download into IndexedDB, then show blob URL
        const ok = await ensureImageCached(remoteUrl, companyId)
        if (cancelled) return
        if (ok) {
          const objectUrl = await getCachedObjectUrl(remoteUrl)
          if (!cancelled && objectUrl) {
            setSrc(objectUrl)
            setReady(true)
            return
          }
        }

        // 3) Last resort while online: remote URL (will break offline)
        if (!cancelled) {
          setSrc(remoteUrl)
          setReady(true)
        }
      } catch (e) {
        console.warn('[useCachedImageSrc] failed', e)
        if (!cancelled) {
          setSrc(browserOnline ? remoteUrl : undefined)
          setReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [remoteUrl, companyId])

  return { src, ready }
}
