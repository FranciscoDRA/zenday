/**
 * ZenDay — validación de licencias del lado del servidor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  EL PROBLEMA QUE RESUELVE
 *  ────────────────────────
 *  Hasta ahora la licencia se validaba dentro del .exe con un secreto que viajaba
 *  en el mismo archivo. Alcanza con `npx asar extract` para leerlo y generar
 *  claves para cualquier equipo, incluida la maestra.
 *
 *  Ofuscar mejor no arregla nada: cualquier validación que corra en la máquina
 *  del cliente se puede desactivar. La única defensa real es criptografía
 *  asimétrica:
 *
 *    · La clave PRIVADA vive únicamente acá, en el servidor. Nunca se distribuye.
 *    · La clave PÚBLICA va embebida en el .exe. Sirve para VERIFICAR firmas,
 *      no para crearlas. Que el cliente la lea no le sirve de nada.
 *
 *  Entonces el cliente ya no decide si su licencia es válida: solo verifica una
 *  respuesta que únicamente vos podés haber firmado.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  CÓMO DESPLEGARLO
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  1. Generá el par de claves (una sola vez, en tu máquina):
 *
 *       node functions/generateKeys.js
 *
 *     Te imprime dos cosas: la privada (para el servidor) y la pública
 *     (para la app). GUARDÁ LA PRIVADA — si la perdés, no podés firmar más
 *     licencias; si se filtra, volvés al punto de partida.
 *
 *  2. Cargá la privada como secreto (NO como variable de entorno común):
 *
 *       firebase functions:secrets:set ZENDAY_PRIVATE_KEY
 *       (pegá el contenido del .pem y Ctrl+D)
 *
 *  3. Pegá la pública en electron/licenseClient.cjs, en PUBLIC_KEY_PEM.
 *
 *  4. Desplegá:
 *
 *       cd functions && npm install && cd ..
 *       firebase deploy --only functions
 *
 *  5. Poné la URL que te devuelve en licenseClient.cjs → LICENSE_ENDPOINT.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  CÓMO VENDÉS UNA LICENCIA
 *  ─────────────────────────────────────────────────────────────────────────
 *  El cliente te pasa su ID de dispositivo (Ajustes → Copiar ID). Vos creás
 *  un documento en Firestore:
 *
 *    licenses/{claveQueLeMandás}
 *      { deviceId, plan: 'professional', activo: true, expiresAt: null,
 *        email, createdAt }
 *
 *  Y listo. Para revocar: poné `activo: false`. La app deja de funcionar
 *  cuando vence la concesión en caché (7 días), sin que tengas que tocar nada más.
 */

const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const crypto = require('crypto')

admin.initializeApp()
const db = admin.firestore()

const ZENDAY_PRIVATE_KEY = defineSecret('ZENDAY_PRIVATE_KEY')

/** Días que la app puede funcionar sin volver a consultar al servidor. */
const DIAS_DE_GRACIA = 7

/**
 * Lo que se firma. El orden y el formato importan: la app arma exactamente
 * la misma cadena para verificar. Cambiar esto invalida las licencias vivas.
 */
function payloadCanonico({ deviceId, plan, emitidoEn, validoHasta, licenciaHasta }) {
  return [
    'zenday-v1',
    `device=${deviceId}`,
    `plan=${plan}`,
    `iat=${emitidoEn}`,
    `exp=${validoHasta}`,
    `lic=${licenciaHasta || 'perpetua'}`,
  ].join('|')
}

exports.validateLicense = onRequest(
  { secrets: [ZENDAY_PRIVATE_KEY], cors: true, region: 'us-central1', maxInstances: 10 },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Método no permitido' })
    }

    const key = String(req.body?.key || '').trim().toUpperCase()
    const deviceId = String(req.body?.deviceId || '').trim().toUpperCase()

    if (!key || !deviceId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' })
    }
    // Formato mínimo, para no gastar una lectura de Firestore por cada intento.
    if (!/^[A-Z0-9-]{8,64}$/.test(key) || !/^[A-Z0-9]{8,64}$/.test(deviceId)) {
      return res.status(400).json({ ok: false, error: 'Formato inválido' })
    }

    try {
      const snap = await db.collection('licenses').doc(key).get()

      if (!snap.exists) {
        // Mismo mensaje para "no existe" y "no es tuya": no le confirmamos a
        // nadie que una clave existe pero es de otro equipo.
        return res.json({ ok: false, error: 'La clave no es válida para este dispositivo.' })
      }

      const lic = snap.data()

      if (lic.activo === false) {
        return res.json({ ok: false, error: 'Esta licencia fue dada de baja. Escribinos.' })
      }

      // Un deviceId vacío en el documento significa "todavía sin activar":
      // la primera activación lo fija. Así podés vender sin pedir el ID antes.
      if (!lic.deviceId) {
        await snap.ref.update({
          deviceId,
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      } else if (String(lic.deviceId).toUpperCase() !== deviceId) {
        return res.json({ ok: false, error: 'La clave no es válida para este dispositivo.' })
      }

      const licenciaHasta = lic.expiresAt || null   // null = perpetua
      if (licenciaHasta && new Date(licenciaHasta) < new Date()) {
        return res.json({ ok: false, error: 'La licencia venció.' })
      }

      const ahora = new Date()
      const hasta = new Date(ahora.getTime() + DIAS_DE_GRACIA * 86400000)

      const datos = {
        deviceId,
        plan: lic.plan || 'professional',
        emitidoEn: ahora.toISOString(),
        validoHasta: hasta.toISOString(),
        licenciaHasta,
      }

      const firma = crypto.sign(
        null,
        Buffer.from(payloadCanonico(datos), 'utf8'),
        crypto.createPrivateKey(ZENDAY_PRIVATE_KEY.value())
      )

      // Registro de uso: te sirve para ver si una clave se está usando desde
      // varios equipos, que es la señal de que alguien la compartió.
      await snap.ref.update({
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        lastDeviceId: deviceId,
        seenCount: admin.firestore.FieldValue.increment(1),
      }).catch(() => { /* que falle el registro no debe negar la licencia */ })

      return res.json({ ok: true, ...datos, firma: firma.toString('base64') })

    } catch (err) {
      console.error('[validateLicense]', err)
      return res.status(500).json({ ok: false, error: 'Error del servidor. Probá de nuevo.' })
    }
  }
)
