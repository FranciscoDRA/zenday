import { describe, it, expect } from 'vitest'
import {
  generarEjemplos, esEjemplo, sinEjemplos, contarEjemplos, MARCA,
} from '../src/utils/datosDeEjemplo.js'
import { ACTIVE_STATUSES, COMPLETED_STATUSES, STATUSES, ORDER_STATUSES } from '../src/utils/constants.js'
import { parseLocalDate, getRevenueDate } from '../src/utils/helpers.js'

/**
 * Datos de ejemplo.
 *
 * El riesgo de esta función no es que genere poco: es que genere datos que la
 * app no sepa leer, o que el borrado se lleve puesto algo real. Los tests van
 * a eso.
 *
 * vitest.config.js fija TZ='America/Montevideo', así que las fechas se prueban
 * en el huso donde el error de UTC existía.
 */

// Un martes cualquiera, a media mañana. Fijo a propósito: si dependiera del
// reloj, estos tests darían distinto según el día en que corran.
const HOY = new Date(2026, 7, 25, 10, 30)   // 25 de agosto de 2026

describe('genera algo que la app pueda mostrar', () => {
  const d = generarEjemplos({ userMode: 'professional', hoy: HOY })

  it('trae las cuatro colecciones con contenido', () => {
    expect(d.patients.length).toBeGreaterThan(0)
    expect(d.appointments.length).toBeGreaterThan(0)
    expect(d.products.length).toBeGreaterThan(0)
    expect(d.expenses.length).toBeGreaterThan(0)
  })

  it('hay algo HOY, que es lo primero que se mira', () => {
    // Si el Panel y la Agenda siguen vacíos, los datos de ejemplo no sirvieron
    // para nada: justamente esas dos pantallas son las que se abren primero.
    const hoyClave = '2026-08-25'
    const deHoy = d.appointments.filter(a => a.startTime.startsWith(hoyClave))
    expect(deHoy.length).toBeGreaterThanOrEqual(3)
  })

  it('hay cobrado Y sin cobrar', () => {
    // Sin las dos cosas, "Lo que cobraste" o "Falta cobrar" quedan en cero y la
    // pantalla de Finanzas se ve rota en vez de vacía.
    expect(d.appointments.some(a => a.paid)).toBe(true)
    expect(d.appointments.some(a => !a.paid)).toBe(true)
  })

  it('hay movimiento del mes anterior, para que la comparativa compare', () => {
    const previas = d.appointments.filter(a => a.startTime.startsWith('2026-07'))
    expect(previas.length).toBeGreaterThanOrEqual(3)
    expect(d.expenses.filter(e => e.date.startsWith('2026-07')).length).toBeGreaterThanOrEqual(2)
  })

  it('hay un artículo agotado y uno con stock bajo', () => {
    // Son los dos estados que pintan distinto. Sin ellos no se ve que existen.
    expect(d.products.some(p => p.stock === 0)).toBe(true)
    expect(d.products.some(p => p.stock > 0 && p.stock < 5)).toBe(true)
  })
})

describe('los datos tienen la forma que la app espera', () => {
  const d = generarEjemplos({ userMode: 'professional', hoy: HOY })

  it('los estados de las citas existen de verdad', () => {
    const reales = new Set([...Object.keys(STATUSES), ...Object.keys(ORDER_STATUSES)])
    for (const a of d.appointments) {
      expect(reales.has(a.status), `"${a.status}" no está en STATUSES ni ORDER_STATUSES`).toBe(true)
    }
  })

  it('las fechas se parsean sin dar Invalid Date', () => {
    for (const a of d.appointments) {
      expect(Number.isNaN(new Date(a.startTime).getTime()), a.startTime).toBe(false)
    }
    for (const e of d.expenses) {
      expect(parseLocalDate(e.date), e.date).not.toBeNull()
    }
  })

  it('las fechas NO se corren de día (el bug de UTC)', () => {
    // Se generan con getFullYear/getMonth/getDate, nunca con toISOString().
    // Una cita de las 16:00 tiene que seguir cayendo el mismo día.
    const tarde = d.appointments.find(a => a.startTime.includes('T16:'))
    expect(tarde).toBeTruthy()
    const comoDate = new Date(tarde.startTime)
    expect(`${comoDate.getFullYear()}-${String(comoDate.getMonth() + 1).padStart(2, '0')}-${String(comoDate.getDate()).padStart(2, '0')}`)
      .toBe(tarde.startTime.slice(0, 10))
  })

  it('lo cobrado tiene fecha de cobro, que es la que decide el mes', () => {
    for (const a of d.appointments.filter(x => x.paid)) {
      expect(a.paymentDate, `${a.id} está cobrada y no tiene paymentDate`).toBeTruthy()
      expect(getRevenueDate(a)).toBe(a.paymentDate)
    }
  })

  it('lo no cobrado NO trae fecha de cobro', () => {
    for (const a of d.appointments.filter(x => !x.paid)) {
      expect(a.paymentDate).toBeUndefined()
    }
  })

  it('cada cita apunta a un cliente que existe', () => {
    const ids = new Set(d.patients.map(p => p.id))
    for (const a of d.appointments) expect(ids.has(a.patientId), a.patientId).toBe(true)
  })

  it('las notas de los clientes son array, no texto', () => {
    // El bug de "45 notas" nació justo de un `notes` que era string.
    for (const p of d.patients) expect(Array.isArray(p.notes)).toBe(true)
  })

  it('ningún registro pasa el techo de campos que aceptan las reglas', () => {
    // firestore.rules corta en 200 campos por documento.
    for (const col of [d.patients, d.appointments, d.products, d.expenses]) {
      for (const x of col) expect(Object.keys(x).length).toBeLessThan(200)
    }
  })
})

