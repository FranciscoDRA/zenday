import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  MEDIOS_DE_PAGO, MEDIO_POR_DEFECTO, CLAVE_ULTIMO_MEDIO,
  medio, etiquetaMedio, vaALaCaja, cierreDelDia, desglosePorMedio,
} from '../src/utils/mediosDePago.js'

/**
 * El cierre del día.
 *
 * ZenDay sabía CUÁNTO cobraste y nunca CÓMO. `paymentMethod` aparecía una sola
 * vez en todo el proyecto, y era una LECTURA en PatientTimeline:
 *
 *     desc: a.paymentMethod ? `Método: ${a.paymentMethod}` : null,
 *
 * La línea de tiempo estaba preparada para mostrarlo y nadie lo escribía nunca.
 *
 * Sin ese dato, a las ocho de la noche la app dice "cobraste $12.400" y el
 * dueño tiene que acordarse de memoria cuánto de eso fue efectivo para saber
 * qué tiene que haber en el cajón. Todos los días.
 *
 * vitest.config.js fija TZ='America/Montevideo': las fechas se prueban en el
 * huso donde el error de UTC existía.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const HOY = new Date(2026, 7, 27, 20, 0)   // jueves 27 de agosto, 20:00

const cobro = (monto, metodo, cuando = HOY, paid = true) => ({
  id: `c-${monto}-${metodo}`,
  price: monto,
  paid,
  paymentMethod: metodo,
  paymentDate: cuando instanceof Date
    ? `${cuando.getFullYear()}-${String(cuando.getMonth() + 1).padStart(2, '0')}-${String(cuando.getDate()).padStart(2, '0')}T12:00:00`
    : cuando,
})

describe('el catálogo de medios', () => {
  it('el efectivo es el único que va a la caja', () => {
    // Es todo el punto: la caja se cuenta con la mano, lo demás llega al banco.
    const enCaja = MEDIOS_DE_PAGO.filter(m => m.enCaja).map(m => m.id)
    expect(enCaja).toEqual(['efectivo'])
  })

  it('están los que usa un local uruguayo', () => {
    const ids = MEDIOS_DE_PAGO.map(m => m.id)
    for (const m of ['efectivo', 'transferencia', 'mercadopago', 'debito', 'credito'])
      expect(ids, m).toContain(m)
  })

  it('un medio desconocido no rompe nada', () => {
    // Hay cobros viejos y datos importados: si esto tirara, la pantalla de
    // Finanzas se caería entera por un registro raro.
    expect(medio('cheque').id).toBe('otro')
    expect(medio(null).id).toBe('otro')
    expect(medio(undefined).id).toBe('otro')
    expect(() => medio({})).not.toThrow()
  })

  it('sin medio registrado lo dice, no inventa', () => {
    expect(etiquetaMedio(null)).toBe('Sin registrar')
    expect(etiquetaMedio('efectivo')).toBe('Efectivo')
  })

  it('vaALaCaja sólo con efectivo', () => {
    expect(vaALaCaja('efectivo')).toBe(true)
    expect(vaALaCaja('transferencia')).toBe(false)
    expect(vaALaCaja('mercadopago')).toBe(false)
    expect(vaALaCaja(null)).toBe(false)
  })
})

describe('el cierre del día', () => {
  const cobros = [
    cobro(1500, 'efectivo'),
    cobro(2700, 'efectivo'),
    cobro(6000, 'transferencia'),
    cobro(2200, 'mercadopago'),
  ]

  it('suma todo lo cobrado hoy', () => {
    expect(cierreDelDia(cobros, HOY).total).toBe(12400)
    expect(cierreDelDia(cobros, HOY).cantidad).toBe(4)
  })

  it('dice cuánto tiene que haber en la caja', () => {
    // La línea por la que existe todo esto: 1500 + 2700 de efectivo.
    expect(cierreDelDia(cobros, HOY).enCaja).toBe(4200)
  })

  it('agrupa por medio y ordena por monto', () => {
    const { porMedio } = cierreDelDia(cobros, HOY)
    expect(porMedio.map(m => m.id)).toEqual(['transferencia', 'efectivo', 'mercadopago'])
    expect(porMedio[1]).toMatchObject({ id: 'efectivo', cantidad: 2, monto: 4200 })
  })

  it('lo que NO está cobrado no entra', () => {
    const conPendiente = [...cobros, { id: 'x', price: 9999, paid: false, paymentMethod: 'efectivo' }]
    expect(cierreDelDia(conPendiente, HOY).total).toBe(12400)
  })

  it('lo de otros días no entra', () => {
    const ayer = new Date(2026, 7, 26, 10, 0)
    const conAyer = [...cobros, cobro(5000, 'efectivo', ayer)]
    expect(cierreDelDia(conAyer, HOY).total).toBe(12400)
    expect(cierreDelDia(conAyer, ayer).total).toBe(5000)
  })

  it('cuenta por la fecha de COBRO, no la de la sesión', () => {
    // Una sesión del lunes cobrada el jueves entra en la caja del jueves, que es
    // cuando la plata estuvo sobre el mostrador. Con startTime, el arqueo no
    // cerraría contra lo que hay en el cajón — justo lo que esto resuelve.
    const sesionVieja = {
      id: 'vieja', price: 3000, paid: true, paymentMethod: 'efectivo',
      startTime: '2026-08-24T10:00:00',
      paymentDate: '2026-08-27T12:00:00',
    }
    expect(cierreDelDia([sesionVieja], HOY).enCaja).toBe(3000)
    expect(cierreDelDia([sesionVieja], new Date(2026, 7, 24)).total).toBe(0)
  })

  it('los cobros viejos sin medio se ven como "Sin registrar"', () => {
    // Esconderlos daría un total que no cierra. Que aparezcan es información.
    const viejo = { id: 'v', price: 800, paid: true, paymentDate: '2026-08-27T12:00:00' }
    const r = cierreDelDia([viejo], HOY)
    expect(r.total).toBe(800)
    expect(r.enCaja).toBe(0)
    expect(r.porMedio[0]).toMatchObject({ id: 'sin-registrar', label: 'Sin registrar' })
  })

  it('un día sin cobros da cero, no explota', () => {
    const r = cierreDelDia([], HOY)
    expect(r).toMatchObject({ total: 0, enCaja: 0, cantidad: 0 })
    expect(r.porMedio).toEqual([])
  })

  it('aguanta basura', () => {
    expect(() => cierreDelDia(null, HOY)).not.toThrow()
    expect(() => cierreDelDia([null, undefined, 'x'], HOY)).not.toThrow()
    expect(cierreDelDia([{ paid: true, price: 'mil', paymentDate: '2026-08-27T12:00' }], HOY).total).toBe(0)
  })
})

describe('el desglose de un rango, para el mes', () => {
  it('respeta desde y hasta', () => {
    const cobros = [
      cobro(1000, 'efectivo',      new Date(2026, 7, 1)),
      cobro(2000, 'transferencia', new Date(2026, 7, 15)),
      cobro(4000, 'efectivo',      new Date(2026, 8, 2)),
    ]
    const r = desglosePorMedio(cobros, { desde: new Date(2026, 7, 1), hasta: new Date(2026, 7, 31) })
    expect(r.total).toBe(3000)
    expect(r.enCaja).toBe(1000)
  })

  it('sin rango toma todo', () => {
    expect(desglosePorMedio([cobro(500, 'efectivo')]).total).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Cableado
// ─────────────────────────────────────────────────────────────────────────────
describe('está enchufado de punta a punta', () => {
  const modal   = leer('components', 'common', 'PaymentDateModal.jsx')
  const app     = leer('App.jsx')
  const reducer = leer('reducers', 'appointmentsReducer.js')
  const fin     = leer('components', 'screens', 'FinancialScreen.jsx')

  it('el modal deja elegir el medio', () => {
    expect(modal).toMatch(/MEDIOS_DE_PAGO/)
    expect(modal).toMatch(/onConfirm\(paymentDate, metodo\)/)
  })

  it('el modal recuerda el último usado', () => {
    // Un local cobra casi siempre igual: si viene premarcado, cobrar sigue
    // siendo un vistazo y no un paso más.
    // Busca el IDENTIFICADOR, no el valor: el modal importa la constante,
    // no escribe la cadena a mano. Buscar el valor daba un falso negativo.
    expect(modal).toMatch(/CLAVE_ULTIMO_MEDIO/)
    expect(modal).toMatch(/localStorage\.setItem\(CLAVE_ULTIMO_MEDIO, metodo\)/)
  })

  it('markAsPaid recibe y guarda el medio', () => {
    expect(app).toMatch(/const markAsPaid = useCallback\(\(id, customPaymentDate = null, metodo = null\)/)
    expect(app).toMatch(/paymentMethod: medioUsado/)
    expect(app).toMatch(/dispatch\(\{ type: 'MARK_PAID', id, paymentDate, paymentMethod: medioUsado \}\)/)
  })

  it('sin medio explícito usa el último, no lo deja vacío', () => {
    // Los botones de "cobrado" del Panel y la Agenda son un click sin modal.
    // Dejarlos sin medio rompería el arqueo, que es el punto de todo esto.
    expect(app).toMatch(/metodo \|\| \(\(\) => \{/)
    expect(app).toMatch(/MEDIO_POR_DEFECTO/)
  })

  it('el reducer no borra el medio al corregir una fecha', () => {
    expect(reducer).toMatch(/paymentMethod: action\.paymentMethod \|\| apt\.paymentMethod \|\| null/)
  })

  it('Finanzas muestra el cierre y la línea de la caja', () => {
    expect(fin).toMatch(/cierreDelDia\(appointments, new Date\(\)\)/)
    expect(fin).toContain('En la caja tiene que haber')
  })

  it('los handlers que reciben del modal declaran el segundo argumento', () => {
    // Sin declararlo, `metodo` sería una variable inexistente y reventaría al
    // cobrar. esbuild no lo caza: sintácticamente es válido.
    const det = leer('components', 'screens', 'AppointmentDetailScreen.jsx')
    const pen = leer('components', 'screens', 'PendingPaymentsScreen.jsx')
    expect(det).toMatch(/const handlePaymentConfirm = \(date, metodo\)/)
    expect(det).toMatch(/const handleEditPaymentDateConfirm = async \(newDate, metodo\)/)
    expect(pen).toMatch(/onConfirm=\{\(date, metodo\) =>/)
  })

  it('el CSS define todas las clases del cierre', () => {
    const css = leer('App.css')
    const usadas = [...fin.matchAll(/className="(cierre-dia[^"]*)"/g)].flatMap(m => m[1].split(/\s+/))
    for (const c of new Set(usadas)) {
      expect(css, `falta .${c}`).toMatch(new RegExp(`\\.${c}\\b`))
    }
  })
})
