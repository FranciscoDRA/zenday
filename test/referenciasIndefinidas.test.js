import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Dos ReferenceError que rompían la pantalla apenas se disparaba el código
 * que las tenía, encontradas corriendo ESLint sobre todo el proyecto
 * (regla no-undef) después de arreglar la configuración:
 *
 *  · pdfReportGenerator.js llamaba formatDateTime() en el comprobante
 *    individual, pero el archivo sólo define formatDate/formatDateLong.
 *  · IntegrationManager.jsx leía process.env.NODE_ENV al montar — process
 *    no existe en el renderer (nodeIntegration:false). Rompía la pantalla
 *    de Integraciones ANTES de que su propio try/catch pudiera actuar,
 *    porque la referencia caía fuera del try.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('el comprobante individual usa una función que existe', () => {
  const fuente = leer('src', 'utils', 'pdfReportGenerator.js')

  it('define formatDateTime', () => {
    expect(fuente).toMatch(/function formatDateTime\(/)
  })

  it('generateReceiptPDF la usa', () => {
    const bloque = fuente.slice(fuente.indexOf('export function generateReceiptPDF'))
    expect(bloque).toMatch(/formatDateTime\(a\.startTime\)/)
  })
})

describe('IntegrationManager no usa process.env en el renderer', () => {
  const fuente = leer('src', 'components', 'common', 'IntegrationManager.jsx')

  it('usa import.meta.env.DEV, no process.env', () => {
    expect(fuente).not.toMatch(/process\.env/)
    expect(fuente).toMatch(/import\.meta\.env\.DEV/)
  })
})
