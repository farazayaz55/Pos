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
  fetchBinary: (url: string) => Promise<{ contentType: string; data: ArrayBuffer }>
  getAppVersion: () => Promise<string>
  getUpdateStatus: () => Promise<UpdateEventPayload>
  checkForUpdates: () => Promise<UpdateEventPayload>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  onUpdateEvent: (callback: (payload: UpdateEventPayload) => void) => () => void
}

declare global {
  interface Window {
    posDesktop?: PosDesktopApi
  }
}

export {}
