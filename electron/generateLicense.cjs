// electron/generateLicense.cjs
// Usá este script para generar claves cuando vendas una licencia
//
// Uso:
//   node electron/generateLicense.cjs <hardware-id> <plan>
//   node electron/generateLicense.cjs master
//
// Ejemplos:
//   node electron/generateLicense.cjs A1B2C3D4E5F6G7H8 professional
//   node electron/generateLicense.cjs A1B2C3D4E5F6G7H8 entrepreneur
//   node electron/generateLicense.cjs master

const { generateKey, generateMasterKey } = require('./licenseManager.cjs')

const arg = process.argv[2]
const plan = process.argv[3] || 'professional'

if (!arg) {
  console.log('\n❌ Falta el hardware ID.\n')
  console.log('Uso:')
  console.log('  node electron/generateLicense.cjs <hardware-id> <plan>')
  console.log('  node electron/generateLicense.cjs master\n')
  console.log('Planes disponibles: professional | entrepreneur\n')
  process.exit(1)
}

if (arg.toLowerCase() === 'master') {
  const key = generateMasterKey()
  console.log('\n🔑 Clave maestra (funciona en cualquier dispositivo):')
  console.log(`   ${key}\n`)
  console.log('⚠️  Guardala en un lugar seguro. No la compartas.\n')
} else {
  const key = generateKey(arg.toUpperCase(), plan)
  console.log(`\n✅ Clave ${plan} para dispositivo ${arg.toUpperCase()}:`)
  console.log(`   ${key}\n`)
  console.log('📧 Enviá esta clave al cliente.\n')
}
