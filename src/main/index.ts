import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, clipboard, shell, dialog } from 'electron'
import type { NativeImage } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { PortalController } from './controller'
import type { PortalEvent, Settings } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let controller: PortalController | null = null
let quitting = false
let shuttingDown = false
let trayHintShown = false

/**
 * Optional isolated profile (`--portal-profile=<dir>` or `OPENCODE_PORTAL_USER_DATA`).
 * A second instance then gets its own settings, ledger and single-instance lock, which is
 * what makes side-by-side testing possible without touching the installed app's data.
 */
function profileOverride(): string | null {
  const env = process.env.OPENCODE_PORTAL_USER_DATA
  if (env && env.trim()) return env.trim()
  const flag = process.argv.find((arg) => arg.startsWith('--portal-profile='))
  return flag ? flag.slice('--portal-profile='.length) || null : null
}

const profileDir = profileOverride()
if (profileDir) app.setPath('userData', resolve(profileDir))

function iconCandidates(): string[] {
  const resources = process.resourcesPath || ''
  const root = app.getAppPath()
  return [
    join(resources, 'icon.png'),
    join(resources, 'icon.ico'),
    join(root, 'build/icon.png'),
    join(root, 'build/icon.ico'),
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../build/icon.ico'),
    join(__dirname, '../../../build/icon.png'),
    join(__dirname, '../renderer/icon.png')
  ].filter(Boolean)
}

function appIcon(): NativeImage | null {
  for (const candidate of iconCandidates()) {
    if (!existsSync(candidate)) continue
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image
  }
  return null
}

/**
 * The tray needs a small bitmap the Windows shell can render: a 512 px source is downscaled
 * by the shell and ends up muddy, and an empty image renders as the blank square that a
 * missing icon produces.
 */
function trayImage(): NativeImage {
  const source = appIcon()
  if (!source) return nativeImage.createEmpty()
  return source.resize({ width: 32, height: 32, quality: 'best' })
}

function send(event: PortalEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('portal:event', event)
}

