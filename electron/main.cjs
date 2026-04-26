const { app, BrowserWindow, ipcMain, Notification, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const http = require('http')
const { getTasks, saveTasks } = require('./store.cjs')
const { autoUpdater } = require('electron-updater')

// ========== LICENCIA CON FALLBACK ==========
const { checkLicense, activateLicense, getDeviceId, setDataPath, deleteLicense } = (() => {
  if (app.isPackaged) {
    const paths = [
      path.join(process.resourcesPath, 'electron', 'licenseManager.cjs'),
      path.join(process.resourcesPath, 'licenseManager.cjs'),
      path.join(__dirname, 'licenseManager.cjs'),
    ]
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log('📁 Licencia encontrada en:', p)
        return require(p)
      }
    }
    console.error('❌ licenseManager.cjs no encontrado en ninguna ruta')
    return {
      checkLicense:    () => ({ status: 'trial', trialDaysLeft: 7 }),
      activateLicense: () => ({ success: false }),
      getDeviceId:     () => 'unknown',
      setDataPath:     () => {},
      deleteLicense:   () => {},
    }
  }
  console.log('📁 Cargando licencia desde desarrollo')
  return require('./licenseManager.cjs')
})()

// ========== SOLO DESHABILITAR SEGURIDAD EN DESARROLLO ==========
const isDev = !app.isPackaged

if (isDev) {
  // Estas flags solo se aplican en desarrollo
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
  app.commandLine.appendSwitch('disable-web-security')
  app.commandLine.appendSwitch('disable-site-isolation-trials')
  app.commandLine.appendSwitch('ignore-certificate-errors')
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
  app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process')
  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-default-apps')
  app.commandLine.appendSwitch('disable-sync')
  app.commandLine.appendSwitch('disable-translate')
  app.commandLine.appendSwitch('no-first-run')
  app.commandLine.appendSwitch('safebrowsing-disable-auto-update')
  
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true
}

let mainWindow
let zendaySession = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: !isDev,                // ✅ true en producción, false solo en desarrollo
      allowRunningInsecureContent: isDev, // ✅ solo desarrollo
      partition: 'persist:zenday',
      sandbox: false,
      additionalArguments: isDev ? ['--disable-web-security', '--allow-file-access-from-files'] : []
    },
    show: false,
    frame: false,
    titleBarStyle: 'hidden'
  })

  const policiesToRemove = [
    'content-security-policy', 'Content-Security-Policy',
    'content-security-policy-report-only', 'Content-Security-Policy-Report-Only',
    'x-webkit-csp', 'X-WebKit-CSP',
    'x-content-security-policy', 'X-Content-Security-Policy',
    'cross-origin-opener-policy', 'Cross-Origin-Opener-Policy',
    'cross-origin-embedder-policy', 'Cross-Origin-Embedder-Policy',
    'cross-origin-resource-policy', 'Cross-Origin-Resource-Policy',
    'frame-ancestors', 'Frame-Ancestors',
    'x-frame-options', 'X-Frame-Options'
  ]

  // Eliminar cabeceras de seguridad también en producción (esto no es una vulnerabilidad, mejora la compatibilidad)
  const removeSecurityHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders }
    policiesToRemove.forEach(policy => delete headers[policy])
    callback({ responseHeaders: headers })
  }

  if (zendaySession) {
    zendaySession.webRequest.onHeadersReceived(removeSecurityHeaders)
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived(removeSecurityHeaders)

  mainWindow.setMenuBarVisibility(false)
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
  
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized', true)
  })
  
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized', false)
  })
}

// ========== AUTO-UPDATER ==========
autoUpdater.checkForUpdatesAndNotify()

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'tu-usuario-github',
  repo: 'zenday',
  private: false
})

autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('update-downloaded')
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

// ========== HANDLERS EXISTENTES ==========
ipcMain.handle('open-external', async (_, url) => {
  await shell.openExternal(url)
})

