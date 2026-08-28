import { describe, it, expect } from 'vitest'
import { ordenar } from '../src/utils/pdfReportGenerator.js'

/**
 * El orden de los reportes venía fijo en el código (fecha, o el "top" por
 * monto) sin forma de cambiarlo. `ordenar` es el helper que ahora usan los
 * cuatro reportes (Ventas, Clientes, Inventario, Inactivos) para respetar lo
 * que el usuario eligió en la pantalla de Reportes.
 */

const clientes = [
  { name: 'Beatriz', spent: 100 },
  { name: 'Ana',      spent: 300 },
  { name: 'Carlos',   spent: 200 },
]

const extractores = { nombre: c => c.name, monto: c => c.spent }

describe('ordenar', () => {
  it('ordena por texto ascendente (localeCompare, no comparación binaria)', () => {
    const r = ordenar(clientes, extractores, 'nombre', 'asc')
    expect(r.map(c => c.name)).toEqual(['Ana', 'Beatriz', 'Carlos'])
  })

  it('ordena por texto descendente', () => {
    const r = ordenar(clientes, extractores, 'nombre', 'desc')
    expect(r.map(c => c.name)).toEqual(['Carlos', 'Beatriz', 'Ana'])
  })

  it('ordena por número ascendente', () => {
    const r = ordenar(clientes, extractores, 'monto', 'asc')
    expect(r.map(c => c.spent)).toEqual([100, 200, 300])
  })

  it('ordena por número descendente (default de sortDir si no se pasa)', () => {
    const r = ordenar(clientes, extractores, 'monto')
    expect(r.map(c => c.spent)).toEqual([300, 200, 100])
  })

  it('si el campo no existe en la tabla de extractores, no toca el orden original', () => {
    const r = ordenar(clientes, extractores, 'campo-inexistente', 'asc')
    expect(r).toEqual(clientes)
  })

  it('no muta la lista original', () => {
    const copia = [...clientes]
    ordenar(clientes, extractores, 'monto', 'asc')
    expect(clientes).toEqual(copia)
  })
})