describe('el modo emprendedor usa sus propios estados', () => {
  const emp = generarEjemplos({ userMode: 'entrepreneur', hoy: HOY })

  it('nada queda con un estado del modo profesional', () => {
    const deOrden = new Set(Object.keys(ORDER_STATUSES))
    for (const a of emp.appointments) {
      expect(deOrden.has(a.status), `"${a.status}" no es un estado de pedido`).toBe(true)
    }
  })

  it('sigue habiendo pedidos activos y terminados', () => {
    expect(emp.appointments.some(a => ACTIVE_STATUSES.has(a.status))).toBe(true)
    expect(emp.appointments.some(a => COMPLETED_STATUSES.has(a.status))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Lo que de verdad puede hacer daño: el borrado.
// ─────────────────────────────────────────────────────────────────────────────
describe('borrar los ejemplos no se lleva puesto nada real', () => {
  const d = generarEjemplos({ userMode: 'professional', hoy: HOY })

  it('TODO lo generado queda marcado', () => {
    for (const col of [d.patients, d.appointments, d.products, d.expenses]) {
      for (const x of col) expect(x[MARCA], `${x.id} sin marcar`).toBe(true)
    }
  })

  it('un dato real con el MISMO nombre no se borra', () => {
    // Éste es el caso que importa: si el borrado filtrara por nombre o por
    // parecido, se llevaría puesto al cliente real que se llama igual.
    const real = { id: 'abc123', name: 'Lucía Fernández', phone: '099 412 887' }
    const mezcla = [...d.patients, real]
    const quedan = sinEjemplos(mezcla)
    expect(quedan).toHaveLength(1)
    expect(quedan[0].id).toBe('abc123')
  })

  it('un dato real con un id que EMPIEZA igual tampoco se borra', () => {
    // El filtro mira la marca, no el prefijo del id.
    const real = { id: 'ejemplo-cliente-1-mio', name: 'Real' }
    expect(sinEjemplos([...d.patients, real]).map(x => x.id)).toEqual(['ejemplo-cliente-1-mio'])
  })

  it('borrar dos veces no rompe nada', () => {
    expect(sinEjemplos(sinEjemplos(d.patients))).toEqual([])
  })

  it('sobre una lista sin ejemplos no toca nada', () => {
    const reales = [{ id: 'a' }, { id: 'b' }]
    expect(sinEjemplos(reales)).toEqual(reales)
  })

  it('aguanta null, undefined y basura', () => {
    expect(sinEjemplos(null)).toEqual([])
    expect(sinEjemplos(undefined)).toEqual([])
    expect(esEjemplo(null)).toBe(false)
    expect(esEjemplo(undefined)).toBe(false)
    expect(esEjemplo({})).toBe(false)
    expect(esEjemplo({ origenEjemplo: 'si' })).toBe(false)   // sólo el booleano
    expect(contarEjemplos(null)).toBe(0)
  })

  it('contarEjemplos cuenta sólo los marcados', () => {
    expect(contarEjemplos([...d.patients, { id: 'real' }])).toBe(d.patients.length)
  })
})

describe('cargar dos veces no duplica', () => {
  it('los ids son fijos, no aleatorios', () => {
    const a = generarEjemplos({ userMode: 'professional', hoy: HOY })
    const b = generarEjemplos({ userMode: 'professional', hoy: HOY })
    expect(a.patients.map(p => p.id)).toEqual(b.patients.map(p => p.id))
    expect(a.appointments.map(x => x.id)).toEqual(b.appointments.map(x => x.id))
  })

  it('no hay ids repetidos dentro de una misma colección', () => {
    const d = generarEjemplos({ userMode: 'professional', hoy: HOY })
    for (const col of [d.patients, d.appointments, d.products, d.expenses]) {
      expect(new Set(col.map(x => x.id)).size).toBe(col.length)
    }
  })
})

describe('la fecha entra por parámetro, no la saca del reloj', () => {
  it('sin fecha, avisa en vez de inventar', () => {
    expect(() => generarEjemplos({ userMode: 'professional' })).toThrow(/fecha/i)
    expect(() => generarEjemplos({ hoy: 'martes' })).toThrow(/fecha/i)
    expect(() => generarEjemplos({ hoy: new Date('cualquier cosa') })).toThrow(/fecha/i)
  })

  it('con otra fecha, los datos se mueven con ella', () => {
    const enero = generarEjemplos({ userMode: 'professional', hoy: new Date(2027, 0, 14, 9, 0) })
    expect(enero.appointments.some(a => a.startTime.startsWith('2027-01-14'))).toBe(true)
    // Y el "mes anterior" cruza bien el año.
    expect(enero.appointments.some(a => a.startTime.startsWith('2026-12'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  El cableado. Los tests de arriba prueban la función; éstos prueban que esté
//  enchufada, que es donde se rompen las cosas de verdad.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('está enchufado', () => {
  const app  = leer('App.jsx')
  const conf = leer('components', 'screens', 'SettingsScreen.jsx')

  it('App.jsx importa el generador', () => {
    expect(app).toMatch(/import \{[^}]*generarEjemplos[^}]*\} from '\.\/utils\/datosDeEjemplo'/)
  })

  it('expone cargar, borrar y la cuenta', () => {
    for (const k of ['cargarDatosDeEjemplo', 'borrarDatosDeEjemplo', 'cuantosEjemplos']) {
      expect(app, `falta ${k} en sharedProps`).toMatch(new RegExp(`\\n\\s*${k},`))
    }
  })

  it('la pantalla de Configuración las recibe', () => {
    expect(conf).toMatch(/cargarDatosDeEjemplo, borrarDatosDeEjemplo, cuantosEjemplos/)
  })

  it('el borrado NO pasa por deletePatient', () => {
    // deletePatient abre un cartel de confirmación por cada cliente: borrar
    // seis ejemplos serían seis carteles seguidos. Por eso hay un camino aparte.
    const bloque = app.slice(app.indexOf('const borrarDatosDeEjemplo'),
                             app.indexOf('const cuantosEjemplos'))
    expect(bloque).not.toMatch(/deletePatient/)
    expect(bloque).toMatch(/setPatientsDelModo\(sinEjemplos\)/)
  })

  it('cargar reemplaza en vez de duplicar', () => {
    // `sinEjemplos` antes de agregar: apretar dos veces deja el mismo juego.
    const bloque = app.slice(app.indexOf('const cargarDatosDeEjemplo'),
                             app.indexOf('const borrarDatosDeEjemplo'))
    for (const setter of ['setPatientsDelModo', 'setAppointmentsDirect', 'setProductsSync', 'setExpensesSync']) {
      expect(bloque, `${setter} no limpia los ejemplos previos`)
        .toMatch(new RegExp(`${setter}\\(\\w+ => \\[\\.\\.\\.sinEjemplos\\(\\w+\\)`))
    }
  })

  it('los cuatro caminos llegan a Firestore', () => {
    // Los tres setters sincronizados ya escriben solos; los clientes no tenían
    // un setter así, y sin sincronizarColeccion los ejemplos quedarían sólo en
    // esta computadora — y el borrado no llegaría al servidor.
    const bloque = app.slice(app.indexOf('const setPatientsDelModo'),
                             app.indexOf('const cargarDatosDeEjemplo'))
    expect(bloque).toMatch(/sincronizarColeccion\('patients', previo, lista\)/)
  })

  it('borrar pregunta antes; cargar no', () => {
    const limpio = sinComentarios(conf)
    const bloque = limpio.slice(limpio.indexOf('const borrarEjemplos'),
                                limpio.indexOf('const handleLeaveBusiness'))
    expect(bloque).toMatch(/await confirm\(/)
    // Cargar no destruye nada y se deshace con un botón: no molesta con carteles.
    expect(limpio).toMatch(/onClick=\{\(\) => cargarDatosDeEjemplo\?\.\(\)\}/)
  })

  it('el botón cambia según haya ejemplos o no', () => {
    expect(conf).toMatch(/cuantosEjemplos > 0 \?/)
    expect(conf).toContain('Cargar datos de ejemplo')
    expect(conf).toContain('Borrar los ejemplos')
  })
})
