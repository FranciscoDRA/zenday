/**
 * Emite una licencia del sistema NUEVO (claves ZD-, validadas contra el servidor).
 *
 *   node functions/nuevaLicencia.js <deviceId> [plan] [email]
 *
 * ⚠️  HAY DOS GENERADORES DE CLAVES. No son intercambiables:
 *
 *     electron/generateLicense.cjs   →  ZENDAY-XXXX-...   sistema actual
 *                                       Funciona hoy, sin desplegar nada.
 *
 *     functions/nuevaLicencia.js     →  ZD-XXXXX-...      sistema nuevo
 *       (este)                          Necesita la Cloud Function desplegada
 *                                       y SERVIDOR_DESPLEGADO = true.
 *
 * Si la app te dice "esta clave necesita el servidor de licencias", corriste
 * este script cuando te tocaba el otro.
 *
 * Ejemplos:
 *   node functions/nuevaLicencia.js A1B2C3D4E5F6G7H8
 *   node functions/nuevaLicencia.js A1B2C3D4E5F6G7H8 professional ana@consultorio.uy
 *   node functions/nuevaLicencia.js PENDIENTE professional ana@consultorio.uy
 *
 * El deviceId te lo pasa el cliente desde Ajustes → Licencia → ID del dispositivo.
 * (OJO: no es el 'ID de usuario' ni el 'código de negocio' — son tres cosas distintas.)
 * Si todavía no lo tenés (le vendiste antes de que instale), poné PENDIENTE:
 * la licencia se ata al primer equipo que la active.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUISITO: credenciales de administrador de Firebase.
 *
 *   npx --yes firebase-tools login
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\ruta\a\serviceAccountKey.json"
 *
 * La clave de servicio se baja de:
 *   Consola de Firebase → Configuración del proyecto → Cuentas de servicio
 *   → Generar nueva clave privada
 *
 * Ese archivo NO va al repositorio. Tratalo como zenday-private.pem.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(2)
const forzar = argv.includes('--igual') || argv.includes('--forzar')
const [deviceIdArg, planArg = 'professional', emailArg = ''] = argv.filter(a => !a.startsWith('--'))

// ─── ¿Sirve de algo la clave que estoy por emitir? ───────────────────────────
// Mientras SERVIDOR_DESPLEGADO esté en false, la app ni consulta al servidor:
// cualquier clave ZD- se rechaza. Emitirla igual y decir "✅ Licencia creada"
// es mentirte — y peor si se la mandás a un cliente que pagó.
function servidorListo() {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'licenseClient.cjs'), 'utf8')
    if (!/const SERVIDOR_DESPLEGADO = true/.test(src)) return false
    // Sólo el CONTENIDO de PUBLIC_KEY_PEM. Buscar 'PEGAR_ACA' en todo el
    // archivo daba siempre positivo: ese texto también está en la línea que
    // comprueba el placeholder. Con eso, esta función devolvía false para
    // siempre y el script se iba a negar a emitir claves incluso después
    // de desplegar bien.
    const m = src.match(/const PUBLIC_KEY_PEM = `([\s\S]*?)`/)
    return !!m && !m[1].includes('PEGAR_ACA')
  } catch {
    return null   // no se pudo leer: no afirmamos nada
  }
}

// El chequeo del servidor va DESPUÉS de validar los argumentos: si además de
// faltar el despliegue pegaste el código de negocio, conviene que te enteres
// del error concreto y no del genérico.
function frenarSiNoHayServidor() {
  if (servidorListo() !== false || forzar) return
  console.error(`
⛔ EL SERVIDOR DE LICENCIAS TODAVÍA NO ESTÁ DESPLEGADO

   En electron/licenseClient.cjs, SERVIDOR_DESPLEGADO está en false. Con eso,
   la app rechaza CUALQUIER clave ZD- sin siquiera consultar al servidor.
   La clave que iba a generar acá no te serviría para nada.

   ── Si querés entrar a la app ahora ────────────────────────────────────
      node electron/generateLicense.cjs

      Te da una clave ZENDAY-... que funciona hoy, sin desplegar nada.
      Sin argumentos usa el ID de esta máquina.

   ── Si querés probar el sistema nuevo sin desplegarlo ──────────────────
      node functions/probarLicencia.js

      Firma una concesión con tu clave privada y la deja donde la app la
      busca. Después ponés SERVIDOR_DESPLEGADO = true y abrís ZenDay.

   ── Si igual querés emitir la clave (para tenerla lista) ───────────────
      node functions/nuevaLicencia.js ${deviceIdArg || '<deviceId>'} --igual

      Queda guardada en Firestore y va a empezar a funcionar en cuanto
      despliegues. Hasta entonces, no se la mandes a nadie.
`)
  process.exit(1)
}

if (!deviceIdArg) {
  console.error(`
Uso:  node functions/nuevaLicencia.js <deviceId> [plan] [email]

  deviceId   Ajustes → Licencia → ID del dispositivo. 16 caracteres, sin guiones.
             Poné PENDIENTE si todavía no lo tenés.
  plan       professional (por defecto) | entrepreneur
  email      Opcional, para que sepas de quién es cada clave.
`)
  process.exit(1)
}

// Se limpian espacios y guiones: el cliente copia y pega, y a veces el
// portapapeles arrastra formato. Mejor aceptar que rechazar por un guion.
const deviceId = deviceIdArg.trim().toUpperCase().replace(/[\s-]/g, '')
const plan = planArg.trim().toLowerCase()

if (!['professional', 'entrepreneur'].includes(plan)) {
  console.error(`⛔ Plan inválido: "${plan}". Usá professional o entrepreneur.`)
  process.exit(1)
}

// La confusión más común: pegar el CÓDIGO DE NEGOCIO en vez del ID de
// dispositivo. Los dos se copian desde Ajustes y se parecen. El código de
// negocio tiene forma XXXX-XXXX-XXXX; el ID son 16 caracteres sin guiones.
if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceIdArg.trim().toUpperCase())) {
  console.error(`
⛔ "${deviceIdArg.trim().toUpperCase()}" es el CÓDIGO DE NEGOCIO, no el ID del dispositivo.

   Son dos cosas distintas y las dos se copian desde Ajustes:

     Código de negocio   XXXX-XXXX-XXXX      para que alguien se sume a tu negocio
     ID de dispositivo   16 caracteres       para emitir una licencia   ← este

   El ID del dispositivo está en Ajustes → sección Licencia → "ID del dispositivo".
   Desde la última versión aparece escrito en pantalla, debajo de la etiqueta.
`)
  process.exit(1)
}

if (deviceId !== 'PENDIENTE' && !/^[A-Z0-9]{8,64}$/.test(deviceId)) {
  console.error(`
⛔ "${deviceIdArg}" no tiene forma de ID de dispositivo.

   Se espera algo como: A1B2C3D4E5F6G7H8
   (entre 8 y 64 caracteres, sólo letras y números)

   Lo sacás de la app: Ajustes → Licencia → ID del dispositivo.
   Si todavía no lo tenés porque el cliente no instaló, poné PENDIENTE:

     node functions/nuevaLicencia.js PENDIENTE professional cliente@mail.com
`)
  process.exit(1)
}

// Los argumentos están bien. Ahora sí: ¿esta clave va a servir de algo?
frenarSiNoHayServidor()

/**
 * Clave legible por teléfono: sin I, O, 0 ni 1, que se confunden al dictarlas.
 * 20 caracteres del alfabeto de 32 = 100 bits de entropía. No se adivina.
 */
