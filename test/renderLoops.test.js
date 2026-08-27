import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

/**
 * Detecta el bug que dejó ZenDay inutilizable: GlobalSearch entraba en un bucle
 * infinito de renders apenas abrías la app, sin tocar nada.
 *
 * Hacen falta TRES cosas juntas:
 *
 *   1. una prop con default literal en la firma  ->  `orders = []`
 *   2. esa prop en las deps de un useEffect
 *   3. ese useEffect llamando a algún setState
 *
 * El (1) es la trampa: parece constante pero se evalúa en CADA render, así que
 * devuelve un array nuevo cada vez. Con (2) el efecto corre siempre; con (3) se
 * realimenta. El bucle es SÍNCRONO: bloquea el hilo y come CPU.
 *
 * La solución es una constante de módulo compartida:
 *
 *     const SIN_DATOS = Object.freeze([])
 *     function Comp({ orders = SIN_DATOS }) { ... }
 *
 * Faltando el (3) no hay bucle, sólo trabajo de más — eso NO se reporta acá,
 * para que este test signifique siempre "hay un bucle" y no se le pierda el
 * respeto.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))

const DEFAULT_LITERAL = /(\w+)\s*=\s*(\[\s*\]|\{[^}]*\}|\(\s*\)\s*=>|function\s*\()/g
const numeroDeLinea = (src, i) => src.slice(0, i).split('\n').length

function archivosFuente(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...archivosFuente(p))
    else if (/\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** Desde `useX(` busca el `)` que lo cierra, contando paréntesis y saltando strings. */
function parentesisDeCierre(src, desde) {
  let prof = 0, comilla = null
  for (let i = desde; i < src.length; i++) {
    const c = src[i]
    if (comilla) { if (c === comilla && src[i - 1] !== '\\') comilla = null; continue }
    if (c === '"' || c === "'" || c === '`') { comilla = c; continue }
    if (c === '(') prof++
    else if (c === ')' && --prof === 0) return i
  }
  return -1
}

