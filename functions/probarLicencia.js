/**
 * Prueba el sistema de licencias NUEVO sin desplegar nada.
 *
 *   node functions/probarLicencia.js              → esta máquina
 *   node functions/probarLicencia.js <ID>         → otro dispositivo
 *   node functions/probarLicencia.js --revocar    → borra la concesión
 *   node functions/probarLicencia.js --vencida    → concesión ya vencida
 *
 * Qué hace: usa tu zenday-private.pem para firmar una concesión igual a la que
 * emitiría la Cloud Function, y la deja donde la app la va a buscar. Después
 * abrís ZenDay y la licencia figura activa.
 *
 * Sirve para ver el circuito completo antes de gastar tiempo en el despliegue,
 * y para comprobar que la firma que produce tu clave privada es la que tu app
 * verifica con la pública. Si eso no coincide, no hay servidor que lo arregle.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const raiz = path.resolve(__dirname, '..')
const rutaPrivada = path.join(raiz, 'zenday-private.pem')
const rutaCliente = path.join(raiz, 'electron', 'licenseClient.cjs')

const args = process.argv.slice(2)
const deviceIdArg = args.find(a => !a.startsWith('--'))
const revocar = args.includes('--revocar')
const vencida = args.includes('--vencida')

const linea = '═'.repeat(68)

// ─── Carpeta de datos de la app ──────────────────────────────────────────────
// Antes se daba por sentado que era "ZenDay". No siempre: Electron usa el
// nombre de la app, que en desarrollo sale de `name` ("zenday") y en el .exe
// empaquetado de `productName` ("ZenDay"). En Windows da igual porque el disco
// no distingue mayúsculas, pero si la carpeta no es la correcta el script
// escribe la concesión en un lugar que la app nunca lee y no avisa de nada.
// Mejor buscarla de verdad.
function carpetaBase() {
  const home = os.homedir()
  switch (process.platform) {
    case 'win32':  return process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    case 'darwin': return path.join(home, 'Library', 'Application Support')
    default:       return process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  }
}

/** Devuelve { ruta, existe, uso } — `uso` dice si la app ya corrió ahí. */
function carpetaDatos() {
  const base = carpetaBase()
  const candidatas = ['ZenDay', 'zenday']

  try {
    for (const nombre of fs.readdirSync(base)) {
      if (/^zenday$/i.test(nombre) && !candidatas.includes(nombre)) candidatas.push(nombre)
    }
  } catch { /* no se pudo listar: seguimos con las dos de siempre */ }

  // La que ya tenga datos de la app gana: es la que la app está usando.
  for (const nombre of candidatas) {
    const p = path.join(base, nombre)
    if (fs.existsSync(path.join(p, 'trial.dat')) || fs.existsSync(path.join(p, 'license.dat'))) {
      return { ruta: p, existe: true, uso: true }
    }
  }
  for (const nombre of candidatas) {
    const p = path.join(base, nombre)
    if (fs.existsSync(p)) return { ruta: p, existe: true, uso: false }
  }
  return { ruta: path.join(base, 'ZenDay'), existe: false, uso: false }
}

const destino = carpetaDatos()
const rutaGrant = path.join(destino.ruta, 'license-grant.json')

// ─── Modo revocar ────────────────────────────────────────────────────────────
if (revocar) {
  if (fs.existsSync(rutaGrant)) {
    fs.unlinkSync(rutaGrant)
    console.log(`\n✅ Concesión borrada de ${rutaGrant}`)
    console.log('   Abrí ZenDay: la licencia ya no debería figurar activa.\n')
  } else {
    console.log('\n   No había ninguna concesión guardada.\n')
  }
  process.exit(0)
}

// ─── Comprobaciones previas ──────────────────────────────────────────────────
if (!fs.existsSync(rutaPrivada)) {
  console.error(`
⛔ No existe zenday-private.pem

   Generá el par primero:   node functions/generateKeys.js
`)
  process.exit(1)
}

// ─── ID del dispositivo ──────────────────────────────────────────────────────
// Sin argumento se calcula el de esta máquina, con el MISMO código que usa la
// app. Copiarlo a mano de una pantalla es donde se cuelan los errores.
const ES_DEVICE_ID = /^[0-9A-F]{16}$/
let deviceId
let propio = false

if (!deviceIdArg) {
  try {
    deviceId = require(path.join(raiz, 'electron', 'licenseManager.cjs')).getDeviceId()
    propio = true
  } catch (err) {
    console.error(`
⛔ No se pudo calcular el ID de esta máquina: ${err.message}

   Pasalo a mano:  node functions/probarLicencia.js <ID-del-dispositivo>
`)
    process.exit(1)
  }
} else {
  deviceId = deviceIdArg.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!ES_DEVICE_ID.test(deviceId)) {
    console.error(`
⛔ "${deviceIdArg}" no parece un ID de dispositivo.

   Son 16 caracteres hexadecimales (0-9 y A-F), por ejemplo A3F91C2D8B7E0456.
   Si lo que copiaste tiene guiones y letras como R, S, Z o V (por ejemplo
   1RSZ-34N5-608V), ese es el CÓDIGO DE NEGOCIO — es otra cosa.

   Para tu propia máquina no hace falta copiar nada:

       node functions/probarLicencia.js
`)
    process.exit(1)
  }
}

