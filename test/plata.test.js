import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getRevenueDate } from '../src/utils/helpers.js'

/**
 * Los números de la pantalla Finanzas.
 *
 * Este es el peor tipo de error que puede tener este programa: no rompe nada,
 * no tira ningún cartel rojo, y el resultado se lo lleva el contador.
 *
 * Había dos, y se sumaban:
 *
 *  1. `revenueData.total` es FACTURADO (cobrado + pendiente), pero se mostraba
 *     bajo el cartel "✅ Lo que cobraste" y se exportaba al Excel como
 *     "Ingresos Cobrados". O sea: plata que todavía no entró, informada como
 *     entrada. La "Ganancia real" salía de ahí, así que también venía inflada.
 *
 *  2. "Total facturado" hacía `total + pending`, y `total` YA incluía el
 *     pendiente. El pendiente se contaba dos veces.
 *
 *  Con $50.000 cobrados y $20.000 pendientes, la pantalla decía:
 *
 *        ✅ Lo que cobraste      $70.000     <- son $50.000
 *        ⏳ Falta cobrar         $20.000     <- bien
 *        📊 Total facturado      $90.000     <- son $70.000
 *
 *  Las tres tarjetas juntas ni siquiera cerraban entre ellas.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
                                    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const finanzas = leer('components', 'screens', 'FinancialScreen.jsx')

// ─────────────────────────────────────────────────────────────────────────────
//  La cuenta, reproducida igual que en la pantalla.
// ─────────────────────────────────────────────────────────────────────────────
function resumir(citas) {
  const paid    = citas.filter(a =>  a.paid).reduce((s, a) => s + (a.price || 0), 0)
  const pending = citas.filter(a => !a.paid).reduce((s, a) => s + (a.price || 0), 0)
  return { paid, pending, total: paid + pending }
}

describe('cobrado, pendiente y facturado cierran entre sí', () => {
  const CITAS = [
    { price: 30000, paid: true  },
    { price: 20000, paid: true  },
    { price: 20000, paid: false },
  ]
  const r = resumir(CITAS)

  it('lo cobrado es sólo lo que tiene paid === true', () => {
    expect(r.paid).toBe(50000)
  })

  it('lo pendiente es el resto', () => {
    expect(r.pending).toBe(20000)
  })

  it('facturado = cobrado + pendiente, no cobrado + pendiente + pendiente', () => {
    expect(r.total).toBe(70000)
    expect(r.total).not.toBe(r.paid + 2 * r.pending)   // los $90.000 de antes
  })

  it('la ganancia real descuenta gastos de lo COBRADO', () => {
    const gastos = 10000
    expect(r.paid - gastos).toBe(40000)
    // Con `total` daba $60.000: $20.000 de ganancia que todavía no existe.
    expect(r.total - gastos).not.toBe(r.paid - gastos)
  })
})

describe('la pantalla usa el campo correcto en cada lugar', () => {
  const limpio = sinComentarios(finanzas)

  it('"Lo que cobraste" muestra paid', () => {
    const i = limpio.indexOf('Lo que cobraste')
    expect(i).toBeGreaterThan(-1)
    expect(limpio.slice(i - 220, i)).toMatch(/revenueData\.paid/)
  })

  it('"Cobrado" del resumen lateral muestra paid', () => {
    const i = limpio.indexOf('✅ Cobrado')
    expect(i).toBeGreaterThan(-1)
    expect(limpio.slice(i, i + 220)).toMatch(/revenueData\.paid/)
  })

  it('la ganancia real sale de paid', () => {
    expect(limpio).toMatch(/const netProfit = revenueData\.paid - expenseData\.total/)
    expect(limpio).not.toMatch(/const netProfit = revenueData\.total/)
  })

  it('el margen también', () => {
    expect(limpio).not.toMatch(/profitMargin = revenueData\.total === 0/)
  })

  it('en ningún lado se suma el pendiente dos veces', () => {
    expect(limpio).not.toMatch(/revenueData\.total \+ revenueData\.pending/)
  })
})

describe('el Excel que se le manda al contador', () => {
  const limpio = sinComentarios(finanzas)
  const bloque = limpio.slice(limpio.indexOf('const handleExportExcel'),
                              limpio.indexOf('XLSX.utils.aoa_to_sheet'))

  it('"Ingresos Cobrados" es lo cobrado', () => {
    expect(bloque).toMatch(/'Ingresos Cobrados', revenueData\.paid/)
  })

  it('"Total Facturado" no cuenta el pendiente dos veces', () => {
    expect(bloque).toMatch(/'Total Facturado', revenueData\.total\]/)
    expect(bloque).not.toMatch(/'Total Facturado', revenueData\.total \+ revenueData\.pending/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Una sola definición de "cuándo entró la plata".
// ─────────────────────────────────────────────────────────────────────────────
describe('las tres pantallas de plata usan el mismo criterio de fecha', () => {
  const PANTALLAS = ['DashboardScreen', 'ReportsScreen', 'FinancialScreen']

  it('ninguna tiene su propia copia de getRevenueDate', () => {
    // Finanzas devolvía `a.startTime` a secas: una sesión del 31 de julio
    // cobrada el 3 de agosto contaba en JULIO acá y en AGOSTO en las otras dos.
    const propias = PANTALLAS.filter(p =>
      /function getRevenueDate/.test(leer('components', 'screens', `${p}.jsx`)))
    expect(propias).toEqual([])
  })

  it('las tres la importan de helpers', () => {
    for (const p of PANTALLAS) {
      expect(leer('components', 'screens', `${p}.jsx`),
        `${p} no importa getRevenueDate`).toMatch(/import \{[^}]*getRevenueDate[^}]*\} from '\.\.\/\.\.\/utils\/helpers'/)
    }
  })

  it('la plata entra el día que se cobró, no el día de la sesión', () => {
    const sesionJulio = {
      startTime:   '2026-07-31T15:00:00',
      paymentDate: '2026-08-03T10:00:00',
    }
    expect(getRevenueDate(sesionJulio)).toBe('2026-08-03T10:00:00')
    expect(new Date(getRevenueDate(sesionJulio)).getMonth()).toBe(7)  // agosto
  })

  it('la entrega manda sobre la fecha de pago', () => {
    expect(getRevenueDate({
      startTime: '2026-01-01', paymentDate: '2026-02-01', deliveredAt: '2026-03-01',
    })).toBe('2026-03-01')
  })

  it('sin cobrar todavía, vale la fecha de la cita', () => {
    expect(getRevenueDate({ startTime: '2026-07-31T15:00:00' })).toBe('2026-07-31T15:00:00')
  })

  it('no explota con una cita vacía', () => {
    expect(getRevenueDate(null)).toBeNull()
    expect(getRevenueDate(undefined)).toBeNull()
  })
})
