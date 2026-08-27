/**
 * safeStorage — capa única de acceso a localStorage.
 *
 * Por qué existe
 * ──────────────
 * Hoy hay 180 llamadas directas a `localStorage.*` repartidas en 23 archivos, y
 * 53 de ellas son `JSON.parse(localStorage.getItem(...))` sin protección. Eso
 * produce dos fallas que el usuario vive como "la app se rompió sola":
 *
 *  1. PANTALLA EN BLANCO. Si una clave quedó con JSON corrupto (una escritura
 *     cortada por falta de espacio, por ejemplo), `JSON.parse` tira excepción.
 *     Cuando eso pasa dentro de un inicializador de useState —como en
 *     App.jsx:238— React no puede montar y no queda nada en pantalla.
 *
 *  2. PÉRDIDA SILENCIOSA DE DATOS. localStorage tiene un límite de ~5-10 MB.
 *     Un consultorio con historial de un año lo alcanza. Cuando se llena,
 *     `setItem` tira QuotaExceededError; en App.jsx los 32 setItem no están
 *     dentro de try/catch, así que la app sigue andando, muestra los datos en
 *     memoria y no guarda nada. El usuario se entera al día siguiente.
 *
 * Uso:
 *   import { readJSON, writeJSON, onStorageError } from './utils/safeStorage'
 *
 *   const patients = readJSON('zenday-professional-patients', [])
 *   writeJSON('zenday-professional-patients', patients)
 *
 *   // Una sola vez, en App.jsx, para avisarle al usuario:
 *   onStorageError(({ type, message }) => toast.addToast(message, 'error'))
 */

let errorHandler = null

/** Registra el callback que se llama cuando una escritura falla. */
export function onStorageError(fn) {
  errorHandler = typeof fn === 'function' ? fn : null
}

function reportError(type, message, detail) {
  console.error(`[storage] ${type}:`, detail?.message || message)
  if (errorHandler) {
    try { errorHandler({ type, message, detail }) } catch { /* no romper por el handler */ }
  }
}

/**
 * Lee y parsea una clave. Nunca lanza: ante JSON corrupto devuelve `fallback`
 * y mueve el valor roto a `<clave>__corrupt` para poder recuperarlo a mano.
 */
export function readJSON(key, fallback = null) {
  let raw
  try {
    raw = localStorage.getItem(key)
  } catch (err) {
    reportError('read', 'No se pudo leer el almacenamiento local.', err)
    return fallback
  }

  if (raw === null || raw === undefined || raw === '') return fallback
  if (raw === 'undefined' || raw === 'null') return fallback

  try {
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch (err) {
    reportError('parse', `Hay datos dañados en "${key}". Se recuperó una copia de respaldo.`, err)
    try { localStorage.setItem(`${key}__corrupt`, raw) } catch { /* sin espacio: se descarta */ }
    return fallback
  }
}

/** Igual que readJSON pero garantiza un array (varias pantallas hacen .map/.filter directo). */
export function readArray(key) {
  const value = readJSON(key, [])
  return Array.isArray(value) ? value : []
}

/**
 * Serializa y guarda. Devuelve true si se guardó.
 *
 * Ante cuota agotada avisa por onStorageError en vez de fallar en silencio,
 * y hace un intento de limpieza de claves descartables antes de rendirse.
 */
export function writeJSON(key, value) {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch (err) {
    reportError('serialize', 'No se pudieron preparar los datos para guardar.', err)
    return false
  }

  try {
    localStorage.setItem(key, serialized)
    return true
  } catch (err) {
    const isQuota =
      err?.name === 'QuotaExceededError' ||
      err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err?.code === 22

    if (isQuota && pruneDisposableKeys()) {
      try {
        localStorage.setItem(key, serialized)
        return true
      } catch { /* sigue sin entrar */ }
    }

    reportError(
      isQuota ? 'quota' : 'write',
      isQuota
        ? 'El almacenamiento local está lleno. Exportá un respaldo y archivá datos viejos: los cambios nuevos no se están guardando.'
        : 'No se pudieron guardar los cambios en este equipo.',
      err
    )
    return false
  }
}

/**
 * Escritura protegida contra borrado accidental.
 *
 * El caso concreto: los listeners de Firestore en App.jsx hacen
 * `subscribe('appointments', data => { ...; localStorage.setItem(key, JSON.stringify(data)) })`.
 * Si un snapshot llega vacío —permisos, colección todavía sin crear, cambio de
 * businessId a mitad de carga— se sobrescribe el respaldo local con `[]` y se
 * pierde la única copia que quedaba en el equipo.
 *
 * writeCollection se niega a reemplazar N elementos por 0 salvo que se lo pidan
 * explícitamente con `{ allowEmpty: true }` (por ejemplo, un borrado deliberado).
 */
export function writeCollection(key, items, { allowEmpty = false } = {}) {
  const next = Array.isArray(items) ? items : []

  if (next.length === 0 && !allowEmpty) {
    const current = readArray(key)
    if (current.length > 0) {
      console.warn(
        `[storage] Escritura vacía bloqueada en "${key}": había ${current.length} registros. ` +
        `Usá writeCollection(key, [], { allowEmpty: true }) si el borrado es intencional.`
      )
      return false
    }
  }

  return writeJSON(key, next)
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key)
    return true
  } catch (err) {
    reportError('remove', 'No se pudo borrar la clave.', err)
    return false
  }
}

/** Borra claves reconstruibles (cachés, copias corruptas) para liberar cuota. */
function pruneDisposableKeys() {
  const disposable = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.endsWith('__corrupt') || k.includes('-cache-') || k.startsWith('zenday-tmp-')) {
        disposable.push(k)
      }
    }
  } catch {
    return false
  }

  if (disposable.length === 0) return false
  disposable.forEach(k => { try { localStorage.removeItem(k) } catch { /* ignorar */ } })
  console.warn(`[storage] Se liberaron ${disposable.length} claves descartables`)
  return true
}

/** Uso aproximado en bytes. Útil para mostrar un aviso antes de llegar al límite. */
export function getUsage() {
  let bytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      bytes += k.length + (localStorage.getItem(k)?.length || 0)
    }
  } catch { return { bytes: 0, megabytes: 0, nearLimit: false } }

  const megabytes = bytes / (1024 * 1024)
  return { bytes, megabytes, nearLimit: megabytes > 4 }
}
