import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * "No puedo eliminar notas."
 *
 * El botón existía, el handler andaba, el test unitario pasaba. Lo que fallaba
 * era una línea de CSS: `opacity: 0`, y el botón sólo aparecía con el mouse
 * encima de la nota. En una tablet no hay hover: el botón era inalcanzable.
 *
 * Eso NO lo encontró ningún test — lo encontró el usuario, quejándose.
 *
 * Así que en vez de arreglar ese botón y seguir, este archivo recorre TODO
 * App.css buscando el mismo patrón: un control que hace algo (editar, borrar,
 * descargar) escondido en opacity:0 esperando un hover que en pantalla táctil
 * nunca llega. Si alguien vuelve a escribir uno, esto lo caza acá y no en la
 * computadora de un cliente.
 *
 * Encontró cinco además del de las notas:
 *   .btn-eliminar             borrar un pedido del kanban
 *   .document-actions         ver / descargar / borrar un documento clínico
 *   .expense-actions          editar / eliminar un gasto
 *   .patient-actions-premium  editar / eliminar un cliente
 *   .product-actions          editar / eliminar un artículo
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const css = fs.readFileSync(path.join(SRC, 'App.css'), 'utf8')

/** CSS sin comentarios: si no, el escáner encuentra el código viejo citado. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Devuelve las reglas de primer nivel (fuera de @media / @supports).
 *
 * Las de adentro de un @media se saltean a propósito: ahí `opacity: 0` puede
 * ser una decisión deliberada para un ancho concreto.
 */
function reglasDeRaiz(fuente) {
  const limpio = sinComentarios(fuente)
  const reglas = []
  let i = 0
  while (i < limpio.length) {
    const abre = limpio.indexOf('{', i)
    if (abre === -1) break
    const selector = limpio.slice(i, abre).trim()

    if (selector.startsWith('@')) {
      // Bloque anidado: lo saltea entero contando llaves.
      let prof = 1, j = abre + 1
      while (j < limpio.length && prof > 0) {
        if (limpio[j] === '{') prof++
        else if (limpio[j] === '}') prof--
        j++
      }
      i = j
      continue
    }

    const cierra = limpio.indexOf('}', abre)
    if (cierra === -1) break
    reglas.push({ selector, cuerpo: limpio.slice(abre + 1, cierra) })
    i = cierra + 1
  }
  return reglas
}

/** ¿El selector nombra algo en lo que se hace clic? */
const PARECE_CONTROL = /(^|[\s.#>+~])(btn|button|boton)|-(actions|btn|button)\b|\b(delete|eliminar|borrar|editar|edit|download|descargar|remove|close|cerrar)/i

/**
 * El input nativo de un interruptor va en opacity:0 A PROPÓSITO: lo que se ve
 * y se toca es el slider estilizado que viene al lado. Esconderlo es correcto.
 * Lo que sí hace falta ahí es un anillo de foco, y eso se prueba aparte.
 */
const esInputEscondidoDeUnSwitch = (sel) => /\binput\b/.test(sel)

describe('ningún control interactivo arranca invisible', () => {
  const enCero = reglasDeRaiz(css)
    .filter(r => /opacity:\s*0\s*(;|$)/.test(r.cuerpo))
    .filter(r => PARECE_CONTROL.test(r.selector))
    .filter(r => !esInputEscondidoDeUnSwitch(r.selector))
    .map(r => r.selector)

  it('no hay ninguno en opacity: 0', () => {
    // Si esto falla, el selector que aparece acá es un botón que el usuario no
    // ve hasta pasar el mouse — y en una tablet no lo ve nunca.
    expect(enCero).toEqual([])
  })
})

describe('los cinco que estaban escondidos', () => {
  const CONTROLES = [
    ['.patient-actions-premium', 'editar y eliminar un cliente'],
    ['.product-actions',         'editar y eliminar un artículo'],
    ['.expense-actions',         'editar y eliminar un gasto'],
    ['.document-actions',        'ver, descargar y borrar un documento clínico'],
    ['.btn-eliminar',            'borrar un pedido del kanban'],
  ]

  /** El cuerpo de la regla que DEFINE ese selector (no las que lo mencionan). */
  const definicion = (sel) => {
    const r = reglasDeRaiz(css).find(x => x.selector === sel)
    expect(r, `no existe una regla \`${sel} { ... }\` en App.css`).toBeTruthy()
    return r.cuerpo
  }

  for (const [sel, queHace] of CONTROLES) {
    describe(`${sel} — ${queHace}`, () => {
      it('tiene una opacidad de reposo visible', () => {
        const m = definicion(sel).match(/opacity:\s*([\d.]+)/)
        expect(m, `${sel} no declara opacity`).not.toBeNull()
        expect(Number(m[1])).toBeGreaterThanOrEqual(0.4)
      })

      it('llega a opacidad plena al enfocarlo con el teclado', () => {
        // :focus-within para los contenedores, :focus-visible para el botón suelto.
        const limpio = sinComentarios(css)
        const escapado = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect(limpio).toMatch(new RegExp(`${escapado}:focus-(within|visible)`))
      })
    })
  }
})

describe('los interruptores muestran dónde está el foco', () => {
  it('el input escondido pinta un anillo sobre el slider', () => {
    // El input está en opacity:0 (correcto), así que el foco hay que dibujarlo
    // sobre el hermano visible. Sin esto, con Tab se llega a un interruptor y
    // nada en pantalla lo indica.
    const limpio = sinComentarios(css)
    expect(limpio).toMatch(/\.toggle-switch input:focus-visible \+ \.toggle-slider/)
    expect(limpio).toMatch(/\.toggle-premium input:focus-visible \+ \.toggle-slider-premium/)
  })

  it('esconder el input nativo sigue estando bien', () => {
    // Que quede escrito: esto NO es el bug de arriba. Es la forma normal de
    // hacer un interruptor estilizado.
    expect(sinComentarios(css)).toMatch(/\.toggle-switch input,\s*\.toggle-premium input\s*\{[^}]*opacity:\s*0/)
  })
})
