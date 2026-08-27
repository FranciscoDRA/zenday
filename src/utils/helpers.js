// src/utils/helpers.js

// todayKey vive ahora en el bloque FECHAS LOCALES del final de este archivo.

export function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return 'Sin fecha'
  try {
    const date = new Date(dateTimeStr)
    if (isNaN(date.getTime())) return 'Fecha inválida'
    return date.toLocaleString('es-ES', { 
      day: '2-digit', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  } catch (error) {
    return 'Fecha inválida'
  }
}

export function formatTime(dateTimeStr) {
  if (!dateTimeStr) return ''
  try {
    const date = new Date(dateTimeStr)
    if (isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  } catch (error) {
    return ''
  }
}

export function formatCurrency(amount, currency = 'UYU') {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0'
  return new Intl.NumberFormat('es-UY', { 
    style: 'currency', 
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

export function calculateDuration(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return Math.round((endDate - startDate) / 60000)
}

export function hasConflict(appointments, newAppointment, excludeId = null) {
  const newStart = new Date(newAppointment.startTime)
  const newEnd = new Date(newAppointment.endTime)
  return appointments.some(apt => {
    if (excludeId && apt.id === excludeId) return false
    if (apt.status === 'cancelled') return false
    const aptStart = new Date(apt.startTime)
    const aptEnd = new Date(apt.endTime)
    return newStart < aptEnd && newEnd > aptStart
  })
}

export function hasAnyConflict(appointments, newAppointments) {
  for (const apt of newAppointments) {
    if (hasConflict(appointments, apt)) return true
  }
  return false
}

export function playDone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(523, ctx.currentTime)
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch (e) { 
    console.log('Audio not supported') 
  }
}

export function announceToScreenReader(message) {
  const el = document.createElement('div')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  el.className = 'sr-only'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1000)
}

export function generateRecurringAppointments(baseAppointment, recurrence, endDate, maxOccurrences = 10, RECURRENCE_TYPES) {
  if (recurrence === 'none' || !recurrence) return [baseAppointment]
  const appointments = [baseAppointment]
  const config = RECURRENCE_TYPES[recurrence]
  if (!config || config.interval === 0) return [baseAppointment]
  
  const startDate = new Date(baseAppointment.startTime)
  const duration = new Date(baseAppointment.endTime) - startDate
  const endDateTime = endDate ? new Date(endDate) : null
  const maxOcc = maxOccurrences || 52
  
  for (let i = 1; i < maxOcc; i++) {
    const nextStart = new Date(startDate)
    nextStart.setDate(startDate.getDate() + (config.interval * i))
    
    if (endDateTime && nextStart > endDateTime) break
    if (nextStart > new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate())) break
    
    const nextEnd = new Date(nextStart.getTime() + duration)
    
    appointments.push({
      ...baseAppointment,
      id: Date.now() + (i * 1000) + Math.random() * 1000,
      startTime: nextStart.toISOString(),
      endTime: nextEnd.toISOString(),
      parentId: baseAppointment.id,
      recurrenceInstance: i + 1,
      recurrenceType: recurrence,
      recurrenceGroupId: baseAppointment.recurrenceGroupId || baseAppointment.id,
    })
  }
  return appointments
}
// ─── FECHAS LOCALES ───────────────────────────────────────────────────────────
// El proyecto estaba en UTC-3 usando `new Date('YYYY-MM-DD')` y
// `toISOString().split('T')[0]`, que trabajan en UTC. Consecuencias reales:
//   · new Date('2026-08-01').getMonth() → 6 (julio): un gasto del 1/8 caía en julio
//   · new Date('2026-01-01').getFullYear() → 2025: enero desaparecía del año
//   · después de las 21:00, "hoy" pasaba a ser mañana en los formularios
// Estos tres helpers son la única forma correcta de manejar fechas locales acá.

/** 'YYYY-MM-DD' → Date local a medianoche. Nunca corre el día. */
export function parseLocalDate(str) {
  if (!str) return null
  const parts = String(str).split('-').map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  const [y, m, d] = parts
  return new Date(y, m - 1, d)
}

/** Date | ISO string → 'YYYY-MM-DD' en hora LOCAL (no UTC). */
export function toLocalDateKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' de hoy en hora local. Reemplaza a new Date().toISOString().split('T')[0] */
export function todayKey() {
  return toLocalDateKey(new Date())
}

/**
 * 'YYYY-MM-DD' de un <input type="date"> → ISO string estable.
 * Se ancla al mediodía local a propósito: así ningún cambio de huso ni horario
 * de verano puede correr la fecha al día anterior o al siguiente.
 */
export function dateInputToISO(str) {
  const d = parseLocalDate(str)
  if (!d) return new Date().toISOString()
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

// ─── IDENTIFICADORES ──────────────────────────────────────────────────────────
// Origen del problema: los registros viejos se crearon con `id: Date.now()`
// (número) y los que vuelven de Firestore traen el id del documento (siempre
// texto). Con ~60 comparaciones `x.id === id` repartidas por el proyecto, en
// cuanto los tipos no coincidían el `find` devolvía undefined y la acción fallaba
// sin ningún error visible: apretabas "guardar nota", "eliminar" o "marcar
// pagado" y no pasaba nada.
//
// La solución no es parchear las 60 comparaciones sino garantizar que todo id sea
// string desde que el dato entra a la app. `normalizeEntities` se aplica en cada
// punto de ingreso (localStorage, Firestore, importaciones).

/** Campos que referencian a otra entidad y también tienen que ser texto. */
const ID_FIELDS = ['id', 'patientId', 'productId', 'clientId', 'recurrenceGroupId', 'externalId']

/**
 * Campos de TEXTO que la app trata como tales sin preguntar.
 *
 * El mismo problema que los ids, con otra puerta de entrada: Excel. Cuando una
 * celda tiene sólo dígitos, la biblioteca devuelve un NÚMERO. Un teléfono
 * uruguayo escrito 099412887 entra como 99412887 (y de paso pierde el cero).
 *
 * Después alguien hace `p.phone.trim()` y el programa se cae con
 *
 *     TypeError: p.phone.trim is not a function
 *
 * Lo peor es dónde se cae: adentro del chequeo de duplicados que corre al
 * GUARDAR un cliente. La excepción sube por una promesa sin catch, así que el
 * usuario aprieta Guardar y no pasa absolutamente nada. Sin cartel, sin error.
 * Se queda apretando el botón. Once veces, en el caso que lo destapó.
 *
 * Coercionar acá arregla también los datos que YA están mal guardados: esto
 * corre en cada punto de entrada (localStorage, Firestore, importaciones), así
 * que el registro sucio se limpia al leerlo y se vuelve a guardar limpio.
 *
 * OJO con lo que NO va en esta lista: `price`, `stock`, `amount` y cualquier
 * cosa con la que se hagan cuentas. Convertirlos a texto rompería la
 * facturación, que es exactamente lo contrario de lo que queremos.
 */
const TEXT_FIELDS = [
  'phone', 'email', 'name', 'code', 'category',
  'description', 'address', 'observations', 'patientName',
]

/**
 * Cualquier cosa → texto seguro para comparar. Nunca tira.
 *
 * Para los lugares donde el dato no pasó por normalizeEntity: la lista que
 * acaba de salir de un Excel, por ejemplo, que todavía no entró a la app.
 */
export function texto(x) {
  if (x === null || x === undefined) return ''
  return String(x).trim()
}

/** Genera un id nuevo, único y siempre string. Reemplaza a `Date.now()`. */
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Pasa a string el id y las referencias de UN registro. No muta el original. */
export function normalizeEntity(item) {
  if (!item || typeof item !== 'object') return item
  let changed = false
  const out = { ...item }
  for (const field of ID_FIELDS) {
    const v = out[field]
    if (v !== undefined && v !== null && typeof v !== 'string') {
      out[field] = String(v)
      changed = true
    }
  }
  // Los de texto: mismo tratamiento, pero SIN tocar los que ya son string
  // (para no re-crear el objeto al pedo) ni los null/undefined, que muchas
  // pantallas usan como "este campo está vacío".
  for (const field of TEXT_FIELDS) {
    const v = out[field]
    if (v !== undefined && v !== null && typeof v !== 'string') {
      out[field] = String(v)
      changed = true
    }
  }
  return changed ? out : item
}

/** Igual que normalizeEntity pero para una lista. Devuelve [] si no es array. */
export function normalizeEntities(list) {
  if (!Array.isArray(list)) return []
  return list.map(normalizeEntity)
}

/**
 * Compara dos versiones de una colección y dice qué hay que escribir y qué
 * hay que borrar en el servidor.
 *
 * Existe porque productos y gastos se editaban sólo en memoria: ProductsScreen
 * crea, edita, importa y borra con `setProducts` a secas, y de `expenses` no
 * había una sola escritura a Firestore. Mientras tanto el listener sí pisaba el
 * estado local con lo del servidor, así que lo recién cargado desaparecía.
 *
 * Se hace por diff y no cambiando los ~15 lugares que llaman a los setters,
 * para que el próximo que agregue uno no tenga que acordarse de sincronizar.
 *
 * @returns {{ guardar: any[], borrar: any[] }}
 */
export function diffColeccion(antes, despues) {
  const clave = (x) => (x?.id != null ? String(x.id) : null)
  const conIdNormalizado = (x) => ({ ...x, id: String(x.id) })

  const mapaAntes = new Map()
  for (const x of Array.isArray(antes) ? antes : []) {
    const k = clave(x)
    if (k != null) mapaAntes.set(k, x)
  }

  const guardar = []
  const vistos = new Set()

  for (const x of Array.isArray(despues) ? despues : []) {
    const k = clave(x)
    if (k == null) continue        // sin id no hay dónde guardarlo
    vistos.add(k)
    const previo = mapaAntes.get(k)
    // Se compara el contenido: sin esto, reordenar la lista o tocar un solo
    // artículo reescribiría los 200 en cada cambio.
    //
    // El id se normaliza antes de comparar. Sin eso, un registro creado acá
    // (id numérico de Date.now()) contra el mismo registro devuelto por
    // Firestore (id string) daba "cambió" siempre, y cada snapshot disparaba
    // una reescritura completa de la colección.
    if (!previo || JSON.stringify(conIdNormalizado(previo)) !== JSON.stringify(conIdNormalizado(x))) {
      guardar.push(x)
    }
  }

  const borrar = []
  for (const [k, x] of mapaAntes) {
    if (!vistos.has(k)) borrar.push(x)
  }

  return { guardar, borrar }
}

/**
 * Devuelve SIEMPRE un array de notas, venga como venga.
 *
 * El bug que tapa: los clientes creados por un pedido web nacían con
 * `notes` como STRING (App.jsx: `notes: \`Cliente web — primer pedido: ...\``).
 * El resto del código asume un array, así que:
 *
 *   patient.notes.length   → 45   (largo del texto, no cantidad de notas)
 *   [...patient.notes]     → 45 "notas", una por CARÁCTER
 *   note.content           → undefined  (fila en blanco)
 *   note.date              → undefined  ("Invalid Date")
 *   note.id                → undefined  (todas "iguales": Set de tamaño 1,
 *                                        por eso "Todas" seleccionaba 1)
 *
 * El texto viejo no se tira: se convierte en una nota con su contenido.
 */
export function normalizarNotas(notas) {
  if (Array.isArray(notas)) {
    // Se garantiza un id único por nota. Sin esto, varias notas sin id (o con
    // el mismo) colapsaban en el Set de la selección múltiple: se veían las 45
    // tildadas y el botón decía "Eliminar (1)".
    const vistos = new Set()
    return notas
      .filter(n => n && typeof n === 'object')
      .map((n, i) => {
        const id = n.id != null && !vistos.has(String(n.id)) ? String(n.id) : `nota-${i}`
        vistos.add(id)
        return String(n.id) === id ? n : { ...n, id }
      })
  }
  if (typeof notas === 'string' && notas.trim()) {
    return [{
      id: 'nota-heredada',
      content: notas.trim(),
      date: null,          // no sabemos cuándo se escribió; se muestra sin fecha
      heredada: true,
    }]
  }
  return []
}

/** Fecha de una nota, tolerando las que no la tienen o la tienen rota. */
export function fechaDeNota(nota) {
  if (nota?.dateFormatted) return nota.dateFormatted
  if (!nota?.date) return 'Sin fecha'
  const d = new Date(nota.date)
  return isNaN(d.getTime()) ? 'Sin fecha' : d.toLocaleString('es-UY')
}

/**
 * Qué le impide a un cliente ser eliminado.
 *
 * Antes el bloqueo era sólo por pedidos, y contaba TODOS — incluidos los
 * completados y cancelados de hace años. El cartel decía "completá los pedidos
 * primero" cuando ya estaban completos: no había forma de destrabarlo.
 *
 * Ahora los motivos son cosas que el usuario SÍ puede resolver: los pedidos
 * activos se completan o cancelan, y las notas y adjuntos se borran. El
 * bloqueo deja de ser una pared y pasa a ser una lista de tareas.
 *
 * @returns {string[]} textos listos para mostrar; vacío = se puede borrar
 */
export function motivosParaNoBorrarCliente({ pedidosActivos = 0, notas = 0, adjuntos = 0 } = {}) {
  const motivos = []
  const plural = (n, singular, prural) => `${n} ${n === 1 ? singular : prural}`

  if (pedidosActivos > 0) motivos.push(plural(pedidosActivos, 'pedido activo', 'pedidos activos'))
  if (notas > 0)          motivos.push(plural(notas, 'nota', 'notas'))
  if (adjuntos > 0)       motivos.push(plural(adjuntos, 'documento adjunto', 'documentos adjuntos'))

  return motivos
}

/**
 * Cuándo cuenta la plata de una cita: el día que se cobró, no el día que pasó.
 *
 * Las tres pantallas que muestran dinero tenían su PROPIA copia de esta
 * función, y no coincidían:
 *
 *   Panel     ->  deliveredAt || paymentDate || startTime
 *   Reportes  ->  deliveredAt || paymentDate || startTime
 *   Finanzas  ->  startTime                                  <-- sólo la fecha de la cita
 *
 * Una sesión del 31 de julio cobrada el 3 de agosto aparecía en AGOSTO en el
 * Panel y en Reportes, y en JULIO en Finanzas. Tres pantallas de la misma app,
 * tres respuestas distintas para el mismo mes. Al que cierra la caja a fin de
 * mes eso lo vuelve loco, y no hay forma de saber cuál está bien.
 *
 * La respuesta correcta es la fecha de cobro: un ingreso entra en el mes en que
 * entró la plata. Ahora hay una sola definición y las tres la importan.
 */
export function getRevenueDate(appointment) {
  if (!appointment) return null
  return appointment.deliveredAt || appointment.paymentDate || appointment.startTime
}

/**
 * Copia texto al portapapeles. Devuelve true si se pudo.
 *
 * Vivia adentro de SettingsScreen. Se movio aca porque ahora tambien lo usa el
 * aviso de error, y dos copias de esto se desincronizan solas.
 *
 * El respaldo con execCommand no es de adorno: navigator.clipboard falla cuando
 * el documento no tiene foco, que en Electron pasa mas seguido de lo que uno
 * espera (justo despues de cerrar un modal, por ejemplo).
 */
export async function copiarAlPortapapeles(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text ?? ''))
      return true
    }
  } catch (err) {
    console.warn('[clipboard] writeText fallo, se prueba el metodo viejo:', err?.name)
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = String(text ?? '')
    Object.assign(ta.style, { position: 'fixed', left: '-999999px', top: '-999999px' })
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
