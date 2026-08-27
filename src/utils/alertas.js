// src/utils/alertas.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  LA PRIMERA PANTALLA QUE TE DICE ALGO QUE NO LE PREGUNTASTE
//
//  Las 24 pantallas de ZenDay son lugares donde uno PONE un dato o lo BUSCA.
//  Ninguna avisa nada por su cuenta. Esta es la unica que mira lo que ya hay
//  guardado y saca una conclusion.
//
//  Dos plata que se pierde en silencio:
//
//  1. EL CLIENTE QUE DEJO DE VENIR. Nadie da un portazo. Simplemente deja de
//     aparecer, y como no genera ningun evento — no hay una cita cancelada, no
//     hay un reclamo, no hay nada — no queda registro de que se fue. El unico
//     lugar del proyecto que calculaba la ultima visita era el PDF de clientes,
//     y filtra por rango ANTES de agrupar: el que dejo de venir queda afuera de
//     la lista por construccion. Justo el que habia que ver.
//
//  2. EL QUE NO VIENE. El estado 'no-show' existe desde siempre. Buscando
//     "no-show" en todo el proyecto aparece cinco veces y las cinco son una
//     etiqueta o un color. Se marca, se pinta gris, y ahi muere. Nadie cuenta
//     nunca cuantas horas se perdieron ni con quien.
//
//  POR QUE NO ES "CLIENTES INACTIVOS: MAS DE 60 DIAS"
//
//  Porque esa regla esta mal y por eso nadie mira esa pantalla en ningun
//  sistema. El que viene cada seis meses no esta perdido a los 60 dias, y el
//  que viene cada semana ya se fue hace rato. Un numero fijo se equivoca en las
//  dos direcciones al mismo tiempo.
//
//  Aca cada cliente se mide contra SU PROPIO ritmo. Si Lucia vino once veces en
//  ocho meses cada tres semanas clavado y hace siete que no aparece, eso es una
//  senal. Si Martin viene cuando se acuerda, no hay senal posible y no se
//  inventa una.
//
//  TRES DECISIONES QUE EVITAN QUE ESTO SEA RUIDO
//
//  a) Mediana, no promedio. Un hueco largo (unas vacaciones, una mudanza) no
//     tiene que arrastrar el ritmo de todo el historial.
//
//  b) Se exige REGULARIDAD antes de alertar. Si los intervalos son 5, 60, 10 y
//     90 dias, ese cliente no tiene ritmo y cualquier alerta seria inventada.
//     Se mide con la desviacion mediana absoluta sobre la mediana.
//
//  c) Si el cliente TIENE UN TURNO AGENDADO, no se avisa nunca. Es el error que
//     mataria la funcion en el primer uso: "me dice que Lucia se fue y la tengo
//     anotada para el jueves".
//
//  Sin React, sin red, sin reloj: `hoy` entra por parametro para que los tests
//  no dependan del dia en que corran.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizar } from './altaRapida'

/** Menos de tres visitas no es un ritmo, es una coincidencia. */
export const MIN_VISITAS = 3

/** Se avisa recien pasado 1.5x el ritmo propio. A 1.1x seria puro ruido. */
export const FACTOR_ATRASO = 1.5

/** De 2.5x del ritmo propio en adelante ya no es un atraso. */
export const FACTOR_PERDIDO = 2.5

/**
 * Piso absoluto. Sin esto, un cliente que pasa cada tres dias dispararia una
 * alerta al cuarto dia, todos los dias, y la pantalla se volveria ilegible.
 */
export const PISO_DIAS = 14

/**
 * Cuanto desorden se tolera antes de decir "este cliente no tiene ritmo".
 * Es la desviacion mediana absoluta dividida la mediana:
 *   intervalos 7, 8, 7, 9   -> 0.07  (regular)
 *   intervalos 21,28,21,35  -> 0.14  (regular)
 *   intervalos 20,30,40     -> 0.33  (irregular pero se le puede llamar mensual)
 *   intervalos 60,10,90     -> 0.50  (esto no es un ritmo)
 *   intervalos 5, 60,10,90  -> 0.79  (mucho menos)
 *
 * Empezo en 0.75 y estaba mal: dejaba pasar 60-10-90 dias como si fuera un
 * ritmo. Bajarlo hace que la pantalla avise menos, y eso es lo correcto: una
 * alerta de mas destruye la confianza en las otras, una de menos no.
 */
