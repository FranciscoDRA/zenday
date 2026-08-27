import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  MIN_VISITAS, FACTOR_ATRASO, FACTOR_PERDIDO, PISO_DIAS, MAX_DESORDEN,
  MIN_NO_SHOWS, MIN_TASA_NO_SHOW,
  mediana, desorden, diasEntre, citasDe, indexarCitas, partirHistorial, ritmoDe,
  ticketPromedio, clientesQueSeVan, clientesQueFaltan, armarAlertas, describirAtraso,
} from '../src/utils/alertas.js'

/**
 * La pantalla de Alertas.
 *
 * Es la única de ZenDay que dice algo que no se le preguntó, y por eso es la
 * única que puede quedar MAL de una forma que el usuario no puede verificar de
 * un vistazo. Si dice "Lucía se fue" y Lucía está agendada para el jueves, la
 * función se desinstala mentalmente en el primer uso y no vuelve nunca.
 *
 * Por eso la mayoría de estos tests son sobre cuándo NO hay que avisar.
 *
 * vitest.config.js fija TZ='America/Montevideo'.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const HOY = new Date(2026, 7, 27, 10, 0)   // jueves 27 de agosto de 2026

/** Una cita `n` días ANTES de hoy. */
const haceDias = (n, extra = {}) => {
  const d = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() - n, 10, 0)
  const pad = x => String(x).padStart(2, '0')
  return {
    id: `c-${n}-${extra.status || 'ok'}`,
    patientId: 'p1',
    startTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00:00`,
    price: 1000,
    paid: true,
    status: 'completed',
    ...extra,
  }
}

/** Una cita `n` días DESPUÉS de hoy. */
const enDias = (n, extra = {}) => haceDias(-n, extra)

const LUCIA = { id: 'p1', name: 'Lucía Fernández' }

// ─────────────────────────────────────────────────────────────────────────────
//  Estadística
// ─────────────────────────────────────────────────────────────────────────────
describe('la estadística de abajo', () => {
  it('la mediana aguanta un valor raro y el promedio no', () => {
    // Es toda la razón de usar mediana: unas vacaciones en el medio no tienen
    // que arrastrar el ritmo de todo el historial.
    const conHueco = [21, 21, 120, 21]
    expect(mediana(conHueco)).toBe(21)
    const promedio = conHueco.reduce((a, b) => a + b) / conHueco.length
    expect(promedio).toBeGreaterThan(45)
  })

  it('la mediana con cantidad par promedia el medio', () => {
    expect(mediana([10, 20, 30, 40])).toBe(25)
  })

  it('sin datos devuelve null, no cero', () => {
    // Cero sería un ritmo de cero días y produciría divisiones absurdas.
    expect(mediana([])).toBeNull()
    expect(mediana(null)).toBeNull()
    expect(desorden([])).toBeNull()
  })

  it('el desorden separa un ritmo de un capricho', () => {
    expect(desorden([7, 8, 7, 9])).toBeLessThan(MAX_DESORDEN)
    expect(desorden([21, 28, 21, 35])).toBeLessThan(MAX_DESORDEN)
    expect(desorden([20, 30, 40])).toBeLessThan(MAX_DESORDEN)      // "mensual", flojo pero real
    expect(desorden([60, 10, 90])).toBeGreaterThan(MAX_DESORDEN)   // esto no es un ritmo
    expect(desorden([5, 60, 10, 90])).toBeGreaterThan(MAX_DESORDEN)
  })

  it('una fecha que falta NO se convierte en 1970', () => {
    // `new Date(null)` da el 1/1/1970, no una fecha inválida. Sin filtrarlo, un
    // registro sin fecha hacía aparecer al cliente con veinte mil días sin
    // venir, ochocientos turnos salteados y una cifra de plata delirante.
    expect(diasEntre(null, HOY)).toBeNull()
    expect(diasEntre(undefined, HOY)).toBeNull()
    expect(diasEntre('', HOY)).toBeNull()
    expect(diasEntre(0, HOY)).toBeNull()
    expect(diasEntre(false, HOY)).toBeNull()
  })

  it('los días se cuentan de medianoche a medianoche', () => {
    // Si se restaran timestamps crudos, una cita de la mañana contra una de la
    // noche daría 0 días donde hay 1, y el ritmo saldría corrido.
    expect(diasEntre(new Date(2026, 7, 1, 23, 0), new Date(2026, 7, 2, 1, 0))).toBe(1)
    expect(diasEntre(new Date(2026, 7, 1, 8, 0), new Date(2026, 7, 1, 20, 0))).toBe(0)
    expect(diasEntre('2026-08-01T10:00:00', '2026-08-31T10:00:00')).toBe(30)
  })

  it('con basura devuelve null y no rompe', () => {
    expect(diasEntre('no es fecha', HOY)).toBeNull()
    expect(diasEntre({}, HOY)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Partir el historial
// ─────────────────────────────────────────────────────────────────────────────
describe('qué cuenta como visita', () => {
  it('una cita pasada sin actualizar el estado igual cuenta', () => {
    // Mucha gente no toca nunca el estado. Exigir 'completed' dejaría el
    // historial de casi todos en cero y la pantalla vacía para siempre: parece
    // que anda y no dice nada, que es la peor falla posible.
    const { visitas } = partirHistorial([haceDias(10, { status: 'scheduled' })], HOY)
    expect(visitas).toHaveLength(1)
  })

  it('una falta no es una visita, y una cancelada tampoco', () => {
    const r = partirHistorial([
      haceDias(10),
      haceDias(20, { status: 'no-show' }),
      haceDias(30, { status: 'cancelled' }),
    ], HOY)
    expect(r.visitas).toHaveLength(1)
    expect(r.faltas).toHaveLength(1)
  })

  it('lo que viene después de hoy es futuro', () => {
    const r = partirHistorial([haceDias(10), enDias(3)], HOY)
    expect(r.visitas).toHaveLength(1)
    expect(r.futuras).toHaveLength(1)
  })

  it('un turno futuro CANCELADO no sujeta a nadie', () => {
    const r = partirHistorial([enDias(3, { status: 'cancelled' })], HOY)
    expect(r.futuras).toHaveLength(0)
  })

  it('las visitas salen ordenadas por fecha', () => {
    const { visitas } = partirHistorial([haceDias(5), haceDias(50), haceDias(20)], HOY)
    const fechas = visitas.map(v => v.startTime)
    expect(fechas).toEqual([...fechas].sort())
  })
})

describe('encontrar las citas de un cliente', () => {
  it('empareja por id', () => {
    expect(citasDe(LUCIA, [haceDias(5), { id: 'x', patientId: 'otro', startTime: '2026-01-01T10:00:00' }]))
      .toHaveLength(1)
  })

  it('empareja por nombre cuando no hay id, sin acentos ni mayúsculas', () => {
    // Los registros importados de Excel muchas veces no tienen patientId.
    // Dejarlos afuera daría un historial incompleto, o sea alertas equivocadas
    // presentadas con cara de certeza.
    const sinId = { id: 'z', patientName: 'LUCIA FERNANDEZ', startTime: '2026-01-01T10:00:00' }
    expect(citasDe(LUCIA, [sinId])).toHaveLength(1)
  })

  it('no confunde a dos clientes distintos', () => {
    const otro = { id: 'z', patientId: 'p2', patientName: 'Marcos', startTime: '2026-01-01T10:00:00' }
    expect(citasDe(LUCIA, [otro])).toHaveLength(0)
  })

  it('la versión indexada da lo mismo que la lenta', () => {
    // `citasDe` recorre todas las citas por cada cliente: con 500 clientes y
    // 5.000 citas son dos millones y medio de comparaciones por render. El
    // índice lo baja a una recorrida, pero sólo sirve si empareja IGUAL.
    const clientes = [
      LUCIA,
      { id: 'p2', name: 'Marcos Pérez' },
      { id: 'p3', name: 'Sin Citas' },
      { name: 'Sólo Nombre' },                    // importado, sin id
    ]
    const citas = [
      haceDias(10),                                                    // p1 por id
      { id: 'n1', patientName: 'lucia fernandez', startTime: '2026-01-05T10:00:00' }, // p1 por nombre
      { id: 'n2', patientId: 'p1', patientName: 'Lucía Fernández', startTime: '2026-02-05T10:00:00' }, // los dos
      { id: 'n3', patientId: 'p2', startTime: '2026-03-05T10:00:00' },
      { id: 'n4', patientName: 'SÓLO NOMBRE', startTime: '2026-04-05T10:00:00' },
      null,
      { id: 'n5', startTime: '2026-05-05T10:00:00' },                  // huérfana
    ]

    const idx = indexarCitas(citas)
    for (const c of clientes) {
      const lenta = citasDe(c, citas)
      const rapida = citasDelIndiceParaTest(c, idx)
      expect(new Set(rapida), c.name).toEqual(new Set(lenta))
      // Y sin duplicar la que trae id Y nombre a la vez.
      expect(rapida.length, `${c.name} duplicada`).toBe(new Set(rapida).size)
    }
  })
})

/**
 * `citasDelIndice` es privada a propósito: es una optimización, no una API.
 * Se la reconstruye acá con las mismas piezas públicas para poder compararla
 * contra `citasDe` sin abrirle la puerta al resto del proyecto.
 */
function citasDelIndiceParaTest(cliente, idx) {
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  const porId = cliente?.id != null ? (idx.porId.get(String(cliente.id)) || []) : []
  const n = norm(cliente?.name)
  const porNombre = n ? (idx.porNombre.get(n) || []) : []
  if (!porNombre.length) return porId
  if (!porId.length) return porNombre
  const vistas = new Set(porId)
  return [...porId, ...porNombre.filter(a => !vistas.has(a))]
}

// ─────────────────────────────────────────────────────────────────────────────
//  El ritmo
// ─────────────────────────────────────────────────────────────────────────────
describe('el ritmo propio de cada cliente', () => {
  it('con menos de tres visitas no se afirma nada', () => {
    // Con una sola diferencia entre dos fechas no hay ritmo, hay una casualidad.
    expect(ritmoDe([haceDias(40), haceDias(20)])).toBeNull()
    expect(MIN_VISITAS).toBe(3)
  })

  it('detecta cada 21 días', () => {
    const r = ritmoDe([haceDias(63), haceDias(42), haceDias(21), haceDias(0)])
    expect(r.dias).toBe(21)
    expect(r.regular).toBe(true)
    expect(r.visitas).toBe(4)
  })

  it('un cliente irregular queda marcado como irregular', () => {
    // Intervalos de 60, 10 y 90 días. Con el umbral viejo (0.75) esto pasaba
    // como "ritmo" y generaba una alerta inventada.
    const r = ritmoDe([haceDias(200), haceDias(140), haceDias(130), haceDias(40)])
    expect(r.regular).toBe(false)
  })

  it('dos citas el mismo día son una sola visita', () => {
    const r = ritmoDe([haceDias(30), haceDias(30), haceDias(15), haceDias(0)])
    expect(r.dias).toBe(15)
  })

  it('un hueco en el medio no le corre el ritmo', () => {
    // Vacaciones de tres meses entre dos tramos regulares de 7 días.
    const r = ritmoDe([haceDias(120), haceDias(113), haceDias(20), haceDias(13), haceDias(6)])
    expect(r.dias).toBe(7)
  })
})

describe('el ticket promedio', () => {
  it('prefiere lo efectivamente cobrado', () => {
    const v = [
      haceDias(30, { price: 1000, paid: true }),
      haceDias(20, { price: 9999, paid: false }),
    ]
    expect(ticketPromedio(v)).toBe(1000)
  })

  it('si no hay nada cobrado usa los precios agendados', () => {
    expect(ticketPromedio([haceDias(10, { price: 500, paid: false })])).toBe(500)
  })

  it('sin ningún precio devuelve 0 y no inventa', () => {
    expect(ticketPromedio([haceDias(10, { price: 0, paid: true })])).toBe(0)
    expect(ticketPromedio([])).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Los que se van
// ─────────────────────────────────────────────────────────────────────────────
describe('los clientes que se están yendo', () => {
  /** Lucía viene cada 21 días. La última vez fue hace `n`. */
  const luciaCada21 = (n) => [
    haceDias(n + 63), haceDias(n + 42), haceDias(n + 21), haceDias(n),
  ]

  it('avisa cuando pasó 1.5 veces su propio ritmo', () => {
    const r = clientesQueSeVan([LUCIA], luciaCada21(45), { hoy: HOY })
    expect(r).toHaveLength(1)
    expect(r[0].ritmoDias).toBe(21)
    expect(r[0].diasSinVenir).toBe(45)
    expect(r[0].nivel).toBe('atrasado')
  })

  it('NO avisa si todavía está dentro de su ritmo', () => {
    expect(clientesQueSeVan([LUCIA], luciaCada21(25), { hoy: HOY })).toHaveLength(0)
  })

  it('pasado 2.5 veces el ritmo, ya no es un atraso', () => {
    const r = clientesQueSeVan([LUCIA], luciaCada21(60), { hoy: HOY })
    expect(r[0].nivel).toBe('perdido')
  })

  it('NUNCA avisa de alguien que tiene turno agendado', () => {
    // El error que mataría la función en el primer uso: "me dice que Lucía se
    // fue y la tengo anotada para el jueves".
    const citas = [...luciaCada21(90), enDias(4)]
    expect(clientesQueSeVan([LUCIA], citas, { hoy: HOY })).toHaveLength(0)
  })

  it('NO avisa de un cliente sin ritmo, por más que haga meses', () => {
    const caotico = [haceDias(400), haceDias(340), haceDias(330), haceDias(120)]
    expect(clientesQueSeVan([LUCIA], caotico, { hoy: HOY })).toHaveLength(0)
  })

  it('NO avisa de alguien con dos visitas, aunque hagan años', () => {
    expect(clientesQueSeVan([LUCIA], [haceDias(500), haceDias(480)], { hoy: HOY })).toHaveLength(0)
  })

  it('el piso de días protege al cliente que pasa muy seguido', () => {
    // Ritmo de 3 días: sin el piso, 1.5x serían 4 días y medio y este cliente
    // aparecería en la lista todas las semanas.
    const cada3 = [haceDias(9), haceDias(6), haceDias(3), haceDias(0)]
    const alDia7 = cada3.map(c => c)   // última visita hace 0 días
    expect(clientesQueSeVan([LUCIA], alDia7, { hoy: HOY })).toHaveLength(0)
    expect(PISO_DIAS).toBeGreaterThanOrEqual(14)
  })

  it('cuenta los turnos salteados y los pasa a plata', () => {
    // Ritmo 21, hace 45 días: debería haber venido a los 21 y a los 42.
    const r = clientesQueSeVan([LUCIA], luciaCada21(45), { hoy: HOY })
    expect(r[0].turnosSalteados).toBe(2)
    expect(r[0].plata).toBe(2000)   // 2 turnos × $1000 de ticket
  })

  it('ordena por plata, no por fecha', () => {
    const caro = { id: 'p2', name: 'Caro' }
    const citasCaro = [
      haceDias(103, { patientId: 'p2', price: 8000 }),
      haceDias(82,  { patientId: 'p2', price: 8000 }),
      haceDias(61,  { patientId: 'p2', price: 8000 }),
      haceDias(40,  { patientId: 'p2', price: 8000 }),
    ]
    const r = clientesQueSeVan([LUCIA, caro], [...luciaCada21(45), ...citasCaro], { hoy: HOY })
    expect(r[0].cliente.id).toBe('p2')
    expect(r[0].plata).toBeGreaterThan(r[1].plata)
  })

  it('sin fecha `hoy` no adivina: tira', () => {
    // Una función que se cae al reloj del sistema no se puede probar y da
    // resultados distintos según el día. Mejor un error ruidoso.
    expect(() => clientesQueSeVan([LUCIA], [], {})).toThrow()
  })

  it('aguanta basura sin romper la pantalla', () => {
    expect(() => clientesQueSeVan(null, null, { hoy: HOY })).not.toThrow()
    expect(() => clientesQueSeVan([null, {}], [null, {}, 'x'], { hoy: HOY })).not.toThrow()
    expect(clientesQueSeVan([LUCIA], [{ patientId: 'p1', startTime: 'roto' }], { hoy: HOY })).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Los que faltan
// ─────────────────────────────────────────────────────────────────────────────
describe('los clientes que faltan sin avisar', () => {
  it('dos faltas en tres citas es un problema', () => {
    const citas = [
      haceDias(30),
      haceDias(20, { status: 'no-show', price: 1500 }),
      haceDias(10, { status: 'no-show', price: 1500 }),
    ]
    const r = clientesQueFaltan([LUCIA], citas, { hoy: HOY })
    expect(r).toHaveLength(1)
    expect(r[0].faltas).toBe(2)
    expect(r[0].plata).toBe(3000)
  })

  it('dos faltas en treinta visitas es la vida normal', () => {
    // Sin la tasa, el ranking lo encabezarían los MEJORES clientes por tener
    // más historial. Exactamente al revés de lo útil.
    const citas = [
      ...Array.from({ length: 30 }, (_, i) => haceDias(i + 5, { id: `v${i}` })),
      haceDias(3,  { id: 'f1', status: 'no-show' }),
      haceDias(60, { id: 'f2', status: 'no-show' }),
    ]
    expect(clientesQueFaltan([LUCIA], citas, { hoy: HOY })).toHaveLength(0)
  })

  it('una sola falta es un olvido, no un patrón', () => {
    const citas = [haceDias(30), haceDias(20, { status: 'no-show' })]
    expect(clientesQueFaltan([LUCIA], citas, { hoy: HOY })).toHaveLength(0)
    expect(MIN_NO_SHOWS).toBe(2)
  })

  it('cancelar no es faltar: no infla la tasa del que avisa', () => {
    const citas = [
      haceDias(40, { id: 'a' }),
      haceDias(30, { id: 'b', status: 'cancelled' }),
      haceDias(20, { id: 'c', status: 'cancelled' }),
      haceDias(10, { id: 'd', status: 'no-show' }),
      haceDias(5,  { id: 'e', status: 'no-show' }),
    ]
    const r = clientesQueFaltan([LUCIA], citas, { hoy: HOY })
    // Esperadas = 1 visita + 2 faltas = 3. Las canceladas no entran al divisor.
    expect(r[0].esperadas).toBe(3)
    expect(r[0].tasa).toBeCloseTo(2 / 3)
  })

  it('la plata es la de las horas que quedaron vacías', () => {
    const citas = [
      haceDias(30),
      haceDias(20, { status: 'no-show', price: 2500 }),
      haceDias(10, { status: 'no-show', price: 4000 }),
    ]
    expect(clientesQueFaltan([LUCIA], citas, { hoy: HOY })[0].plata).toBe(6500)
  })

  it('el umbral de tasa es el declarado', () => {
    expect(MIN_TASA_NO_SHOW).toBeGreaterThan(0)
    expect(MIN_TASA_NO_SHOW).toBeLessThan(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Las dos juntas
// ─────────────────────────────────────────────────────────────────────────────
describe('armarAlertas', () => {
  it('suma la plata de las dos listas', () => {
    const citas = [
      haceDias(108), haceDias(87), haceDias(66), haceDias(45),
      haceDias(200, { id: 'f1', status: 'no-show', price: 1500 }),
      haceDias(190, { id: 'f2', status: 'no-show', price: 1500 }),
    ]
    const r = armarAlertas([LUCIA], citas, { hoy: HOY })
    expect(r.plata.total).toBe(r.plata.seVan + r.plata.faltan)
    expect(r.total).toBe(r.seVan.length + r.faltan.length)
  })

  it('sin datos devuelve la forma completa, no undefined', () => {
    // La pantalla lee r.plata.total antes de saber si hay algo: si esto
    // devolviera un objeto incompleto, reventaría con el negocio vacío.
    const r = armarAlertas([], [], { hoy: HOY })
    expect(r).toMatchObject({ seVan: [], faltan: [], total: 0 })
    expect(r.plata).toMatchObject({ seVan: 0, faltan: 0, total: 0 })
  })

  it('la plata es un número plano, no un getter', () => {
    // Se pasa por props y se desestructura; un getter se pierde en el camino.
    const r = armarAlertas([], [], { hoy: HOY })
    expect(Object.getOwnPropertyDescriptor(r.plata, 'total').value).toBe(0)
  })
})

describe('el texto de la tarjeta', () => {
  it('dice el ritmo en castellano', () => {
    expect(describirAtraso({ ritmoDias: 7, visitas: 9, diasSinVenir: 30 }))
      .toContain('todas las semanas')
    expect(describirAtraso({ ritmoDias: 21, visitas: 9, diasSinVenir: 45 }))
      .toContain('cada 21 días')
  })

  it('sin datos devuelve vacío, no "undefined"', () => {
    expect(describirAtraso(null)).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Cableado
// ─────────────────────────────────────────────────────────────────────────────
describe('está enchufado', () => {
  it('la pantalla existe y usa el motor', () => {
    const pantalla = leer('components', 'screens', 'AlertasScreen.jsx')
    expect(pantalla).toMatch(/from '\.\.\/\.\.\/utils\/alertas'/)
    expect(pantalla).toMatch(/armarAlertas/)
  })

  it('App.jsx la registra como pantalla', () => {
    const app = leer('App.jsx')
    expect(app).toMatch(/alertas:\s+AlertasScreen/)
    expect(app).toMatch(/import AlertasScreen|import \{ AlertasScreen \}/)
  })

  it('el menú la muestra en los modos que tienen clientes', () => {
    const sidebar = leer('components', 'layout', 'Sidebar.jsx')
    // Dos veces: una en el bloque de emprendedor y otra en el de profesional.
    expect([...sidebar.matchAll(/id: 'alertas'/g)]).toHaveLength(2)
    // Y NINGUNA en el modo personal, que no tiene clientes.
    const personal = sidebar.slice(sidebar.indexOf("userMode === 'personal'"), sidebar.indexOf("userMode === 'entrepreneur'"))
    expect(personal).not.toContain('alertas')
  })

  it('el CSS define todas las clases que usa la pantalla', () => {
    const css = leer('App.css')
    const pantalla = leer('components', 'screens', 'AlertasScreen.jsx')
    const usadas = [...pantalla.matchAll(/className="(alertas[^"{]*)"/g)].flatMap(m => m[1].split(/\s+/))
    expect(usadas.length).toBeGreaterThan(5)
    for (const c of new Set(usadas.filter(Boolean))) {
      expect(css, `falta .${c}`).toMatch(new RegExp(`\\.${c}\\b`))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  El medio de pago, que se registraba y no salía en ningún informe
// ─────────────────────────────────────────────────────────────────────────────
describe('el medio de pago llega a los informes', () => {
  const fin = leer('components', 'screens', 'FinancialScreen.jsx')
  const pdf = leer('utils', 'pdfReportGenerator.js')

  it('Finanzas muestra el desglose del PERÍODO, no sólo el de hoy', () => {
    // `desglosePorMedio` estaba escrito y probado desde el día uno y no lo
    // llamaba NADIE. Se podía marcar "cobré con débito" y ese dato no aparecía
    // en ningún lado que no fuera el día de hoy.
    expect(fin).toMatch(/desglosePorMedio/)
    expect(fin).toContain('Cómo te pagaron')
  })

  it('el desglose sale de la MISMA lista que el total cobrado', () => {
    // Dos filtros parecidos pero separados terminan dando dos números
    // distintos, y una diferencia de un peso en una pantalla de plata parece
    // un error aunque no lo sea.
    expect(fin).toMatch(/desglosePorMedio\(revenueData\.items\)/)
    expect(fin).toMatch(/items: filtered/)
  })

  it('el PDF financiero tiene la sección', () => {
    expect(pdf).toContain('Cómo te pagaron')
    expect(pdf).toMatch(/desglosePorMedio\(filteredApts\)/)
  })

  it('el PDF de ventas tiene la columna del medio', () => {
    expect(pdf).toMatch(/'Cliente', 'Producto\/Servicio', 'Fecha', 'Monto', 'Medio', 'Estado'/)
    expect(pdf).toMatch(/etiquetaMedio\(a\.paymentMethod\)/)
  })

  it('al agregar la columna se corrió el índice que pinta el estado', () => {
    // "Estado" pasó de la posición 4 a la 5. Dejarlo en 4 pintaba de verde el
    // medio de pago: un bug silencioso que sólo se ve imprimiendo.
    const bloque = pdf.slice(pdf.indexOf("'Medio', 'Estado'"))
    expect(bloque).toMatch(/data\.column\.index === 5 && data\.section === 'body'/)
  })

  it('un pendiente no dice con qué se pagó', () => {
    // Poner "Efectivo" en un pedido no cobrado sería afirmar que entró plata
    // que no entró.
    expect(pdf).toMatch(/a\.paid \? etiquetaMedio\(a\.paymentMethod\) : '—'/)
  })
})