function hooksConDeps(src) {
  const out = []
  for (const m of src.matchAll(/\buse(Effect|LayoutEffect|Memo|Callback)\s*\(/g)) {
    const abre = m.index + m[0].length - 1
    const cierra = parentesisDeCierre(src, abre)
    if (cierra < 0) continue
    const cuerpo = src.slice(abre + 1, cierra)
    const deps = cuerpo.match(/,\s*\[([^\]]*)\]\s*$/)
    if (!deps) continue
    out.push({
      tipo: 'use' + m[1],
      linea: numeroDeLinea(src, m.index),
      vars: deps[1].split(',').map(s => s.trim()).filter(Boolean),
      haceSetState: /\bset[A-Z]\w*\s*\(/.test(cuerpo.slice(0, deps.index)),
    })
  }
  return out
}

function buscarBucles(raiz = SRC) {
  const encontrados = []
  for (const archivo of archivosFuente(raiz)) {
    const src = fs.readFileSync(archivo, 'utf8')
    const rel = path.relative(raiz, archivo).replace(/\\/g, '/')
    const hooks = hooksConDeps(src)

    const firmas = src.matchAll(
      /(?:function|const)\s+(\w+)\s*=?\s*\(?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)?\s*(?:=>)?\s*\{/g)

    for (const f of firmas) {
      const [, componente, params] = f
      for (const d of params.matchAll(DEFAULT_LITERAL)) {
        const prop = d[1]
        const peligrosos = hooks.filter(h =>
          h.vars.includes(prop) && h.tipo.endsWith('Effect') && h.haceSetState)
        for (const h of peligrosos) {
          encontrados.push(`${rel}:${numeroDeLinea(src, f.index)} ${componente}() — `
                         + `prop "${prop}" con default literal está en las deps del `
                         + `${h.tipo} de la línea ${h.linea}, que hace setState`)
        }
      }
    }
  }
  return encontrados
}

describe('ningún componente entra en bucle infinito de renders', () => {
  it('no hay props con default literal en deps de un useEffect que hace setState', () => {
    expect(buscarBucles()).toEqual([])
  })

  it('el detector encuentra el bug original de GlobalSearch', () => {
    // Sin esto, el test de arriba podría estar pasando porque el detector no
    // detecta nada. Se le da el código exacto que rompió la app.
    // El directorio va en la carpeta temporal del sistema, no dentro de src/:
    // un test no tiene por qué escribir en el código fuente.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenday-bucle-'))
    try {
      fs.writeFileSync(path.join(dir, 'Roto.jsx'), `
        export function Roto({ orders = [] }) {
          const [results, setResults] = useState([])
          useEffect(() => {
            if (!query) { setResults([]); return }
            setResults(orders)
          }, [query, orders])
          return null
        }`)
      const hallado = buscarBucles(dir)
      expect(hallado.some(h => h.includes('Roto()') && h.includes('orders'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Cableado de la sincronización.
//
//  El diff se prueba en helpers.test.js. Acá se comprueba que esté ENCHUFADO
//  donde corresponde — y, sobre todo, que NO esté enchufado donde no va: si el
//  listener de Firestore usara el setter sincronizado, cada snapshot del
//  servidor se devolvería al servidor en un eco sin fin.
// ─────────────────────────────────────────────────────────────────────────────
describe('los datos que carga el usuario llegan al servidor', () => {
  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')

  it('las pantallas reciben los setters que persisten', () => {
    expect(app).toMatch(/setProducts:\s*setProductsSync/)
    expect(app).toMatch(/setExpenses:\s*setExpensesSync/)
  })

  it('el listener de Firestore usa los setters CRUDOS, no los sincronizados', () => {
    // Si esto se rompe, cada snapshot recibido se reenvía al servidor.
    expect(app).toMatch(/subscribe\('products',\s*guard\('products',\s*setProducts\)/)
    expect(app).toMatch(/subscribe\('expenses',\s*guard\('expenses',\s*setExpenses\)/)
  })

  it('setAppointmentsDirect sincroniza (editar precio, borrar pedido, entregar)', () => {
    const bloque = app.slice(app.indexOf('const setAppointmentsDirect'),
                             app.indexOf('const setAppointmentsDirect') + 2000)
    expect(bloque).toContain("sincronizarColeccion('appointments'")
  })

  it('el efecto de sincronización no se arma dentro de un setState', () => {
    // Meter el efecto en el updater es impuro: StrictMode lo corre dos veces
    // y cada guardado saldría duplicado. Tiene que calcularse afuera.
    expect(app).not.toMatch(/set(Products|Expenses)\(\s*prev\s*=>\s*\{[\s\S]{0,400}sincronizarColeccion/)
  })

  it('el contexto de toast está memorizado', () => {
    // Sin esto el provider entrega un objeto nuevo por render, App.jsx tiene
    // `toast` en las deps del efecto de suscripción, y cada toast rearmaba las
    // cuatro suscripciones trayendo un snapshot que pisaba lo recién guardado.
    const toastCtx = fs.readFileSync(path.join(SRC, 'contexts', 'ToastContext.jsx'), 'utf8')
    expect(toastCtx).toMatch(/useMemo\(\(\)\s*=>\s*\(\{\s*addToast,\s*removeToast\s*\}\)/)
    // El objeto literal se busca sólo en el JSX. Buscarlo en todo el archivo
    // daba falso positivo con el comentario que explica el bug, que lo cita.
    expect(toastCtx).toMatch(/<ToastContext\.Provider value=\{value\}>/)
  })

  it('las notas del historial del paciente se persisten', () => {
    const tl = fs.readFileSync(path.join(SRC, 'components', 'screens', 'PatientTimeline.jsx'), 'utf8')
    expect(tl).toContain('onAddNote')
    expect(tl).not.toContain('localNotes')   // el useState que las tiraba
  })
})
