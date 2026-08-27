// src/utils/mediosDePago.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  EL CIERRE DEL DIA
//
//  Hasta ahora ZenDay sabia CUANTO cobraste y nunca COMO. Buscando en todo el
//  proyecto, `paymentMethod` aparecia una sola vez, en PatientTimeline:
//
//      desc: a.paymentMethod ? `Método: ${a.paymentMethod}` : null,
//
//  O sea: la linea de tiempo estaba preparada para mostrarlo y nadie lo
//  escribia nunca. Una funcion a medio construir que quedo ahi.
//
//  Y sin eso, a la noche, cuando el dueño baja la persiana, la app le dice
//  "cobraste $12.400" y el tiene que acordarse de memoria cuanto de eso fue
//  efectivo para saber que tiene que haber en la caja. Todos los dias.
//
//  Un local mueve efectivo, transferencia, Mercado Pago y debito en la misma
//  jornada — la propia pantalla de Pagos Pendientes dice "Podes pagar por
//  transferencia bancaria o Mercado Pago". La app sabia que la gente paga de
//  formas distintas, y no anotaba cual.
//
//  Todo lo de aca es puro: sin React, sin Firebase, sin reloj. La fecha entra
//  por parametro para que los tests no dependan del dia en que corran.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los medios que se pueden elegir al cobrar.
 *
 * `enCaja` es el campo que hace util todo esto: marca lo que queda como plata
 * fisica en el cajon. Es lo unico que hay que contar a la noche.
 */
export const MEDIOS_DE_PAGO = [
  { id: 'efectivo',      label: 'Efectivo',       icono: '💵', enCaja: true  },
  { id: 'transferencia', label: 'Transferencia',  icono: '🏦', enCaja: false },
  { id: 'mercadopago',   label: 'Mercado Pago',   icono: '💳', enCaja: false },
  { id: 'debito',        label: 'Débito',         icono: '💳', enCaja: false },
  { id: 'credito',       label: 'Crédito',        icono: '💳', enCaja: false },
  { id: 'otro',          label: 'Otro',           icono: '•',  enCaja: false },
]

/** El que viene marcado si el usuario nunca eligio ninguno. */
export const MEDIO_POR_DEFECTO = 'efectivo'

const PORID = new Map(MEDIOS_DE_PAGO.map(m => [m.id, m]))

/**
 * Devuelve el medio, o el de "otro" si no se reconoce.
 *
 * Nunca undefined: hay cobros viejos guardados SIN medio, y una pantalla que
 * explota por eso seria peor que la falta del dato.
 */
export function medio(id) {
  return PORID.get(String(id || '').toLowerCase()) || PORID.get('otro')
}

/** Etiqueta lista para mostrar. 'Sin registrar' para los cobros viejos. */
export function etiquetaMedio(id) {
  if (!id) return 'Sin registrar'
  return medio(id).label
}

/** ¿Este cobro suma a lo que tiene que haber fisicamente en la caja? */
export function vaALaCaja(id) {
  return medio(id).enCaja === true
}

