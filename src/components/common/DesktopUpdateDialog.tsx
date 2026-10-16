import { useCallback, useEffect, useRef, useState } from 'react'
import { isDesktopApp } from '@/stores/posSettingsStore'
import type { UpdateEventPayload } from '@/types/desktop'

const dismissKey = (version: string) => `pos-update-dismissed:${version}`

const isDismissed = (version: string | undefined) => {
  if (!version || typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(dismissKey(version)) === '1'
}

const markDismissed = (version: string | undefined) => {
  if (!version || typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(dismissKey(version), '1')
}

const DesktopUpdateDialog = () => {
  const [payload, setPayload] = useState<UpdateEventPayload | null>(null)
  const [open, setOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const sawUpdateRef = useRef(false)

  const handleClose = useCallback(() => {
    setPayload((prev) => {
      markDismissed(prev?.availableVersion ?? prev?.version)
      return prev
    })
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!isDesktopApp() || !window.posDesktop) return
    let cancelled = false
    const desktopApi = window.posDesktop

    const apply = (next: UpdateEventPayload) => {
      if (cancelled) return
      setPayload(next)

      const version = next.availableVersion
      const progressStatuses =
        next.status === 'available' ||
        next.status === 'downloading' ||
        next.status === 'downloaded'

      if (progressStatuses) {
        sawUpdateRef.current = true
        if (!isDismissed(version)) setOpen(true)
        return
      }

      if (next.status === 'error' && sawUpdateRef.current && !isDismissed(version)) {
        setOpen(true)
      }
    }

    void desktopApi.getUpdateStatus().then(apply).catch(() => {})

    const unsubscribe = desktopApi.onUpdateEvent(apply)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !installing) handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, installing, handleClose])

  if (!open || !payload) return null

  const version = payload.availableVersion
  const isError = payload.status === 'error'
  const ready = payload.status === 'downloaded'
  const downloading =
    payload.status === 'available' || payload.status === 'downloading'

  const handleUpdateNow = async () => {
    if (!window.posDesktop || !ready) return
    setInstalling(true)
    try {
      const result = await window.posDesktop.installUpdate()
      if (!result.success) {
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: result.error || 'Failed to install update',
              }
            : prev,
        )
        setInstalling(false)
      }
    } catch (err) {
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              error: err instanceof Error ? err.message : 'Failed to install update',
            }
          : prev,
      )
      setInstalling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="card w-full max-w-md p-6 shadow-lg" role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold text-slate-900">
          {isError ? 'Update failed' : 'Update available'}
        </h3>
        <div className="mt-2 text-sm text-slate-600">
          {isError ? (
            <p>{payload.error || 'Something went wrong while updating.'}</p>
          ) : (
            <>
              <p>
                {version
                  ? `Version ${version} is available.`
                  : 'A new version of Restaurant POS is available.'}
              </p>
              {downloading && (
                <p className="mt-2 text-slate-500">
                  {payload.status === 'downloading' && payload.progress != null
                    ? `Downloading… ${payload.progress}%`
                    : 'Downloading update…'}
                </p>
              )}
              {ready && (
                <p className="mt-2 text-slate-500">
                  Ready to install. The app will restart to apply the update.
                </p>
              )}
              {(payload.status === 'downloading' || payload.status === 'available') &&
                payload.progress != null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, payload.progress))}%`,
                      }}
                    />
                  </div>
                )}
            </>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClose}
            disabled={installing}
          >
            Close
          </button>
          {!isError && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleUpdateNow()}
              disabled={!ready || installing}
            >
              {installing
                ? 'Restarting…'
                : downloading
                  ? 'Downloading…'
                  : 'Update now'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DesktopUpdateDialog
