// src/utils/altaRapida.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  ESCRIBIR UNA LINEA EN VEZ DE LLENAR CATORCE CAMPOS
//
//  Suena el telefono. "¿Me das hora el jueves a las cuatro?"
//
//  Hoy eso es: Nueva cita -> buscar el cliente -> elegir fecha -> elegir hora ->
//  servicio -> precio -> guardar. Seis pasos con la persona esperando en la
//  linea, y un formulario de 14 campos.
//
//  Con esto es:  lucia jueves 16 corte  ->  Enter.
//
//  Ctrl+K ya existia y abria la busqueda global, que sabe BUSCAR lo que ya esta
//  y nunca crear nada. La puerta estaba puesta; faltaba lo que entiende la
//  frase.
//
//  DOS PRINCIPIOS QUE MANDAN SOBRE "SER INTELIGENTE"
//
//  1. Predecible antes que astuto. Si el usuario no puede anticipar como se va
//     a interpretar lo que escribe, deja de usarlo a la tercera sorpresa. Por
//     eso las reglas son pocas y en orden fijo, no un puntaje difuso.
//
//  2. Nunca inventar. Lo que no se entiende queda VACIO y se avisa. Un turno
//     creado con un precio adivinado es peor que un campo en blanco: el error
//     se descubre a fin de mes, cuando la caja no cierra.
//
//  Sin React, sin red, sin reloj: `hoy` entra por parametro para que los tests
//  no dependan del dia en que corran.
// ─────────────────────────────────────────────────────────────────────────────

/** Saca acentos y pasa a minusculas, para comparar "Lucía" con "lucia". */
export function normalizar(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

const DIAS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
}

const pad = n => String(n).padStart(2, '0')
const claveDia = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Copia de `base` corrida n dias, a medianoche. No muta. */
function correr(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setDate(d.getDate() + n)
  return d
}

/**
 * Interpreta UN token como fecha. Devuelve Date o null.
 *
 * Un dia de la semana significa el PROXIMO: si hoy es jueves y escribis
 * "jueves", es el de la semana que viene, no hoy. Quien quiere hoy escribe
 * "hoy" — es mas corto y no deja lugar a duda.
 */
