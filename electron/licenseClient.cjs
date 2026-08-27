// electron/licenseClient.cjs
//
// ═══════════════════════════════════════════════════════════════════════════
//  Verificación de licencia contra el servidor.
//
//  La diferencia con el esquema viejo: acá NO hay ningún secreto. Sólo está la
//  clave PÚBLICA, que sirve para verificar firmas pero no para crearlas. Un
//  cliente puede leerla, copiarla y publicarla — no le sirve de nada, porque
//  para falsificar una licencia haría falta la privada, que sólo existe en tu
//  Cloud Function.
//
//  Funcionamiento:
//    1. La app manda { clave, deviceId } al servidor.
//    2. El servidor responde con una concesión FIRMADA, válida 7 días.
//    3. La app verifica la firma con la clave pública y guarda la concesión.
//    4. Mientras la concesión no venza, la app funciona SIN conexión.
//    5. Al vencer, se revalida. Si el servidor dice que no, se acabó.
//
//  Los 7 días de gracia son a propósito: un psicólogo tiene que poder trabajar
//  con el WiFi caído. Y si le revocás la licencia, deja de funcionar dentro de
//  la semana sin que tengas que hacer nada más.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const https = require('https')

// ─── CONFIGURACIÓN — completar después de desplegar ──────────────────────────

