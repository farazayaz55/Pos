import { usePosSettingsStore } from '@/stores/posSettingsStore'
import { PrintConfigError } from '@/services/printReceipt'
import {
  formatXzReportPlainText,
  type XzReportPrintInput,
} from '@/utils/xzReportText'

/**
 * Print an X, Z, or Z-period summary report to the configured receipt printer.
 * Desktop: ESC/POS text via Electron. Browser: opens a print window with preformatted text.
 */
export async function printXzReport(input: XzReportPrintInput): Promise<void> {
  const text = formatXzReportPlainText(input)
  const desktop = window.posDesktop

  if (!desktop) {
    const w = window.open('', '_blank', 'noopener,noreferrer,width=400,height=700')
    if (!w) {
      throw new Error('Pop-up blocked — allow pop-ups to print the report.')
    }
    w.document.write(
      `<!doctype html><html><head><title>Report</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
         font-size: 12px; white-space: pre; margin: 16px; }
  @media print { body { margin: 0; } }
</style></head><body>${text.replace(/</g, '&lt;')}</body></html>`,
    )
    w.document.close()
    w.focus()
    w.print()
    return
  }

  const deviceName = usePosSettingsStore.getState().receiptPrinterName
  if (!deviceName) {
    throw new PrintConfigError(
      'No receipt printer selected. Choose one in Settings before printing.',
    )
  }

  const result = await desktop.print({
    deviceName,
    text,
  })
  if (!result.success) {
    throw new Error(result.error || 'Print failed')
  }
}