ipcMain.handle('get-tasks', () => getTasks())
ipcMain.handle('save-tasks', (_, tasks) => saveTasks(tasks))

ipcMain.handle('show-notification', (_, title, body) => {
  new Notification({ title, body }).show()
})

ipcMain.handle('close-window', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.close()
})

ipcMain.handle('minimize-window', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.minimize()
})

ipcMain.handle('maximize-window', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  }
})

ipcMain.handle('is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.isMaximized() : false
})

ipcMain.handle('reload-window', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.reload()
})

ipcMain.handle('open-dev-tools', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.webContents.openDevTools()
})

ipcMain.handle('open-file', async (_, dataUrl, fileName) => {
  try {
    const ext = fileName.split('.').pop() || 'pdf'
    const tmpPath = path.join(os.tmpdir(), `zenday_${Date.now()}.${ext}`)
    const base64 = dataUrl.split(',')[1]
    fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'))
    await shell.openPath(tmpPath)
    return { success: true, path: tmpPath }
  } catch (error) {
    console.error('Error al abrir archivo:', error)
    return { success: false, error: error.message }
  }
})

// ========== HANDLERS DE LICENCIA ==========
ipcMain.handle('check-license', () => checkLicense())
ipcMain.handle('activate-license', (_, key) => activateLicense(key))
ipcMain.handle('get-device-id', () => getDeviceId())
ipcMain.handle('delete-license', () => deleteLicense())

// ========== VERSIÓN ==========
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

// ========== FETCH EXTERNO (sin CORS) ==========
ipcMain.handle('fetch-external', async (_, url, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url)
      const lib = parsedUrl.protocol === 'https:' ? https : http

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path:     parsedUrl.pathname + parsedUrl.search,
        method:   options.method || 'GET',
        headers:  options.headers || {},
        rejectUnauthorized: false,
      }

      const req = lib.request(reqOptions, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300
          try {
            resolve({ ok, status: res.statusCode, data: JSON.parse(data) })
          } catch {
            resolve({ ok, status: res.statusCode, data })
          }
        })
      })

      req.on('error', err => {
        console.error('[fetch-external] Error:', err.message)
        reject(err.message)
      })

      if (options.body) req.write(options.body)
      req.end()
    } catch (err) {
      console.error('[fetch-external] URL inválida:', err.message)
      reject(err.message)
    }
  })
})

// ========== RECORDATORIOS (solo tareas locales) ==========
setInterval(() => {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const currentTime = now.toTimeString().slice(0, 5)

  const tasks = getTasks()
  tasks.forEach(task => {
    if (task.date === today && task.reminder === currentTime && !task.done) {
      new Notification({ title: '⏰ Recordatorio', body: task.title }).show()
    }
  })
}, 60000)

// ========== EVENTOS DE APLICACIÓN ==========
app.whenReady().then(() => {
  zendaySession = session.fromPartition('persist:zenday')
  
  const policiesToRemove = [
    'content-security-policy', 'Content-Security-Policy',
    'content-security-policy-report-only', 'Content-Security-Policy-Report-Only',
    'cross-origin-opener-policy', 'Cross-Origin-Opener-Policy',
    'cross-origin-embedder-policy', 'Cross-Origin-Embedder-Policy',
    'cross-origin-resource-policy', 'Cross-Origin-Resource-Policy',
    'x-frame-options', 'X-Frame-Options'
  ]
  
  const removeSecurityHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders }
    policiesToRemove.forEach(policy => delete headers[policy])
    callback({ responseHeaders: headers })
  }
  
  zendaySession.webRequest.onHeadersReceived(removeSecurityHeaders)
  
  zendaySession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['notifications', 'geolocation', 'media', 'popup', 'fullscreen']
    callback(allowed.includes(permission))
  })
  
  session.defaultSession.webRequest.onHeadersReceived(removeSecurityHeaders)
  
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['notifications', 'geolocation', 'media', 'popup', 'fullscreen']
    callback(allowed.includes(permission))
  })
  
  setDataPath(app.getPath('userData'))
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})