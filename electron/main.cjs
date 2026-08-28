// ═══════════════════════════════════════════════════════════════════════
//  MONITOREO DE ERRORES (proceso principal)
//
//  Antes de esto, un error en el proceso principal (no en la ventana) sólo
//  se veía si el cliente tenía la consola abierta — que nunca la tiene. Va
//  primero en el archivo, antes de cualquier otro require, para agarrar
//  también los fallos que puedan pasar cargando esos módulos.
//
//  El DSN de Sentry NO es un secreto (a diferencia de ZENDAY_LICENSE_SECRET):
//  solo permite ENVIAR eventos a este proyecto, no leerlos ni administrarlo.
//  Es seguro que viaje dentro del .exe, igual que la apiKey de Firebase.
//
//  sendDefaultPii:false y sin integraciones de captura de pantalla/sesión a
//  propósito: esta app maneja historias clínicas. Sentry se usa acá para
//  saber QUE se rompió y DONDE, no para grabar lo que el cliente hace.
// ═══════════════════════════════════════════════════════════════════════
const Sentry = require('@sentry/electron/main')
Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://3d9074b064d477ba3b407155725f96d1@o4511989052080128.ingest.us.sentry.io/4511989066366976',
  release: `zenday@${require('../package.json').version}`,
  environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  sendDefaultPii: false,
})

const { app, BrowserWindow, ipcMain, Notification, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const http = require('http')
const net = require('net')
const dns = require('dns')
const { getTasks, saveTasks } = require('./store.cjs')
const documentStore = require('./documentStore.cjs')
const licenseClient = require('./licenseClient.cjs')
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
        return require(p)
      }
    }
    console.error('[License] licenseManager.cjs no encontrado en ninguna ruta')
    // FIX: el fallback devolvía { trialDaysLeft } mientras el módulo real devuelve
    // { daysLeft }. La UI leía daysLeft => undefined. Ahora coinciden las formas.
    return {
      checkLicense:    () => ({ status: 'trial', daysLeft: 7, plan: 'professional' }),
      activateLicense: () => ({ success: false, message: 'Módulo de licencias no disponible.' }),
      getDeviceId:     () => 'unknown',
      setDataPath:     () => {},
      deleteLicense:   () => false,
    }
  }
  return require('./licenseManager.cjs')
})()

const isDev = !app.isPackaged

// ========== LOG SILENCIADO EN PRODUCCIÓN ==========
// FIX: 266 llamadas a console.* filtraban datos de clientes/pedidos a la consola
// de un build de producción con DevTools abribles. En producción sólo pasan errores.
const log = (...args) => { if (isDev) console.log(...args) }

if (isDev) {
  app.commandLine.appendSwitch('ignore-certificate-errors')
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
  app.commandLine.appendSwitch('no-first-run')
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true
}

let mainWindow
let zendaySession = null
let versionCheckInterval = null   // FIX: antes se creaba un setInterval por ventana y nunca se limpiaba
let reminderInterval = null


let handlersRegistered = false

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS DE SEGURIDAD
// ═══════════════════════════════════════════════════════════════════════

// Rangos privados / loopback / link-local: bloquearlos evita que un renderer
// comprometido use fetch-external para escanear la red interna del cliente (SSRF).
function isPrivateAddress(hostname) {
  const h = String(hostname).toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true

  if (net.isIPv6(h)) {
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
  }
  if (!net.isIPv4(h)) return false

  const [a, b] = h.split('.').map(Number)
  if (a === 127 || a === 0 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true       // metadata cloud / link-local
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

const ALLOWED_FETCH_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024   // 10 MB
const MAX_REDIRECTS = 3

// Extensiones que abre open-file. Se excluye todo lo ejecutable: sin esto, un XSS
// en el renderer podía escribir un .exe/.bat/.hta en temp y lanzarlo con shell.openPath.
const ALLOWED_OPEN_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
  'txt', 'csv', 'json', 'xlsx', 'xls', 'docx', 'doc', 'odt', 'ods'
])

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

