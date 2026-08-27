import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, arrayUnion, arrayRemove } from 'firebase/firestore'
import { readFileSync } from 'fs'

const env = await initializeTestEnvironment({
  projectId: 'zenday-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
})

// ── Sembrar datos como si fueran dos consultorios reales ──────────────
const BIZ_A = 'AAAA-BBBB-CCCC'   // consultorio de Ana
const BIZ_B = 'DDDD-EEEE-FFFF'   // consultorio de Bruno
const BIZ_C = 'GGGG-HHHH-IIII'   // consultorio con roles: Clara, Pablo, Sofía

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'businesses', BIZ_A), { createdBy: 'ana', createdAt: 'x', members: ['ana'] })
  await setDoc(doc(db, 'businesses', BIZ_B), { createdBy: 'bruno', createdAt: 'x', members: ['bruno'] })
  await setDoc(doc(db, 'users', 'ana'),   { email: 'ana@x.com',   businessId: BIZ_A, isOwner: true })
  await setDoc(doc(db, 'users', 'bruno'), { email: 'bruno@x.com', businessId: BIZ_B, isOwner: true })
  await setDoc(doc(db, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'),
    { id: 'p1', name: 'Paciente de Ana', notes: 'confidencial' })
  await setDoc(doc(db, 'businesses', BIZ_B, 'data', 'professional', 'patients', 'p9'),
    { id: 'p9', name: 'Paciente de Bruno' })
  await setDoc(doc(db, 'config', 'app'), { latestVersion: '1.0.8', downloadUrl: 'https://github.com/x' })

  // Un tercer consultorio, éste CON roles: dueña, un profesional y la secretaria.
  await setDoc(doc(db, 'businesses', BIZ_C), {
    createdBy: 'clara', createdAt: 'x',
    members: ['clara', 'pablo', 'sofia'],
    roles: { clara: 'dueno', pablo: 'profesional', sofia: 'asistente' },
  })
  await setDoc(doc(db, 'businesses', BIZ_C, 'data', 'professional', 'patients', 'pc1'),
    { id: 'pc1', name: 'Paciente del consultorio', notes: 'lo que se hablo en sesion' })
  await setDoc(doc(db, 'businesses', BIZ_C, 'data', 'professional', 'appointments', 'ac1'),
    { id: 'ac1', patientName: 'Paciente', startTime: '2026-09-01T10:00' })
  await setDoc(doc(db, 'businesses', BIZ_C, 'data', 'professional', 'expenses', 'ec1'),
    { id: 'ec1', amount: 5000 })
})

