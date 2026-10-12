import { localDb } from '@/localdb/db'
import type { Category, Company, MenuItem } from '@/types'

/** In-memory object URLs so we don't recreate them every render. */
const objectUrls = new Map<string, string>()

/** In-flight downloads so parallel callers share one request. */
const inflight = new Map<string, Promise<boolean>>()

const isHttpUrl = (url: string | undefined | null): url is string =>
  !!url &&
  (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('gs://'))

/**
 * Stable cache key — strip query/token so the same Storage object always hits.
 * Firebase download URLs often differ only by `token=`.
 */
export const imageCacheKey = (url: string): string => {
  try {
    if (url.startsWith('gs://')) return url
    const u = new URL(url)
    if (
      u.hostname.includes('firebasestorage.googleapis.com') ||
      u.hostname.endsWith('.firebasestorage.app') ||
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1'
    ) {
      return `${u.origin}${u.pathname}`
    }
  } catch {
    // keep raw
  }
  return url
}

const canAttemptDownload = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine

export const getCachedImageRow = (url: string) =>
  localDb.imageCache.get(imageCacheKey(url))

const rowToObjectUrl = (key: string, bytes: ArrayBuffer, contentType: string) => {
  const existing = objectUrls.get(key)
  if (existing) return existing
  const blob = new Blob([bytes], { type: contentType || 'image/jpeg' })
  const objectUrl = URL.createObjectURL(blob)
  objectUrls.set(key, objectUrl)
  return objectUrl
}

/** Returns a stable blob: URL if cached, otherwise null. */
export const getCachedObjectUrl = async (
  url: string | undefined | null,
): Promise<string | null> => {
  if (!isHttpUrl(url)) return null
  const key = imageCacheKey(url)
  const existing = objectUrls.get(key)
  if (existing) return existing
  const row = await getCachedImageRow(url)
  if (!row?.bytes || !(row.bytes.byteLength > 0)) return null
  return rowToObjectUrl(key, row.bytes, contentTypeOrDefault(row.contentType))
}

const contentTypeOrDefault = (t?: string) => t || 'image/jpeg'

const rememberBytes = async (
  url: string,
  bytes: ArrayBuffer,
  contentType: string,
  companyId?: string,
): Promise<void> => {
  const key = imageCacheKey(url)
  const copy = bytes.slice(0)
  await localDb.imageCache.put({
    url: key,
    bytes: copy,
    contentType: contentTypeOrDefault(contentType),
    companyId,
    updatedAt: Date.now(),
  })
  const prev = objectUrls.get(key)
  if (prev) URL.revokeObjectURL(prev)
  objectUrls.delete(key)
  rowToObjectUrl(key, copy, contentTypeOrDefault(contentType))
}

/** Rewrite Firebase Storage download URL to Vite same-origin proxy (dev only). */
const toViteStorageProxyUrl = (url: string): string | null => {
  try {
    const u = new URL(url)
    if (u.hostname !== 'firebasestorage.googleapis.com') return null
    // Only available while Vite dev server is running
    if (typeof window === 'undefined') return null
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return null
    return `/__storage${u.pathname}${u.search}`
  } catch {
    return null
  }
}

const downloadViaElectron = async (
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> => {
  const desktop = typeof window !== 'undefined' ? window.posDesktop : undefined
  if (!desktop?.fetchBinary) return null
  try {
    const { data, contentType } = await desktop.fetchBinary(url)
    if (data && data.byteLength > 0) {
      return { bytes: data, contentType: contentTypeOrDefault(contentType) }
    }
  } catch (err) {
    console.warn('[imageCache] Electron fetchBinary failed', err)
  }
  return null
}

const downloadViaFetch = async (
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> => {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    if (!bytes.byteLength) return null
    return {
      bytes,
      contentType: contentTypeOrDefault(res.headers.get('content-type') || undefined),
    }
  } catch {
    return null
  }
}

const downloadImageBytes = async (
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> => {
  // 1) Electron main process — no CORS (packaged + electron:dev)
  const viaElectron = await downloadViaElectron(url)
  if (viaElectron) return viaElectron

  // 2) Vite same-origin proxy (electron:dev / npm run dev) — avoids Storage CORS
  const proxyUrl = toViteStorageProxyUrl(url)
  if (proxyUrl) {
    const viaProxy = await downloadViaFetch(proxyUrl)
    if (viaProxy) return viaProxy
  }

  // 3) Direct fetch (works after `storage-cors.json` is applied to the bucket)
  const viaFetch = await downloadViaFetch(url)
  if (viaFetch) return viaFetch

  throw new Error('All image download methods failed')
}

/**
 * Download and store image bytes when the browser is online.
 * Idempotent if already cached. Dedupes concurrent requests for the same URL.
 */
export const ensureImageCached = async (
  url: string | undefined | null,
  companyId?: string,
  options?: { force?: boolean },
): Promise<boolean> => {
  if (!isHttpUrl(url)) return false
  if (!canAttemptDownload() && !options?.force) return false

  const key = imageCacheKey(url)

  if (!options?.force) {
    const existing = await getCachedImageRow(url)
    if (existing?.bytes && existing.bytes.byteLength > 0) {
      rowToObjectUrl(key, existing.bytes, contentTypeOrDefault(existing.contentType))
      return true
    }
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const work = (async () => {
    try {
      const { bytes, contentType } = await downloadImageBytes(url)
      if (!bytes.byteLength) return false
      await rememberBytes(url, bytes, contentType, companyId)
      return true
    } catch (err) {
      console.warn('[imageCache] failed to cache', url, err)
      return false
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, work)
  return work
}

export const prefetchImageUrls = async (
  urls: Array<string | undefined | null>,
  companyId?: string,
) => {
  if (!canAttemptDownload()) return
  const originals = urls.filter(isHttpUrl)
  const byKey = new Map<string, string>()
  for (const u of originals) {
    byKey.set(imageCacheKey(u), u)
  }
  const list = [...byKey.values()]
  if (!list.length) return

  const concurrency = 4
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency)
    await Promise.all(batch.map((u) => ensureImageCached(u, companyId)))
  }
}

export const collectMenuImageUrls = (
  categories: Category[],
  items: MenuItem[],
  company?: Company | null,
): string[] => {
  const out: string[] = []
  if (company?.logoUrl) out.push(company.logoUrl)
  for (const c of categories) {
    if (c.imageUrl) out.push(c.imageUrl)
  }
  for (const i of items) {
    if (i.imageUrl) out.push(i.imageUrl)
  }
  return out
}

export const prefetchMenuImages = async (
  companyId: string,
  categories: Category[],
  items: MenuItem[],
  company?: Company | null,
) => {
  await prefetchImageUrls(collectMenuImageUrls(categories, items, company), companyId)
}

export const countCachedImages = () => localDb.imageCache.count()
