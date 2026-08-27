// electron/documentStore.cjs
//
// ─────────────────────────────────────────────────────────────────────────────
//  POR QUÉ EXISTE ESTE ARCHIVO
// ─────────────────────────────────────────────────────────────────────────────
//  Los adjuntos de los clientes (PDFs, fotos, estudios) se guardaban como base64
//  DENTRO de localStorage — `exportImport.js:544`, `data: e.target.result`.
//
//  El problema no es de estilo, es de capacidad: base64 infla un archivo ~33%, y
//  localStorage tiene un tope duro de 5-10 MB COMPARTIDO CON TODO LO DEMÁS. Un
//  PDF de 2 MB ocupa ~2,7 MB. Dos adjuntos y la app deja de guardar: no sólo
//  documentos, también pedidos, clientes y gastos, porque comparten la cuota.
//  Y hasta ahora fallaba en silencio.
//
//  Acá los archivos van al disco, en la carpeta de datos de la app:
//
//    <userData>/client-documents/<patientId>/
//      index.json          metadatos (nombre, tamaño, tipo, fecha)
//      <docId>.<ext>       el archivo real, en binario
//
//  Sin límite práctico de tamaño, y el respaldo pasa a ser copiar una carpeta.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

let ROOT = null

function setRoot(userDataPath) {
  ROOT = path.join(userDataPath, 'client-documents')
  fs.mkdirSync(ROOT, { recursive: true })
}

// El id del paciente y el del documento vienen del renderer, así que hay que
// tratarlos como texto no confiable: sin esto, un id tipo "../../.." podría
// escribir o borrar fuera de la carpeta de la app.
function safeSegment(value) {
  const s = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!s || s === '.' || s === '..') return null
  return s.slice(0, 128)
}

function patientDir(patientId) {
  const seg = safeSegment(patientId)
  if (!seg || !ROOT) return null
  return path.join(ROOT, seg)
}

function indexPath(patientId) {
  const dir = patientDir(patientId)
  return dir ? path.join(dir, 'index.json') : null
}

function readIndex(patientId) {
  const p = indexPath(patientId)
  if (!p || !fs.existsSync(p)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('[documentStore] index.json ilegible:', err.message)
    return []
  }
}

function writeIndex(patientId, docs) {
  const dir = patientDir(patientId)
  if (!dir) return false
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(docs, null, 2), 'utf8')
  return true
}

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const MAX_BYTES = 25 * 1024 * 1024   // 25 MB por archivo

/** Metadatos, sin los bytes: la lista no necesita cargar los archivos en memoria. */
function list(patientId) {
  return readIndex(patientId).map(({ data, ...meta }) => meta)
}

/**
 * Guarda un adjunto. `dataUrl` es un data: URL (lo que devuelve FileReader).
 * Devuelve los metadatos, sin los bytes.
 */
function save(patientId, meta, dataUrl) {
  const dir = patientDir(patientId)
  if (!dir) return { ok: false, error: 'Cliente inválido' }

  const str = String(dataUrl || '')
  const coma = str.indexOf(',')
  if (!str.startsWith('data:') || coma === -1) return { ok: false, error: 'Archivo inválido' }

  const mime = String(meta?.mimeType || '').toLowerCase()
  if (mime && !ALLOWED_MIME.has(mime)) {
    return { ok: false, error: `Tipo de archivo no permitido: ${mime}` }
  }

  const buffer = Buffer.from(str.slice(coma + 1), 'base64')
  if (buffer.length === 0)          return { ok: false, error: 'El archivo está vacío' }
  if (buffer.length > MAX_BYTES)    return { ok: false, error: 'El archivo supera los 25 MB' }

  const docs = readIndex(patientId)
  const nombre = String(meta?.name || 'archivo')
  if (docs.some(d => d.name === nombre)) {
    return { ok: false, error: `Ya existe un documento llamado "${nombre}"` }
  }

  const docId = safeSegment(meta?.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const ext = (nombre.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  const fileName = `${docId}.${ext}`

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, fileName), buffer)

    // Verificar que quedó escrito antes de dar por buena la operación.
    const escrito = fs.statSync(path.join(dir, fileName)).size
    if (escrito !== buffer.length) {
      fs.unlinkSync(path.join(dir, fileName))
      return { ok: false, error: 'El archivo no se guardó completo' }
    }

    const record = {
      id: docId,
      name: nombre,
      type: meta?.type || 'generic',
      size: buffer.length,
      mimeType: mime,
      fileName,
      uploadDate: meta?.uploadDate || new Date().toISOString(),
    }
    docs.push(record)
    writeIndex(patientId, docs)
    return { ok: true, doc: record }
  } catch (err) {
    console.error('[documentStore] Error guardando:', err.message)
    return { ok: false, error: 'No se pudo guardar el archivo en el disco' }
  }
}

