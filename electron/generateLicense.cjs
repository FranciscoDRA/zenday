// electron/generateLicense.cjs
//
// Genera claves del sistema de licencias ACTUAL (las que empiezan con ZENDAY-).
// Funciona hoy, sin desplegar nada.
//
// LOS TRES NIVELES QUE VENDÉS
//
//   professional    Agenda, clientes, finanzas. Queda encerrado en modo profesional.
//   entrepreneur    Pedidos, stock, integraciones. Encerrado en modo emprendedor.
//   admin           Los dos, y puede cambiar de modo cuando quiera.
//
// Las tres quedan atadas al equipo del cliente: sólo funcionan en esa máquina.
//
// Uso:
//   node electron/generateLicense.cjs                        → esta máquina, professional
//   node electron/generateLicense.cjs admin                  → esta máquina, admin
//   node electron/generateLicense.cjs <ID-del-cliente>       → su equipo, professional
//   node electron/generateLicense.cjs <ID-del-cliente> admin → su equipo, admin
//   node electron/generateLicense.cjs --soporte              → llave global (NO se vende)

const { generateKey, generateMasterKey, getDeviceId } = require('./licenseManager.cjs')

const args = process.argv.slice(2)
const linea = '─'.repeat(68)

// 'admin' es el nombre comercial; adentro el plan se llama 'master'.
// Se aceptan los dos para no romper nada de lo que ya exista.
const ALIAS_PLAN = {
  professional: 'professional',
  profesional:  'professional',
  entrepreneur: 'entrepreneur',
  emprendedor:  'entrepreneur',
  admin:        'master',
  master:       'master',
}
const NOMBRE_VISIBLE = { professional: 'professional', entrepreneur: 'entrepreneur', master: 'admin' }

// ── Llave global de soporte ──────────────────────────────────────────────────
if (args.includes('--soporte') || args.includes('--global')) {
  console.log(`\n${linea}`)
  console.log('  🔑 LLAVE GLOBAL DE SOPORTE')
  console.log(linea)
  console.log(`\n     ${generateMasterKey()}\n`)
  console.log(`  Funciona en CUALQUIER equipo y no vence.

  ⚠️  ESTA NO SE VENDE. Es para entrar a la máquina de un cliente a dar
      soporte, para demos, y para no quedarte afuera de tu propia app.

      Si se la das a un cliente, le funciona a él y a cualquiera a quien
      se la reenvíe. Para vender el nivel admin:

          node electron/generateLicense.cjs <ID-del-cliente> admin

      Esa queda atada al equipo de esa persona.
`)
  console.log(`${linea}\n`)
  process.exit(0)
}

// ── Separar el plan del ID, venga en el orden que venga ──────────────────────
const esPlan = (a) => ALIAS_PLAN[String(a).toLowerCase()] !== undefined
const planArg = args.find(esPlan)
const plan = planArg ? ALIAS_PLAN[planArg.toLowerCase()] : 'professional'
const idArg = args.find(a => !esPlan(a) && !a.startsWith('--'))

// ── Validar el ID, o calcular el de esta máquina ─────────────────────────────
// El ID del dispositivo son 16 caracteres hexadecimales. El "código de negocio"
// que aparece en Ajustes tiene otra forma (ej: 1RSZ-34N5-608V) y no sirve acá:
// generar una clave con él da una clave que la app va a rechazar, sin decir por
// qué. Mejor frenar antes.
const ES_DEVICE_ID = /^[0-9A-F]{16}$/

let deviceId
let propio = false

if (!idArg) {
  deviceId = getDeviceId()
  propio = true
} else {
  const limpio = idArg.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!ES_DEVICE_ID.test(limpio)) {
    console.error(`
⛔ "${idArg}" no parece un ID de dispositivo.

   El ID son 16 caracteres hexadecimales (0-9 y A-F), por ejemplo:
       A3F91C2D8B7E0456

   Si lo que copiaste tiene guiones y letras como R, S, Z o V
   (por ejemplo 1RSZ-34N5-608V), ese es el CÓDIGO DE NEGOCIO, que es
   otra cosa. El ID del dispositivo está en:

       Ajustes → Licencia → ID del dispositivo

   Y si la clave es para tu propia máquina, no hace falta copiar nada:

       node electron/generateLicense.cjs
`)
    process.exit(1)
  }
  deviceId = limpio
}

// ── Generar ──────────────────────────────────────────────────────────────────
const key = generateKey(deviceId, plan)
const visible = NOMBRE_VISIBLE[plan]

const QUE_HABILITA = {
  professional: 'Agenda, clientes y finanzas. Queda en modo profesional.',
  entrepreneur: 'Pedidos, stock e integraciones. Queda en modo emprendedor.',
  master:       'Los dos modos, y puede cambiar entre ellos cuando quiera.',
}

console.log(`\n${linea}`)
console.log(`  ✅ Clave generada`)
console.log(linea)
console.log(`
  Dispositivo:  ${deviceId}${propio ? '   (esta máquina)' : ''}
  Nivel:        ${visible}
  Habilita:     ${QUE_HABILITA[plan]}

  CLAVE:        ${key}
`)
console.log(linea)

if (propio) {
  console.log(`
  Pegala en ZenDay: pantalla de licencia → Activar.
  Sólo vale para ESTA computadora. Para un cliente, pedile su ID:

      node electron/generateLicense.cjs <ID-del-cliente> ${visible}
`)
} else {
  console.log(`
  📧 Mandale esta clave al cliente. Sólo funciona en su equipo:
     si la reenvía a otra persona, no le va a servir.
`)
}

if (process.env.ZENDAY_LICENSE_SECRET) {
  console.log(`  ℹ️  Generada con el secreto de ZENDAY_LICENSE_SECRET.
     La app tiene que estar compilada con ESE MISMO secreto o va a
     rechazar la clave.\n`)
}
console.log(`${linea}\n`)
