import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ACTIVE_STATUSES, COMPLETED_STATUSES, STATUSES, ORDER_STATUSES } from '../src/utils/constants.js'
import { normalizarNotas, fechaDeNota, motivosParaNoBorrarCliente } from '../src/utils/helpers.js'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const css      = leer('App.css')
const detalle  = leer('components', 'screens', 'PatientDetailScreen.jsx')
const lista    = leer('components', 'screens', 'PatientsScreen.jsx')
const app      = leer('App.jsx')

const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('el botón de borrar una nota se puede ver', () => {
  /** El bloque de reglas de .delete-note, sin comentarios. */
  const bloque = (() => {
    const limpio = sinComentarios(css)
    const i = limpio.indexOf('.delete-note {')
    return limpio.slice(i, limpio.indexOf('}', i))
  })()

  it('no está en opacity: 0', () => {
    // Estaba en 0 y sólo aparecía con :hover sobre la nota. El botón existía y
    // funcionaba: simplemente no se veía. En una pantalla táctil no hay hover,
    // así que era inalcanzable. Eso es "no puedo eliminar notas".
    expect(bloque).not.toMatch(/opacity:\s*0\s*;/)
  })

  it('tiene una opacidad de reposo visible', () => {
    const m = bloque.match(/opacity:\s*([\d.]+)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThanOrEqual(0.4)
  })

  it('también se ve al llegar con el teclado', () => {
    expect(sinComentarios(css)).toMatch(/\.delete-note:focus-visible/)
  })

  it('la cabecera de notas tiene layout — si no, los botones se apilan', () => {
    expect(sinComentarios(css)).toMatch(/\.notes-header\s*\{[^}]*display:\s*flex/)
  })
})

describe('borrar notas', () => {
  it('compara los ids como texto', () => {
    // Las notas viejas pueden tener id numérico y las nuevas string: `!==`
    // estricto no encontraba la nota y no borraba nada.
    expect(detalle).toMatch(/String\(n\.id\) !== String\(noteId\)/)
  })

  it('avisa si no encontró la nota en vez de decir que la borró', () => {
    const bloque = detalle.slice(detalle.indexOf('const handleDeleteNote'),
                                 detalle.indexOf('const alternarNota'))
    expect(bloque).toMatch(/updatedNotes\.length === currentNotes\.length/)
    expect(bloque.indexOf('No se encontró esa nota'))
      .toBeLessThan(bloque.indexOf("'Nota eliminada'"))
  })

  it('se ordenan por fecha, no por id', () => {
    // `b.id - a.id` con ids string da NaN: el orden quedaba al azar.
    expect(sinComentarios(detalle)).not.toMatch(/sort\(\(a, b\) => b\.id - a\.id\)/)
    // `|| 0` para que las notas sin fecha no ensucien el orden con NaN.
    expect(detalle).toMatch(/new Date\(b\.date \|\| 0\) - new Date\(a\.date \|\| 0\)/)
  })

  it('se pueden seleccionar varias y borrarlas juntas', () => {
    expect(detalle).toContain('borrarNotasElegidas')
    expect(detalle).toContain('alternarTodas')
    expect(detalle).toMatch(/type="checkbox"/)
  })

  it('la selección aparece con 2 notas, no con 8', () => {
    // Con umbral 8, alguien con 7 notas sigue borrando de a una.
    expect(detalle).toMatch(/notas\.length >= 2/)
  })
})

describe('borrar clientes', () => {
  it('sólo bloquea por pedidos ACTIVOS', () => {
    // Antes contaba todos: completados, entregados y cancelados de hace años.
    // Cualquier cliente con historial quedaba imposible de borrar, y el
    // mensaje pedía "completá los pedidos primero" cuando ya estaban completos.
    const bloque = lista.slice(lista.indexOf('const verificarPedidosAsociados'),
                               lista.indexOf('const totalPedidos'))
    expect(bloque).toMatch(/ACTIVE_STATUSES\.has\(a\.status\)/)
  })

  it('el nombre sólo se usa cuando el pedido no tiene patientId', () => {
    // Con el fallback suelto, dos personas que se llaman igual se bloqueaban
    // mutuamente.
    const bloque = lista.slice(lista.indexOf('const verificarPedidosAsociados'),
                               lista.indexOf('const totalPedidos'))
    expect(bloque).toMatch(/if \(a\.patientId\) return String\(a\.patientId\)/)
  })
})

describe('una sola definición de "activo"', () => {
  it('App.jsx no tiene su propia copia', () => {
    expect(sinComentarios(app)).not.toMatch(/const ACTIVE_STATUSES = new Set/)
    expect(app).toMatch(/ACTIVE_STATUSES.*from '\.\/utils\/constants'/)
  })

  it("incluye 'in-progress', con guion — no 'in_progress'", () => {
    expect(ACTIVE_STATUSES.has('in-progress')).toBe(true)
    expect(ACTIVE_STATUSES.has('in_progress')).toBe(false)
  })

  it('todos los estados listados existen de verdad', () => {
    const reales = new Set([...Object.keys(STATUSES), ...Object.keys(ORDER_STATUSES)])
    for (const e of [...ACTIVE_STATUSES, ...COMPLETED_STATUSES]) {
      expect(reales.has(e), `"${e}" no está en STATUSES ni en ORDER_STATUSES`).toBe(true)
    }
  })

  it('activo y terminado no se pisan', () => {
    for (const e of ACTIVE_STATUSES) expect(COMPLETED_STATUSES.has(e)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  El caso de la captura: un cliente con `notes` como STRING.
//
//  Los clientes creados por un pedido web nacían con
//    notes: `Cliente web — primer pedido: ${prods}`
//  o sea texto, no un array. Como el resto del código asume array:
//
//    "Notas (45)"        ← largo del texto, no cantidad de notas
//    45 filas vacías     ← [...string] da un carácter por nota
//    "Invalid Date"      ← ningún carácter tiene .date
//    "Eliminar (1)"      ← todos los ids son undefined → Set de tamaño 1
// ─────────────────────────────────────────────────────────────────────────────
describe('notas que venían guardadas como texto', () => {
  const textoWeb = 'Cliente web — primer pedido: Oso Saxofonista'

  it('un string es UNA nota, no una por carácter', () => {
    const r = normalizarNotas(textoWeb)
    expect(r).toHaveLength(1)
    expect(r[0].content).toBe(textoWeb)
  })

  it('no se pierde el texto que ya estaba guardado', () => {
    expect(normalizarNotas(textoWeb)[0].content).toContain('Oso Saxofonista')
  })

  it('queda marcada como heredada, para poder mostrarla distinto', () => {
    expect(normalizarNotas(textoWeb)[0].heredada).toBe(true)
  })

  it('45 notas sin id reciben 45 ids distintos', () => {
    // Este es el bug de "Todas": el Set colapsaba los ids repetidos.
    const sinId = Array.from({ length: 45 }, () => ({ content: 'x' }))
    const ids = new Set(normalizarNotas(sinId).map(n => String(n.id)))
    expect(ids.size).toBe(45)
  })

  it('los ids repetidos también se separan', () => {
    const ids = new Set(normalizarNotas([{ id: 'a' }, { id: 'a' }, { id: 'a' }]).map(n => String(n.id)))
    expect(ids.size).toBe(3)
  })

  it('si los ids ya están bien, no se toca el objeto', () => {
    const ok = [{ id: 'x' }, { id: 'y' }]
    expect(normalizarNotas(ok)[0]).toBe(ok[0])
  })

  it('aguanta null, undefined y basura adentro del array', () => {
    expect(normalizarNotas(null)).toEqual([])
    expect(normalizarNotas(undefined)).toEqual([])
    expect(normalizarNotas('')).toEqual([])
    expect(normalizarNotas([{ id: 1 }, null, 'x', 7])).toHaveLength(1)
  })

  it('una nota sin fecha no dice "Invalid Date"', () => {
    expect(fechaDeNota({ date: null })).toBe('Sin fecha')
    expect(fechaDeNota({ date: 'cualquier cosa' })).toBe('Sin fecha')
    expect(fechaDeNota({})).toBe('Sin fecha')
  })
})

describe('el origen: el cliente web ya no nace con notes de texto', () => {
  it('App.jsx guarda un array', () => {
    const bloque = app.slice(app.indexOf('Cliente web — primer pedido') - 400,
                             app.indexOf('Cliente web — primer pedido') + 200)
    expect(bloque).toMatch(/notes:\s*\[\{/)
    expect(bloque).toMatch(/content:\s*`Cliente web/)
  })
})

describe('la pantalla usa las notas normalizadas', () => {
  it('no lee patient.notes crudo en ningún lado', () => {
    const limpio = sinComentarios(detalle)
    const usos = (limpio.match(/patient\??\.notes/g) || [])
    // El único permitido es el que se lo pasa a normalizarNotas.
    expect(usos).toHaveLength(1)
    expect(limpio).toMatch(/normalizarNotas\(patient\?\.notes\)/)
  })

  it('la línea de tiempo también normaliza', () => {
    const tl = leer('components', 'screens', 'PatientTimeline.jsx')
    expect(tl).toMatch(/normalizarNotas\(patient\?\.notes\)/)
  })

  it('una nota sin texto muestra un motivo, no una fila en blanco', () => {
    expect(detalle).toContain('Nota sin texto')
  })
})

describe('qué impide borrar un cliente', () => {
  it('pedidos activos, notas y adjuntos', () => {
    expect(motivosParaNoBorrarCliente({ pedidosActivos: 2 })).toEqual(['2 pedidos activos'])
    expect(motivosParaNoBorrarCliente({ notas: 1 })).toEqual(['1 nota'])
    expect(motivosParaNoBorrarCliente({ adjuntos: 3 })).toEqual(['3 documentos adjuntos'])
  })

  it('un cliente vacío se puede borrar', () => {
    expect(motivosParaNoBorrarCliente({})).toEqual([])
    expect(motivosParaNoBorrarCliente({ pedidosActivos: 0, notas: 0, adjuntos: 0 })).toEqual([])
  })

  it('los enumera todos juntos', () => {
    expect(motivosParaNoBorrarCliente({ pedidosActivos: 3, notas: 45, adjuntos: 2 }))
      .toEqual(['3 pedidos activos', '45 notas', '2 documentos adjuntos'])
  })

  it('la pantalla de detalle mira las tres cosas', () => {
    expect(detalle).toMatch(/notas:\s*notas\.length/)
    expect(detalle).toMatch(/adjuntos:\s*documents\.length/)
    expect(detalle).toMatch(/ACTIVE_STATUSES\.has\(a\.status\)/)
  })

  it('ya no dice "completá los pedidos primero" cuando no se puede', () => {
    expect(sinComentarios(detalle)).not.toContain('Completar o cancelar todas sus citas')
    expect(sinComentarios(lista)).not.toContain('Eliminá o completá los pedidos primero')
  })
})