// Compara versiones semver reales. Antes se usaba `latest !== current`, que marcaba
// como "actualización disponible" cualquier diferencia, incluido un downgrade.
function isNewerVersion(latest, current) {
  const parse = (v) => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const [la, lb, lc] = parse(latest)
  const [ca, cb, cc] = parse(current)
  if (la !== ca) return la > ca
  if (lb !== cb) return lb > cb
  return lc > cc
}

// ═══════════════════════════════════════════════════════════════════════

function registerIpcHandlers() {
  if (handlersRegistered) return
  handlersRegistered = true

  // ========== ABRIR ENLACES EXTERNOS (con validación de protocolo) ==========
  // FIX: antes aceptaba cualquier string. Un `file:///C:/...exe` o un esquema
  // custom registrado por otro programa podía lanzar un ejecutable local.
  ipcMain.handle('open-external', async (_, url) => {
    try {
      const parsed = new URL(String(url))
      if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
        console.error('[open-external] Protocolo bloqueado:', parsed.protocol)
        return { success: false, error: 'Protocolo no permitido' }
      }
      await shell.openExternal(parsed.href)
      return { success: true }
    } catch (err) {
      console.error('[open-external] URL inválida:', err.message)
      return { success: false, error: 'URL inválida' }
    }
  })

  ipcMain.handle('get-tasks', () => getTasks())
  ipcMain.handle('save-tasks', (_, tasks) => saveTasks(tasks))

  ipcMain.handle('show-notification', (_, title, body) => {
    new Notification({ title: String(title || ''), body: String(body || '') }).show()
  })

  // Los controles de ventana ahora actúan sobre la ventana que emitió el evento,
  // no sobre "la que tenga foco" (que puede ser otra si se abre un diálogo).
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle('close-window',    (e) => { windowOf(e)?.close() })
  ipcMain.handle('minimize-window', (e) => { windowOf(e)?.minimize() })
  ipcMain.handle('maximize-window', (e) => {
    const win = windowOf(e)
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('is-maximized', (e) => windowOf(e)?.isMaximized() ?? false)
  ipcMain.handle('reload-window', (e) => { windowOf(e)?.reload() })

  // FIX: DevTools sólo en desarrollo. En un build vendido no debe poder abrirse
  // desde la UI: da acceso directo a los datos de los clientes y al preload.
  ipcMain.handle('open-dev-tools', (e) => {
    if (!isDev) return { success: false, error: 'No disponible en producción' }
    windowOf(e)?.webContents.openDevTools()
    return { success: true }
  })

  // ========== ABRIR ARCHIVO TEMPORAL (con allowlist de extensión) ==========
  ipcMain.handle('open-file', async (_, dataUrl, fileName) => {
    try {
      const rawExt = String(fileName || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
      const ext = rawExt || 'pdf'

      if (!ALLOWED_OPEN_EXTENSIONS.has(ext)) {
        console.error('[open-file] Extensión bloqueada:', ext)
        return { success: false, error: `Tipo de archivo no permitido: .${ext}` }
      }

      const str = String(dataUrl || '')
      const commaIdx = str.indexOf(',')
      if (!str.startsWith('data:') || commaIdx === -1) {
        return { success: false, error: 'Formato de archivo inválido' }
      }

      const buffer = Buffer.from(str.slice(commaIdx + 1), 'base64')
      if (buffer.length > 50 * 1024 * 1024) {
        return { success: false, error: 'Archivo demasiado grande (máx. 50 MB)' }
      }

      // Carpeta propia dentro de temp, no la raíz compartida.
      const tmpDir = path.join(os.tmpdir(), 'zenday-tmp')
      fs.mkdirSync(tmpDir, { recursive: true })
      const tmpPath = path.join(tmpDir, `zenday_${Date.now()}.${ext}`)

      fs.writeFileSync(tmpPath, buffer)
      const result = await shell.openPath(tmpPath)
      if (result) return { success: false, error: result }

      return { success: true, path: tmpPath }
    } catch (error) {
      console.error('[open-file] Error:', error.message)
      return { success: false, error: 'No se pudo abrir el archivo' }
    }
  })

  // ========== HANDLERS DE LICENCIA ==========
  // ========== LICENCIAS ==========
  //
  //  Conviven DOS sistemas, a propósito:
  //
  //   · licenseClient.cjs  — el nuevo: valida contra el servidor y verifica una
  //                          firma Ed25519. No hay ningún secreto en el .exe.
  //   · licenseManager.cjs — el viejo: valida localmente con un secreto que
  //                          viaja dentro de la app. Se puede piratear.
  //
  //  El nuevo TOMA EL CONTROL sólo si está configurado (clave pública pegada y
  //  endpoint puesto). Mientras tanto no interfiere: la app se comporta
  //  exactamente igual que antes. Eso permite tener el cableado hecho y
  //  desplegado sin cambiarle nada a los clientes hasta que estés listo.
  //
  //  Y cuando el nuevo esté activo, las claves ya vendidas con el esquema viejo
  //  SIGUEN funcionando: si el servidor no reconoce una clave, se prueba con la
  //  validación local antes de rechazarla.

  ipcMain.handle('check-license', async () => {
    if (!licenseClient.estaConfigurado()) return checkLicense()   // sistema viejo

    try {
      const r = await licenseClient.verificar(getDeviceId())

      if (r.estado === 'activa') {
        return { status: 'active', plan: r.plan, validoHasta: r.validoHasta }
      }

      // Sin internet y con la concesión vencida: NO se bloquea la app. Un
      // consultorio puede estar días sin conexión y el cliente pagó. Se avisa.
      if (r.estado === 'sin-verificar') {
        return { status: 'active', plan: r.plan || 'professional', aviso: r.message }
      }

      if (r.estado === 'revocada') {
        return { status: 'expired', plan: null, message: r.message }
      }

      // 'sin-licencia': puede ser alguien en período de prueba, o un cliente
      // viejo con licencia local. Se delega al sistema anterior, que sabe de
      // trials y de claves del esquema previo.
      return checkLicense()

    } catch (err) {
      console.error('[License] Error verificando, se usa el sistema local:', err.message)
      return checkLicense()
    }
  })

  // Las claves nuevas empiezan con ZD-; las del esquema anterior, con ZENDAY-.
  const pareceClaveNueva = (k) => /^ZD-/i.test(String(k || '').trim())

  ipcMain.handle('activate-license', async (_, key) => {
    if (!licenseClient.estaConfigurado()) {
      // FIX: antes esto caía directo al sistema viejo, que rechaza cualquier
      // clave ZD- por formato y responde "no es válida para este dispositivo".
      // Es falso y manda a buscar el problema donde no está: la clave puede ser
      // perfecta, lo que falta es desplegar la Cloud Function.
      if (pareceClaveNueva(key)) {
        return {
          success: false,
          message: 'Esta clave necesita el servidor de licencias, que todavía no está desplegado. '
                 + 'Mientras tanto usá una clave del sistema anterior (ZENDAY-...).',
        }
      }
      return activateLicense(key)   // sistema viejo
    }

    try {
      const r = await licenseClient.activar(key, getDeviceId())
      if (r.success) return r

      // SIEMPRE se prueba después con la validación local, incluso si el fallo
      // fue de red.
      //
      // Esto arregla un problema real: apenas se generan las claves con
      // generateKeys.js, `estaConfigurado()` pasa a true y la app empieza a
      // consultar el servidor — aunque la Cloud Function todavía no esté
      // desplegada. Sin este respaldo, quedaba imposible activar NINGUNA
      // licencia en esa ventana: ni las nuevas (no hay servidor) ni las viejas
      // (no se probaban). También cubre al cliente que compró con el esquema
      // anterior y está sin internet.
      const local = activateLicense(key)
      if (local.success) {
        console.log('[License] Clave validada localmente (esquema anterior)')
        return local
      }

      // La clave tampoco vale localmente. Ahí sí el mensaje de red es el correcto:
      // puede ser una clave nueva legítima que no se pudo verificar.
      if (r.message?.includes('conectar') && pareceClaveNueva(key)) {
        return {
          success: false,
          message: 'No se pudo contactar al servidor de licencias. Revisá tu conexión '
                 + 'y volvé a intentar en unos minutos.',
        }
      }
      return r

    } catch (err) {
      console.error('[License] Error activando:', err.message)
      return { success: false, message: 'No se pudo activar. Intentá de nuevo.' }
    }
  })

  ipcMain.handle('get-device-id', () => getDeviceId())

  ipcMain.handle('delete-license', () => {
    licenseClient.borrar()      // borra la concesión firmada
    return deleteLicense()      // y la licencia local
  })

  // ========== ADJUNTOS DE CLIENTES ==========
  // Antes vivían como base64 dentro de localStorage y llenaban la cuota de la
  // app entera (ver el comentario de electron/documentStore.cjs).
  ipcMain.handle('docs-list',    (_, patientId)             => documentStore.list(patientId))
  ipcMain.handle('docs-save',    (_, patientId, meta, data) => documentStore.save(patientId, meta, data))
  ipcMain.handle('docs-read',    (_, patientId, docId)      => documentStore.read(patientId, docId))
  ipcMain.handle('docs-delete',  (_, patientId, docId)      => documentStore.remove(patientId, docId))
  ipcMain.handle('docs-delete-all', (_, patientId)          => documentStore.removeAll(patientId))
  ipcMain.handle('docs-migrate', (_, patientId, docs)       => documentStore.migrate(patientId, docs))

  // ========== REGISTRO DE ERRORES ==========
  // Hoy, si a un cliente se le rompe la app, vos no te enterás nunca. Esto deja
  // un archivo de texto en la carpeta de datos que el cliente puede mandarte.
  // No sale de la máquina: no se envía a ningún lado sin que él lo haga.
  ipcMain.handle('log-error', (_, payload) => {
    try {
      const logPath = path.join(app.getPath('userData'), 'zenday-errors.log')

      // Rotar si pasa 1 MB, para no dejar un archivo gigante en el disco ajeno.
      try {
        if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
          fs.renameSync(logPath, logPath + '.old')
        }
      } catch { /* si no se puede rotar, se sigue igual */ }

      const entrada = [
        '─'.repeat(70),
        `${new Date().toISOString()}  v${app.getVersion()}  ${process.platform}`,
        `pantalla: ${payload?.scope || 'desconocida'}`,
        `mensaje:  ${payload?.message || '(sin mensaje)'}`,
        payload?.stack || '',
        payload?.componentStack || '',
        '',
      ].join('\n')

      fs.appendFileSync(logPath, entrada, 'utf8')
      return { ok: true, path: logPath }
    } catch (err) {
      console.error('[log-error]', err.message)
      return { ok: false }
    }
  })

  ipcMain.handle('open-error-log', async () => {
    const logPath = path.join(app.getPath('userData'), 'zenday-errors.log')
    if (!fs.existsSync(logPath)) return { ok: false, error: 'Todavía no hay errores registrados' }
    await shell.openPath(logPath)
    return { ok: true, path: logPath }
  })

  ipcMain.handle('get-app-version', () => app.getVersion())

  // ========== FETCH EXTERNO ==========
  // FIX PRINCIPAL: se elimina `rejectUnauthorized: false`. Con eso desactivado,
  // cualquiera en la red del cliente (WiFi de un café, router comprometido) podía
  // interceptar y modificar las respuestas de las integraciones sin que la app
  // lo notara. Además: sólo HTTPS, sin destinos privados, tamaño acotado y
  // redirecciones controladas.
  ipcMain.handle('fetch-external', async (_, url, options = {}) => {
    const doRequest = (targetUrl, redirectsLeft) => new Promise((resolve, reject) => {
      let parsedUrl
      try {
        parsedUrl = new URL(String(targetUrl))
      } catch {
        return reject(new Error('URL inválida'))
      }

      // En desarrollo se permite http para probar contra un backend local.
      const protocolOk = parsedUrl.protocol === 'https:' || (isDev && parsedUrl.protocol === 'http:')
      if (!protocolOk) {
        return reject(new Error('Sólo se permiten URLs https://'))
      }
      if (!isDev && isPrivateAddress(parsedUrl.hostname)) {
        return reject(new Error('Destino no permitido'))
      }

      const method = String(options.method || 'GET').toUpperCase()
      if (!ALLOWED_FETCH_METHODS.has(method)) {
        return reject(new Error(`Método no permitido: ${method}`))
      }

      // isPrivateAddress arriba sólo mira el hostname tal cual llegó — un
      // dominio que resuelve a una IP privada (169.254.169.254, 127.0.0.1)
      // lo pasaba igual, porque Node vuelve a resolver el DNS por su cuenta
      // al conectar (DNS rebinding). Acá se resuelve UNA vez, se valida CADA
      // IP resuelta, y se conecta directo a esa IP (pinning) — así lo que se
      // valida es lo mismo a lo que efectivamente se conecta. `servername` se
      // deja en el hostname real para que el SNI/certificado TLS sigan siendo
      // los del dominio, no los de la IP.
      const connectTo = (address) => {
        const lib = parsedUrl.protocol === 'https:' ? https : http
        const reqOptions = {
          hostname: address,
          servername: parsedUrl.protocol === 'https:' ? parsedUrl.hostname : undefined,
          port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path:     parsedUrl.pathname + parsedUrl.search,
          method,
          headers: {
            ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
            Host: parsedUrl.host,
          },
          // rejectUnauthorized queda en su valor por defecto (true): se valida el certificado.
        }
        runRequest(lib, reqOptions)
      }

      if (isDev) {
        connectTo(parsedUrl.hostname)
        return
      }

      dns.lookup(parsedUrl.hostname, { all: true }, (err, addresses) => {
        if (err || !addresses || addresses.length === 0) {
          return reject(new Error('No se pudo resolver el destino'))
        }
        if (addresses.some(a => isPrivateAddress(a.address))) {
          return reject(new Error('Destino no permitido'))
        }
        connectTo(addresses[0].address)
      })

      function runRequest(lib, reqOptions) {
      const req = lib.request(reqOptions, (res) => {
        // Redirecciones manuales, revalidando el destino en cada salto.
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) return reject(new Error('Demasiadas redirecciones'))
          const next = new URL(res.headers.location, parsedUrl).href
          return resolve(doRequest(next, redirectsLeft - 1))
        }

        let data = ''
        let bytes = 0
        res.on('data', chunk => {
          bytes += chunk.length
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy()
            return reject(new Error('Respuesta demasiado grande'))
          }
          data += chunk
        })
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300
          try {
            resolve({ ok, status: res.statusCode, data: JSON.parse(data) })
          } catch {
            resolve({ ok, status: res.statusCode, data })
          }
        })
      })

      req.setTimeout(30000, () => {
        req.destroy()
        reject(new Error('Timeout de la petición'))
      })

      req.on('error', err => reject(new Error(err.message)))

      if (options.body) req.write(options.body)
      req.end()
      }
    })

    try {
      return await doRequest(url, MAX_REDIRECTS)
    } catch (err) {
      console.error('[fetch-external]', err.message)
      // Se rechaza con Error (no con string) para que el renderer reciba
      // un objeto de error normal y no un `undefined` en err.message.
      throw new Error(err.message)
    }
  })

  ipcMain.handle('install-update', async () => {
    log('[Update] install-update: la descarga la maneja el frontend')
  })
}

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
      webSecurity: true,              // FIX: antes `!isDev`; ahora siempre activo
      allowRunningInsecureContent: false,
      partition: 'persist:zenday',
      sandbox: true,                  // FIX: el renderer corre en sandbox del SO
      spellcheck: false,
    },
    show: false,
    frame: false,
    titleBarStyle: 'hidden'
  })

  // FIX CRÍTICO: se eliminó el bloque que borraba Content-Security-Policy,
  // X-Frame-Options y las cabeceras Cross-Origin de TODAS las respuestas,
  // también en producción. Eso desactivaba de raíz las defensas del navegador
  // contra inyección de scripts. Si alguna integración se rompe por CSP,
  // se corrige la CSP de index.html — no se borra la cabecera.

  mainWindow.setMenuBarVisibility(false)

  // FIX: sin esto, cualquier link o redirección podía navegar la ventana
  // principal fuera de la app; el preload sigue expuesto en ese origen.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) shell.openExternal(parsed.href)
    } catch { /* URL inválida: se ignora */ }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalDev  = isDev && url.startsWith('http://localhost:5173')
    const isLocalFile = url.startsWith('file://')
    if (!isLocalDev && !isLocalFile) {
      event.preventDefault()
      try {
        const parsed = new URL(url)
        if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) shell.openExternal(parsed.href)
      } catch { /* ignorar */ }
    }
  })

  // Bloquea la creación de webviews (vector clásico de escape en Electron).
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    setTimeout(() => checkVersionFirebase(), 5000)
    if (versionCheckInterval) clearInterval(versionCheckInterval)
    versionCheckInterval = setInterval(() => checkVersionFirebase(), 60 * 60 * 1000)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (versionCheckInterval) { clearInterval(versionCheckInterval); versionCheckInterval = null }
  })

  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window-maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized', false))
}

