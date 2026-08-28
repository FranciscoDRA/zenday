import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * ZenDay maneja historias clínicas. El diseño original de reporteDeErrores.js
 * es explícito: "NO SALE NADA DE LA MAQUINA" salvo que el usuario lo mande a
 * mano. Sentry rompe esa regla a propósito (para monitoreo real), pero sólo
 * puede mandar el error técnico — nunca texto de la pantalla, nombres de
 * pacientes, ni nada que el usuario haya escrito.
 *
 * Estos tests bloquean esa configuración: si alguien agrega una integración
 * de replay/breadcrumbs de DOM, o saca sendDefaultPii:false, esto se rompe
 * antes de que llegue a producción.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('Sentry en el proceso principal (electron/main.cjs)', () => {
  const fuente = leer('electron', 'main.cjs')
  const bloque = fuente.slice(fuente.indexOf('Sentry.init('), fuente.indexOf('Sentry.init(') + 400)

  it('no manda información personal por defecto', () => {
    expect(bloque).toMatch(/sendDefaultPii:\s*false/)
  })

  it('el DSN sale de una variable de entorno, no está hardcodeado', () => {
    expect(bloque).toMatch(/process\.env\.SENTRY_DSN/)
  })
})

describe('Sentry en el renderer (src/main.jsx)', () => {
  const fuente = leer('src', 'main.jsx')
  const bloque = fuente.slice(fuente.indexOf('Sentry.init('), fuente.indexOf('Sentry.init(') + 400)

  it('no manda información personal por defecto', () => {
    expect(bloque).toMatch(/sendDefaultPii:\s*false/)
  })

  it('no agrega integraciones por defecto (sin captura de DOM/breadcrumbs)', () => {
    expect(bloque).toMatch(/integrations:\s*\[\]/)
  })
})

describe('lo que se manda a Sentry es el error, no el contenido de la pantalla', () => {
  it('reporteDeErrores.js manda un Error reconstruido (mensaje + stack), no el DOM ni el estado', () => {
    const fuente = leer('src', 'utils', 'reporteDeErrores.js')
    const bloque = fuente.slice(fuente.indexOf('Sentry.captureException'), fuente.indexOf('Sentry.captureException') + 200)
    expect(bloque).toMatch(/captureException\(err, \{ tags: \{ scope: error\.scope \} \}\)/)
  })

  it('ErrorBoundary manda el error de React y el component stack, no props ni datos del formulario', () => {
    const fuente = leer('src', 'components', 'common', 'ErrorBoundary.jsx')
    const bloque = fuente.slice(fuente.indexOf('Sentry.captureException'), fuente.indexOf('Sentry.captureException') + 250)
    expect(bloque).toMatch(/componentStack/)
    expect(bloque).not.toMatch(/this\.props\.children/)
  })
})
