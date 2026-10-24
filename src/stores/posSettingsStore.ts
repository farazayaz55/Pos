import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PosSettingsState {
  receiptPrinterName: string | null
  autoPrint: boolean
  customerDisplayEnabled: boolean
  /** Electron Display.id; null = auto (first non-primary, else primary). */
  customerDisplayId: number | null
  setReceiptPrinterName: (name: string | null) => void
  setAutoPrint: (value: boolean) => void
  setCustomerDisplayEnabled: (value: boolean) => void
  setCustomerDisplayId: (id: number | null) => void
}

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      receiptPrinterName: null,
      autoPrint: true,
      customerDisplayEnabled: false,
      customerDisplayId: null,
      setReceiptPrinterName: (name) => set({ receiptPrinterName: name }),
      setAutoPrint: (value) => set({ autoPrint: value }),
      setCustomerDisplayEnabled: (value) => set({ customerDisplayEnabled: value }),
      setCustomerDisplayId: (id) => set({ customerDisplayId: id }),
    }),
    { name: 'pos.settings' },
  ),
)

export const isDesktopApp = () => typeof window !== 'undefined' && Boolean(window.posDesktop)