export function parsearFecha(token, hoy) {
  const t = normalizar(token)
  if (!t) return null

  if (t === 'hoy') return correr(hoy, 0)
  if (t === 'manana' || t === 'mnn') return correr(hoy, 1)
  if (t === 'pasado') return correr(hoy, 2)

  if (t in DIAS) {
    const objetivo = DIAS[t]
    const actual = hoy.getDay()
    let faltan = (objetivo - actual + 7) % 7
    if (faltan === 0) faltan = 7        // "jueves" siendo jueves = el que viene
    return correr(hoy, faltan)
  }

  // 3/9, 3-9, 03/09/2026
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/)
  if (m) {
    const dia = Number(m[1])
    const mes = Number(m[2])
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null
    let anio = m[3] ? Number(m[3]) : hoy.getFullYear()
    if (anio < 100) anio += 2000
    const d = new Date(anio, mes - 1, dia)
    // Si no se escribio el año y la fecha ya paso, se asume el que viene:
    // el 3/1 escrito en diciembre es enero, no diez meses atras.
    if (!m[3] && d < correr(hoy, 0)) d.setFullYear(anio + 1)
    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

/**
 * Interpreta UN token como hora. Devuelve {hora, minuto} o null.
 *
 * Un numero pelado NO se toma como hora aca: eso lo decide `interpretar`,
 * que sabe si ya hay hora y si el numero puede ser un precio.
 */
export function parsearHora(token) {
  const t = normalizar(token).replace(/\s/g, '')
  if (!t) return null

  // 16:30, 16.30, 16h30
  let m = t.match(/^(\d{1,2})[:.h](\d{2})(hs?)?$/)
  if (m) {
    const h = Number(m[1]), min = Number(m[2])
    return (h < 24 && min < 60) ? { hora: h, minuto: min } : null
  }

  // 4pm, 9am
  m = t.match(/^(\d{1,2})(am|pm)$/)
  if (m) {
    let h = Number(m[1])
    if (h > 12) return null
    if (m[2] === 'pm' && h !== 12) h += 12
    if (m[2] === 'am' && h === 12) h = 0
    return { hora: h, minuto: 0 }
  }

  // 16h, 16hs
  m = t.match(/^(\d{1,2})hs?$/)
  if (m) {
    const h = Number(m[1])
    return h < 24 ? { hora: h, minuto: 0 } : null
  }

  return null
}

/** $1800, $ 1.800, 1800$ → 1800. Sólo con el signo: obliga a que sea precio. */
export function parsearPrecioExplicito(token) {
  const t = normalizar(token)
  const m = t.match(/^\$\s*([\d.,]+)$/) || t.match(/^([\d.,]+)\s*\$$/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(/,/g, '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Busca el mejor candidato por nombre, de mas exacto a mas laxo.
 *
 * En orden a proposito: exacto > empieza con > contiene. Sin puntajes difusos.
 * Que el usuario pueda predecir a quien va a elegir importa mas que acertar un
 * caso raro de mas.
 */
export function buscarPorNombre(tokens, lista, campo = 'name') {
  if (!Array.isArray(lista) || lista.length === 0 || tokens.length === 0) return null

  const candidatos = lista
    .map(x => ({ x, n: normalizar(x?.[campo]) }))
    .filter(c => c.n)

  // Se prueban las combinaciones mas largas primero: "juan carlos" antes que
  // "juan", asi un nombre compuesto no se parte al medio.
  for (let largo = Math.min(3, tokens.length); largo >= 1; largo--) {
    for (let i = 0; i + largo <= tokens.length; i++) {
      const trozo = normalizar(tokens.slice(i, i + largo).join(' '))
      if (trozo.length < 2) continue

      for (const modo of ['exacto', 'empieza', 'contiene']) {
        const hit = candidatos.find(c =>
          modo === 'exacto'  ? c.n === trozo
          : modo === 'empieza' ? c.n.split(/\s+/).some(p => p.startsWith(trozo))
          : c.n.includes(trozo))
        if (hit) return { item: hit.x, desde: i, hasta: i + largo }
      }
    }
  }
  return null
}

/**
 * Interpreta la linea completa.
 *
 * @returns {{
 *   cliente, clienteTexto, fecha, hora, articulo, precio,
 *   faltantes: string[], entendido: boolean, sobrante: string
 * }}
 *
 * `faltantes` es lo que el formulario va a pedir igual. No es un error: es la
 * lista honesta de lo que NO se pudo deducir, para mostrarla antes de confirmar.
 */
export function interpretar(texto, { clientes = [], articulos = [], hoy } = {}) {
  if (!(hoy instanceof Date) || Number.isNaN(hoy.getTime())) {
    throw new Error('interpretar necesita una fecha `hoy` válida')
  }

  const tokens = String(texto || '').trim().split(/\s+/).filter(Boolean)
  const usado = new Array(tokens.length).fill(false)

  const libres = () => tokens.filter((_, i) => !usado[i])
  const marcar = (desde, hasta) => { for (let i = desde; i < hasta; i++) usado[i] = true }

  let fecha = null, hora = null, precio = null

  // ── 1. Lo inequivoco primero: fechas y horas con formato ──────────────────
  tokens.forEach((tk, i) => {
    if (usado[i]) return
    if (!fecha) {
      const f = parsearFecha(tk, hoy)
      if (f) { fecha = f; usado[i] = true; return }
    }
    if (!hora) {
      const h = parsearHora(tk)
      if (h) { hora = h; usado[i] = true; return }
    }
    if (precio === null) {
      const p = parsearPrecioExplicito(tk)
      if (p !== null) { precio = p; usado[i] = true }
    }
  })

  // ── 2. El cliente, sobre lo que quedo ─────────────────────────────────────
  const restantes = tokens.map((t, i) => ({ t, i })).filter(x => !usado[x.i])
  const soloTexto = restantes.map(x => x.t)

  let cliente = null, clienteTexto = ''
  const hitCliente = buscarPorNombre(soloTexto, clientes, 'name')
  if (hitCliente) {
    cliente = hitCliente.item
    const idx = restantes.slice(hitCliente.desde, hitCliente.hasta).map(x => x.i)
    idx.forEach(i => { usado[i] = true })
    clienteTexto = cliente.name
  }

  // ── 3. El articulo o servicio, sobre lo que sigue quedando ────────────────
  const restantes2 = tokens.map((t, i) => ({ t, i })).filter(x => !usado[x.i])
  let articulo = null
  const hitArticulo = buscarPorNombre(restantes2.map(x => x.t), articulos, 'name')
  if (hitArticulo) {
    articulo = hitArticulo.item
    restantes2.slice(hitArticulo.desde, hitArticulo.hasta).forEach(x => { usado[x.i] = true })
    if (precio === null && Number(articulo.price) > 0) precio = Number(articulo.price)
  }

  // ── 4. Los numeros pelados que sobraron ───────────────────────────────────
  //
  // Aca esta la unica ambiguedad real de todo esto: "16" puede ser las cuatro
  // de la tarde o dieciseis pesos. La regla, fija y explicable en una linea:
  // un numero de 0 a 23, si todavia no hay hora, es la hora; cualquier otro es
  // el precio. Quien quiera cobrar $16 escribe "$16" y se acabo la discusion.
  tokens.forEach((tk, i) => {
    if (usado[i]) return
    if (!/^\d{1,6}$/.test(tk)) return
    const n = Number(tk)
    if (!hora && n >= 0 && n <= 23) { hora = { hora: n, minuto: 0 }; usado[i] = true; return }
    if (precio === null) { precio = n; usado[i] = true }
  })

  const faltantes = []
  if (!cliente)  faltantes.push('cliente')
  if (!fecha)    faltantes.push('fecha')
  if (!hora)     faltantes.push('hora')
  if (precio === null) faltantes.push('precio')

  return {
    cliente,
    clienteTexto,
    fecha,
    fechaClave: fecha ? claveDia(fecha) : null,
    hora,
    articulo,
    precio,
    faltantes,
    // Con cliente Y fecha ya vale la pena ofrecer el alta: el resto se completa
    // en el formulario, que igual se abre con todo lo que si se entendio.
    entendido: Boolean(cliente && fecha),
    sobrante: libres().join(' '),
  }
}

/** 'YYYY-MM-DDTHH:mm:00' local, como los guarda la app. Nunca toISOString(). */
export function aInicio({ fecha, hora }) {
  if (!fecha) return null
  const h = hora?.hora ?? 9
  const m = hora?.minuto ?? 0
  return `${claveDia(fecha)}T${pad(h)}:${pad(m)}:00`
}

/** Texto corto para mostrar en la sugerencia antes de confirmar. */
export function describir(r) {
  if (!r?.fecha) return ''
  const dia = r.fecha.toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' })
  const hs = r.hora ? ` · ${pad(r.hora.hora)}:${pad(r.hora.minuto)}` : ''
  return `${dia}${hs}`
}
