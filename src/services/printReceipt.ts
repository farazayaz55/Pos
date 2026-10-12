import { usePosSettingsStore } from '@/stores/posSettingsStore'

export class PrintConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintConfigError'
  }
}

/**
 * Print the current window contents (receipt page).
 * In Electron: silent print to the configured printer.
 * In the browser: falls back to window.print() (system dialog).
 */
export async function printReceipt(): Promise<void> {
  const desktop = window.posDesktop
  if (!desktop) {
    window.print()
    return
  }

  const deviceName = usePosSettingsStore.getState().receiptPrinterName
  if (!deviceName) {
    throw new PrintConfigError(
      'No receipt printer selected. Choose one in Settings before printing.',
    )
  }

  const result = await desktop.print({ deviceName })
  if (!result.success) {
    throw new Error(result.error || 'Print failed')
  }
}
