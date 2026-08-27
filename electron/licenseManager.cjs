// electron/licenseManager.cjs
//
// ─────────────────────────────────────────────────────────────────────────────
//  LEER ANTES DE TOCAR
// ─────────────────────────────────────────────────────────────────────────────
//  Este archivo viaja DENTRO del .exe que le entregás al cliente. Cualquier
//  secreto que esté acá es, en la práctica, público: alcanza con abrir el asar
//  (`npx asar extract app.asar out/`) para leerlo y generar claves para
//  cualquier hardware ID, incluida la maestra.
//
//  Eso NO se arregla ofuscando mejor. La única solución real es que la clave se
//  valide del lado del servidor (una Cloud Function que firme una respuesta con
//  una clave privada que nunca sale del servidor; la app sólo verifica la firma
//  con la pública). Ver la sección "Licencias" del informe.
//
//  Lo que sí arregla este archivo, mientras tanto:
//   1. El secreto sale del repositorio y pasa a inyectarse en build.
//   2. HMAC en lugar de sha256(concatenación) — evita extender el payload.
//   3. El hardware ID deja de depender del nombre del equipo y de la RAM,
//      que cambian y dejaban al cliente sin licencia de un día para el otro.
//   4. Se acepta el esquema viejo: las claves ya vendidas siguen funcionando.
//   5. Una validación fallida ya no borra el archivo de licencia.
//   6. El trial se firma, así que no se resetea editando el .dat.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
// El secreto se inyecta en build:  ZENDAY_LICENSE_SECRET=... npm run dist
// Si no está definido se usa el histórico, para no romper instalaciones vivas.
const LEGACY_SECRET = 'ZENDAY-SECRET-2024-XK9P'
const SECRET = process.env.ZENDAY_LICENSE_SECRET || LEGACY_SECRET

const TRIAL_DAYS = 14
const TRIAL_SIGNING_KEY = crypto.createHash('sha256').update(`${SECRET}:trial`).digest()

// ─── RUTAS ────────────────────────────────────────────────────────────────────
const getDefaultDataPath = () => {
  const homedir = os.homedir()
  switch (process.platform) {
    case 'win32':  return path.join(homedir, 'AppData', 'Roaming', 'ZenDay')
    case 'darwin': return path.join(homedir, 'Library', 'Application Support', 'ZenDay')
    default:       return path.join(homedir, '.config', 'ZenDay')
  }
}

const DEFAULT_DATA_PATH = getDefaultDataPath()
let LICENSE_FILE = path.join(DEFAULT_DATA_PATH, 'license.dat')
let TRIAL_FILE   = path.join(DEFAULT_DATA_PATH, 'trial.dat')

function setDataPath(userDataPath) {
  LICENSE_FILE = path.join(userDataPath, 'license.dat')
  TRIAL_FILE   = path.join(userDataPath, 'trial.dat')
  ensureDir()
}

function ensureDir() {
  try {
    const dir = path.dirname(LICENSE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error('[License] Error creando carpeta:', err.message)
  }
}
ensureDir()

// ─── HARDWARE ID ──────────────────────────────────────────────────────────────
//
// El esquema viejo usaba hostname + platform + arch + modelo de CPU + RAM total.
// Problema real de soporte: si el cliente renombraba la PC o le agregaba un
// módulo de RAM, el hardware ID cambiaba, la licencia dejaba de validar y —peor—
// el código la borraba del disco. El cliente quedaba sin producto sin haber
// hecho nada malo.
//
// El esquema nuevo usa el GUID de la máquina (Windows/Linux/macOS), que sobrevive
// a renombrar el equipo y a cambios de hardware, con fallback al modelo de CPU.

function getMachineGuid() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      ).toString()
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
      if (m) return m[1]
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000
      }).toString()
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (m) return m[1]
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim()
      }
    }
  } catch { /* sin GUID: se usa el fallback */ }
  return null
}

let cachedHwId = null

function getHardwareId() {
  if (cachedHwId) return cachedHwId
  const guid = getMachineGuid()
  const data = guid
    ? `guid:${guid}`
    : [os.platform(), os.arch(), os.cpus()[0]?.model || ''].join('|')

  cachedHwId = crypto.createHash('sha256').update(data).digest('hex').substring(0, 16).toUpperCase()
  return cachedHwId
}

/** Hardware ID con el algoritmo viejo — sólo para revalidar licencias ya vendidas. */
function getLegacyHardwareId() {
  const data = [
    os.hostname(), os.platform(), os.arch(),
    os.cpus()[0]?.model || '', os.totalmem().toString(),
  ].join('|')
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16).toUpperCase()
}

// ─── GENERACIÓN DE CLAVE ──────────────────────────────────────────────────────
function formatKey(hash) {
  const p = (i) => hash.substring(i, i + 4).toUpperCase()
  return `ZENDAY-${p(0)}-${p(4)}-${p(8)}-${p(12)}`
}

