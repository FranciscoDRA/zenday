import { describe, it, expect } from 'vitest'
import { appointmentsReducer as reducer } from '../src/reducers/appointmentsReducer.js'

const cita = (id, hIni = 10, hFin = 11, extra = {}) => ({
  id,
  status: 'scheduled',
  paid: false,
  price: 1000,
  startTime: new Date(2026, 7, 20, hIni, 0).toISOString(),
  endTime:   new Date(2026, 7, 20, hFin, 0).toISOString(),
  ...extra,
})

describe('appointmentsReducer', () => {
  it('SET_APPOINTMENTS reemplaza el estado', () => {
    const next = reducer([cita('a')], { type: 'SET_APPOINTMENTS', payload: [cita('b')] })
    expect(next.map(a => a.id)).toEqual(['b'])
  })

  it('SET_APPOINTMENTS con basura devuelve [] en vez de romper la app', () => {
    expect(reducer([], { type: 'SET_APPOINTMENTS', payload: null })).toEqual([])
    expect(reducer([], { type: 'SET_APPOINTMENTS', payload: 'texto' })).toEqual([])
  })

  it('ADD_APPOINTMENT agrega si no hay conflicto', () => {
    const next = reducer([cita('a', 10, 11)], { type: 'ADD_APPOINTMENT', payload: cita('b', 15, 16) })
    expect(next).toHaveLength(2)
  })

  it('ADD_APPOINTMENT rechaza si el horario está ocupado', () => {
    const estado = [cita('a', 10, 11)]
    const next = reducer(estado, { type: 'ADD_APPOINTMENT', payload: cita('b', 10, 11) })
    expect(next).toBe(estado)   // misma referencia = no cambió nada
  })

  it('ADD_MULTIPLE rechaza el lote entero si UNA choca', () => {
    const estado = [cita('a', 10, 11)]
    const lote = [cita('b', 8, 9), cita('c', 10, 11)]
    expect(reducer(estado, { type: 'ADD_MULTIPLE_APPOINTMENTS', payload: lote })).toBe(estado)
  })

  // ── El bug que rompía "agregar nota", aplicado a las citas ──
  describe('ids de tipo mixto (número vs string)', () => {
    it('DELETE encuentra la cita aunque el id venga como string', () => {
      const next = reducer([cita(1755000000000), cita('otra', 15, 16)],
                           { type: 'DELETE_APPOINTMENT', id: '1755000000000' })
      expect(next.map(a => String(a.id))).toEqual(['otra'])
    })

    it('DELETE encuentra la cita aunque el id venga como número', () => {
      const next = reducer([cita('1755000000000'), cita('otra', 15, 16)],
                           { type: 'DELETE_APPOINTMENT', id: 1755000000000 })
      expect(next.map(a => String(a.id))).toEqual(['otra'])
    })

    it('MARK_PAID funciona con tipos cruzados', () => {
      const next = reducer([cita(42)], { type: 'MARK_PAID', id: '42' })
      expect(next[0].paid).toBe(true)
      expect(next[0].paymentDate).toBeTruthy()
    })

    it('UPDATE_STATUS funciona con tipos cruzados', () => {
      const next = reducer([cita(42)], { type: 'UPDATE_STATUS', id: '42', status: 'confirmed' })
      expect(next[0].status).toBe('confirmed')
    })
  })

  it('MARK_PAID respeta una fecha de pago ya cargada', () => {
    const fecha = '2026-01-15T12:00:00.000Z'
    const next = reducer([cita('a', 10, 11, { paymentDate: fecha })], { type: 'MARK_PAID', id: 'a' })
    expect(next[0].paymentDate).toBe(fecha)
  })

  it('UPDATE_STATUS sella deliveredAt al completar', () => {
    const next = reducer([cita('a')], { type: 'UPDATE_STATUS', id: 'a', status: 'completed' })
    expect(next[0].deliveredAt).toBeTruthy()
  })

  it('UPDATE_STATUS no pisa un deliveredAt existente', () => {
    const fecha = '2026-01-15T12:00:00.000Z'
    const next = reducer([cita('a', 10, 11, { status: 'completed', deliveredAt: fecha })],
                         { type: 'UPDATE_STATUS', id: 'a', status: 'delivered' })
    expect(next[0].deliveredAt).toBe(fecha)
  })

  it('UPDATE_APPOINTMENT con id inexistente no inventa registros', () => {
    const estado = [cita('a')]
    const next = reducer(estado, { type: 'UPDATE_APPOINTMENT', id: 'no-existe', payload: { price: 9 } })
    expect(next).toBe(estado)
  })

  it('UPDATE_APPOINTMENT rechaza mover una cita a un horario ocupado', () => {
    const estado = [cita('a', 10, 11), cita('b', 15, 16)]
    const next = reducer(estado, {
      type: 'UPDATE_APPOINTMENT', id: 'b',
      payload: { startTime: new Date(2026, 7, 20, 10, 0).toISOString(),
                 endTime:   new Date(2026, 7, 20, 11, 0).toISOString() },
    })
    expect(next).toBe(estado)
  })

  it('UPDATE_APPOINTMENT deja cambiar el precio sin tocar el horario', () => {
    const next = reducer([cita('a')], { type: 'UPDATE_APPOINTMENT', id: 'a', payload: { price: 2500 } })
    expect(next[0].price).toBe(2500)
  })

  it('DELETE_RECURRING borra todo el grupo y nada más', () => {
    const estado = [
      cita('a', 8,  9,  { recurrenceGroupId: 'g1' }),
      cita('b', 10, 11, { recurrenceGroupId: 'g1' }),
      cita('c', 15, 16, { recurrenceGroupId: 'g2' }),
    ]
    const next = reducer(estado, { type: 'DELETE_RECURRING_APPOINTMENTS', groupId: 'g1' })
    expect(next.map(a => a.id)).toEqual(['c'])
  })

  it('una acción desconocida no altera el estado', () => {
    const estado = [cita('a')]
    expect(reducer(estado, { type: 'INVENTADA' })).toBe(estado)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  MARK_PAID tiene que respetar la fecha que eligió el usuario.
//
//  Antes se despachaba solo { type, id } y el reducer ponía la de hoy. El modal
//  dice "Elegí la fecha del pago — puede ser pasada o futura": el usuario cargaba
//  un pago del 15 de agosto, Firestore guardaba el 15 y el estado local el día
//  de hoy. Los reportes leen el estado, así que mostraban mal.
//  Y al CORREGIR una fecha ya cargada el reducer conservaba la vieja: no
//  cambiaba nada, pero el toast decía "Fecha de pago actualizada".
// ─────────────────────────────────────────────────────────────────────────────
describe('MARK_PAID respeta la fecha elegida', () => {
  const pedido = (extra = {}) => ([{ id: '1', paid: false, ...extra }])

  it('usa la fecha que viene en la acción', () => {
    const r = reducer(pedido(), {
      type: 'MARK_PAID', id: '1', paymentDate: '2026-08-15T15:00:00.000Z',
    })
    expect(r[0].paid).toBe(true)
    expect(r[0].paymentDate).toBe('2026-08-15T15:00:00.000Z')
  })

  it('CORRIGE una fecha ya cargada — el caso que no hacía nada', () => {
    const r = reducer(pedido({ paid: true, paymentDate: '2026-08-01T12:00:00.000Z' }), {
      type: 'MARK_PAID', id: '1', paymentDate: '2026-08-20T12:00:00.000Z',
    })
    expect(r[0].paymentDate).toBe('2026-08-20T12:00:00.000Z')
  })

  it('sin fecha en la acción, conserva la que había', () => {
    const r = reducer(pedido({ paymentDate: '2026-07-01T12:00:00.000Z' }), {
      type: 'MARK_PAID', id: '1',
    })
    expect(r[0].paymentDate).toBe('2026-07-01T12:00:00.000Z')
  })

  it('sin fecha en ningún lado, usa ahora', () => {
    const r = reducer(pedido(), { type: 'MARK_PAID', id: '1' })
    expect(typeof r[0].paymentDate).toBe('string')
    expect(new Date(r[0].paymentDate).getTime()).toBeGreaterThan(0)
  })
})
