import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  type WebContents,
  type WebContentsPrintOptions,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const isDev = !app.isPackaged
const SCHEME = 'app'

/** 80mm thermal width (microns). */
const RECEIPT_PAGE_WIDTH_MICRONS = 80_000
const RECEIPT_PAGE_HEIGHT_MICRONS_DEFAULT = 200_000
const PRINT_CALLBACK_TIMEOUT_MS = 45_000
const PRINT_WINDOW_DESTROY_DELAY_MS = 2_500

type PrintResult = { success: boolean; error?: string }

type SilentPrintOptions = {
  deviceName?: string
  /** Page height in microns (fitted to receipt content when provided). */
  pageHeightMicrons?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const clampPageHeight = (pageHeightMicrons?: number) =>
  Math.max(
    60_000,
    Math.min(
      400_000,
      Math.round(pageHeightMicrons || RECEIPT_PAGE_HEIGHT_MICRONS_DEFAULT),
    ),
  )

/** Match saved name against OS printer name (Windows is picky / case-sensitive). */
const resolveDeviceName = async (
  webContents: WebContents,
  requested?: string,
): Promise<string | undefined> => {
  if (!requested) return undefined
  const printers = await webContents.getPrintersAsync()
  const exact = printers.find((p) => p.name === requested)
  if (exact) return exact.name
  const byDisplay = printers.find((p) => p.displayName === requested)
  if (byDisplay) return byDisplay.name
  const lower = requested.toLowerCase()
  const ci = printers.find(
    (p) =>
      p.name.toLowerCase() === lower || p.displayName.toLowerCase() === lower,
  )
  if (ci) return ci.name
  return requested
}

const printWebContents = (
  webContents: WebContents,
  options: WebContentsPrintOptions,
): Promise<PrintResult> =>
  new Promise((resolve) => {
    let settled = false
    const finish = (result: PrintResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        success: false,
        error:
          'Print timed out. On Windows, confirm the printer name and that a paper size is set in printer properties.',
      })
    }, PRINT_CALLBACK_TIMEOUT_MS)

    try {
      webContents.print(options, (success, failureReason) => {
        clearTimeout(timer)
        if (success) {
          finish({ success: true })
        } else {
          finish({
            success: false,
            error: failureReason || 'Print failed',
          })
        }
      })
    } catch (err) {
      clearTimeout(timer)
      finish({
        success: false,
        error: err instanceof Error ? err.message : 'Print failed',
      })
    }
  })

const destroyLater = (win: BrowserWindow) => {
  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy()
  }, PRINT_WINDOW_DESTROY_DELAY_MS)
}

/**
 * Windows: Chromium silent webContents.print is broken for many POS-80 drivers
 * (empty page size / blank slips). Render HTML → PDF, then print via SumatraPDF
 * (pdf-to-printer), which matches how Chrome successfully prints.
 */
const printPdfOnWindows = async (
  pdfPath: string,
  printerName: string,
): Promise<PrintResult> => {
  try {
    // Lazy require so macOS/Linux builds don't load a Windows-only module at startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { print } = require('pdf-to-printer') as {
      print: (
        pdf: string,
        options?: {
          printer?: string
          silent?: boolean
          scale?: 'noscale' | 'shrink' | 'fit'
          monochrome?: boolean
          copies?: number
        },
      ) => Promise<void>
    }

    await print(pdfPath, {
      printer: printerName,
      silent: true,
      scale: 'noscale',
      monochrome: true,
      copies: 1,
    })
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'PDF print failed',
    }
  }
}

const measureContentHeightMicrons = async (
  webContents: WebContents,
  fallback?: number,
): Promise<number> => {
  try {
    const contentHeightPx = await webContents.executeJavaScript(
      `Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, 120)`,
    )
    if (typeof contentHeightPx === 'number' && contentHeightPx > 0) {
      return clampPageHeight(
        Math.round(contentHeightPx * (25_400 / 96) * 1.15 + 10_000),
      )
    }
  } catch {
    // ignore
  }
  return clampPageHeight(fallback)
}