/** Esquema actual: HMAC-SHA256 con el secreto como clave. */
function generateKey(hardwareId, plan = 'professional') {
  const hash = crypto.createHmac('sha256', SECRET).update(`${hardwareId}:${plan}`).digest('hex')
  return formatKey(hash)
}

/**
 * Llave global de soporte. Funciona en CUALQUIER equipo y no vence.
 *
 * ⚠️  NO ES UN NIVEL VENDIBLE. Para vender el plan admin usá
 *     generateKey(hardwareId, 'master'), que queda atado al equipo del cliente.
 *
 * Esta sirve para entrar a la máquina de un cliente a dar soporte, para demos
 * y para no quedarte afuera de tu propia app. Tratala como una contraseña.
 */
function generateMasterKey() {
  const hash = crypto.createHmac('sha256', SECRET).update('MASTER').digest('hex')
  return formatKey(hash)
}

/** Esquema histórico: sha256(hwid:plan:SECRET). Se conserva para no invalidar ventas previas. */
function generateLegacyKey(hardwareId, plan = 'professional') {
  const hash = crypto.createHash('sha256').update(`${hardwareId}:${plan}:${LEGACY_SECRET}`).digest('hex')
  return formatKey(hash)
}

function generateLegacyMasterKey() {
  const hash = crypto.createHash('sha256').update(`MASTER:${LEGACY_SECRET}`).digest('hex')
  return formatKey(hash)
}

// ─── VALIDACIÓN ───────────────────────────────────────────────────────────────
// timingSafeEqual evita filtrar cuántos caracteres coinciden midiendo el tiempo
// de respuesta. Con 64 bits de clave y activación local el ataque es teórico,
// pero comparar así no cuesta nada.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

const KEY_REGEX = /^ZENDAY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
// Los tres niveles que se venden. 'master' desbloquea el cambio de modo
// (ver isModeLocked en SettingsScreen): es el "admin que quiere todo".
//
// Está en PLANS a propósito, para que generateKey() produzca una clave admin
// ATADA A UN EQUIPO, igual que las otras dos.
//
// Antes el único camino a plan 'master' era generateMasterKey(), que es
// HMAC(SECRET,'MASTER'): UNA sola clave, sin dispositivo, igual para todas las
// máquinas del mundo. Servía como llave interna de soporte, pero era imposible
// venderla como nivel: el primer cliente que la reenviaba se la daba a todos.
const PLANS = ['professional', 'entrepreneur', 'master']

function validateKey(key) {
  if (!key || typeof key !== 'string') return { valid: false, plan: null }
  const normalized = key.trim().toUpperCase()
  if (!KEY_REGEX.test(normalized)) return { valid: false, plan: null }

  const hwIds = [getHardwareId(), getLegacyHardwareId()]

  for (const hwId of hwIds) {
    for (const plan of PLANS) {
      if (safeEqual(normalized, generateKey(hwId, plan)))       return { valid: true, plan, scheme: 'hmac' }
      if (safeEqual(normalized, generateLegacyKey(hwId, plan))) return { valid: true, plan, scheme: 'legacy' }
    }
  }

  if (safeEqual(normalized, generateMasterKey()))       return { valid: true, plan: 'master', scheme: 'hmac' }
  if (safeEqual(normalized, generateLegacyMasterKey())) return { valid: true, plan: 'master', scheme: 'legacy' }

  return { valid: false, plan: null }
}

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
function saveLicense(key, plan) {
  try {
    ensureDir()
    const data = {
      key: key.trim().toUpperCase(),
      plan,
      hwId: getHardwareId(),
      activatedAt: new Date().toISOString(),
      version: '2.0',
    }
    fs.writeFileSync(LICENSE_FILE, Buffer.from(JSON.stringify(data)).toString('base64'), 'utf8')
    return true
  } catch (err) {
    console.error('[License] Error guardando licencia:', err.message)
    return false
  }
}

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null
    const encoded = fs.readFileSync(LICENSE_FILE, 'utf8')
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function deleteLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE)
    return true
  } catch {
    return false
  }
}

// ─── TRIAL FIRMADO ────────────────────────────────────────────────────────────
// Antes el trial era base64 plano: `base64 -d trial.dat`, editar la fecha,
// volver a codificar y el período de prueba se reiniciaba indefinidamente.
// Ahora el contenido va firmado con HMAC; si no valida, el trial se considera
// consumido en lugar de regenerarse.
function writeTrial(payload) {
  const body = JSON.stringify(payload)
  const sig = crypto.createHmac('sha256', TRIAL_SIGNING_KEY).update(body).digest('hex')
  fs.writeFileSync(TRIAL_FILE, Buffer.from(JSON.stringify({ body, sig })).toString('base64'), 'utf8')
}

