// electron/licenseManager.cjs
const crypto = require('crypto')
const os = require('os')
const fs = require('fs')
const path = require('path')

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SECRET = 'ZENDAY-SECRET-2024-XK9P' // Cambiá esto por algo tuyo y no lo compartas
const TRIAL_DAYS = 14

// ─── RUTAS CON VALOR POR DEFECTO (siempre disponibles) ────────────────────────
// En Windows: C:\Users\TU_USUARIO\AppData\Roaming\ZenDay\
// En macOS: ~/Library/Application Support/ZenDay/
// En Linux: ~/.config/ZenDay/
const getDefaultDataPath = () => {
  const homedir = os.homedir()
  switch (process.platform) {
    case 'win32':
      return path.join(homedir, 'AppData', 'Roaming', 'ZenDay')
    case 'darwin':
      return path.join(homedir, 'Library', 'Application Support', 'ZenDay')
    default:
      return path.join(homedir, '.config', 'ZenDay')
  }
}

const DEFAULT_DATA_PATH = getDefaultDataPath()
let LICENSE_FILE = path.join(DEFAULT_DATA_PATH, 'license.dat')
let TRIAL_FILE = path.join(DEFAULT_DATA_PATH, 'trial.dat')

function setDataPath(userDataPath) {
  LICENSE_FILE = path.join(userDataPath, 'license.dat')
  TRIAL_FILE = path.join(userDataPath, 'trial.dat')
  console.log('📁 DataPath actualizado:', userDataPath)
}

// Asegurar que la carpeta existe al inicio
try {
  const dir = path.dirname(LICENSE_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log('📁 Carpeta creada:', dir)
  }
} catch (err) {
  console.error('Error creando carpeta:', err)
}

// ─── HARDWARE ID ─────────────────────────────────────────────────────────────
function getHardwareId() {
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || '',
    os.totalmem().toString(),
  ].join('|')

  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16).toUpperCase()
}

// ─── GENERACIÓN DE CLAVE ──────────────────────────────────────────────────────
function generateKey(hardwareId, plan = 'professional') {
  const payload = `${hardwareId}:${plan}:${SECRET}`
  const hash = crypto.createHash('sha256').update(payload).digest('hex')
  const part1 = hash.substring(0, 4).toUpperCase()
  const part2 = hash.substring(4, 8).toUpperCase()
  const part3 = hash.substring(8, 12).toUpperCase()
  const part4 = hash.substring(12, 16).toUpperCase()
  return `ZENDAY-${part1}-${part2}-${part3}-${part4}`
}

function generateMasterKey() {
  const payload = `MASTER:${SECRET}`
  const hash = crypto.createHash('sha256').update(payload).digest('hex')
  const part1 = hash.substring(0, 4).toUpperCase()
  const part2 = hash.substring(4, 8).toUpperCase()
  const part3 = hash.substring(8, 12).toUpperCase()
  const part4 = hash.substring(12, 16).toUpperCase()
  return `ZENDAY-${part1}-${part2}-${part3}-${part4}`
}

// ─── VALIDACIÓN (ÚNICA VERSIÓN CORREGIDA) ─────────────────────────────────────
function validateKey(key, hardwareId) {
  if (!key || typeof key !== 'string') return { valid: false, plan: null }
  const normalized = key.trim().toUpperCase()
  const regex = /^ZENDAY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  if (!regex.test(normalized)) return { valid: false, plan: null }

  // Verificar planes professional y entrepreneur
  for (const plan of ['professional', 'entrepreneur']) {
    if (normalized === generateKey(hardwareId, plan)) return { valid: true, plan }
  }

  // Verificar clave MASTER
  if (normalized === generateMasterKey()) return { valid: true, plan: 'master' }

  return { valid: false, plan: null }
}

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
function saveLicense(key, plan) {
  try {
    const dir = path.dirname(LICENSE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const hwId = getHardwareId()
    const data = {
      key: key.trim().toUpperCase(),
      plan: plan,
      hwId: hwId,
      activatedAt: new Date().toISOString(),
      version: '1.0',
    }

    const encoded = Buffer.from(JSON.stringify(data)).toString('base64')
    fs.writeFileSync(LICENSE_FILE, encoded, 'utf8')
    console.log('✅ Licencia guardada en:', LICENSE_FILE)
    return true
  } catch (err) {
    console.error('❌ Error guardando licencia:', err)
    return false
  }
}

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null
    const encoded = fs.readFileSync(LICENSE_FILE, 'utf8')
    const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    return data
  } catch (err) {
    return null
  }
}

function deleteLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE)
    }
    return true
  } catch (err) {
    return false
  }
}

// ─── TRIAL ────────────────────────────────────────────────────────────────────
function getTrialInfo() {
  try {
    if (!fs.existsSync(TRIAL_FILE)) {
      const dir = path.dirname(TRIAL_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      const data = { startedAt: new Date().toISOString() }
      const encoded = Buffer.from(JSON.stringify(data)).toString('base64')
      fs.writeFileSync(TRIAL_FILE, encoded, 'utf8')
      return { active: true, daysLeft: TRIAL_DAYS }
    }

    const encoded = fs.readFileSync(TRIAL_FILE, 'utf8')
    const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    const startedAt = new Date(data.startedAt)
    const now = new Date()
    const diffMs = now - startedAt
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, TRIAL_DAYS - diffDays)

    return { active: daysLeft > 0, daysLeft: daysLeft, startedAt: data.startedAt }
  } catch (err) {
    console.error('Error leyendo trial:', err)
    return { active: false, daysLeft: 0 }
  }
}

// ─── API PRINCIPAL ────────────────────────────────────────────────────────────
function checkLicense() {
  const saved = loadLicense()
  if (saved) {
    const hwId = getHardwareId()
    const result = validateKey(saved.key, hwId)
    if (result.valid) {
      return { status: 'active', plan: result.plan, key: saved.key, activatedAt: saved.activatedAt }
    } else {
      deleteLicense()
    }
  }
  const trial = getTrialInfo()
  if (trial.active) return { status: 'trial', daysLeft: trial.daysLeft, plan: 'professional' }
  return { status: 'expired', plan: null }
}

function activateLicense(key) {
  if (!key?.trim()) return { success: false, message: 'Ingresá una clave de licencia.' }

  const hwId = getHardwareId()
  const result = validateKey(key, hwId)
  if (!result.valid) return { success: false, message: 'La clave no es válida para este dispositivo.' }

  const saved = saveLicense(key, result.plan)
  if (!saved) return { success: false, message: 'No se pudo guardar la licencia.' }

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
  deleteLicense,
  setDataPath,
}