/** Devuelve el data: URL de un adjunto. Se lee sólo cuando se va a abrir o descargar. */
function read(patientId, documentId) {
  const dir = patientDir(patientId)
  const docId = safeSegment(documentId)
  if (!dir || !docId) return { ok: false, error: 'Documento inválido' }

  const doc = readIndex(patientId).find(d => String(d.id) === docId)
  if (!doc) return { ok: false, error: 'El documento no existe' }

  try {
    const buffer = fs.readFileSync(path.join(dir, doc.fileName))
    const mime = doc.mimeType || 'application/octet-stream'
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, doc }
  } catch (err) {
    console.error('[documentStore] Error leyendo:', err.message)
    return { ok: false, error: 'No se pudo leer el archivo' }
  }
}

function remove(patientId, documentId) {
  const dir = patientDir(patientId)
  const docId = safeSegment(documentId)
  if (!dir || !docId) return { ok: false, error: 'Documento inválido' }

  const docs = readIndex(patientId)
  const doc = docs.find(d => String(d.id) === docId)
  if (!doc) return { ok: true, docs: docs.map(({ data, ...m }) => m) }   // ya no estaba

  try {
    const f = path.join(dir, doc.fileName)
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch (err) {
    console.error('[documentStore] Error borrando el archivo:', err.message)
  }

  const restantes = docs.filter(d => String(d.id) !== docId)
  writeIndex(patientId, restantes)
  return { ok: true, docs: restantes.map(({ data, ...m }) => m) }
}

/** Borra todos los adjuntos de un cliente (se usa al eliminar el cliente). */
function removeAll(patientId) {
  const dir = patientDir(patientId)
  if (!dir) return { ok: false }
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    console.error('[documentStore] Error borrando la carpeta:', err.message)
    return { ok: false, error: err.message }
  }
}

/**
 * Migración desde el esquema viejo.
 *
 * El renderer manda lo que encontró en localStorage bajo `client_documents_*`.
 * Se escribe cada archivo al disco y se VERIFICA que quedó bien antes de
 * responder que se puede borrar la clave. Si algo falla, esa clave no se toca:
 * es preferible seguir con la cuota apretada que perder el estudio de un paciente.
 */
function migrate(patientId, documentos) {
  if (!Array.isArray(documentos) || documentos.length === 0) {
    return { ok: true, migrados: 0, puedeBorrarse: true }
  }

  const yaGuardados = readIndex(patientId)
  let migrados = 0
  let fallidos = 0

  for (const viejo of documentos) {
    if (!viejo?.data) { fallidos++; continue }
    if (yaGuardados.some(d => d.name === viejo.name)) continue   // ya migrado

    const res = save(patientId, {
      id: viejo.id, name: viejo.name, type: viejo.type,
      mimeType: viejo.mimeType, uploadDate: viejo.uploadDate,
    }, viejo.data)

    if (res.ok) {
      // Doble verificación: releer del disco y comparar tamaño.
      const check = read(patientId, res.doc.id)
      if (check.ok && check.doc.size === res.doc.size) migrados++
      else fallidos++
    } else if (res.error?.includes('Ya existe')) {
      migrados++
    } else {
      console.error('[documentStore] Migración falló para', viejo.name, '→', res.error)
      fallidos++
    }
  }

  return { ok: true, migrados, fallidos, puedeBorrarse: fallidos === 0 }
}

module.exports = { setRoot, list, save, read, remove, removeAll, migrate, ROOT: () => ROOT }