// ========== CHECK DE VERSIÓN ==========
async function checkVersionFirebase() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: '/v1/projects/zenday-297b3/databases/(default)/documents/config/app',
      method: 'GET',
      // FIX: antes rejectUnauthorized:false. Este endpoint decide de dónde se
      // descarga el instalador; sin validar el certificado, un atacante en la red
      // podía responder con su propio downloadUrl y servir un .exe modificado.
      headers: { 'Content-Type': 'application/json' }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const latestVersion = parsed.fields?.latestVersion?.stringValue || null
          const downloadUrl   = parsed.fields?.downloadUrl?.stringValue   || null
          const releaseNotes  = parsed.fields?.releaseNotes?.stringValue  || null
          const currentVersion = app.getVersion()

          if (!latestVersion || !downloadUrl) {
            log('[Update] Respuesta incompleta desde Firestore')
            return resolve()
          }

          // FIX: sólo se acepta una URL de descarga https del dominio propio.
          // Antes bastaba con que empezara con "http" (lo validaba el frontend).
          let urlOk = false
          try {
            const u = new URL(downloadUrl)
            urlOk = u.protocol === 'https:' &&
                    (u.hostname === 'github.com' || u.hostname.endsWith('.github.com') ||
                     u.hostname === 'objects.githubusercontent.com')
          } catch { urlOk = false }

          if (!urlOk) {
            console.error('[Update] downloadUrl rechazada por no ser de un origen confiable')
            return resolve()
          }

          // FIX: comparación semver real en lugar de `!==`
          if (isNewerVersion(latestVersion, currentVersion)) {
            log(`[Update] Nueva versión disponible: ${latestVersion}`)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update-downloaded', {
                version: latestVersion,
                downloadUrl,
                releaseNotes: releaseNotes || 'Mejoras y correcciones'
              })
            }
          }
        } catch (err) {
          console.error('[Update] Error parseando respuesta:', err.message)
        }
        resolve()
      })
    })

    req.on('error', (err) => {
      log('[Update] Error de red:', err.message)
      resolve()
    })

    req.setTimeout(10000, () => {
      req.destroy()
      resolve()
    })

    req.end()
  })
}

