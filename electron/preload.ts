import { contextBridge, ipcRenderer } from 'electron'

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
  /** Main-process fetch (bypasses renderer CORS) for offline image caching. */
  fetchBinary: (url: string) => Promise<{ contentType: string; data: ArrayBuffer }>
}

const api: PosDesktopApi = {
  isDesktop: true,
  getPrinters: () => ipcRenderer.invoke('pos:get-printers'),
  print: (options) => ipcRenderer.invoke('pos:print', options ?? {}),
  testPrint: (options) => ipcRenderer.invoke('pos:test-print', options ?? {}),
  openDisplay: (companyId) => ipcRenderer.invoke('pos:open-display', companyId),
  fetchBinary: (url) => ipcRenderer.invoke('pos:fetch-binary', url),
}

contextBridge.exposeInMainWorld('posDesktop', api)