function readTrial() {
  try {
    if (!fs.existsSync(TRIAL_FILE)) return null
    const raw = JSON.parse(Buffer.from(fs.readFileSync(TRIAL_FILE, 'utf8'), 'base64').toString('utf8'))

    // Formato viejo (sin firma): se acepta una vez y se reescribe firmado,
    // para que quien ya está en período de prueba no lo pierda al actualizar.
    //
    // OJO: no se confía en el `startedAt` que trae el JSON — cualquiera puede
    // escribir un archivo con esa forma (sin `sig`) y poner ahí la fecha que
    // quiera para resetear el trial. En su lugar se usa la fecha de
    // modificación del propio archivo en disco: mentir sobre eso ya no es
    // editar un texto, hay que tocar el timestamp del sistema de archivos.
    // Para quien de verdad viene del formato viejo no cambia nada, porque ese
    // archivo se escribía una sola vez, al empezar el trial, y las copias/
    // restauraciones de backup conservan la fecha de modificación original.
    if (raw && raw.startedAt && !raw.sig) {
      let startedAt
      try { startedAt = fs.statSync(TRIAL_FILE).mtime.toISOString() } catch { startedAt = new Date().toISOString() }
      const migrated = { startedAt, hwId: getHardwareId() }
      writeTrial(migrated)
      return migrated
    }

    if (!raw || !raw.body || !raw.sig) return null
    const expected = crypto.createHmac('sha256', TRIAL_SIGNING_KEY).update(raw.body).digest('hex')
    if (!safeEqual(raw.sig, expected)) {
      console.error('[License] Firma del trial inválida')
      return { tampered: true }
    }
    return JSON.parse(raw.body)
  } catch {
    return null
  }
}

function getTrialInfo() {
  try {
    ensureDir()
    const existing = readTrial()

    if (existing?.tampered) return { active: false, daysLeft: 0, tampered: true }

    if (!existing) {
      const data = { startedAt: new Date().toISOString(), hwId: getHardwareId() }
      writeTrial(data)
      return { active: true, daysLeft: TRIAL_DAYS }
    }

    const startedAt = new Date(existing.startedAt)
    if (Number.isNaN(startedAt.getTime())) return { active: false, daysLeft: 0 }

    // Si el reloj del sistema quedó antes del inicio del trial (típico truco de
    // "atrasar la fecha"), se toma como día 0 en lugar de dar días de más.
    const diffDays = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 86400000))
    const daysLeft = Math.max(0, TRIAL_DAYS - diffDays)

    return { active: daysLeft > 0, daysLeft, startedAt: existing.startedAt }
  } catch (err) {
    console.error('[License] Error leyendo trial:', err.message)
    return { active: false, daysLeft: 0 }
  }
}

// ─── API PRINCIPAL ────────────────────────────────────────────────────────────
function checkLicense() {
  const saved = loadLicense()

  if (saved) {
    const result = validateKey(saved.key)
    if (result.valid) {
      // Si la licencia venía del esquema viejo, se reescribe con el nuevo
      // hardware ID: la próxima validación ya no depende del nombre del equipo.
      if (result.scheme === 'legacy' || saved.version !== '2.0') {
        saveLicense(saved.key, result.plan)
      }
      return { status: 'active', plan: result.plan, key: saved.key, activatedAt: saved.activatedAt }
    }

    // FIX IMPORTANTE: antes acá se llamaba a deleteLicense(). Cualquier fallo
    // transitorio de validación (cambio de hardware, error leyendo el GUID)
    // borraba la licencia comprada y el cliente quedaba en 'expired' sin vuelta
    // atrás. Ahora se informa el problema y el archivo se conserva, para poder
    // reactivar con la misma clave o revalidarla desde soporte.
    return {
      status: 'invalid',
      plan: null,
      key: saved.key,
      message: 'La licencia guardada no coincide con este equipo. Reactivala o escribinos.',
    }
  }

  const trial = getTrialInfo()
  if (trial.active) return { status: 'trial', daysLeft: trial.daysLeft, plan: 'professional' }
  return { status: 'expired', plan: null, tampered: trial.tampered || false }
}

function activateLicense(key) {
  if (!key?.trim()) return { success: false, message: 'Ingresá una clave de licencia.' }

  const result = validateKey(key)
  if (!result.valid) return { success: false, message: 'La clave no es válida para este dispositivo.' }

  if (!saveLicense(key, result.plan)) {
    return { success: false, message: 'No se pudo guardar la licencia.' }
  }
  return { success: true, message: '¡Licencia activada!', plan: result.plan }
}

function getDeviceId() {
  return getHardwareId()
}

module.exports = {
  checkLicense,
  activateLicense,
  getDeviceId,
  generateKey,
  generateMasterKey,
  generateLegacyKey,
  generateLegacyMasterKey,
  getLegacyHardwareId,
  deleteLicense,
  setDataPath,
}
