import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  type WebContentsPrintOptions,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const isDev = !app.isPackaged
const SCHEME = 'app'

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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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

  ipcMain.handle('pos:get-printers', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
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
    async (_event, options: { deviceName?: string } = {}) => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow
      if (!win) {
        return { success: false, error: 'No window available to print' }
      }

      const printOptions: WebContentsPrintOptions = {
        silent: true,
        printBackground: true,
        deviceName: options.deviceName || undefined,
      }

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        win.webContents.print(printOptions, (success, failureReason) => {
          if (success) {
            resolve({ success: true })
          } else {
            resolve({
              success: false,
              error: failureReason || 'Print failed',
            })
          }
        })
      })
    },
  )

  ipcMain.handle(
    'pos:test-print',
    async (_event, options: { deviceName?: string } = {}) => {
      if (!options.deviceName) {
        return { success: false, error: 'No printer selected' }
      }

      const testWin = new BrowserWindow({
        show: false,
        width: 320,
        height: 480,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      })

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title>
<style>
  body { font-family: ui-monospace, monospace; font-size: 12px; margin: 16px; color: #111; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 8px; }
  p { margin: 4px 0; text-align: center; }
  hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
</style></head><body>
  <h1>Restaurant POS</h1>
  <p>Printer test</p>
  <hr>
  <p>${new Date().toLocaleString()}</p>
  <p>If you can read this, the printer is configured correctly.</p>
</body></html>`

      try {
        await testWin.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        )
        // Give Chromium a beat to layout before printing
        await new Promise((r) => setTimeout(r, 200))

        const result = await new Promise<{ success: boolean; error?: string }>(
          (resolve) => {
            testWin.webContents.print(
              {
                silent: true,
                printBackground: true,
                deviceName: options.deviceName,
              },
              (success, failureReason) => {
                if (success) resolve({ success: true })
                else
                  resolve({
                    success: false,
                    error: failureReason || 'Test print failed',
                  })
              },
            )
          },
        )
        return result
      } finally {
        testWin.destroy()
      }
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
}

app.whenReady().then(() => {
  if (!isDev) {
    registerAppProtocol()
  }
  registerIpc()
  createWindow()

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