/** 'YYYY-MM-DD' local. Nunca toISOString(), que pasa a UTC y corre el dia. */
function claveDeDia(valor) {
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * El cierre del dia: cuanto entro, por que via, y cuanto tiene que haber en la
 * caja.
 *
 * @param {Array}  cobros  citas/pedidos. Se toman solo los que tienen paid=true.
 * @param {Date|string} dia  el dia a cerrar.
 * @returns {{ total, enCaja, cantidad, porMedio: Array, dia: string }}
 *
 * Ojo con QUE fecha se usa: la de COBRO (paymentDate), no la de la sesion. Una
 * sesion del lunes cobrada el miercoles entra en la caja del miercoles, que es
 * cuando la plata estuvo sobre el mostrador. Usar startTime daria un arqueo que
 * no cierra contra lo que hay en el cajon, que es exactamente lo que esto
 * viene a resolver.
 */
export function cierreDelDia(cobros, dia) {
  const clave = claveDeDia(dia)
  const lista = Array.isArray(cobros) ? cobros : []

  const delDia = lista.filter(c => {
    if (!c?.paid) return false
    const cuando = c.paymentDate || c.startTime
    return cuando && claveDeDia(cuando) === clave
  })

  const acumulado = new Map()
  let total = 0
  let enCaja = 0

  for (const c of delDia) {
    const monto = Number(c.price) || 0
    // Los cobros viejos no tienen medio. Van a 'otro' y quedan visibles: que
    // aparezcan como "Sin registrar" es informacion, esconderlos no.
    const id = c.paymentMethod ? medio(c.paymentMethod).id : null
    const k = id || 'sin-registrar'

    const previo = acumulado.get(k) || { id: k, cantidad: 0, monto: 0 }
    previo.cantidad += 1
    previo.monto += monto
    acumulado.set(k, previo)

    total += monto
    if (id && vaALaCaja(id)) enCaja += monto
  }

  // Ordenado por monto: lo que mas movio, primero.
  const porMedio = [...acumulado.values()]
    .map(x => ({
      ...x,
      label: x.id === 'sin-registrar' ? 'Sin registrar' : medio(x.id).label,
      icono: x.id === 'sin-registrar' ? '❓' : medio(x.id).icono,
      enCaja: x.id === 'sin-registrar' ? false : vaALaCaja(x.id),
    }))
    .sort((a, b) => b.monto - a.monto)

  return { dia: clave, total, enCaja, cantidad: delDia.length, porMedio }
}

/**
 * Igual que cierreDelDia pero para un rango, que es lo que muestra Finanzas
 * cuando se elige un mes o un año.
 */
export function desglosePorMedio(cobros, { desde, hasta } = {}) {
  const lista = Array.isArray(cobros) ? cobros : []
  const d = desde ? claveDeDia(desde) : null
  const h = hasta ? claveDeDia(hasta) : null

  const dentro = lista.filter(c => {
    if (!c?.paid) return false
    // Sin rango no hace falta mirar la fecha, y NO mirarla es lo correcto: quien
    // llama sin rango ya filtró la lista por su cuenta, y descartar un registro
    // por tener la fecha rara haría que este total no cierre contra el de quien
    // llamó. Un peso de diferencia en una pantalla de plata parece un error.
    if (!d && !h) return true
    const k = claveDeDia(c.paymentDate || c.startTime)
    if (!k) return false
    if (d && k < d) return false
    if (h && k > h) return false
    return true
  })

  // Se reusa el mismo calculo forzando la clave del dia, para no tener dos
  // versiones de la misma cuenta que se desincronicen.
  const acumulado = new Map()
  let total = 0, enCaja = 0
  for (const c of dentro) {
    const monto = Number(c.price) || 0
    const id = c.paymentMethod ? medio(c.paymentMethod).id : null
    const k = id || 'sin-registrar'
    const previo = acumulado.get(k) || { id: k, cantidad: 0, monto: 0 }
    previo.cantidad += 1
    previo.monto += monto
    acumulado.set(k, previo)
    total += monto
    if (id && vaALaCaja(id)) enCaja += monto
  }

  const porMedio = [...acumulado.values()]
    .map(x => ({
      ...x,
      label: x.id === 'sin-registrar' ? 'Sin registrar' : medio(x.id).label,
      icono: x.id === 'sin-registrar' ? '❓' : medio(x.id).icono,
      enCaja: x.id === 'sin-registrar' ? false : vaALaCaja(x.id),
    }))
    .sort((a, b) => b.monto - a.monto)

  return { total, enCaja, cantidad: dentro.length, porMedio }
}

/** Clave donde se recuerda el ultimo medio usado, para venir premarcado. */
export const CLAVE_ULTIMO_MEDIO = 'zenday-ultimo-medio-de-pago'