// Pegá acá la salida de `node functions/generateKeys.js` (la PÚBLICA).
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
PEGAR_ACA_LA_CLAVE_PUBLICA
-----END PUBLIC KEY-----`

// La URL que te devuelve `firebase deploy --only functions`.
const LICENSE_ENDPOINT = 'https://us-central1-zenday-297b3.cloudfunctions.net/validateLicense'

// ⚠️  PONER EN true RECIÉN DESPUÉS DE DESPLEGAR LA CLOUD FUNCTION.
//
// Sin este flag había un agujero: apenas corrías generateKeys.js, la clave
// pública quedaba pegada, `estaConfigurado()` daba true y la app empezaba a
// consultar un servidor que todavía no existía. Resultado: no se podía activar
// ninguna licencia hasta terminar el despliegue.
//
// La URL de arriba PARECE válida aunque no haya nada desplegado, así que no
// alcanza con mirarla: hace falta que vos confirmes que el deploy se hizo.
const SERVIDOR_DESPLEGADO = false

// ─────────────────────────────────────────────────────────────────────────────

let GRANT_FILE = null
function setDataPath(userDataPath) {
  GRANT_FILE = path.join(userDataPath, 'license-grant.json')
}

function estaConfigurado() {
  return SERVIDOR_DESPLEGADO
    && !PUBLIC_KEY_PEM.includes('PEGAR_ACA')
    && !LICENSE_ENDPOINT.includes('TU_PROYECTO')
}

/** Misma cadena que arma el servidor. Si difiere en un carácter, la firma no valida. */
function payloadCanonico({ deviceId, plan, emitidoEn, validoHasta, licenciaHasta }) {
  return [
    'zenday-v1',
    `device=${deviceId}`,
    `plan=${plan}`,
    `iat=${emitidoEn}`,
    `exp=${validoHasta}`,
    `lic=${licenciaHasta || 'perpetua'}`,
  ].join('|')
}

function verificarFirma(grant) {
  try {
    return crypto.verify(
      null,
      Buffer.from(payloadCanonico(grant), 'utf8'),
      crypto.createPublicKey(PUBLIC_KEY_PEM),
      Buffer.from(grant.firma, 'base64')
    )
  } catch (err) {
    console.error('[licenseClient] Error verificando la firma:', err.message)
    return false
  }
}

function guardarGrant(grant) {
  try {
    fs.mkdirSync(path.dirname(GRANT_FILE), { recursive: true })
    fs.writeFileSync(GRANT_FILE, JSON.stringify(grant), 'utf8')
    return true
  } catch (err) {
    console.error('[licenseClient] No se pudo guardar la concesión:', err.message)
    return false
  }
}

function leerGrant() {
  try {
    if (!GRANT_FILE || !fs.existsSync(GRANT_FILE)) return null
    return JSON.parse(fs.readFileSync(GRANT_FILE, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Valida la concesión guardada.
 * Editar el archivo a mano no sirve: cualquier cambio rompe la firma.
 */
function validarGrantLocal(deviceId) {
  const grant = leerGrant()
  if (!grant?.firma) return { valido: false, motivo: 'sin-concesion' }

  if (!verificarFirma(grant)) {
    console.error('[licenseClient] Firma inválida — el archivo fue alterado')
    return { valido: false, motivo: 'firma-invalida' }
  }
  // Que la concesión sea de ESTE equipo: si no, se copia el archivo y listo.
  if (String(grant.deviceId).toUpperCase() !== String(deviceId).toUpperCase()) {
    return { valido: false, motivo: 'otro-dispositivo' }
  }
  if (new Date(grant.validoHasta) < new Date()) {
    return { valido: false, motivo: 'vencida', grant }
  }
  if (grant.licenciaHasta && new Date(grant.licenciaHasta) < new Date()) {
    return { valido: false, motivo: 'licencia-vencida' }
  }

  return { valido: true, grant }
}

function pedirAlServidor(key, deviceId) {
  return new Promise((resolve) => {
    let url
    try { url = new URL(LICENSE_ENDPOINT) } catch { return resolve({ ok: false, error: 'red' }) }

    const body = JSON.stringify({ key, deviceId })
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      // rejectUnauthorized queda en true: acá viaja la licencia, no se toca.
    }, (res) => {
      let data = ''
      res.on('data', c => { data += c; if (data.length > 1e6) req.destroy() })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ ok: false, error: 'respuesta-invalida' }) }
      })
    })

    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'red' }) })
    req.on('error', () => resolve({ ok: false, error: 'red' }))
    req.write(body)
    req.end()
  })
}

/** Activación: el usuario pega la clave. Requiere internet una sola vez. */
async function activar(key, deviceId) {
  if (!estaConfigurado()) return { success: false, error: 'no-configurado' }

  const res = await pedirAlServidor(key, deviceId)

  if (res.error === 'red') {
    return { success: false, message: 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.' }
  }
  if (!res.ok) {
    return { success: false, message: res.error || 'La clave no es válida para este dispositivo.' }
  }
  // Nunca confiar en la respuesta sin verificar la firma: sin esto, alguien que
  // intercepte la red podría responder `{ok:true}` y activar cualquier cosa.
  if (!verificarFirma(res)) {
    return { success: false, message: 'La respuesta del servidor no es auténtica.' }
  }

  guardarGrant({ ...res, key })
  return { success: true, message: '¡Licencia activada!', plan: res.plan }
}

/**
 * Chequeo de arranque. Devuelve el estado y, si conviene, revalida en segundo
 * plano — nunca bloquea el inicio de la app esperando la red.
 */
async function verificar(deviceId) {
  if (!estaConfigurado()) return { estado: 'no-configurado' }

  const local = validarGrantLocal(deviceId)

  if (local.valido) {
    // Faltando menos de 2 días para vencer, se renueva sin molestar al usuario.
    const restan = (new Date(local.grant.validoHasta) - new Date()) / 86400000
    if (restan < 2 && local.grant.key) {
      pedirAlServidor(local.grant.key, deviceId).then(res => {
        if (res?.ok && verificarFirma(res)) guardarGrant({ ...res, key: local.grant.key })
      }).catch(() => { /* silencioso: la concesión actual todavía sirve */ })
    }
    return { estado: 'activa', plan: local.grant.plan, validoHasta: local.grant.validoHasta }
  }

  // Vencida: se intenta renovar. Si no hay red, se avisa pero no se bloquea
  // de golpe — el cliente puede estar en un consultorio sin internet.
  if (local.motivo === 'vencida' && local.grant?.key) {
    const res = await pedirAlServidor(local.grant.key, deviceId)
    if (res?.ok && verificarFirma(res)) {
      guardarGrant({ ...res, key: local.grant.key })
      return { estado: 'activa', plan: res.plan, validoHasta: res.validoHasta }
    }
    if (res?.error === 'red') {
      return { estado: 'sin-verificar', message: 'No pudimos verificar tu licencia. Conectate a internet en los próximos días.' }
    }
    return { estado: 'revocada', message: res?.error || 'Tu licencia ya no está activa.' }
  }

  return { estado: 'sin-licencia', motivo: local.motivo }
}

function borrar() {
  try {
    if (GRANT_FILE && fs.existsSync(GRANT_FILE)) fs.unlinkSync(GRANT_FILE)
    return true
  } catch { return false }
}

module.exports = {
  setDataPath, activar, verificar, borrar,
  estaConfigurado, verificarFirma, payloadCanonico, validarGrantLocal,
}
