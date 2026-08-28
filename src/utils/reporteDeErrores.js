// src/utils/reporteDeErrores.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  POR QUE EXISTE ESTO
//
//  De los seis errores que aparecieron auditando ZenDay, SEIS no le avisaron
//  nada al usuario. El peor fue este:
//
//      TypeError: ge.phone.trim is not a function
//
//  Reventaba adentro del guardado de un cliente. Como subia por una promesa sin
//  catch, la pantalla no mostraba absolutamente nada: se apretaba "Guardar" y no
//  pasaba nada. Once veces seguidas, segun la consola.
//
//  Y lo mas irritante: el error SI se estaba registrando. main.jsx ya lo mandaba
//  a zenday-errors.log. La informacion existia, en un archivo, en la misma
//  computadora. Nadie se la mostro a nadie.
//
//  Esto cierra ese hueco: el error se ve, se puede copiar, y se puede mandar.
//
//  NO SALE NADA DE LA MAQUINA. El log queda en la carpeta de datos del usuario
//  y el reporte se copia al portapapeles. Lo manda el usuario si quiere, a mano.
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/electron/renderer'

/** Cuantos errores se guardan en memoria para el reporte. */
export const MAX_GUARDADOS = 20

/** Ventana en la que un error repetido no vuelve a molestar, en ms. */
export const SILENCIO_MS = 30_000

const errores = []
const oyentes = new Set()
const avisadoEn = new Map()   // mensaje -> timestamp del ultimo aviso

/**
 * Fallas normales que NO son un problema y no hay que mostrarle a nadie.
 *
 * El polling de las tiendas corre cada 30 segundos. Sin internet —o con el wifi
 * yendo y viniendo, que es lo normal en un local— falla y se reintenta solo. Si
 * cada uno de esos abriera un cartel rojo, el usuario tendria un cartel cada
 * medio minuto y en dos dias dejaria de leerlos. Que es exactamente lo que hay
 * que evitar: el objetivo es que cuando SI aparezca uno, se le crea.
 */
const RUIDO = [
  /aborted/i,
  /abort(error)?/i,
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /load failed/i,
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /the operation was aborted/i,
  /resizeobserver loop/i,   // ruido conocido de Chrome, no rompe nada
]

export function esRuidoConocido(mensaje) {
  const m = String(mensaje || '')
  if (!m) return true          // sin mensaje no hay nada util que mostrar
  return RUIDO.some(re => re.test(m))
}

/** Recorta un stack largo: para un reporte por WhatsApp, 12 lineas alcanzan. */
function recortarStack(stack, lineas = 12) {
  return String(stack || '').split('\n').slice(0, lineas).join('\n')
}

/**
 * Registra un error y decide si hay que avisarle al usuario.
 *
 * @returns {{guardado: boolean, avisar: boolean, error: object|null}}
 *   avisar=false cuando es ruido conocido o cuando el mismo error ya aviso hace
 *   menos de SILENCIO_MS. Un bucle que falla veinte veces por segundo tiene que
 *   dejar UN cartel, no veinte.
 */
export function registrarError({ scope, message, stack, ahora = Date.now() } = {}) {
  const mensaje = String(message || '').trim()

  if (esRuidoConocido(mensaje)) return { guardado: false, avisar: false, error: null }

  const error = {
    scope: String(scope || 'desconocido'),
    message: mensaje,
    stack: recortarStack(stack),
    cuando: ahora,
  }

  errores.push(error)
  if (errores.length > MAX_GUARDADOS) errores.shift()

  // Mismo filtro de ruido de arriba, así que Sentry recibe lo mismo que ve el
  // usuario en <AvisoDeError/> — nada de "sin internet" cada 30 segundos.
  try {
    const err = new Error(mensaje)
    if (stack) err.stack = stack
    Sentry.captureException(err, { tags: { scope: error.scope } })
  } catch { /* Sentry no puede ser la causa de otra falla */ }

  const ultimo = avisadoEn.get(mensaje)
  const avisar = ultimo === undefined || (ahora - ultimo) > SILENCIO_MS
  if (avisar) {
    avisadoEn.set(mensaje, ahora)
    for (const fn of oyentes) {
      try { fn(error) } catch { /* un oyente roto no puede romper el registro */ }
    }
  }

  return { guardado: true, avisar, error }
}

/** Se suscribe a los errores que ameritan aviso. Devuelve la baja. */
export function suscribirse(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

/** Los ultimos errores guardados, del mas viejo al mas nuevo. */
export function ultimosErrores() {
  return errores.slice()
}

/** Vacia todo. Sirve para los tests y para el boton de "ya lo mande". */
export function limpiar() {
  errores.length = 0
  avisadoEn.clear()
}

/** Fecha legible sin depender del huso de nadie mas que el del usuario. */
function cuando(ts) {
  try { return new Date(ts).toLocaleString('es-UY') } catch { return String(ts) }
}

/**
 * Arma el texto que el usuario copia y manda.
 *
 * Pensado para pegarse en un WhatsApp: sin adjuntos, sin pasos, sin explicar
 * que es una consola. Un cliente que escribe "no anda" no ayuda a nadie; este
 * texto dice que fallo, donde y con que version.
 */
export function armarReporte({ version, userMode, plan, ahora = Date.now() } = {}) {
  const lineas = [
    'REPORTE DE PROBLEMA — ZenDay',
    '─'.repeat(40),
    `Fecha:    ${cuando(ahora)}`,
    `Version:  ${version || 'desconocida'}`,
    `Modo:     ${userMode || 'desconocido'}`,
    `Licencia: ${plan || 'desconocida'}`,
    '',
  ]

  if (errores.length === 0) {
    lineas.push('No se registro ningun error en esta sesion.')
    lineas.push('')
    lineas.push('Si algo anda mal igual, conta que estabas haciendo cuando paso.')
  } else {
    lineas.push(`Errores registrados: ${errores.length}`)
    lineas.push('')
    // Del mas nuevo al mas viejo: el ultimo es casi siempre el que importa.
    errores.slice().reverse().forEach((e, i) => {
      lineas.push(`${i + 1}. [${cuando(e.cuando)}] ${e.scope}`)
      lineas.push(`   ${e.message}`)
      if (e.stack) lineas.push(e.stack.split('\n').map(l => '   ' + l.trim()).join('\n'))
      lineas.push('')
    })
  }

  return lineas.join('\n')
}
