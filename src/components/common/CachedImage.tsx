import type { ImgHTMLAttributes, ReactNode } from 'react'
import { useCachedImageSrc } from '@/hooks/useCachedImageSrc'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | undefined | null
  companyId?: string
  /** Shown when there is no usable src (e.g. offline miss). */
  fallback?: ReactNode
}

/**
 * <img> that prefers IndexedDB-cached blob URLs for offline POS.
 */
const CachedImage = ({ src: remoteSrc, companyId, fallback, alt, ...rest }: Props) => {
  const { src, ready } = useCachedImageSrc(remoteSrc, companyId)

  if (!ready && !src) {
    return fallback ? <>{fallback}</> : null
  }

  if (!src) {
    return fallback ? <>{fallback}</> : null
  }

  return <img src={src} alt={alt ?? ''} {...rest} />
}

export default CachedImage
