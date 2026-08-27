import { describe, it, expect } from 'vitest'
import {
  parseLocalDate, toLocalDateKey, todayKey, dateInputToISO,
  newId, normalizeEntity, normalizeEntities,
  hasConflict, hasAnyConflict, formatCurrency,
  diffColeccion,
} from '../src/utils/helpers.js'

// ─────────────────────────────────────────────────────────────────────────────
//  FECHAS
//  Uruguay está en UTC-3. Todo lo que use toISOString() sobre una fecha local
//  corre el día. Estos tests fijan el comportamiento correcto para que no vuelva.
// ─────────────────────────────────────────────────────────────────────────────
describe('fechas locales', () => {
  it('parseLocalDate no corre el mes (el bug del gasto de agosto que caía en julio)', () => {
    expect(parseLocalDate('2026-08-01').getMonth()).toBe(7)      // agosto
    expect(new Date('2026-08-01').getMonth()).toBe(6)            // el método viejo daba julio
  })

  it('parseLocalDate no corre el año (enero 2026 caía en 2025)', () => {
    expect(parseLocalDate('2026-01-01').getFullYear()).toBe(2026)
  })

  it('toLocalDateKey es la inversa exacta de parseLocalDate', () => {
    for (const d of ['2026-01-01', '2026-08-01', '2026-12-31', '2024-02-29']) {
      expect(toLocalDateKey(parseLocalDate(d))).toBe(d)
    }
  })

  it('toLocalDateKey de las 22:00 no salta al día siguiente', () => {
    expect(toLocalDateKey(new Date(2026, 7, 20, 22, 0))).toBe('2026-08-20')
  })

  it('toLocalDateKey de las 00:30 no vuelve al día anterior', () => {
    expect(toLocalDateKey(new Date(2026, 7, 20, 0, 30))).toBe('2026-08-20')
  })

  it('dateInputToISO conserva el día elegido en el input', () => {
    expect(new Date(dateInputToISO('2026-08-20')).getDate()).toBe(20)
    expect(new Date(dateInputToISO('2026-01-01')).getFullYear()).toBe(2026)
  })

  it('todayKey coincide con la fecha local, no con la UTC', () => {
    expect(todayKey()).toBe(toLocalDateKey(new Date()))
  })

  it('las entradas inválidas devuelven null o vacío en vez de romper', () => {
    expect(parseLocalDate('')).toBeNull()
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate('no-es-fecha')).toBeNull()
    expect(toLocalDateKey('basura')).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  IDENTIFICADORES — la causa del bug de "agregar nota"
// ─────────────────────────────────────────────────────────────────────────────
describe('identificadores', () => {
  it('normalizeEntity pasa el id numérico a string', () => {
    expect(normalizeEntity({ id: 1755000000000 }).id).toBe('1755000000000')
  })

  it('normaliza también las referencias a otras entidades', () => {
    const n = normalizeEntity({ id: 1, patientId: 2, productId: 3 })
    expect([n.id, n.patientId, n.productId]).toEqual(['1', '2', '3'])
  })

  it('no toca los campos que no son ids', () => {
    const n = normalizeEntity({ id: 1, name: 'Ana', price: 500, paid: false })
    expect(n.name).toBe('Ana')
    expect(n.price).toBe(500)
    expect(n.paid).toBe(false)
  })

  it('no muta el objeto original', () => {
    const original = { id: 42 }
    normalizeEntity(original)
    expect(typeof original.id).toBe('number')
  })

  it('deja null y undefined como estaban', () => {
    const n = normalizeEntity({ id: null, patientId: undefined })
    expect(n.id).toBeNull()
    expect(n.patientId).toBeUndefined()
  })

  it('normalizeEntities devuelve [] ante cualquier cosa que no sea array', () => {
    expect(normalizeEntities(null)).toEqual([])
    expect(normalizeEntities(undefined)).toEqual([])
    expect(normalizeEntities('texto')).toEqual([])
  })

  it('REGRESIÓN — el escenario exacto del bug de las notas', () => {
    // Un cliente guardado con id numérico, buscado con el id string que
    // devuelve Firestore. Antes el find fallaba, updatePatient recibía
    // undefined y la nota se perdía sin ningún error.
    const guardados = normalizeEntities([{ id: 1755000000000, name: 'Ana', notes: [] }])
    const encontrado = guardados.find(p => p.id === '1755000000000')
    expect(encontrado).toBeDefined()
    expect(encontrado.name).toBe('Ana')
  })

  it('newId no colisiona ni en el mismo milisegundo', () => {
    const ids = Array.from({ length: 10000 }, newId)
    expect(new Set(ids).size).toBe(10000)
  })

  it('newId siempre devuelve string', () => {
    expect(typeof newId()).toBe('string')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  SOLAPAMIENTO DE TURNOS — el corazón de la agenda
// ─────────────────────────────────────────────────────────────────────────────
describe('conflictos de horario', () => {
  const cita = (id, hIni, hFin) => ({
    id,
    startTime: new Date(2026, 7, 20, hIni, 0).toISOString(),
    endTime:   new Date(2026, 7, 20, hFin, 0).toISOString(),
  })

  it('detecta un solapamiento total', () => {
    expect(hasConflict([cita('a', 10, 11)], cita('b', 10, 11))).toBe(true)
  })

  it('detecta un solapamiento parcial', () => {
    expect(hasConflict([cita('a', 10, 12)], cita('b', 11, 13))).toBe(true)
  })

  it('dos citas consecutivas NO son conflicto', () => {
    expect(hasConflict([cita('a', 10, 11)], cita('b', 11, 12))).toBe(false)
  })

  it('citas en horarios separados no chocan', () => {
    expect(hasConflict([cita('a', 10, 11)], cita('b', 15, 16))).toBe(false)
  })

  it('una cita no choca consigo misma al editarla', () => {
    const existente = cita('a', 10, 11)
    expect(hasConflict([existente], existente, 'a')).toBe(false)
  })

  it('agenda vacía nunca da conflicto', () => {
    expect(hasConflict([], cita('a', 10, 11))).toBe(false)
  })

  it('hasAnyConflict detecta si UNA sola del lote choca', () => {
    const agenda = [cita('a', 10, 11)]
    const lote = [cita('b', 8, 9), cita('c', 10, 11), cita('d', 14, 15)]
    expect(hasAnyConflict(agenda, lote)).toBe(true)
  })

  it('hasAnyConflict da false si ninguna choca', () => {
    const agenda = [cita('a', 10, 11)]
    expect(hasAnyConflict(agenda, [cita('b', 8, 9), cita('c', 14, 15)])).toBe(false)
  })
})

describe('formato de moneda', () => {
  it('no revienta con valores raros', () => {
    expect(() => formatCurrency(null)).not.toThrow()
    expect(() => formatCurrency(undefined)).not.toThrow()
    expect(() => formatCurrency('abc')).not.toThrow()
    expect(() => formatCurrency(0)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  diffColeccion — el corazón del arreglo de "los datos se evaporan".
//
//  Productos y gastos se editaban sólo en memoria y en localStorage, mientras
//  el listener de Firestore pisaba el estado con lo del servidor: cargabas un
//  artículo, salía el toast verde, y desaparecía.
// ─────────────────────────────────────────────────────────────────────────────
describe('diffColeccion', () => {
  it('lo nuevo se guarda', () => {
    const r = diffColeccion([{ id: '1' }], [{ id: '1' }, { id: '2' }])
    expect(r.guardar.map(x => x.id)).toEqual(['2'])
    expect(r.borrar).toEqual([])
  })

  it('lo editado se guarda', () => {
    const r = diffColeccion([{ id: '1', precio: 100 }], [{ id: '1', precio: 250 }])
    expect(r.guardar.map(x => x.precio)).toEqual([250])
  })

  it('lo que ya no está se borra', () => {
    const r = diffColeccion([{ id: '1' }, { id: '2' }], [{ id: '1' }])
    expect(r.borrar.map(x => x.id)).toEqual(['2'])
  })

  it('sin cambios no escribe nada — 200 artículos no se reescriben por tocar uno', () => {
    const lista = Array.from({ length: 200 }, (_, i) => ({ id: String(i), n: `art ${i}` }))
    const r = diffColeccion(lista, lista.map(x => ({ ...x })))
    expect(r.guardar).toEqual([])
    expect(r.borrar).toEqual([])
  })

  it('reordenar la lista no cuenta como cambio', () => {
    const lista = [{ id: '1' }, { id: '2' }, { id: '3' }]
    const r = diffColeccion(lista, [...lista].reverse())
    expect(r.guardar).toEqual([])
    expect(r.borrar).toEqual([])
  })

  it('los ids number y string son el MISMO registro', () => {
    // El bug de las notas salió justo de esto: Date.now() da número y Firestore
    // devuelve string. Sin normalizar, cada snapshot duplicaría todo.
    const r = diffColeccion([{ id: 7, n: 'a' }], [{ id: '7', n: 'a' }])
    expect(r.guardar).toEqual([])
    expect(r.borrar).toEqual([])
  })

  it('un registro sin id no se intenta guardar', () => {
    // saveDoc sin id devuelve error; mejor no emitir la escritura.
    const r = diffColeccion([], [{ n: 'sin id' }, { id: '1' }])
    expect(r.guardar.map(x => x.id)).toEqual(['1'])
  })

  it('aguanta null y undefined sin explotar', () => {
    expect(() => diffColeccion(null, undefined)).not.toThrow()
    expect(diffColeccion(null, undefined)).toEqual({ guardar: [], borrar: [] })
  })

  it('vaciar la lista pide borrar todo (el llamador decide si eso está bien)', () => {
    const r = diffColeccion([{ id: '1' }, { id: '2' }], [])
    expect(r.borrar.map(x => x.id)).toEqual(['1', '2'])
  })
})
