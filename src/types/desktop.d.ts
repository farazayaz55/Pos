export interface DesktopPrinter {
  name: string
  displayName: string
  description: string
  isDefault: boolean
  status: number
}

export interface PrintOptions {
  deviceName?: string
}

export interface PosDesktopApi {
  isDesktop: true
  getPrinters: () => Promise<DesktopPrinter[]>
  print: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  testPrint: (options?: PrintOptions) => Promise<{ success: boolean; error?: string }>
  openDisplay: (companyId: string) => Promise<void>
  fetchBinary: (url: string) => Promise<{ contentType: string; data: ArrayBuffer }>
}

declare global {
  interface Window {
    posDesktop?: PosDesktopApi
  }
}

export {}
