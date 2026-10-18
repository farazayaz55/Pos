import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export interface DesktopPrinter {
  name: string
  displayName: string
  description: string
  isDefault: boolean
  status: number
}

export interface PrintOptions {
  deviceName?: string
  /** Self-contained HTML document for a dedicated print window (macOS/Linux). */
  html?: string
  /** Plain-text receipt for ESC/POS RAW printing (Windows POS printers). */
  text?: string
  /** Optional page height in microns (fits thermal paper length). */
  pageHeightMicrons?: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateEventPayload {
  status: UpdateStatus
  version: string
  availableVersion?: string
  progress?: number
  error?: string
}

export interface PosDesktopApi {
  isDesktop: true
  getPrinters: () => Promise<DesktopPrinter[]>
  print: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  testPrint: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  openDisplay: (companyId: string) => Promise<void>
  /** Main-process fetch (bypasses renderer CORS) for offline image caching. */
  fetchBinary: (url: string) => Promise<{ contentType: string; data: ArrayBuffer }>
  getAppVersion: () => Promise<string>
  getUpdateStatus: () => Promise<UpdateEventPayload>
  checkForUpdates: () => Promise<UpdateEventPayload>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  onUpdateEvent: (callback: (payload: UpdateEventPayload) => void) => () => void
}

const api: PosDesktopApi = {
  isDesktop: true,
  getPrinters: () => ipcRenderer.invoke('pos:get-printers'),
  print: (options) => ipcRenderer.invoke('pos:print', options ?? {}),
  testPrint: (options) => ipcRenderer.invoke('pos:test-print', options ?? {}),
  openDisplay: (companyId) => ipcRenderer.invoke('pos:open-display', companyId),
  fetchBinary: (url) => ipcRenderer.invoke('pos:fetch-binary', url),
  getAppVersion: async () => {
    const status = await ipcRenderer.invoke('pos:updater-get-status')
    return status.version as string
  },
  getUpdateStatus: () => ipcRenderer.invoke('pos:updater-get-status'),
  checkForUpdates: () => ipcRenderer.invoke('pos:updater-check'),
  installUpdate: () => ipcRenderer.invoke('pos:updater-install'),
  onUpdateEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: UpdateEventPayload) => {
      callback(payload)
    }
    ipcRenderer.on('pos:updater-event', listener)
    return () => {
      ipcRenderer.removeListener('pos:updater-event', listener)
    }
  },
}

contextBridge.exposeInMainWorld('posDesktop', api)