const printHtmlDocument = async (
  html: string,
  options: SilentPrintOptions = {},
): Promise<PrintResult> => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tmpHtml = path.join(app.getPath('temp'), `pos-receipt-${id}.html`)
  const tmpPdf = path.join(app.getPath('temp'), `pos-receipt-${id}.pdf`)
  await fs.writeFile(tmpHtml, html, 'utf8')

  const printWin = new BrowserWindow({
    show: false,
    width: 302, // ~80mm at 96dpi
    height: 1200,
    x: -20_000,
    y: -20_000,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    await printWin.loadFile(tmpHtml)
    printWin.showInactive()
    await sleep(process.platform === 'win32' ? 500 : 250)

    const pageHeightMicrons = await measureContentHeightMicrons(
      printWin.webContents,
      options.pageHeightMicrons,
    )
    const resolved = await resolveDeviceName(
      printWin.webContents,
      options.deviceName,
    )

    if (!resolved && options.deviceName) {
      return { success: false, error: `Printer not found: ${options.deviceName}` }
    }

    // --- Windows: PDF → SumatraPDF (reliable for POS-80) ---
    if (process.platform === 'win32') {
      if (!resolved) {
        return { success: false, error: 'No printer selected' }
      }
      const pdfData = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: {
          width: RECEIPT_PAGE_WIDTH_MICRONS,
          height: pageHeightMicrons,
        },
        margins: {
          marginType: 'none',
        },
      })
      await fs.writeFile(tmpPdf, pdfData)
      return printPdfOnWindows(tmpPdf, resolved)
    }

    // --- macOS / Linux: webContents.print is usually fine ---
    return printWebContents(printWin.webContents, {
      silent: true,
      printBackground: true,
      color: true,
      margins: { marginType: 'none' },
      pageSize: {
        width: RECEIPT_PAGE_WIDTH_MICRONS,
        height: pageHeightMicrons,
      },
      copies: 1,
      ...(resolved ? { deviceName: resolved } : {}),
    })
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Print failed',
    }
  } finally {
    destroyLater(printWin)
    // Delay cleanup so SumatraPDF can finish reading the file on Windows
    setTimeout(() => {
      void fs.unlink(tmpHtml).catch(() => {})
      void fs.unlink(tmpPdf).catch(() => {})
    }, PRINT_WINDOW_DESTROY_DELAY_MS + 1_000)
  }
}

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

type UpdateEventPayload = {
  status: UpdateStatus
  version: string
  availableVersion?: string
  progress?: number
  error?: string
}

let updateStatus: UpdateStatus = 'idle'
let availableVersion: string | undefined
let downloadProgress: number | undefined
let lastError: string | undefined

const getUpdatePayload = (): UpdateEventPayload => ({
  status: updateStatus,
  version: app.getVersion(),
  availableVersion,
  progress: downloadProgress,
  error: lastError,
})

const emitUpdateEvent = () => {
  const payload = getUpdatePayload()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pos:updater-event', payload)
    }
  }
}

const setUpdateStatus = (
  status: UpdateStatus,
  extras: Partial<Pick<UpdateEventPayload, 'availableVersion' | 'progress' | 'error'>> = {},
) => {
  updateStatus = status
  if ('availableVersion' in extras) availableVersion = extras.availableVersion
  if ('progress' in extras) downloadProgress = extras.progress
  if ('error' in extras) lastError = extras.error
  emitUpdateEvent()
}

const setupAutoUpdater = () => {
  if (isDev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus('checking', { error: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateStatus('available', {
      availableVersion: info.version,
      progress: 0,
      error: undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus('not-available', {
      availableVersion: undefined,
      progress: undefined,
      error: undefined,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus('downloading', {
      progress: Math.round(progress.percent),
      error: undefined,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus('downloaded', {
      availableVersion: info.version,
      progress: 100,
      error: undefined,
    })
  })

  autoUpdater.on('error', (err) => {
    setUpdateStatus('error', {
      error: err?.message || 'Update failed',
    })
  })

  // Startup check after window is ready; UI listens via IPC events
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: Error) => {
      setUpdateStatus('error', { error: err?.message || 'Update check failed' })
    })
  }, 3000)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let mainWindow: BrowserWindow | null = null

const distPath = () => path.join(__dirname, '..', 'dist')

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadURL(`${SCHEME}://./index.html`)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const registerAppProtocol = () => {
  const root = distPath()

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    let rel = decodeURIComponent(url.pathname)
    if (!rel || rel === '/') {
      rel = '/index.html'
    }

    let filePath = path.normalize(path.join(root, rel))
    if (!filePath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 })
    }

    try {
      const st = await fs.stat(filePath)
      if (st.isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      }
    } catch {
      filePath = path.join(root, 'index.html')
    }

    return net.fetch(pathToFileURL(filePath).href)
  })
}

