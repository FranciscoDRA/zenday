/**
 * Reglas de la Realtime Database, probadas contra el emulador.
 *
 *   npm run test:rtdb
 *
 * El agujero que cierra esto: con las reglas anteriores, el acceso a un negocio
 * se decidía leyendo un campo que el PROPIO usuario podía escribir.
 *
 *     "users":  { "$userId": { ".write": "$userId === auth.uid" } }
 *     "zenday": { "$businessId": {
 *        ".read": "root.child('users').child(auth.uid).child('businessId').val() === $businessId"
 *     }}
 *
 * O sea: cualquiera que se registrara podía escribir en SU propio nodo
 *
 *     users/{su-uid}/businessId = "<el negocio de otro>"
 *
 * y con eso ganaba lectura y escritura completas sobre las historias clínicas
 * de ese negocio. Una escritura, un campo, acceso total.
 *
 * Ahora la pertenencia la declara el negocio (zenday/$id/members/$uid), que
 * sólo pueden tocar los miembros que ya están adentro.
 */

import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing'
import { ref, get, set } from 'firebase/database'
import fs from 'fs'
import assert from 'assert'

const NEGOCIO_A = 'negocio-a'
const NEGOCIO_B = 'negocio-b'
const ANA   = 'uid-ana'      // miembro del negocio A
const BRUNO = 'uid-bruno'    // autenticado, de ningún negocio

let pasaron = 0, fallaron = 0
async function prueba(nombre, fn) {
  try { await fn(); pasaron++; console.log(`  ✔ ${nombre}`) }
  catch (e) { fallaron++; console.log(`  ✘ ${nombre}\n      ${e.message}`) }
}

const env = await initializeTestEnvironment({
  projectId: 'zenday-rtdb-test',
  database: { rules: fs.readFileSync('database.rules.json', 'utf8') },
})

// Estado inicial, saltando las reglas: Ana es miembro del A, hay datos en los dos.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.database()
  await set(ref(db, `zenday/${NEGOCIO_A}/members/${ANA}`), true)
  await set(ref(db, `zenday/${NEGOCIO_A}/patients/p1`), { name: 'Paciente del A' })
  await set(ref(db, `zenday/${NEGOCIO_B}/members/uid-otro`), true)
  await set(ref(db, `zenday/${NEGOCIO_B}/patients/p9`), { name: 'Paciente del B' })
  await set(ref(db, 'productos/prod-1'), { nombre: 'Oso', stock: 3 })
})

const comoAna   = env.authenticatedContext(ANA).database()
const comoBruno = env.authenticatedContext(BRUNO).database()
const sinLogin  = env.unauthenticatedContext().database()

console.log('\nEL AGUJERO PRINCIPAL: elegirse el negocio a mano')

await prueba('Bruno puede escribir su propio nodo users (eso está bien)', async () => {
  await assertSucceeds(set(ref(comoBruno, `users/${BRUNO}`), {
    businessId: NEGOCIO_A, email: 'bruno@mail.com',
  }))
})

await prueba('...pero eso NO le da acceso al negocio A', async () => {
  // Con las reglas viejas, esta lectura funcionaba.
  await assertFails(get(ref(comoBruno, `zenday/${NEGOCIO_A}/patients`)))
})

await prueba('...ni le deja escribir en el negocio A', async () => {
  await assertFails(set(ref(comoBruno, `zenday/${NEGOCIO_A}/patients/p2`), { name: 'Intruso' }))
})

await prueba('...ni sumarse solo a la lista de miembros', async () => {
  await assertFails(set(ref(comoBruno, `zenday/${NEGOCIO_A}/members/${BRUNO}`), true))
})

console.log('\nEL DUEÑO SIGUE PUDIENDO TRABAJAR')

await prueba('Ana lee los pacientes de su negocio', async () => {
  await assertSucceeds(get(ref(comoAna, `zenday/${NEGOCIO_A}/patients`)))
})

await prueba('Ana crea un paciente en su negocio', async () => {
  await assertSucceeds(set(ref(comoAna, `zenday/${NEGOCIO_A}/patients/p2`), { name: 'Nuevo' }))
})

await prueba('Ana puede sumar a otra persona a SU negocio', async () => {
  await assertSucceeds(set(ref(comoAna, `zenday/${NEGOCIO_A}/members/${BRUNO}`), true))
})

await prueba('nadie se adueña de un negocio que todavía no tiene miembros', async () => {
  // Sin esta guarda, quien adivinara un businessId sin nodo `members` se
  // anotaba solo y se quedaba con todo. El primer miembro se siembra a mano
  // desde la consola de Firebase o con clave de servicio.
  await assertFails(set(ref(comoBruno, 'zenday/negocio-vacio/members/' + BRUNO), true))
})

await prueba('Ana NO puede leer el negocio de otro', async () => {
  await assertFails(get(ref(comoAna, `zenday/${NEGOCIO_B}/patients`)))
})

console.log('\nSIN LOGIN NO SE VE NADA')

await prueba('un anónimo no lee los pacientes', async () => {
  await assertFails(get(ref(sinLogin, `zenday/${NEGOCIO_A}/patients`)))
})

await prueba('un anónimo no lee la raíz', async () => {
  await assertFails(get(ref(sinLogin, '/')))
})

console.log('\nLOS DATOS TIENEN QUE TENER FORMA')

await prueba('un paciente sin nombre se rechaza', async () => {
  await assertFails(set(ref(comoAna, `zenday/${NEGOCIO_A}/patients/p3`), { telefono: '099' }))
})

await prueba('un producto con precio negativo se rechaza', async () => {
  await assertFails(set(ref(comoAna, `zenday/${NEGOCIO_A}/products/x`), { name: 'Oso', price: -5 }))
})

await prueba('un producto con precio de texto se rechaza', async () => {
  await assertFails(set(ref(comoAna, `zenday/${NEGOCIO_A}/products/y`), { name: 'Oso', price: '100' }))
})

await prueba('un gasto bien formado se acepta', async () => {
  await assertSucceeds(set(ref(comoAna, `zenday/${NEGOCIO_A}/expenses/g1`), {
    amount: 1500, date: '2026-08-01', category: 'alquiler',
  }))
})

console.log('\n/productos — el catálogo que lee la integración')

await prueba('ZenDay logueado SÍ lo puede leer (antes estaba denegado)', async () => {
  // Con las reglas anteriores /productos no estaba declarado, y en RTDB lo que
  // no se declara se DENIEGA. El sincronizador de stock nunca funcionó: el
  // error caía en un console.warn y nadie lo veía.
  await assertSucceeds(get(ref(comoAna, 'productos')))
})

await prueba('nadie lo puede escribir desde la app', async () => {
  // Lo escribe Apps Script con clave de servicio, que se saltea las reglas.
  await assertFails(set(ref(comoAna, 'productos/prod-2'), { nombre: 'Nuevo', stock: 1 }))
})

await prueba('sin login no se lee', async () => {
  await assertFails(get(ref(sinLogin, 'productos')))
})

await env.cleanup()
console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`)
assert.strictEqual(fallaron, 0, `${fallaron} prueba(s) de reglas fallaron`)
