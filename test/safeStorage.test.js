import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── localStorage simulado, con cuota configurable ───────────────────────────
class FakeStorage {
  constructor(limitBytes = Infinity) { this.map = new Map(); this.limit = limitBytes }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
  usage() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n }
  setItem(k, v) {
    const proyectado = this.usage() - (this.map.has(k) ? k.length + this.map.get(k).length : 0) + k.length + v.length
    if (proyectado > this.limit) {
      const err = new Error('quota'); err.name = 'QuotaExceededError'; err.code = 22
      throw err
    }
    this.map.set(k, v)
  }
}

let store
beforeEach(async () => {
  store = new FakeStorage()
  globalThis.localStorage = store
  vi.resetModules()
})

const cargar = () => import('../src/utils/safeStorage.js?t=' + Math.random())

describe('lectura protegida', () => {
  it('devuelve el fallback si la clave no existe', async () => {
    const { readJSON } = await cargar()
    expect(readJSON('nada', { a: 1 })).toEqual({ a: 1 })
  })

  it('NO revienta con JSON corrupto — era la pantalla en blanco al arrancar', async () => {
    const { readJSON } = await cargar()
    store.setItem('rota', '{"sin cerrar":')
    expect(() => readJSON('rota', [])).not.toThrow()
    expect(readJSON('rota', [])).toEqual([])
  })

  it('guarda una copia del dato corrupto para poder recuperarlo a mano', async () => {
    const { readJSON } = await cargar()
    store.setItem('rota', '{"sin cerrar":')
    readJSON('rota', [])
    expect(store.getItem('rota__corrupt')).toBe('{"sin cerrar":')
  })

  it('trata los strings "undefined" y "null" como ausencia de dato', async () => {
    const { readJSON } = await cargar()
    store.setItem('a', 'undefined'); store.setItem('b', 'null')
    expect(readJSON('a', 'fb')).toBe('fb')
    expect(readJSON('b', 'fb')).toBe('fb')
  })

  it('readArray siempre devuelve un array, aunque lo guardado sea un objeto', async () => {
    const { readArray } = await cargar()
    store.setItem('x', '{"no":"es array"}')
    expect(readArray('x')).toEqual([])
  })
})

describe('escritura y cuota', () => {
  it('guarda y relee', async () => {
    const { writeJSON, readJSON } = await cargar()
    expect(writeJSON('k', { a: 1 })).toBe(true)
    expect(readJSON('k')).toEqual({ a: 1 })
  })

  it('AVISA cuando la cuota se agota, en vez de fallar en silencio', async () => {
    const { writeJSON, onStorageError } = await cargar()
    globalThis.localStorage = store = new FakeStorage(200)
    const avisos = []
    onStorageError(e => avisos.push(e))

    const ok = writeJSON('grande', 'x'.repeat(500))
    expect(ok).toBe(false)                      // el llamador se entera
    expect(avisos).toHaveLength(1)              // y el usuario también
    expect(avisos[0].type).toBe('quota')
    expect(avisos[0].message).toMatch(/lleno/i)
  })

  it('libera cachés descartables antes de rendirse', async () => {
    globalThis.localStorage = store = new FakeStorage(300)
    const { writeJSON } = await cargar()
    store.map.set('viejo__corrupt', 'x'.repeat(200))
    expect(writeJSON('nuevo', 'y'.repeat(150))).toBe(true)
    expect(store.getItem('viejo__corrupt')).toBeNull()
  })

  it('no rompe con estructuras circulares', async () => {
    const { writeJSON } = await cargar()
    const circular = {}; circular.self = circular
    expect(writeJSON('c', circular)).toBe(false)
  })
})

describe('writeCollection — la guarda contra borrado accidental', () => {
  it('BLOQUEA reemplazar N registros por 0', async () => {
    const { writeCollection, readArray } = await cargar()
    writeCollection('citas', [{ id: '1' }, { id: '2' }])
    expect(writeCollection('citas', [])).toBe(false)
    expect(readArray('citas')).toHaveLength(2)   // los datos siguen ahí
  })

  it('permite el borrado si es explícito', async () => {
    const { writeCollection, readArray } = await cargar()
    writeCollection('citas', [{ id: '1' }])
    expect(writeCollection('citas', [], { allowEmpty: true })).toBe(true)
    expect(readArray('citas')).toHaveLength(0)
  })

  it('escribir [] sobre algo ya vacío no es problema', async () => {
    const { writeCollection } = await cargar()
    expect(writeCollection('nueva', [])).toBe(true)
  })

  it('reemplazar N por M sí se permite', async () => {
    const { writeCollection, readArray } = await cargar()
    writeCollection('citas', [{ id: '1' }, { id: '2' }])
    expect(writeCollection('citas', [{ id: '3' }])).toBe(true)
    expect(readArray('citas')).toHaveLength(1)
  })

  it('un no-array se trata como lista vacía y también queda bloqueado', async () => {
    const { writeCollection, readArray } = await cargar()
    writeCollection('citas', [{ id: '1' }])
    expect(writeCollection('citas', null)).toBe(false)
    expect(readArray('citas')).toHaveLength(1)
  })
})

describe('uso de almacenamiento', () => {
  it('reporta el uso y avisa al acercarse al límite', async () => {
    const { writeJSON, getUsage } = await cargar()
    writeJSON('chico', 'x'.repeat(100))
    expect(getUsage().bytes).toBeGreaterThan(100)
    expect(getUsage().nearLimit).toBe(false)

    writeJSON('grande', 'x'.repeat(5 * 1024 * 1024))
    expect(getUsage().nearLimit).toBe(true)      // dispara el aviso preventivo
  })
})