// ─── Firmar la concesión, igual que lo haría el servidor ─────────────────────
// Esta cadena tiene que coincidir EXACTA con la de licenseClient.cjs y la de
// functions/index.js. Un carácter de diferencia y la firma no valida.
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

const ahora = new Date()
const dias = n => new Date(ahora.getTime() + n * 86400000).toISOString()

const datos = {
  deviceId,
  plan: 'professional',
  emitidoEn: vencida ? dias(-10) : ahora.toISOString(),
  validoHasta: vencida ? dias(-3) : dias(7),
  licenciaHasta: null,
}

const priv = crypto.createPrivateKey(fs.readFileSync(rutaPrivada, 'utf8'))
const firma = crypto.sign(null, Buffer.from(payloadCanonico(datos), 'utf8'), priv).toString('base64')
const grant = { ...datos, firma, key: 'ZD-PRUEBA-LOCAL' }

// ─── Verificar con la MISMA clave pública que usa la app ─────────────────────
// Este es el punto del script: comprobar que la privada que tenés y la pública
// que quedó pegada en la app son realmente un par.
let pubOk = null
try {
  const src = fs.readFileSync(rutaCliente, 'utf8')
  const m = src.match(/const PUBLIC_KEY_PEM = `([\s\S]*?)`/)
  if (m && !m[1].includes('PEGAR_ACA')) {
    pubOk = crypto.verify(
      null,
      Buffer.from(payloadCanonico(datos), 'utf8'),
      crypto.createPublicKey(m[1].trim()),
      Buffer.from(firma, 'base64')
    )
  }
} catch (err) {
  console.error('No se pudo leer la clave pública de licenseClient.cjs:', err.message)
}

if (pubOk === false) {
  console.error(`
${linea}
⛔ LA CLAVE PRIVADA Y LA PÚBLICA NO SON UN PAR
${linea}

   La firma que produce zenday-private.pem no valida con la clave pública que
   está pegada en electron/licenseClient.cjs. Con esto, ninguna licencia va a
   funcionar por más que despliegues el servidor.

   Suele pasar si generaste el par dos veces, o si pegaste la pública a mano.
   Se arregla regenerando:

       node functions/generateKeys.js --forzar

   (ojo: eso invalida cualquier licencia ya emitida con el par anterior)
`)
  process.exit(1)
}

// ─── Escribir la concesión ───────────────────────────────────────────────────
fs.mkdirSync(destino.ruta, { recursive: true })
fs.writeFileSync(rutaGrant, JSON.stringify(grant, null, 2), 'utf8')

// ─── Estado del flag ─────────────────────────────────────────────────────────
let flagPuesto = false
try {
  flagPuesto = /const SERVIDOR_DESPLEGADO = true/.test(fs.readFileSync(rutaCliente, 'utf8'))
} catch { /* ignorar */ }

console.log(`\n${linea}`)
console.log(`  ✅ Concesión ${vencida ? 'VENCIDA ' : ''}firmada y guardada`)
console.log(linea)
console.log(`
  Dispositivo:  ${deviceId}${propio ? '   (esta máquina)' : ''}
  Plan:         professional
  Vence:        ${new Date(datos.validoHasta).toLocaleString('es-UY')}
  Archivo:      ${rutaGrant}

  Firma verificada contra la clave pública de la app:  ${pubOk === true ? '✅ SÍ' : '⚠️  no se pudo comprobar'}
`)

if (!destino.uso) {
  console.log(`  ⚠️  En esa carpeta no hay trial.dat ni license.dat, así que puede que
      no sea la que usa tu ZenDay. Si después de abrir la app la licencia
      sigue sin figurar activa, avisá y lo miramos.
`)
}
console.log(linea)

if (!flagPuesto) {
  console.log(`
  ⚠️  FALTA UN PASO PARA VERLO EN LA APP

  En electron/licenseClient.cjs, cambiá:

      const SERVIDOR_DESPLEGADO = false     →     true

  Después abrí ZenDay. La licencia tiene que figurar ACTIVA, sin internet y
  sin servidor: la app verifica la firma con su clave pública, nada más.

  ⚠️  Volvelo a false cuando termines de probar, hasta que despliegues de verdad.
`)
} else {
  console.log(`
  El flag ya está en true. Abrí ZenDay y la licencia debería figurar activa.

  Para probar el caso contrario:
      node functions/probarLicencia.js --revocar
`)
}
console.log(`${linea}\n`)
