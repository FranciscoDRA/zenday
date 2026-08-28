import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Al crear un pedido nuevo y escribir algo en el buscador de artículos, la
 * pantalla se rompía: el filtro usaba texto(p.name)/texto(p.code) pero el
 * archivo nunca importaba texto() de utils/helpers. En cuanto la búsqueda
 * dejaba de estar vacía, `texto` era undefined → ReferenceError → lo agarraba
 * el ErrorBoundary más cercano ("Algo se rompió en esta pantalla").
 *
 * Encima, como ErrorBoundary no pasa por registrarError(), el aviso de "esto
 * no se guardó en el log de errores local" era correcto pero confuso: el
 * error SÍ estaba (en Sentry), sólo no en el panel "Reportar problema".
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const fuente = fs.readFileSync(path.join(ROOT, 'src', 'components', 'screens', 'EmprendedorPanel.jsx'), 'utf8')

describe('EmprendedorPanel importa todo lo que usa en el filtro de productos', () => {
  it('importa texto() de utils/helpers', () => {
    expect(fuente).toMatch(/import \{[^}]*\btexto\b[^}]*\} from '\.\.\/\.\.\/utils\/helpers'/)
  })

  it('el filtro de productosFiltrados sigue usando texto() en ambos campos', () => {
    const bloque = fuente.slice(
      fuente.indexOf('const productosFiltrados'),
      fuente.indexOf('const productosFiltrados') + 700
    )
    expect(bloque).toMatch(/texto\(p\.name\)/)
    expect(bloque).toMatch(/texto\(p\.code\)/)
  })
})