function generarClave() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(20)
  const chars = Array.from(bytes, b => alfabeto[b % alfabeto.length])
  const grupo = i => chars.slice(i * 5, i * 5 + 5).join('')
  return `ZD-${grupo(0)}-${grupo(1)}-${grupo(2)}-${grupo(3)}`
}

const clave = generarClave()

const doc = {
  deviceId: deviceId === 'PENDIENTE' ? '' : deviceId,
  plan,
  activo: true,
  expiresAt: null,          // null = perpetua. Para suscripción: '2027-01-01T00:00:00.000Z'
  email: emailArg.trim(),
  createdAt: new Date().toISOString(),
}

async function main() {
  let admin
  try {
    admin = require('firebase-admin')
  } catch {
    console.log('\n⚠️  firebase-admin no está instalado acá.')
    console.log('   Instalalo con:  cd functions && npm install\n')
    console.log('   Mientras tanto, creá el documento a mano en la consola de Firebase:\n')
    console.log(`   Colección: licenses`)
    console.log(`   ID del documento: ${clave}`)
    console.log(`   Campos:`)
    console.log(JSON.stringify(doc, null, 4).split('\n').map(l => '     ' + l).join('\n'))
    console.log(`\n   La clave es:\n\n     ${clave}\n`)
    if (servidorListo() === false) {
      console.log(`   ⚠️  NO se la mandes a nadie todavía: SERVIDOR_DESPLEGADO está`)
      console.log(`      en false y hoy la app la rechaza.\n`)
    } else {
      console.log(`   Mandásela al cliente una vez creado el documento.\n`)
    }
    return
  }

  try {
    if (!admin.apps.length) admin.initializeApp()
    await admin.firestore().collection('licenses').doc(clave).set(doc)
  } catch (err) {
    console.error('\n⛔ No se pudo escribir en Firestore:', err.message)
    console.error('\n   Casi siempre falta la credencial de administrador:')
    console.error('     $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\ruta\\serviceAccountKey.json"')
    console.error('\n   O creá el documento a mano en la consola:')
    console.error(`     licenses/${clave}`)
    console.error(JSON.stringify(doc, null, 2))
    process.exit(1)
  }

  const linea = '═'.repeat(64)
  console.log(`\n${linea}`)
  console.log('  ✅ Licencia creada')
  console.log(linea)
  console.log(`\n  Clave para el cliente:\n\n     ${clave}\n`)
  console.log(`  Plan:        ${plan}`)
  console.log(`  Dispositivo: ${doc.deviceId || 'sin atar — se fija en la primera activación'}`)
  if (doc.email) console.log(`  Cliente:     ${doc.email}`)
  console.log(`\n${linea}`)
  console.log('  Para dar de baja esta licencia más adelante, poné activo: false')
  console.log(`  en el documento licenses/${clave}. El cliente deja de poder`)
  console.log('  usar la app dentro de los 7 días.')
  console.log(`${linea}`)

  if (servidorListo() === false) {
    console.log(`
  ⚠️  TODAVÍA NO SE LA MANDES A NADIE

  SERVIDOR_DESPLEGADO sigue en false: hoy esta clave se rechaza. Va a
  empezar a funcionar cuando despliegues la Cloud Function y pongas ese
  flag en true.
${linea}`)
  }
  console.log('')
}

main()
