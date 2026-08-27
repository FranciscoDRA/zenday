import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { firestore } from '../firebase'

/**
 * useBusinessId — resuelve a qué negocio pertenece el usuario logueado.
 *
 * Qué se arregló respecto de la versión anterior
 * ──────────────────────────────────────────────
 *
 * 1. UN ERROR DE RED YA NO CREA UN NEGOCIO NUEVO.  ← el bug más grave
 *    Antes, todo el bloque de lectura estaba dentro de un `try` cuyo `catch`
 *    hacía "crear un negocio nuevo". Ese catch no distinguía entre
 *    "este usuario todavía no tiene negocio" (correcto: crear) y
 *    "falló la lectura de Firestore por red o permisos" (incorrecto: crear).
 *    Resultado real: un cliente que abría ZenDay con mal WiFi entraba a un
 *    negocio vacío, con otro businessId, y veía todos sus datos "desaparecidos".
 *    Peor todavía: al escribir en ese businessId nuevo, los datos empezaban a
 *    dividirse entre dos negocios.
 *    Ahora sólo se crea cuando la lectura fue exitosa y confirmó que no hay
 *    businessId. Cualquier otro fallo devuelve `error` y no toca nada.
 *
 * 2. `arrayUnion` en vez de leer-modificar-escribir.
 *    El patrón `members: [...members, uid]` pierde miembros cuando dos personas
 *    entran al mismo tiempo: cada una escribe la lista que leyó antes.
 *
 * 3. Código de negocio con entropía criptográfica.
 *    `Math.random()` es predecible: conociendo unas salidas se puede inferir el
 *    estado del generador. Como el código de negocio ES la credencial para
 *    entrar (ver punto 4), tiene que venir de `crypto.getRandomValues`.
 *
 * 4. IMPORTANTE — esto NO reemplaza las reglas de Firestore.
 *    `joinBusiness` sigue siendo el cliente diciéndole a la base "agregame a
 *    este negocio". Si las reglas permiten escribir `businesses/{id}.members`,
 *    cualquier usuario autenticado puede agregarse a CUALQUIER negocio cuyo
 *    código conozca o adivine, y leer los datos de los clientes de otro.
 *    El archivo `firestore.rules` que acompaña este parche es lo que
 *    efectivamente lo impide. Sin desplegarlo, este archivo no alcanza.
 */

function generateBusinessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin I/O/0/1: se dictan por teléfono
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, b => alphabet[b % alphabet.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

const CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

function isValidBusinessCode(code) {
  return typeof code === 'string' && CODE_REGEX.test(code.trim().toUpperCase())
}

export function useBusinessId(user) {
  const [businessId, setBusinessId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) {
      setBusinessId(null)
      setLoading(false)
      setError(null)
      return
    }

    // Si el usuario cambia (o se desmonta) mientras la promesa está en vuelo,
    // no se aplica el resultado viejo sobre el estado nuevo.
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      const userRef = doc(firestore, 'users', user.uid)

      // ── Paso 1: leer el perfil. Un fallo acá NO crea nada. ──
      let userSnap
      try {
        userSnap = await getDoc(userRef)
      } catch (err) {
        if (cancelled) return
        console.error('[BusinessId] No se pudo leer el perfil:', err.code || err.message)
        setBusinessId(null)
        setError({
          code: err.code || 'unavailable',
          message: 'No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar.',
        })
        setLoading(false)
        return
      }

      if (cancelled) return

      const existingId = userSnap.exists() ? userSnap.data()?.businessId : null

      // ── Paso 2: el usuario ya tiene negocio ──
      if (isValidBusinessCode(existingId)) {
        const normalized = existingId.trim().toUpperCase()
        setBusinessId(normalized)
        setLoading(false)

        // Reparar la membresía en segundo plano: que falle no debe impedir usar
        // la app, sólo se registra.
        try {
          const businessRef = doc(firestore, 'businesses', normalized)
          const businessSnap = await getDoc(businessRef)

          if (businessSnap.exists()) {
            const members = businessSnap.data()?.members || []
            if (!members.includes(user.uid)) {
              await updateDoc(businessRef, { members: arrayUnion(user.uid) })
            }
          } else {
            await setDoc(businessRef, {
              createdBy: user.uid,
              createdAt: new Date().toISOString(),
              members: [user.uid],
            })
          }
        } catch (err) {
          console.warn('[BusinessId] No se pudo verificar la membresía:', err.code || err.message)
        }
        return
      }

      // ── Paso 3: la lectura funcionó y confirmó que no hay negocio → crear ──
      try {
        const newBusinessId = generateBusinessCode()

        await setDoc(doc(firestore, 'businesses', newBusinessId), {
          createdBy: user.uid,
          createdAt: new Date().toISOString(),
          members: [user.uid],
        })

        await setDoc(userRef, {
          email: user.email,
          businessId: newBusinessId,
          isOwner: true,
          createdAt: new Date().toISOString(),
        }, { merge: true })

        if (cancelled) return
        setBusinessId(newBusinessId)
      } catch (err) {
        if (cancelled) return
        console.error('[BusinessId] Error creando negocio:', err.code || err.message)
        setBusinessId(null)
        setError({
          code: err.code || 'unknown',
          message: 'No se pudo crear el espacio de trabajo. Intentá de nuevo en un momento.',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [user])

  return { businessId, loading, error }
}

export async function joinBusiness(user, businessCode) {
  if (!user) throw new Error('Usuario no autenticado')

  const code = String(businessCode || '').trim().toUpperCase()
  if (!isValidBusinessCode(code)) throw new Error('INVALID_CODE')

  // Antes acá había un getDoc() para verificar que el negocio existiera. Se quitó
  // a propósito: firestore.rules sólo permite leer businesses/{id} a los miembros,
  // así que ese pre-chequeo siempre fallaría para quien se está sumando. Y no hace
  // falta — updateDoc sobre un documento inexistente ya falla con `not-found`.
  // De paso deja de existir una vía para preguntar "¿existe este negocio?" sin
  // pertenecer a él, que servía para adivinar códigos.
  try {
    // arrayUnion es atómico: no pisa a otro miembro que se sume al mismo tiempo.
    await updateDoc(doc(firestore, 'businesses', code), { members: arrayUnion(user.uid) })
  } catch (err) {
    if (err?.code === 'not-found' || err?.code === 'permission-denied') {
      throw new Error('INVALID_CODE', { cause: err })
    }
    throw err
  }

  await setDoc(doc(firestore, 'users', user.uid), {
    email: user.email,
    businessId: code,
    isOwner: false,
    updatedAt: new Date().toISOString(),
  }, { merge: true })

  return code
}

export async function leaveBusiness(user, currentBusinessId) {
  if (!user) throw new Error('Usuario no autenticado')

  const newBusinessId = generateBusinessCode()

  // Orden: primero salir del anterior, después crear el nuevo y apuntar el
  // perfil. Antes se creaba el nuevo primero y, si la salida fallaba, el usuario
  // quedaba listado como miembro de los dos negocios a la vez.
  if (currentBusinessId) {
    try {
      await updateDoc(doc(firestore, 'businesses', currentBusinessId), {
        members: arrayRemove(user.uid),
      })
    } catch (err) {
      console.warn('[leaveBusiness] No se pudo salir del negocio anterior:', err.code || err.message)
    }
  }

  await setDoc(doc(firestore, 'businesses', newBusinessId), {
    createdBy: user.uid,
    createdAt: new Date().toISOString(),
    members: [user.uid],
  })

  await setDoc(doc(firestore, 'users', user.uid), {
    email: user.email,
    businessId: newBusinessId,
    isOwner: true,
    updatedAt: new Date().toISOString(),
  }, { merge: true })

  return newBusinessId
}
