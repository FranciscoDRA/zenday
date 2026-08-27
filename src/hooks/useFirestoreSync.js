import { useCallback } from 'react'
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, query, getDocs, writeBatch,
} from 'firebase/firestore'
import { firestore } from '../firebase'

/**
 * useFirestoreSync — acceso a los datos del negocio en Firestore.
 *
 * Qué se arregló
 * ──────────────
 *
 * 1. LOS ERRORES YA NO SE TRAGAN.
 *    Antes cada función hacía `catch (err) { console.error(...) }` y devolvía
 *    normal. Para quien la llamaba, un guardado que falló por permisos o por
 *    estar sin conexión era indistinguible de uno exitoso: la app mostraba el
 *    dato en pantalla, el usuario seguía trabajando, y Firestore nunca lo
 *    recibió. Ahora `saveDoc` y `deleteDoc` devuelven `{ ok, error }`.
 *
 * 2. `getAll` DISTINGUE "VACÍO" DE "FALLÓ".  ← el que causa pérdida de datos
 *    Antes el catch devolvía `[]`, el mismo valor que una colección legítimamente
 *    vacía. App.jsx decide con `if (fsApts.length > 0)`, así que un fallo de
 *    permisos se leía como "Firestore está vacío" y disparaba la rama que
 *    sobrescribe y re-sube. Ahora devuelve `{ ok, items, error }` y quien llama
 *    puede decidir con la verdad.
 *
 * 3. SUBIDA INICIAL EN LOTES.
 *    App.jsx hacía `saved.forEach(a => saveDoc('appointments', a.id, a))`: una
 *    escritura de red por registro, sin await y sin control de errores. Con 400
 *    pedidos son 400 requests sueltos disparados a la vez. `saveMany` usa
 *    writeBatch (máx. 500 por lote, que es el límite de Firestore).
 *
 * 4. `subscribe` avisa de los errores de snapshot.
 *    Antes el callback de error sólo hacía console.error, así que si las reglas
 *    denegaban la lectura la app se quedaba muda mostrando datos viejos.
 */
export function useFirestoreSync(businessId, userMode) {

  const collectionRef = useCallback((collectionName) => {
    return collection(firestore, 'businesses', businessId, 'data', userMode, collectionName)
  }, [businessId, userMode])

  const docRef = useCallback((collectionName, id) => {
    return doc(firestore, 'businesses', businessId, 'data', userMode, collectionName, String(id))
  }, [businessId, userMode])

  const saveDoc = useCallback(async (collectionName, id, data) => {
    if (!businessId || !userMode) return { ok: false, error: 'sin-negocio' }
    if (id === undefined || id === null || id === '') {
      console.error(`[Sync] Intento de guardar en ${collectionName} sin id`)
      return { ok: false, error: 'sin-id' }
    }

    try {
      await setDoc(
        docRef(collectionName, id),
        { ...data, id: String(id), _updatedAt: new Date().toISOString() },
        { merge: true }
      )
      return { ok: true }
    } catch (err) {
      console.error(`[Sync] Error guardando ${collectionName}/${id}:`, err.code || err.message)
      return { ok: false, error: err.code || err.message }
    }
  }, [businessId, userMode, docRef])

  /** Guarda muchos documentos en lotes de 500 (límite de writeBatch). */
  const saveMany = useCallback(async (collectionName, items) => {
    if (!businessId || !userMode) return { ok: false, saved: 0, error: 'sin-negocio' }

    const list = (Array.isArray(items) ? items : []).filter(
      it => it && it.id !== undefined && it.id !== null && it.id !== ''
    )
    if (list.length === 0) return { ok: true, saved: 0 }

    const CHUNK = 500
    let saved = 0

    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        const batch = writeBatch(firestore)
        const slice = list.slice(i, i + CHUNK)

        slice.forEach(item => {
          batch.set(
            docRef(collectionName, item.id),
            { ...item, id: String(item.id), _updatedAt: new Date().toISOString() },
            { merge: true }
          )
        })

        await batch.commit()
        saved += slice.length
      }
      return { ok: true, saved }
    } catch (err) {
      console.error(`[Sync] Error en lote de ${collectionName}:`, err.code || err.message)
      return { ok: false, saved, error: err.code || err.message }
    }
  }, [businessId, userMode, docRef])

  const deleteDocument = useCallback(async (collectionName, id) => {
    if (!businessId || !userMode) return { ok: false, error: 'sin-negocio' }

    try {
      await deleteDoc(docRef(collectionName, id))
      return { ok: true }
    } catch (err) {
      console.error(`[Sync] Error eliminando ${collectionName}/${id}:`, err.code || err.message)
      return { ok: false, error: err.code || err.message }
    }
  }, [businessId, userMode, docRef])

  /**
   * Escucha una colección.
   * @param onData  (items, meta) => void   meta: { fromCache, hasPendingWrites }
   * @param onError (error) => void         para avisar en pantalla, no sólo en consola
   */
  const subscribe = useCallback((collectionName, onData, onError) => {
    if (!businessId || !userMode) return () => {}

    return onSnapshot(
      query(collectionRef(collectionName)),
      (snapshot) => {
        const items = snapshot.docs.map(d => ({ ...d.data(), id: d.id }))
        onData(items, {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        })
      },
      (error) => {
        console.error(`[Sync] Error en snapshot ${collectionName}:`, error.code || error.message)
        if (typeof onError === 'function') onError(error)
      }
    )
  }, [businessId, userMode, collectionRef])

  /** Devuelve { ok, items, error } — nunca un [] ambiguo. */
  const getAll = useCallback(async (collectionName) => {
    if (!businessId || !userMode) return { ok: false, items: [], error: 'sin-negocio' }

    try {
      const snapshot = await getDocs(collectionRef(collectionName))
      return { ok: true, items: snapshot.docs.map(d => ({ ...d.data(), id: d.id })) }
    } catch (err) {
      console.error(`[Sync] Error obteniendo ${collectionName}:`, err.code || err.message)
      return { ok: false, items: [], error: err.code || err.message }
    }
  }, [businessId, userMode, collectionRef])

  return { saveDoc, saveMany, deleteDoc: deleteDocument, subscribe, getAll }
}

export default useFirestoreSync