function createWindow(): void {
  const icon = appIcon()
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    ...(icon ? { icon } : {}),
    backgroundColor: '#07080b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07080b', symbolColor: '#8b93a7', height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
      if (!trayHintShown) {
        trayHintShown = true
        tray?.displayBalloon?.({
          title: 'OpenCode Portal is still running',
          content: 'Cursor keeps working because the gateway and tunnel stay up. Quit from the tray menu.',
          iconType: 'info'
        })
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip('OpenCode Portal')
  refreshTray()
  tray.on('click', () => showWindow())
  void recoverTrayIcon()
}

/**
 * Packaged builds get build/icon.png from extraResources. If that is ever missing the tray
 * would stay blank, so fall back to the icon embedded in the executable itself.
 */
async function recoverTrayIcon(): Promise<void> {
  if (!tray || !trayImage().isEmpty()) return
  try {
    const image = await app.getFileIcon(process.execPath, { size: 'small' })
    if (tray && !image.isEmpty()) tray.setImage(image.resize({ width: 32, height: 32, quality: 'best' }))
  } catch {
    /* keep the blank tray rather than crashing */
  }
}

function refreshTray(): void {
  if (!tray || !controller) return
  const gateway = controller.gateway.snapshot()
  const tunnel = controller.tunnel.status()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open OpenCode Portal', click: () => showWindow() },
      { type: 'separator' },
      {
        label: gateway.running ? `Gateway running on :${gateway.port}` : 'Gateway stopped',
        enabled: false
      },
      {
        label: tunnel.publicUrl ? `Tunnel: ${tunnel.publicUrl.replace('https://', '')}` : 'Tunnel offline',
        enabled: false
      },
      { type: 'separator' },
      {
        label: gateway.running ? 'Stop gateway' : 'Start gateway',
        click: () => {
          if (gateway.running) void controller?.stopGateway()
          else void controller?.startGateway()
          setTimeout(refreshTray, 400)
        }
      },
      {
        label: tunnel.phase === 'online' ? 'Stop tunnel' : 'Start tunnel',
        click: () => {
          if (tunnel.phase === 'online') void controller?.stopTunnel()
          else void controller?.startTunnel()
          setTimeout(refreshTray, 1200)
        }
      },
      { type: 'separator' },
      {
        label: 'Copy Cursor base URL',
        enabled: Boolean(tunnel.publicUrl),
        click: () => {
          if (tunnel.publicUrl) clipboard.writeText(`${tunnel.publicUrl}/v1`)
        }
      },
      {
        label: 'Copy portal access token',
        click: () => {
          if (controller) clipboard.writeText(controller.secrets.portalToken)
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function registerIpc(): void {
  if (!controller) return
  const c = controller

  ipcMain.handle('portal:state', () => c.state())
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => c.updateSettings(patch))
  ipcMain.handle('settings:effort', (_event, effort: Settings['reasoningEffort']) => c.setReasoningEffort(effort))
  ipcMain.handle('onboarding:step', (_event, step: number) => c.setOnboardingStep(step))
  ipcMain.handle('onboarding:complete', (_event, complete: boolean) => c.completeOnboarding(complete))

  ipcMain.handle('key:set', (_event, key: string) => {
    c.setApiKey(key)
    return true
  })
  ipcMain.handle('key:verify', (_event, key?: string) => c.verifyKey(key))
  ipcMain.handle('key:clear', () => {
    c.setApiKey('')
    return true
  })
  ipcMain.handle('ngrok:setToken', (_event, token: string) => {
    c.setNgrokToken(token)
    return true
  })

  ipcMain.handle('gateway:start', () => c.startGateway())
  ipcMain.handle('gateway:stop', () => c.stopGateway())
  ipcMain.handle('gateway:restart', () => c.restartGateway())
  ipcMain.handle('tunnel:start', () => c.startTunnel())
  ipcMain.handle('tunnel:stop', () => c.stopTunnel())
  ipcMain.handle('ngrok:detect', () => c.detectNgrok())
  ipcMain.handle('ngrok:install', () => c.installNgrokCli())

  ipcMain.handle('cursor:info', () => c.cursorInfo())
  ipcMain.handle('cursor:apply', () => c.applyCursor())
  ipcMain.handle('cursor:open', () => c.openCursor())
  ipcMain.handle('cursor:state', () => c.cursorState())

  ipcMain.handle('token:rotate', () => c.rotatePortalToken())
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  ipcMain.handle('clipboard:token', () => {
    clipboard.writeText(c.secrets.portalToken)
    return true
  })
  ipcMain.handle('clipboard:apiKey', () => {
    clipboard.writeText(c.secrets.apiKey)
    return true
  })

  ipcMain.handle('app:diagnose', () => c.diagnose())
  ipcMain.handle('app:openExternal', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return true
  })
  ipcMain.handle('app:revealData', () => {
    void shell.openPath(c.state().userDataDir)
    return true
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    userData: c.state().userDataDir
  }))
  ipcMain.handle('requests:clear', () => c.clearRequests())

  ipcMain.handle('usage:refresh', () => c.refreshQuota())
  ipcMain.handle('usage:clear', () => {
    c.clearUsage()
    return true
  })

  ipcMain.handle('reasoning:clear', () => {
    c.clearReasoningJournal()
    return { size: 0, capacity: c.reasoning.capacity }
  })
  ipcMain.handle('logs:clear', () => c.clearLogs())
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('app:quit', () => {
    quitting = true
    app.quit()
  })
  ipcMain.handle('app:restartOnboarding', () => {
    c.completeOnboarding(false)
    send({ type: 'navigate', view: 'onboarding' })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    controller = new PortalController((event) => {
      send(event)
      if (event.type === 'gateway' || event.type === 'tunnel') refreshTray()
      if (event.type === 'state') refreshTray()
    })
    registerIpc()
    createWindow()
    buildTray()
    await controller.boot()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray: Cursor depends on the local gateway.
  })

  app.on('before-quit', (event) => {
    if (shuttingDown || !controller) return
    event.preventDefault()
    shuttingDown = true
    quitting = true
    const active = controller
    void active.shutdown().finally(() => {
      app.quit()
    })
  })
}

process.on('uncaughtException', (error) => {
  controller?.logs.error('portal', `Uncaught: ${error.message}`)
  try {
    if (mainWindow) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'OpenCode Portal',
        message: error.message,
        detail: 'The portal kept the gateway alive. Check the logs, then restart the app if requests fail.'
      })
    }
  } catch {
    /* ignore */
  }
})