export const MAX_DESORDEN = 0.4

/** Una falta es un olvido. Dos ya es un patron — pero ademas mira la tasa. */
export const MIN_NO_SHOWS = 2

/**
 * Dos faltas en treinta visitas es la vida normal. Dos en tres es un problema.
 * Sin la tasa, el ranking lo encabezarian los mejores clientes por tener mas
 * historial, que es exactamente al reves de lo util.
 */
export const MIN_TASA_NO_SHOW = 0.2

/** Los estados en que el cliente NO estuvo presente. */
const NO_VINO = new Set(['cancelled', 'no-show'])

// ─── Estadistica ──────────────────────────────────────────────────────────────

export function mediana(xs) {
  const v = (Array.isArray(xs) ? xs : []).filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Desviacion mediana absoluta sobre la mediana. 0 = intervalos identicos.
 *
 * Se usa la MAD y no el desvio estandar a proposito: con pocas muestras — y aca
 * siempre son pocas, dos o tres intervalos — un solo valor raro le dispara el
 * desvio estandar y tapa el ritmo real.
 */
export function desorden(xs) {
  const med = mediana(xs)
  if (med === null || med <= 0) return null
  const mad = mediana(xs.map(x => Math.abs(x - med)))
  return mad === null ? null : mad / med
}

function aMedianoche(v) {
  // OJO: `new Date(null)` NO da fecha inválida, da el 1 de enero de 1970. Lo
  // mismo con `new Date(0)`, `new Date(false)` y `new Date('')`.
  //
  // Sin este filtro, un registro sin fecha se convertía silenciosamente en 1970
  // y el cliente aparecía como que hace veinte mil días que no viene, con
  // ochocientos "turnos salteados" y una cifra de plata perdida delirante. En
  // una pantalla cuya única función es hacer afirmaciones, un dato faltante
  // tiene que quedar afuera, nunca convertirse en una fecha plausible.
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  if (typeof v === 'number' && !(Number.isFinite(v) && v > 0)) return null

  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

/** Dias enteros entre dos fechas, contados de medianoche a medianoche. */
export function diasEntre(desde, hasta) {
  const a = aMedianoche(desde)
  const b = aMedianoche(hasta)
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}

// ─── Datos de un cliente ──────────────────────────────────────────────────────

/**
 * Las citas de un cliente.
 *
 * Se acepta el id O el nombre, igual que PatientTimeline: hay registros viejos
 * e importados que nunca tuvieron patientId, y dejarlos afuera silenciosamente
 * daria un historial incompleto — o sea, alertas equivocadas presentadas con
 * cara de certeza.
 */
export function citasDe(cliente, citas) {
  if (!cliente) return []
  const nombre = normalizar(cliente.name)
  return (Array.isArray(citas) ? citas : []).filter(a => {
    if (!a) return false
    if (cliente.id != null && a.patientId != null && String(a.patientId) === String(cliente.id)) return true
    return Boolean(nombre) && normalizar(a.patientName) === nombre
  })
}

/**
 * El mismo emparejamiento pero indexado.
 *
 * `citasDe` recorre TODAS las citas por cada cliente. Con 500 clientes y 5.000
 * citas eso son dos millones y medio de comparaciones cada vez que se dibuja la
 * pantalla, y se siente. Indexando una sola vez pasa a ser una recorrida y una
 * busqueda por cliente.
 *
 * Se conservan las dos: `citasDe` es la version legible con la que se prueba la
 * regla, y esta es la rapida que se usa en los bucles. Las dos tienen que dar
 * lo mismo, y hay un test que lo verifica.
 */
export function indexarCitas(citas) {
  const porId = new Map()
  const porNombre = new Map()

  for (const a of (Array.isArray(citas) ? citas : [])) {
    if (!a) continue
    if (a.patientId != null) {
      const k = String(a.patientId)
      if (!porId.has(k)) porId.set(k, [])
      porId.get(k).push(a)
    }
    const n = normalizar(a.patientName)
    if (n) {
      if (!porNombre.has(n)) porNombre.set(n, [])
      porNombre.get(n).push(a)
    }
  }
  return { porId, porNombre }
}

function citasDelIndice(cliente, idx) {
  if (!cliente) return []
  const porId = cliente.id != null ? (idx.porId.get(String(cliente.id)) || []) : []
  const n = normalizar(cliente.name)
  const porNombre = n ? (idx.porNombre.get(n) || []) : []

  if (!porNombre.length) return porId
  if (!porId.length) return porNombre
  // Una misma cita puede tener el id Y el nombre: se une sin duplicar, porque
  // contarla dos veces partiria el ritmo al medio.
  const vistas = new Set(porId)
  return [...porId, ...porNombre.filter(a => !vistas.has(a))]
}

/**
 * Parte el historial en tres: las veces que vino, las que falto, y lo que tiene
 * por delante.
 *
 * "Vino" = una cita pasada que no esta cancelada ni marcada como falta. Se
 * eligio asi y no "estado completado" porque en la realidad muchos usuarios no
 * actualizan el estado nunca: exigir 'completed' dejaria el historial de casi
 * todos en cero y la pantalla vacia para siempre, que es la peor falla posible
 * — parece que funciona y no dice nada.
 */
export function partirHistorial(citas, hoy) {
  const t = hoy instanceof Date ? hoy.getTime() : new Date(hoy).getTime()
  const visitas = [], faltas = [], futuras = []

  for (const a of citas) {
    const cuando = a?.startTime ? new Date(a.startTime) : null
    if (!cuando || Number.isNaN(cuando.getTime())) continue

    if (cuando.getTime() > t) {
      // Un turno cancelado a futuro no es un turno: no sujeta a nadie.
      if (!NO_VINO.has(a.status)) futuras.push(a)
      continue
    }
    if (a.status === 'no-show') { faltas.push(a); continue }
    if (a.status === 'cancelled') continue
    visitas.push(a)
  }

  const porFecha = (x, y) => new Date(x.startTime) - new Date(y.startTime)
  return { visitas: visitas.sort(porFecha), faltas: faltas.sort(porFecha), futuras: futuras.sort(porFecha) }
}

/**
 * El ritmo propio de un cliente, o null si no tiene uno que se pueda afirmar.
 *
 * @returns {{ dias, desorden, regular, visitas, ultima } | null}
 */
export function ritmoDe(visitas) {
  if (!Array.isArray(visitas) || visitas.length < MIN_VISITAS) return null

  const fechas = visitas
    .map(v => new Date(v.startTime))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)
  if (fechas.length < MIN_VISITAS) return null

  const intervalos = []
  for (let i = 1; i < fechas.length; i++) {
    const d = diasEntre(fechas[i - 1], fechas[i])
    // Dos citas el mismo dia son una sola visita para medir el ritmo.
    if (d !== null && d > 0) intervalos.push(d)
  }
  if (intervalos.length < MIN_VISITAS - 1) return null

  const dias = mediana(intervalos)
  if (dias === null || dias <= 0) return null

  const des = desorden(intervalos)
  return {
    dias,
    desorden: des,
    regular: des !== null && des <= MAX_DESORDEN,
    visitas: fechas.length,
    ultima: fechas[fechas.length - 1],
  }
}

/**
 * Cuanto deja por visita, en promedio.
 *
 * Se prefiere lo efectivamente COBRADO. Si no hay nada cobrado se cae a los
 * precios agendados, que es una estimacion peor pero honesta; y si no hay
 * ningun precio devuelve 0, y entonces la alerta se muestra sin cifra en vez
 * de mostrar una inventada.
 */
export function ticketPromedio(visitas) {
  const conPrecio = visitas.filter(v => Number(v?.price) > 0)
  if (!conPrecio.length) return 0
  const cobradas = conPrecio.filter(v => v.paid)
  const base = cobradas.length ? cobradas : conPrecio
  return base.reduce((s, v) => s + Number(v.price), 0) / base.length
}

// ─── Las dos alertas ──────────────────────────────────────────────────────────

/**
 * Los clientes que se estan yendo, medidos contra su propio ritmo.
 *
 * Devuelve una lista ordenada por plata, de mayor a menor: lo primero que se ve
 * tiene que ser lo que mas cuesta.
 */
export function clientesQueSeVan(clientes, citas, { hoy, indice } = {}) {
  if (!(hoy instanceof Date) || Number.isNaN(hoy.getTime())) {
    throw new Error('clientesQueSeVan necesita una fecha `hoy` válida')
  }

  const idx = indice || indexarCitas(citas)
  const salida = []

  for (const cliente of (Array.isArray(clientes) ? clientes : [])) {
    if (!cliente) continue

    const { visitas, futuras } = partirHistorial(citasDelIndice(cliente, idx), hoy)

    // Tiene turno: no se fue. Antes que cualquier otra cuenta.
    if (futuras.length > 0) continue

    const ritmo = ritmoDe(visitas)
    if (!ritmo || !ritmo.regular) continue

    const diasSinVenir = diasEntre(ritmo.ultima, hoy)
    if (diasSinVenir === null) continue
    if (diasSinVenir < PISO_DIAS) continue
    if (diasSinVenir < ritmo.dias * FACTOR_ATRASO) continue

    const ticket = ticketPromedio(visitas)
    const turnosSalteados = Math.floor(diasSinVenir / ritmo.dias)

    salida.push({
      cliente,
      nivel: diasSinVenir >= ritmo.dias * FACTOR_PERDIDO ? 'perdido' : 'atrasado',
      ritmoDias: Math.round(ritmo.dias),
      visitas: ritmo.visitas,
      ultima: ritmo.ultima,
      diasSinVenir,
      turnosSalteados,
      ticket,
      plata: Math.round(turnosSalteados * ticket),
    })
  }

  return salida.sort((a, b) => b.plata - a.plata || b.diasSinVenir - a.diasSinVenir)
}

/**
 * Los que faltan sin avisar.
 *
 * La tasa se calcula sobre las veces que se los ESPERABA (vino + falto). Las
 * canceladas quedan afuera del divisor a proposito: avisar que no venis es lo
 * contrario de faltar, y contarlas ahi premiaria al que no avisa.
 */
export function clientesQueFaltan(clientes, citas, { hoy, indice } = {}) {
  if (!(hoy instanceof Date) || Number.isNaN(hoy.getTime())) {
    throw new Error('clientesQueFaltan necesita una fecha `hoy` válida')
  }

  const idx = indice || indexarCitas(citas)
  const salida = []

  for (const cliente of (Array.isArray(clientes) ? clientes : [])) {
    if (!cliente) continue

    const { visitas, faltas } = partirHistorial(citasDelIndice(cliente, idx), hoy)
    if (faltas.length < MIN_NO_SHOWS) continue

    const esperadas = visitas.length + faltas.length
    const tasa = esperadas > 0 ? faltas.length / esperadas : 0
    if (tasa < MIN_TASA_NO_SHOW) continue

    // La plata es la de los turnos que quedaron vacios: esa hora estaba
    // reservada y no se pudo vender a nadie mas.
    const plata = faltas.reduce((s, f) => s + (Number(f.price) || 0), 0)

    salida.push({
      cliente,
      faltas: faltas.length,
      esperadas,
      tasa,
      ultimaFalta: faltas[faltas.length - 1]?.startTime || null,
      plata: Math.round(plata),
    })
  }

  return salida.sort((a, b) => b.plata - a.plata || b.faltas - a.faltas)
}

/**
 * Las dos cosas juntas, que es como se miran: una sola puerta.
 *
 * @returns {{ seVan, faltan, plata, total }}
 */
export function armarAlertas(clientes, citas, { hoy } = {}) {
  // Un solo indice para las dos listas: recorrer las citas dos veces es gratis
  // en un negocio chico y no lo es en uno con años de historial.
  const indice = indexarCitas(citas)
  const seVan = clientesQueSeVan(clientes, citas, { hoy, indice })
  const faltan = clientesQueFaltan(clientes, citas, { hoy, indice })

  const plataSeVan  = seVan.reduce((s, x) => s + x.plata, 0)
  const plataFaltan = faltan.reduce((s, x) => s + x.plata, 0)

  return {
    seVan,
    faltan,
    // Numeros planos y no un getter: esto se pasa por props, se serializa y se
    // desestructura, y un getter se pierde en cualquiera de las tres.
    plata: {
      seVan:  plataSeVan,
      faltan: plataFaltan,
      total:  plataSeVan + plataFaltan,
    },
    total: seVan.length + faltan.length,
  }
}

/** Texto corto para la tarjeta. Se arma acá para poder probarlo sin React. */
export function describirAtraso(item) {
  if (!item) return ''
  const cada = item.ritmoDias === 1 ? 'todos los días'
    : item.ritmoDias === 7 ? 'todas las semanas'
    : `cada ${item.ritmoDias} días`
  return `Venía ${cada} · ${item.visitas} visitas · hace ${item.diasSinVenir} días que no aparece`
}
