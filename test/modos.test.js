import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { USER_MODES } from '../src/utils/constants.js'

/**
 * El modo "Comerciante" (merchant) era un fantasma.
 *
 * Estaba en USER_MODES, así que SettingsScreen lo pintaba en el desplegable de
 * modos. Pero:
 *
 *   · nada en toda la app hacía `setUserMode('merchant')`
 *   · los tres lugares que lo miraban lo trataban idéntico a 'entrepreneur'
 *   · las claves de datos son `zenday-${modo}-...`
 *
 * O sea que elegirlo era peor que inútil: la app aparecía VACÍA (otro juego de
 * claves en localStorage y otra rama en Firestore) y lo que se cargara ahí
 * quedaba invisible desde cualquier otro modo. Un usuario que lo probaba creía
 * que había perdido todo.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('el modo Comerciante ya no existe', () => {
  it('no está en el catálogo de modos', () => {
    expect(USER_MODES.merchant).toBeUndefined()
    expect(Object.keys(USER_MODES)).toEqual(['personal', 'professional', 'entrepreneur'])
  })

  it('ningún archivo lo sigue mirando', () => {
    // Se recorre src/ entero: si alguien vuelve a agregar un
    // `userMode === 'merchant'`, este test lo caza.
    const pendientes = []
    ;(function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.jsx?$/.test(e.name)) continue
        const limpio = sinComentarios(fs.readFileSync(p, 'utf8'))
        // La migración es el único uso legítimo: convierte el valor guardado.
        const usos = (limpio.match(/'merchant'/g) || []).length
        const migracion = /guardado === 'merchant'/.test(limpio) ? 1 : 0
        if (usos - migracion > 0) pendientes.push(path.relative(SRC, p))
      }
    })(SRC)
    expect(pendientes).toEqual([])
  })

  it('los que lo trataban igual que a emprendedor quedaron limpios', () => {
    for (const f of [['components', 'layout', 'Sidebar.jsx'],
                     ['components', 'screens', 'DashboardScreen.jsx'],
                     ['components', 'common', 'AppointmentCard.jsx']]) {
      expect(sinComentarios(leer(...f))).not.toMatch(/\|\|\s*userMode === 'merchant'/)
      expect(sinComentarios(leer(...f))).not.toMatch(/userMode === 'merchant'\s*\|\|/)
    }
  })
})

describe('a quien lo tenía elegido no se lo deja tirado', () => {
  const app = leer('App.jsx')

  it('el modo guardado se migra a emprendedor', () => {
    // Sin esto, sacar merchant de USER_MODES dejaba al usuario en un modo que
    // ya no aparece en el desplegable, con la app vacía y sin forma de volver.
    expect(app).toMatch(/guardado === 'merchant'/)
    expect(app).toMatch(/setItem\('zenday-user-mode', 'entrepreneur'\)/)
  })

  it('la migración corre ANTES de decidir el modo inicial', () => {
    const bloque = app.slice(app.indexOf('const [userMode, setUserMode]'),
                             app.indexOf('const [userMode, setUserMode]') + 1200)
    expect(bloque.indexOf("guardado === 'merchant'"))
      .toBeLessThan(bloque.indexOf("return guardado || 'professional'"))
  })

  it('no se borran los datos que hubiera bajo las claves viejas', () => {
    // Migrar el modo es reversible; borrar zenday-merchant-* no lo sería.
    const limpio = sinComentarios(app)
    expect(limpio).not.toMatch(/removeItem\(.*merchant/)
    expect(limpio).not.toMatch(/zenday-merchant-\w+.*remove/)
  })
})
