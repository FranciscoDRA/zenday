import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * generateInactiveCustomersReport (y el equivalente en ReportsScreen.jsx) se
 * armaban enteros desde `appointments`: un cliente registrado que nunca hizo
 * un pedido no dejaba rastro en ningún lado, ni siquiera en el reporte de
 * "clientes inactivos" — que es justo donde más importa, porque "nunca
 * compró" es el caso más urgente de todos para un reporte de reactivación.
 *
 * `patients` llegaba como parámetro y no se usaba (lo marcó no-unused-vars).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('clientes que nunca compraron aparecen en "Inactivos"', () => {
  it('pdfReportGenerator.js: generateInactiveCustomersReport usa patients, no lo ignora', () => {
    const fuente = leer('src', 'utils', 'pdfReportGenerator.js')
    const bloque = fuente.slice(
      fuente.indexOf('export function generateInactiveCustomersReport'),
      fuente.indexOf('export function generateDailyCashCloseReport')
    )
    expect(bloque).toMatch(/sinPedidos/)
    expect(bloque).toMatch(/nuncaCompro|Nunca compró/)
    // No debe crashear con lastOrder undefined: el que nunca compró no tiene
    // fecha de última compra, así que el .toISOString() tiene que estar
    // protegido con un chequeo, no llamado directo.
    expect(bloque).toMatch(/c\.lastOrder \? formatDate\(c\.lastOrder\.toISOString\(\)\) : /)
  })

  it('ReportsScreen.jsx: inactiveStats también incluye a los que nunca compraron', () => {
    const fuente = leer('src', 'components', 'screens', 'ReportsScreen.jsx')
    const bloque = fuente.slice(
      fuente.indexOf('const inactiveStats = useMemo'),
      fuente.indexOf('// ── Orden elegido')
    )
    expect(bloque).toMatch(/sinPedidos/)
    // Sólo se arma con `patients` cuando selectedProfile === userMode: el
    // prop `patients` refleja userMode (ver App.jsx), no selectedProfile.
    expect(bloque).toMatch(/selectedProfile === userMode/)
  })

  it('generateCustomersReport ya no recibe patients (nunca lo usó: es un ranking por gasto)', () => {
    const fuente = leer('src', 'utils', 'pdfReportGenerator.js')
    const firma = fuente.slice(
      fuente.indexOf('export function generateCustomersReport'),
      fuente.indexOf('export function generateCustomersReport') + 200
    )
    expect(firma).not.toMatch(/\bpatients\b/)
  })
})
