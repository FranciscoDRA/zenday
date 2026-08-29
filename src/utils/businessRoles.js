// src/utils/businessRoles.js
//
// Espejo, del lado del cliente, de la lógica de roles que vive en
// firestore.rules (rolEn/veHistorias/veLaCaja). Tiene que decir EXACTAMENTE
// lo mismo que la regla: si acá se muestra una pantalla que el servidor va a
// rechazar, el usuario ve un error de permisos confuso en vez de nunca ver el
// botón. La regla de Firestore es la que de verdad protege los datos — esto
// es sólo para no ofrecer en la interfaz lo que el servidor no va a dejar
// hacer, y para esconder de un vistazo lo que un rol limitado no necesita ver.

export const ROLES = {
  DUENO: 'dueno',
  PROFESIONAL: 'profesional',
  ASISTENTE: 'asistente',
}

export const ROLE_LABELS = {
  [ROLES.DUENO]: '👑 Dueño/a',
  [ROLES.PROFESIONAL]: '🩺 Profesional',
  [ROLES.ASISTENTE]: '📅 Asistente',
}

export const ROLE_DESCRIPTIONS = {
  [ROLES.DUENO]: 'Ve y edita todo, incluidas finanzas y auditoría.',
  [ROLES.PROFESIONAL]: 'Agenda e historias clínicas. No ve gastos ni auditoría.',
  [ROLES.ASISTENTE]: 'Sólo agenda y catálogo. No abre historias clínicas ni ve la caja.',
}

/**
 * Mismo default que rolEn() en firestore.rules: si el negocio no tiene el
 * campo `roles`, todos sus miembros son dueños (así las reglas se pudieron
 * desplegar sin migrar los negocios que ya existían). Si el negocio SÍ tiene
 * `roles` y un uid no figura ahí, el rol mínimo es asistente — no dueño —
 * porque si no, cualquiera que se sume con el código del negocio entraría
 * como dueño.
 */
export function rolDe(businessDoc, uid) {
  if (!businessDoc?.roles) return ROLES.DUENO
  return businessDoc.roles[uid] || ROLES.ASISTENTE
}

/** Puede abrir una historia clínica (pantalla de Clientes/Pacientes). */
export function veHistorias(rol) {
  return rol === ROLES.DUENO || rol === ROLES.PROFESIONAL
}

/** Puede ver la plata: gastos, finanzas, reportes y auditoría. */
export function veLaCaja(rol) {
  return rol === ROLES.DUENO
}

/**
 * Pantallas que un rol NO puede abrir. Mismo criterio que `puede()` en
 * firestore.rules: patients → veHistorias; expenses/financial/reports/audit →
 * veLaCaja (financial y reports mezclan ingresos con gastos, así que van con
 * la caja aunque no sean la colección `expenses` en sí). `pending` no está
 * restringido en las reglas de Firestore (son citas filtradas, mismo acceso
 * que la agenda), pero acá se le exige veHistorias además: para hacer
 * seguimiento de un pago pendiente hace falta poder abrir a ese cliente.
 */
const PANTALLAS_RESTRINGIDAS = {
  patients: veHistorias,
  patientDetail: veHistorias,
  pending: veHistorias,
  expenses: veLaCaja,
  financial: veLaCaja,
  reports: veLaCaja,
  audit: veLaCaja,
}

/** true si `rol` SÍ puede abrir `screenId` (sin entrada acá = abierta a todos). */
export function puedeVerPantalla(rol, screenId) {
  const chequeo = PANTALLAS_RESTRINGIDAS[screenId]
  return !chequeo || chequeo(rol)
}
