/**
 * Genera el par de claves del sistema de licencias. Se corre UNA SOLA VEZ.
 *
 *   node functions/generateKeys.js
 *
 * Qué hace:
 *   · Escribe zenday-private.pem en la raíz del proyecto (ya está en .gitignore)
 *   · Pega la clave pública dentro de electron/licenseClient.cjs automáticamente
 *
 * Se hace así y no copiando a mano porque un PEM son varias líneas y un solo
 * salto de línea mal pegado rompe la firma sin ningún mensaje útil.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const raiz = path.resolve(__dirname, '..')
const rutaPrivada = path.join(raiz, 'zenday-private.pem')
const rutaCliente = path.join(raiz, 'electron', 'licenseClient.cjs')

// ── No pisar un par existente sin avisar ─────────────────────────────────────
if (fs.existsSync(rutaPrivada) && !process.argv.includes('--forzar')) {
  console.error('\n⛔ Ya existe zenday-private.pem\n')
  console.error('   Si generás un par nuevo, TODAS las licencias que vendiste')
  console.error('   dejan de validar. Los clientes tendrían que reactivar.\n')
  console.error('   Si igual querés reemplazarlo:  node functions/generateKeys.js --forzar\n')
  process.exit(1)
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' })
const pub = publicKey.export({ type: 'spki', format: 'pem' })

// ── Verificar el par antes de escribir nada ──────────────────────────────────
const prueba = Buffer.from('prueba-de-firma', 'utf8')
const firma = crypto.sign(null, prueba, privateKey)
if (!crypto.verify(null, prueba, publicKey, firma)) {
  console.error('⛔ El par generado no verifica. No se escribió nada.')
  process.exit(1)
}

// ── Guardar la privada ───────────────────────────────────────────────────────
fs.writeFileSync(rutaPrivada, priv, { encoding: 'utf8', mode: 0o600 })

// ── Pegar la pública en el cliente ───────────────────────────────────────────
let clienteOk = false
try {
  let src = fs.readFileSync(rutaCliente, 'utf8')
  const antes = src
  src = src.replace(
    /const PUBLIC_KEY_PEM = `[\s\S]*?`/,
    'const PUBLIC_KEY_PEM = `' + pub.trim() + '`'
  )
  if (src !== antes) {
    fs.writeFileSync(rutaCliente, src, 'utf8')
    clienteOk = true
  }
} catch (err) {
  console.error('No se pudo escribir licenseClient.cjs:', err.message)
}

// ── Instrucciones ────────────────────────────────────────────────────────────
const linea = '═'.repeat(70)
console.log(`\n${linea}`)
console.log('  ✅ Par de claves generado y verificado')
console.log(linea)
console.log(`\n  Privada  →  zenday-private.pem   (NO la subas a git, ya está ignorada)`)
console.log(`  Pública  →  electron/licenseClient.cjs   ${clienteOk ? '✅ pegada' : '⚠️  pegala a mano'}`)

if (!clienteOk) {
  console.log('\n  No pude modificar licenseClient.cjs. Pegá esto en PUBLIC_KEY_PEM:\n')
  console.log(pub)
}

console.log(`\n${linea}`)
console.log('  LO QUE SIGUE')
console.log(linea)
console.log(`
  1. Cargar la privada como secreto en Firebase (PowerShell):

       Get-Content zenday-private.pem | npx --yes firebase-tools functions:secrets:set ZENDAY_PRIVATE_KEY

     (en Mac o Linux:  cat zenday-private.pem | npx --yes firebase-tools functions:secrets:set ZENDAY_PRIVATE_KEY)

  2. Desplegar la función:

       cd functions
       npm install
       cd ..
       npx --yes firebase-tools deploy --only functions

  3. En electron/licenseClient.cjs:
       · poner la URL que imprimió el deploy en LICENSE_ENDPOINT
       · cambiar  const SERVIDOR_DESPLEGADO = false   a   true

     Hasta que ese flag esté en true, la app sigue usando el sistema de
     licencias anterior. Es a propósito: así generar las claves no rompe
     nada mientras terminás el despliegue.

  4. Para vender una licencia:

       node functions/nuevaLicencia.js <ID-del-dispositivo> [plan] [email]

     El ID se lo pedís al cliente: Ajustes → Copiar ID de usuario.
`)
console.log(linea)
console.log('  ⚠️  GUARDÁ zenday-private.pem EN UN LUGAR SEGURO')
console.log('      Si la perdés, no podés emitir más licencias.')
console.log('      Si se filtra, cualquiera puede emitirlas.')
console.log(`${linea}\n`)