const ana    = env.authenticatedContext('ana').firestore()
const bruno  = env.authenticatedContext('bruno').firestore()
const nadie  = env.unauthenticatedContext().firestore()
const clara  = env.authenticatedContext('clara').firestore()   // dueña
const pablo  = env.authenticatedContext('pablo').firestore()   // profesional
const sofia  = env.authenticatedContext('sofia').firestore()   // asistente

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  OK    ${name}`) }
  catch (e) { fail++; console.log(`  FALLA ${name}\n        ${e.message.split('\n')[0]}`) }
}

console.log('\n═══ AISLAMIENTO ENTRE NEGOCIOS (lo que importa) ═══')
await t('Ana lee sus propios pacientes',
  () => assertSucceeds(getDoc(doc(ana, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))
await t('Bruno NO puede leer los pacientes de Ana',
  () => assertFails(getDoc(doc(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))
await t('Bruno NO puede listar la colección de Ana',
  () => assertFails(getDocs(collection(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients'))))
await t('Bruno NO puede escribir en el negocio de Ana',
  () => assertFails(setDoc(doc(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'hack'), { name: 'x' })))
await t('Bruno NO puede borrar datos de Ana',
  () => assertFails(deleteDoc(doc(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))
await t('Sin login NO se lee nada',
  () => assertFails(getDoc(doc(nadie, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))

console.log('\n═══ MEMBRESÍA (joinBusiness / leaveBusiness) ═══')
await t('Bruno NO puede leer el documento del negocio de Ana',
  () => assertFails(getDoc(doc(bruno, 'businesses', BIZ_A))))
await t('Bruno NO puede EXPULSAR a Ana de su propio negocio',
  () => assertFails(updateDoc(doc(bruno, 'businesses', BIZ_A), { members: [] })))
await t('Bruno NO puede reescribir members de Ana a su antojo',
  () => assertFails(updateDoc(doc(bruno, 'businesses', BIZ_A), { members: ['bruno'] })))
await t('Bruno NO puede cambiar createdBy de Ana',
  () => assertFails(updateDoc(doc(bruno, 'businesses', BIZ_A), { createdBy: 'bruno' })))
await t('Bruno SÍ puede sumarse con el código (joinBusiness funciona)',
  () => assertSucceeds(updateDoc(doc(bruno, 'businesses', BIZ_A), { members: arrayUnion('bruno') })))
await t('Ya adentro, Bruno lee los datos compartidos',
  () => assertSucceeds(getDoc(doc(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))
await t('Bruno SÍ puede salirse (leaveBusiness funciona)',
  () => assertSucceeds(updateDoc(doc(bruno, 'businesses', BIZ_A), { members: arrayRemove('bruno') })))
await t('Al salir, Bruno pierde el acceso',
  () => assertFails(getDoc(doc(bruno, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))

console.log('\n═══ PERFILES DE USUARIO ═══')
await t('Ana lee su propio perfil',       () => assertSucceeds(getDoc(doc(ana, 'users', 'ana'))))
await t('Bruno NO lee el perfil de Ana',  () => assertFails(getDoc(doc(bruno, 'users', 'ana'))))
await t('Bruno NO escribe el perfil de Ana', () => assertFails(setDoc(doc(bruno, 'users', 'ana'), { businessId: BIZ_B }, { merge: true })))
await t('Nadie puede borrar perfiles',    () => assertFails(deleteDoc(doc(ana, 'users', 'ana'))))

console.log('\n═══ CONFIG DE VERSIÓN (main.cjs la lee sin login) ═══')
await t('Lectura pública de config/app',      () => assertSucceeds(getDoc(doc(nadie, 'config', 'app'))))
await t('NADIE puede escribir el downloadUrl', () => assertFails(setDoc(doc(ana, 'config', 'app'), { downloadUrl: 'https://malo.com/virus.exe' }, { merge: true })))

console.log('\n═══ OPERACIÓN NORMAL DE ZENDAY ═══')
for (const [mode, col] of [['professional','appointments'],['professional','products'],['entrepreneur','expenses'],['professional','audit']]) {
  await t(`Ana crea en ${mode}/${col}`,
    () => assertSucceeds(setDoc(doc(ana, 'businesses', BIZ_A, 'data', mode, col, 'n1'), { id: 'n1', valor: 1 })))
}
await t('Ana borra un registro propio',
  () => assertSucceeds(deleteDoc(doc(ana, 'businesses', BIZ_A, 'data', 'professional', 'appointments', 'n1'))))
await t('Colección no prevista queda cerrada',
  () => assertFails(setDoc(doc(ana, 'businesses', BIZ_A, 'data', 'professional', 'inventada', 'x'), { a: 1 })))
await t('Modo inventado queda cerrado',
  () => assertFails(setDoc(doc(ana, 'businesses', BIZ_A, 'data', 'otromodo', 'patients', 'x'), { a: 1 })))
await t('Ruta suelta en la raíz queda cerrada',
  () => assertFails(setDoc(doc(ana, 'cualquiercosa', 'x'), { a: 1 })))

// ═══════════════════════════════════════════════════════════════════════════
//  ROLES
//
//  El corte que importa: la secretaria agenda pero NO lee lo que se habló en
//  sesión. Sin esto, un consultorio con secretaria no puede usar ZenDay sin
//  que ella vea todas las historias clínicas.
// ═══════════════════════════════════════════════════════════════════════════
const HC   = ['businesses', BIZ_C, 'data', 'professional', 'patients', 'pc1']
const CITA = ['businesses', BIZ_C, 'data', 'professional', 'appointments', 'ac1']
const GAS  = ['businesses', BIZ_C, 'data', 'professional', 'expenses', 'ec1']

console.log('\n═══ ROLES: la asistente agenda pero no lee historias ═══')
await t('Sofía (asistente) ve la agenda',
  () => assertSucceeds(getDoc(doc(sofia, ...CITA))))
await t('Sofía puede agendar',
  () => assertSucceeds(setDoc(doc(sofia, 'businesses', BIZ_C, 'data', 'professional', 'appointments', 'nueva'),
    { id: 'nueva', patientName: 'X', startTime: '2026-09-02T09:00' })))
await t('Sofía puede cancelar una cita',
  () => assertSucceeds(deleteDoc(doc(sofia, 'businesses', BIZ_C, 'data', 'professional', 'appointments', 'nueva'))))
await t('Sofía NO abre una historia clínica',
  () => assertFails(getDoc(doc(sofia, ...HC))))
await t('Sofía NO lista los pacientes',
  () => assertFails(getDocs(collection(sofia, 'businesses', BIZ_C, 'data', 'professional', 'patients'))))
await t('Sofía NO escribe una historia clínica',
  () => assertFails(setDoc(doc(sofia, 'businesses', BIZ_C, 'data', 'professional', 'patients', 'px'), { name: 'x' })))
await t('Sofía NO borra un paciente',
  () => assertFails(deleteDoc(doc(sofia, ...HC))))
await t('Sofía NO ve los gastos',
  () => assertFails(getDoc(doc(sofia, ...GAS))))

console.log('\n═══ ROLES: el profesional ve historias, no la caja ═══')
await t('Pablo (profesional) abre una historia clínica',
  () => assertSucceeds(getDoc(doc(pablo, ...HC))))
await t('Pablo escribe en la historia',
  () => assertSucceeds(setDoc(doc(pablo, 'businesses', BIZ_C, 'data', 'professional', 'patients', 'pc2'), { id: 'pc2', name: 'Nuevo' })))
await t('Pablo ve la agenda',
  () => assertSucceeds(getDoc(doc(pablo, ...CITA))))
await t('Pablo NO ve los gastos del consultorio',
  () => assertFails(getDoc(doc(pablo, ...GAS))))
await t('Pablo NO lee la auditoría',
  () => assertFails(getDocs(collection(pablo, 'businesses', BIZ_C, 'data', 'professional', 'audit'))))

console.log('\n═══ ROLES: la dueña ve todo ═══')
await t('Clara abre una historia clínica',  () => assertSucceeds(getDoc(doc(clara, ...HC))))
await t('Clara ve los gastos',              () => assertSucceeds(getDoc(doc(clara, ...GAS))))
await t('Clara ve la agenda',               () => assertSucceeds(getDoc(doc(clara, ...CITA))))

console.log('\n═══ ROLES: nadie se asciende solo ═══')
await t('Sofía NO se pone a sí misma como dueña',
  () => assertFails(updateDoc(doc(sofia, 'businesses', BIZ_C), { roles: { clara: 'dueno', pablo: 'profesional', sofia: 'dueno' } })))
await t('Pablo NO se asciende a dueño',
  () => assertFails(updateDoc(doc(pablo, 'businesses', BIZ_C), { roles: { clara: 'dueno', pablo: 'dueno', sofia: 'asistente' } })))
await t('Clara SÍ puede cambiar los roles',
  () => assertSucceeds(updateDoc(doc(clara, 'businesses', BIZ_C), { roles: { clara: 'dueno', pablo: 'profesional', sofia: 'profesional' } })))

// Ésta es la prueba que decide si el rol MANDA de verdad.
//
// El emulador loguea "evaluation error" cuando estas reglas deniegan, y una
// regla que revienta también deniega. O sea que todos los assertFails de
// arriba podrían estar pasando por el motivo equivocado: no porque Sofía sea
// asistente, sino porque la expresión falla siempre. Si fuera así, ascenderla
// no cambiaría nada y seguiría sin poder abrir la historia.
//
// Acá Sofía acaba de pasar a 'profesional'. Si ahora SÍ puede, entonces lo que
// la bloqueaba era el rol.
await t('Sofía, ya ascendida a profesional, SÍ abre la historia (el rol es lo que mandaba)',
  () => assertSucceeds(getDoc(doc(sofia, ...HC))))
await t('...y ahora sí puede escribir en ella',
  () => assertSucceeds(setDoc(doc(sofia, 'businesses', BIZ_C, 'data', 'professional', 'patients', 'ps1'), { id: 'ps1', name: 'Alta por Sofia' })))
await t('...pero sigue sin ver la caja, que es sólo del dueño',
  () => assertFails(getDoc(doc(sofia, ...GAS))))

console.log('\n═══ ROLES: quien se suma sin rol asignado entra con el MÍNIMO ═══')
await t('Bruno se suma al consultorio de Clara con el código',
  () => assertSucceeds(updateDoc(doc(bruno, 'businesses', BIZ_C), { members: arrayUnion('bruno') })))
await t('...pero NO queda como dueño: no ve historias',
  () => assertFails(getDoc(doc(bruno, ...HC))))
await t('...ni ve la caja',
  () => assertFails(getDoc(doc(bruno, ...GAS))))
await t('...sí ve la agenda, como cualquier asistente',
  () => assertSucceeds(getDoc(doc(bruno, ...CITA))))

console.log('\n═══ COMPATIBILIDAD: los negocios SIN roles siguen igual ═══')
await t('Ana (negocio sin campo roles) sigue leyendo sus pacientes',
  () => assertSucceeds(getDoc(doc(ana, 'businesses', BIZ_A, 'data', 'professional', 'patients', 'p1'))))
await t('Ana sigue viendo sus gastos',
  () => assertSucceeds(setDoc(doc(ana, 'businesses', BIZ_A, 'data', 'entrepreneur', 'expenses', 'g1'), { id: 'g1', amount: 1 })))
await t('Ana sigue leyendo su auditoría',
  () => assertSucceeds(getDocs(collection(ana, 'businesses', BIZ_A, 'data', 'professional', 'audit'))))

console.log(`\n${pass} OK / ${fail} fallas\n`)
await env.cleanup()
process.exit(fail ? 1 : 0)
