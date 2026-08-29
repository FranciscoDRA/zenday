import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * El descuento de stock al completar un pedido vivía SOLO adentro de
 * updateStatus (el botón dedicado de "cambiar estado"). Un pedido creado
 * directamente como "Entregado"/"Retirado" — la venta al mostrador típica en
 * modo emprendedor — o editado a "Entregado" desde el formulario completo,
 * nunca pasaba por ahí: el stock quedaba sin descontar y "Artículos" mostraba
 * un número cada vez más alejado de lo realmente vendido.
 *
 * El fix centraliza la lógica en `adjustStockForStatus` y la llama desde los
 * cuatro caminos que pueden hacer que un pedido termine "completado":
 * crearlo ya así, editarlo a mano, cambiarle el estado con el botón dedicado,
 * o crear varios de una (citas recurrentes).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

describe('App.jsx: el stock se ajusta sin importar por dónde el pedido llega a "completado"', () => {
  const fuente = leer('src', 'App.jsx')

  it('adjustStockForStatus existe y compara contra COMPLETED_STATUSES', () => {
    expect(fuente).toMatch(/const adjustStockForStatus = useCallback/)
    const bloque = fuente.slice(
      fuente.indexOf('const adjustStockForStatus = useCallback'),
      fuente.indexOf('const addAppointment = useCallback')
    )
    expect(bloque).toMatch(/COMPLETED_STATUSES\.has\(oldStatus\)/)
    expect(bloque).toMatch(/COMPLETED_STATUSES\.has\(newStatus\)/)
  })

  it('addAppointment (crear un pedido nuevo, posiblemente ya "entregado") llama a adjustStockForStatus', () => {
    const bloque = fuente.slice(
      fuente.indexOf('const addAppointment = useCallback'),
      fuente.indexOf('const addMultipleAppointments = useCallback')
    )
    expect(bloque).toMatch(/adjustStockForStatus\(null, n\.status, n\.productId, n\.quantity, n\.patientName\)/)
  })

  it('addMultipleAppointments (citas recurrentes) también ajusta stock por cada una', () => {
    const bloque = fuente.slice(
      fuente.indexOf('const addMultipleAppointments = useCallback'),
      fuente.indexOf('const updateAppointment = useCallback')
    )
    expect(bloque).toMatch(/data\.forEach\(n => adjustStockForStatus\(null, n\.status, n\.productId, n\.quantity, n\.patientName\)\)/)
  })

  it('updateAppointment (editar desde el formulario completo) ajusta stock SÓLO si el estado cambió', () => {
    const bloque = fuente.slice(
      fuente.indexOf('const updateAppointment = useCallback'),
      fuente.indexOf('const updateStatus = useCallback')
    )
    expect(bloque).toMatch(/if \(updatedAppointment\.status !== appointment\.status\) {/)
    expect(bloque).toMatch(/adjustStockForStatus\(appointment\.status, updatedAppointment\.status, updatedAppointment\.productId, updatedAppointment\.quantity, updatedAppointment\.patientName\)/)
  })

  it('updateStatus (el botón dedicado) sigue ajustando stock, ahora vía el helper compartido', () => {
    const bloque = fuente.slice(
      fuente.indexOf('const updateStatus = useCallback'),
      fuente.indexOf('const deleteAppointment = useCallback')
    )
    expect(bloque).toMatch(/adjustStockForStatus\(oldStatus, newStatus, appointment\.productId, appointment\.quantity, appointment\.patientName\)/)
    // No debe quedar la lógica vieja duplicada acá adentro.
    expect(bloque).not.toMatch(/completingStatuses/)
  })
})

describe('EmprendedorPanel.jsx: entregar un pedido ya no descuenta stock por su cuenta', () => {
  it('entregarPedido delega el descuento a addAppointment, no lo hace con un setProducts propio', () => {
    const fuente = leer('src', 'components', 'screens', 'EmprendedorPanel.jsx')
    const bloque = fuente.slice(
      fuente.indexOf('const entregarPedido = useCallback'),
      fuente.indexOf('// ── ELIMINAR PEDIDO')
    )
    // Antes: setProducts(prevProducts => prevProducts.map(... stock - 1 ...))
    // ANTES de llamar a addAppointment — un descuento fantasma si addAppointment
    // rechazaba el pedido por choque de horario. El texto de confirmación
    // ("Stock actual: X → X-1") es sólo informativo y sigue ahí a propósito;
    // lo que importa es que ya no haya un setProducts propio en este bloque.
    expect(bloque).not.toMatch(/setProducts/)
    expect(bloque).toMatch(/addAppointment\(nuevaAppointment\)/)
    // El aviso de "Sin stock" ANTES de crear el pedido sigue ahí (bloqueo duro,
    // independiente del ajuste automático que ahora hace addAppointment).
    expect(bloque).toMatch(/Sin stock de/)
  })

  it('setProducts ya no está en la firma del componente: nada lo usa', () => {
    const fuente = leer('src', 'components', 'screens', 'EmprendedorPanel.jsx')
    const firma = fuente.slice(fuente.indexOf('export default function EmprendedorPanel'), fuente.indexOf('}) {'))
    expect(firma).not.toMatch(/setProducts/)
  })
})