const registerIpc = () => {
  /**
   * Download arbitrary HTTPS assets in the main process (no renderer CORS).
   * Used to cache menu images for offline POS.
   */
  ipcMain.handle('pos:fetch-binary', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL')
    }
    const res = await net.fetch(url)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const data = await res.arrayBuffer()
    return { contentType, data }
  })

  ipcMain.handle('pos:get-printers', async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      mainWindow
    if (!win) return []
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      isDefault: p.isDefault,
      status: p.status,
    }))
  })

  ipcMain.handle(
    'pos:print',
    async (
      event,
      options: {
        deviceName?: string
        html?: string
        pageHeightMicrons?: number
      } = {},
    ) => {
      // Prefer a self-contained receipt HTML document. Printing the live
      // admin UI on Windows often yields a blank (white) page because of
      // @media print visibility tricks + Chromium's silent print path.
      if (typeof options.html === 'string' && options.html.trim()) {
        return printHtmlDocument(options.html, {
          deviceName: options.deviceName,
          pageHeightMicrons: options.pageHeightMicrons,
        })
      }

      // No HTML payload — print a minimal document instead of the live UI.
      const fallbackHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title>
<style>body{font-family:monospace;font-size:12px;color:#000;padding:8px}</style>
</head><body><p>Nothing to print.</p></body></html>`
      return printHtmlDocument(fallbackHtml, {
        deviceName: options.deviceName,
        pageHeightMicrons: options.pageHeightMicrons,
      })
    },
  )

  ipcMain.handle(
    'pos:test-print',
    async (_event, options: { deviceName?: string } = {}) => {
      if (!options.deviceName) {
        return { success: false, error: 'No printer selected' }
      }

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Consolas, "Courier New", monospace; font-size: 12px; padding: 8px 10px; box-sizing: border-box; max-width: 80mm; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 8px; color: #000; }
  p { margin: 4px 0; text-align: center; color: #000; }
  hr { border: none; border-top: 1px dashed #000; margin: 12px 0; }
</style></head><body>
  <h1>Restaurant POS</h1>
  <p>Printer test</p>
  <hr>
  <p>${new Date().toLocaleString()}</p>
  <p>If you can read this, the printer is configured correctly.</p>
</body></html>`

      return printHtmlDocument(html, { deviceName: options.deviceName })
    },
  )

  ipcMain.handle('pos:open-display', async (_event, companyId: string) => {
    if (!companyId || typeof companyId !== 'string') return

    const displayWin = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'Product Display',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    if (isDev) {
      await displayWin.loadURL(`http://localhost:5174/display/${companyId}`)
    } else {
      // Protocol handler falls back to index.html; pathname stays /display/:id for BrowserRouter
      await displayWin.loadURL(`${SCHEME}://./display/${companyId}`)
    }
  })

  ipcMain.handle('pos:updater-get-status', () => getUpdatePayload())

  ipcMain.handle('pos:updater-check', async () => {
    if (isDev) {
      return {
        ...getUpdatePayload(),
        status: 'not-available' as const,
        error: undefined,
      }
    }
    try {
      setUpdateStatus('checking', { error: undefined })
      await autoUpdater.checkForUpdates()
      return getUpdatePayload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update check failed'
      setUpdateStatus('error', { error: message })
      return getUpdatePayload()
    }
  })

  ipcMain.handle('pos:updater-install', () => {
    if (isDev || updateStatus !== 'downloaded') {
      return { success: false, error: 'No update ready to install' }
    }
    // Allow the IPC response to flush before quitting
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    return { success: true }
  })
}

app.whenReady().then(() => {
  if (!isDev) {
    registerAppProtocol()
  }
  registerIpc()
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
