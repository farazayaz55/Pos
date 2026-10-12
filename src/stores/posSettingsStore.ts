import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PosSettingsState {
  receiptPrinterName: string | null
  autoPrint: boolean
  setReceiptPrinterName: (name: string | null) => void
  setAutoPrint: (value: boolean) => void
}

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      receiptPrinterName: null,
      autoPrint: true,
      setReceiptPrinterName: (name) => set({ receiptPrinterName: name }),
      setAutoPrint: (value) => set({ autoPrint: value }),
    }),
    { name: 'pos.settings' },
  ),
)

export const isDesktopApp = () => typeof window !== 'undefined' && Boolean(window.posDesktop)
