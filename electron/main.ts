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
import { buildEscPosReceipt, rawPrintWindows } from './escposPrint'

const isDev = !app.isPackaged
const SCHEME = 'app'

/** 80mm thermal width (microns) — used for macOS/Linux HTML print only. */
const RECEIPT_PAGE_WIDTH_MICRONS = 80_000
const RECEIPT_PAGE_HEIGHT_MICRONS_DEFAULT = 200_000
const PRINT_CALLBACK_TIMEOUT_MS = 45_000
const PRINT_WINDOW_DESTROY_DELAY_MS = 2_500

type PrintResult = { success: boolean; error?: string }

type SilentPrintOptions = {
  deviceName?: string
  html?: string
  /** Plain-text receipt body for ESC/POS (preferred on Windows). */
  text?: string
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

const resolvePrinterFromApp = async (
  requested?: string,
): Promise<string | undefined> => {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return requested
  return resolveDeviceName(win.webContents, requested)
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

const printEscPosOnWindows = async (
  printerName: string,
  text: string,
): Promise<PrintResult> => {
  try {
    const payload = buildEscPosReceipt(text)
    await rawPrintWindows(printerName, payload)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'RAW print failed',
    }
  }
}

/** macOS/Linux: print HTML via Chromium (works there; broken for POS-80 on Windows). */
const printHtmlOnUnix = async (
  html: string,
  options: SilentPrintOptions = {},
): Promise<PrintResult> => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tmpHtml = path.join(app.getPath('temp'), `pos-receipt-${id}.html`)
  await fs.writeFile(tmpHtml, html, 'utf8')

  const printWin = new BrowserWindow({
    show: false,
    width: 302,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    await printWin.loadFile(tmpHtml)
    await sleep(250)
    const resolved = await resolveDeviceName(
      printWin.webContents,
      options.deviceName,
    )
    return printWebContents(printWin.webContents, {
      silent: true,
      printBackground: true,
      color: true,
      margins: { marginType: 'none' },
      pageSize: {
        width: RECEIPT_PAGE_WIDTH_MICRONS,
        height: clampPageHeight(options.pageHeightMicrons),
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
    setTimeout(() => {
      void fs.unlink(tmpHtml).catch(() => {})
    }, PRINT_WINDOW_DESTROY_DELAY_MS)
  }
}

const printDocument = async (
  options: SilentPrintOptions = {},
): Promise<PrintResult> => {
  const resolved = await resolvePrinterFromApp(options.deviceName)
  if (!resolved) {
    return { success: false, error: 'No printer selected' }
  }

  // Windows POS-80: Chromium silent/PDF paths feed blank paper. Send ESC/POS RAW.
  if (process.platform === 'win32') {
    const text =
      (options.text && options.text.trim()) ||
      'Restaurant POS\nPrinter test\n\nIf you can read this, RAW printing works.'
    return printEscPosOnWindows(resolved, text)
  }

  if (options.html && options.html.trim()) {
    return printHtmlOnUnix(options.html, { ...options, deviceName: resolved })
  }

  const fallbackHtml = `<!DOCTYPE html><html><body style="font-family:monospace;font-size:12px;color:#000;padding:8px;white-space:pre-wrap">${(
    options.text || 'Restaurant POS'
  )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</body></html>`
  return printHtmlOnUnix(fallbackHtml, { ...options, deviceName: resolved })
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
      _event,
      options: {
        deviceName?: string
        html?: string
        text?: string
        pageHeightMicrons?: number
      } = {},
    ) => {
      return printDocument({
        deviceName: options.deviceName,
        html: options.html,
        text: options.text,
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

      const width = 42
      const center = (s: string) => {
        const t = s.slice(0, width)
        const pad = Math.max(0, Math.floor((width - t.length) / 2))
        return `${' '.repeat(pad)}${t}`
      }
      const padLR = (left: string, right: string) => {
        const spaces = Math.max(1, width - left.length - right.length)
        return `${left}${' '.repeat(spaces)}${right}`
      }
      const text = [
        center('Restaurant POS'),
        center('Printer test'),
        '-'.repeat(width),
        padLR('Date', new Date().toLocaleString()),
        padLR('Status', 'OK'),
        '-'.repeat(width),
        center('If you can read this,'),
        center('alignment is working.'),
      ].join('\n')

      return printDocument({ deviceName: options.deviceName, text })
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
