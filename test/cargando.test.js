import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * El medio segundo en que la app mentía.
 *
 * App.jsx tenía una bandera `loaded`: se apaga al arrancar y se prende cuando
 * terminan de llegar los datos. Existía desde siempre. Y nunca salía de
 * App.jsx — no se pasaba a ninguna pantalla, no se usaba para nada.
 *
 * Así que mientras los datos venían en camino, cada pantalla se dibujaba con
 * los arrays vacíos. Lo que veía el usuario al abrir ZenDay:
 *
 *     Ingresos del mes    $0
 *     Gastos del mes      $0
 *     Ganancia neta       $0
 *     ↓ 0% vs anterior
 *     No hay consultas para hoy
 *
 * ...y medio segundo después, los números de verdad.
 *
 * No rompía nada. Era peor que eso: cada mañana el programa le decía al dueño
 * que su negocio no había facturado nada, y después se corregía solo. Es el
 * tipo de cosa que se siente y no se sabe nombrar — "le falta algo",
 * "se siente raro".
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8')

const app = leer('src', 'App.jsx')
const css = leer('src', 'App.css')
const comp = leer('src', 'components', 'common', 'CargandoPantalla.jsx')

const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('la bandera de carga por fin se usa', () => {
  const limpio = sinComentarios(app)

  it('`loaded` decide qué se dibuja', () => {
    expect(limpio).toMatch(/\{loaded\s*\n?\s*\?\s*<S \{\.\.\.sharedProps\}/)
    expect(limpio).toMatch(/:\s*<CargandoPantalla \/>\}/)
  })

  it('se declara y se usa en el MISMO componente', () => {
    // Si el gate quedara en otro componente, `loaded` sería undefined y la app
    // arrancaría en blanco con un ReferenceError. Vale la pena comprobarlo:
    // esbuild no lo caza, porque sintácticamente es válido.
    const lineas = app.replace(/\r/g, '').split('\n')
    const componentes = []
    lineas.forEach((l, i) => {
      if (/^(export )?function [A-Z]\w*/.test(l)) componentes.push(i + 1)
    })
    const donde = (predicado) => {
      const n = lineas.findIndex(predicado) + 1
      expect(n, 'no encontré la línea').toBeGreaterThan(0)
      return componentes.filter(c => c < n).pop()
    }
    const declara = donde(l => l.includes('const [loaded, setLoaded]'))
    const usa     = donde(l => /\{loaded$/.test(l.trimEnd()))
    expect(declara).toBe(usa)
  })

  it('el gate está en UN solo lugar', () => {
    // Adentro de cada pantalla se olvidaría alguna. Acá se envuelve el único
    // punto donde se dibuja la pantalla activa.
    expect((sinComentarios(app).match(/<CargandoPantalla \/>/g) || [])).toHaveLength(1)
  })

  it('el esqueleto queda DENTRO del ErrorBoundary', () => {
    // Si quedara afuera y el esqueleto fallara, se cae toda la app.
    const i = app.indexOf('<ErrorBoundary key={id}')
    const j = app.indexOf('</ErrorBoundary>', i)
    expect(app.slice(i, j)).toContain('<CargandoPantalla />')
  })
})

describe('el esqueleto tiene la forma de la pantalla', () => {
  it('trae KPIs y lista, que es lo que hay debajo', () => {
    // Si el esqueleto no se pareciera al contenido real, al llegar los datos
    // saltaría todo de lugar y el remedio sería peor que la enfermedad.
    expect(comp).toMatch(/cargando-kpis/)
    expect(comp).toMatch(/cargando-lista/)
  })

  it('avisa a los lectores de pantalla', () => {
    // Un esqueleto es puro adorno visual: sin esto, quien usa lector no se
    // entera de que hay algo cargando.
    expect(comp).toMatch(/aria-busy="true"/)
    expect(comp).toMatch(/sr-only/)
  })
})

describe('el CSS del esqueleto', () => {
  it('define todas las clases que usa el componente', () => {
    const usadas = [...comp.matchAll(/className="([^"]+)"/g)]
      .flatMap(m => m[1].split(/\s+/))
      .filter(c => c.startsWith('cargando'))
    for (const c of new Set(usadas)) {
      expect(css, `falta .${c} en App.css`).toMatch(new RegExp(`\\.${c}\\b`))
    }
  })

  it('respeta a quien pidió menos movimiento', () => {
    // Windows tiene esa opción y hay gente a la que el movimiento le marea.
    const bloque = css.slice(css.indexOf('@keyframes cargandoBrillo'))
    expect(bloque).toMatch(/prefers-reduced-motion/)
    expect(bloque).toMatch(/\.cargando-bloque \{ animation: none/)
  })

  it('el brillo se ve distinto en modo oscuro', () => {
    // El degradado blanco al 45% sobre fondo oscuro es un flash desagradable.
    expect(css).toMatch(/body\.dark \.cargando-bloque/)
  })
})
