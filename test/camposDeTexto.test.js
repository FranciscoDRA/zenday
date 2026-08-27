import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { texto, normalizeEntity, normalizeEntities } from '../src/utils/helpers.js'

/**
 * "No puedo agregar clientes."
 *
 *     Uncaught (in promise) TypeError: ge.phone.trim is not a function
 *         at Array.some (<anonymous>)
 *
 * QUÉ PASABA
 * ──────────
 * Excel devuelve un NÚMERO cuando la celda tiene sólo dígitos. Un teléfono
 * uruguayo escrito 099412887 entra a la app como el número 99412887 — y de
 * paso pierde el cero de adelante.
 *
 * Después, al guardar un cliente nuevo, el chequeo de duplicados hacía:
 *
 *     const samePhone = (patientData.phone && p.phone && p.phone.trim() === ...)
 *
 * El guard `p.phone &&` no protege nada: un número es truthy. Así que pasaba y
 * `.trim()` reventaba.
 *
 * Y lo peor es DÓNDE reventaba: adentro del guardado. La excepción subía por
 * una promesa sin catch, o sea que el usuario apretaba "Guardar" y no pasaba
 * absolutamente nada. Sin cartel, sin error, sin pista. Se quedaba apretando
 * el botón — once veces, según la consola que lo destapó.
 *
 * Con un solo cliente mal guardado, NINGÚN cliente nuevo se podía crear.
 *
 * EL ARREGLO, EN TRES CAPAS
 * ─────────────────────────
 *   1. normalizeEntity coerciona los campos de texto. Como corre en cada punto
 *      de entrada, limpia también los registros que YA estaban mal guardados.
 *   2. texto() en las comparaciones, para los datos que todavía no pasaron por
 *      normalizeEntity (una lista recién salida de un Excel, por ejemplo).
 *   3. La importación coerciona en el origen, así no entra más basura.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

// ─────────────────────────────────────────────────────────────────────────────
//  1. El crash, y que no vuelva
// ─────────────────────────────────────────────────────────────────────────────
describe('un teléfono numérico ya no tira abajo la app', () => {
  const comoLoDejaExcel = { id: 7, name: 'Lucía', phone: 99412887, email: null }

  it('así se rompía', () => {
    expect(() => comoLoDejaExcel.phone.trim()).toThrow(/trim is not a function/)
  })

  it('normalizeEntity lo convierte a texto', () => {
    const l = normalizeEntity(comoLoDejaExcel)
    expect(typeof l.phone).toBe('string')
    expect(l.phone.trim()).toBe('99412887')
  })

  it('y sigue arreglando los ids, como antes', () => {
    expect(normalizeEntity(comoLoDejaExcel).id).toBe('7')
  })

  it('no toca los null: hay pantallas que los usan como "vacío"', () => {
    expect(normalizeEntity(comoLoDejaExcel).email).toBeNull()
  })

  it('si ya estaba todo bien, devuelve el MISMO objeto', () => {
    // Importa para React: un objeto nuevo en cada lectura provocaría renders
    // de más en todas las listas.
    const limpio = { id: 'a', name: 'Ana', phone: '099 412 887' }
    expect(normalizeEntity(limpio)).toBe(limpio)
  })
})

describe('lo que se usa para hacer cuentas NO se convierte a texto', () => {
  it('price, stock y amount siguen siendo números', () => {
    // Convertirlos rompería la facturación, que es exactamente lo contrario de
    // lo que buscábamos.
    const l = normalizeEntity({ id: 'a', price: 1500, stock: 3, amount: 99.5 })
    expect(l.price).toBe(1500)
    expect(l.stock).toBe(3)
    expect(l.amount).toBe(99.5)
  })

  it('una lista entera se limpia sin romper los montos', () => {
    const [a] = normalizeEntities([{ id: 1, code: 100245, price: 890 }])
    expect(a.code).toBe('100245')
    expect(a.price).toBe(890)
  })
})

describe('texto() aguanta cualquier cosa', () => {
  it('números, null, undefined, vacío', () => {
    expect([texto(99412887), texto(null), texto(undefined), texto('  hola '), texto(0), texto('')])
      .toEqual(['99412887', '', '', 'hola', '0', ''])
  })

  it('el cero es "0", no vacío', () => {
    // Un código de artículo 0 es un código, no la ausencia de código.
    expect(texto(0)).toBe('0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  2. Que nadie vuelva a llamar .trim() sobre un campo guardado
// ─────────────────────────────────────────────────────────────────────────────
describe('no quedan métodos de texto sobre campos que pueden ser número', () => {
  const CAMPOS = ['phone', 'email', 'code', 'category', 'address', 'observations']
  const METODOS = ['trim', 'toLowerCase', 'toUpperCase', 'startsWith', 'padStart']

  function recorrer(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(p, acc)
      else if (/\.jsx?$/.test(e.name)) acc.push(p)
    }
    return acc
  }

  it('ningún archivo lo hace', () => {
    const re = new RegExp(`\\.(${CAMPOS.join('|')})\\s*\\.\\s*(${METODOS.join('|')})\\s*\\(`)
    const malos = recorrer(SRC)
      .filter(f => re.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
    expect(malos).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  3. El origen: la importación de Excel
// ─────────────────────────────────────────────────────────────────────────────
describe('la importación de Excel no mete números donde va texto', () => {
  const imp = sinComentarios(leer('utils', 'exportImport.js'))

  it('los campos del cliente pasan por texto()', () => {
    for (const campo of ['name', 'phone', 'email', 'address', 'birthDate', 'observations']) {
      expect(imp, `${campo} no pasa por texto()`).toMatch(new RegExp(`${campo}:\\s*texto\\(`))
    }
  })

  it('el nombre y el código del artículo también', () => {
    expect(imp).toMatch(/name: texto\(row\['nombre'\]/)
    expect(imp).toMatch(/code: texto\(row\['codigo'\]/)
  })

  it('pero el precio y el stock siguen siendo numéricos', () => {
    expect(imp).toMatch(/price: parseFloat\(/)
    expect(imp).toMatch(/stock: parseInt\(/)
  })
})

describe('el chequeo de duplicados que rompía el alta', () => {
  const pantalla = sinComentarios(leer('components', 'screens', 'PatientsScreen.jsx'))

  it('compara con texto(), no con .trim() directo', () => {
    expect(pantalla).toMatch(/texto\(patientData\.phone\)/)
    expect(pantalla).toMatch(/texto\(p\.phone\)/)
  })

  it('el guard mira si hay texto, no si el valor es truthy', () => {
    // `patientData.phone &&` dejaba pasar un número. `texto(...) !== ''` no.
    expect(pantalla).toMatch(/texto\(patientData\.phone\) !== ''/)
  })
})