autoUpdater.autoDownload = false
autoUpdater.on('error', (err) => console.error('[Updater] Error:', err.message))

// ========== EVENTOS DE APLICACIÓN ==========
app.whenReady().then(() => {
  // ── Identidad de la app ante Windows ──────────────────────────────────────
  //
  // Sin esto las notificaciones NO APARECEN en Windows 10/11. No fallan, no
  // tiran error: Windows las descarta en silencio, que es lo peor que puede
  // pasar cuando estás tratando de entender por que no suena nada.
  //
  // El motivo: Windows exige que cada notificacion venga de una app con
  // AppUserModelID, y que ese ID coincida con el de un acceso directo del menu
  // Inicio. El instalador NSIS crea el acceso directo con el appId de
  // package.json ("com.zenday.app"), pero en tiempo de ejecucion Electron usa
  // otro ID derivado de la ruta del .exe. Al no coincidir, el toast se pierde.
  //
  // En desarrollo no se nota, porque ahi Electron corre bajo el acceso directo
  // de Node y Windows es mas permisivo. Aparece solo en la app INSTALADA, que
  // es donde uno ya no esta mirando la consola.
  if (process.platform === 'win32') app.setAppUserModelId('com.zenday.app')

  zendaySession = session.fromPartition('persist:zenday')

  // La app no usa cámara, micrófono ni ubicación: antes se concedían
  // automáticamente `geolocation` y `media` a cualquier contenido cargado.
  //
  // El portapapeles SÍ hace falta: los botones de "Copiar ID" y "Copiar código
  // de negocio" usan navigator.clipboard.writeText. Al cerrar la lista de más
  // dejé esto afuera y el copiado empezó a tirar
  // `NotAllowedError: Write permission denied`.
  const PERMISOS_PERMITIDOS = new Set([
    'notifications',
    'clipboard-write',
    'clipboard-sanitized-write',
  ])
  const permissionHandler = (_webContents, permission, callback) => {
    callback(PERMISOS_PERMITIDOS.has(permission))
  }
  zendaySession.setPermissionRequestHandler(permissionHandler)
  session.defaultSession.setPermissionRequestHandler(permissionHandler)

  // Algunas versiones de Electron consultan el portapapeles por este otro
  // camino, que es sincrónico. Sin esto el permiso se deniega igual.
  const permissionCheck = (_wc, permission) => PERMISOS_PERMITIDOS.has(permission)
  zendaySession.setPermissionCheckHandler(permissionCheck)
  session.defaultSession.setPermissionCheckHandler(permissionCheck)

  setDataPath(app.getPath('userData'))
  licenseClient.setDataPath(app.getPath('userData'))
  documentStore.setRoot(app.getPath('userData'))

  registerIpcHandlers()
  createWindow()

  // ========== RECORDATORIOS (tareas locales) ==========
  // FIX: antes el intervalo arrancaba al cargar el módulo y seguía corriendo
  // aunque no hubiera ventana. Además comparaba la hora exacta (HH:MM), así que
  // si el tick se corría un segundo pasado el minuto el recordatorio se perdía
  // para siempre. Ahora se marca cada tarea ya notificada dentro del día.
  const notifiedToday = new Set()
  let lastDay = new Date().toDateString()

  reminderInterval = setInterval(() => {
    try {
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

      if (now.toDateString() !== lastDay) {
        notifiedToday.clear()
        lastDay = now.toDateString()
      }

      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const tasks = getTasks()

      tasks.forEach(task => {
        if (task.done || task.date !== today || !task.reminder) return
        if (notifiedToday.has(task.id)) return

        const [h, m] = String(task.reminder).split(':').map(Number)
        if (Number.isNaN(h)) return
        const taskMinutes = h * 60 + (m || 0)

        // Dispara si ya pasó la hora pero no hace más de 5 minutos:
        // tolera drift del intervalo y la app estando cerrada un rato.
        if (nowMinutes >= taskMinutes && nowMinutes - taskMinutes <= 5) {
          notifiedToday.add(task.id)
          new Notification({ title: '⏰ Recordatorio', body: String(task.title || '') }).show()
        }
      })
    } catch (err) {
      console.error('[Reminders] Error:', err.message)
    }
  }, 60000)
})

app.on('window-all-closed', () => {
  if (reminderInterval)     { clearInterval(reminderInterval);     reminderInterval = null }
  if (versionCheckInterval) { clearInterval(versionCheckInterval); versionCheckInterval = null }
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Una sola instancia. Se mantiene aunque ya no esté el bot de WhatsApp: dos
// ZenDay abiertos escriben en los mismos archivos de datos y en la misma
// licencia, y el último en guardar pisa al otro.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
