export interface DesktopPrinter {
  name: string
  displayName: string
  description: string
  isDefault: boolean
  status: number
}

export interface DesktopDisplayInfo {
  id: number
  label: string
  width: number
  height: number
  isPrimary: boolean
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

export type CustomerDisplayPhase = 'idle' | 'ordering' | 'thanks'

export interface CustomerDisplayState {
  phase: CustomerDisplayPhase
  companyName?: string
  companyLogoUrl?: string
  tableNumber?: string
  lines: {
    lineId: string
    itemName: string
    quantity: number
    lineTotal: number
    modifiers: { optionName: string; priceAdjustment: number }[]
    note?: string
  }[]
  subtotal: number
  discountAmount: number
  taxLines: { name: string; rate: number; amount: number }[]
  tax: number
  total: number
  orderNumber?: number
  thanksTotal?: number
}

export interface PosDesktopApi {
  isDesktop: true
  getPrinters: () => Promise<DesktopPrinter[]>
  print: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  testPrint: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  openDisplay: (companyId: string) => Promise<void>
  getDisplays: () => Promise<DesktopDisplayInfo[]>
  openCustomerDisplay: (options?: { displayId?: number | null }) => Promise<void>
  closeCustomerDisplay: () => Promise<void>
  identifyDisplays: () => Promise<void>
  publishCustomerDisplay: (state: CustomerDisplayState) => Promise<void>
  getCustomerDisplayState: () => Promise<CustomerDisplayState | null>
  onCustomerDisplayState: (
    callback: (state: CustomerDisplayState) => void,
  ) => () => void
  /** Main-process fetch (bypasses renderer CORS) for offline image caching. */
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
