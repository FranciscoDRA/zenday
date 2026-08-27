import { hasConflict, hasAnyConflict } from '../utils/helpers'

// Los ids de las citas conviven como número (los viejos, creados con `Date.now()`)
// y como string (los que vuelven de Firestore, donde el id del documento siempre
// es texto). Comparar con `===` fallaba justo en la transición: apretabas
// "eliminar" o "marcar como pagado" y no pasaba nada, sin ningún error.
const sameId = (a, b) => (a == null ? null : String(a)) === (b == null ? null : String(b))

export function appointmentsReducer(state, action) {
  switch (action.type) {
    case 'SET_APPOINTMENTS':
      return Array.isArray(action.payload) ? action.payload : []

    case 'ADD_APPOINTMENT':
      if (hasConflict(state, action.payload)) return state
      return [...state, action.payload]

    case 'ADD_MULTIPLE_APPOINTMENTS':
      if (hasAnyConflict(state, action.payload)) return state
      return [...state, ...action.payload]

    case 'UPDATE_APPOINTMENT': {
      const updated = state.map(apt =>
        sameId(apt.id, action.id) ? { ...apt, ...action.payload } : apt
      )
      const updatedApt = updated.find(apt => sameId(apt.id, action.id))
      if (!updatedApt) return state
      if (hasConflict(updated, updatedApt, action.id)) return state
      return updated
    }

    case 'MARK_PAID':
      return state.map(apt =>
        sameId(apt.id, action.id)
          ? {
              ...apt,
              paid: true,
              paymentDate: action.paymentDate || apt.paymentDate || new Date().toISOString(),
              // El medio va en la accion, igual que la fecha. Si no viene, se
              // conserva el que ya tuviera: corregir una fecha no puede borrar
              // el medio que ya estaba registrado.
              paymentMethod: action.paymentMethod || apt.paymentMethod || null,
            }
          : apt
      )

    case 'DELETE_APPOINTMENT':
      return state.filter(apt => !sameId(apt.id, action.id))

    case 'DELETE_RECURRING_APPOINTMENTS':
      return state.filter(apt => !sameId(apt.recurrenceGroupId, action.groupId))

    case 'UPDATE_STATUS': {
      const completingStatuses = ['completed', 'delivered', 'picked']
      const isNowCompleted = completingStatuses.includes(action.status)
      const wasCompleted = completingStatuses.includes(
        state.find(a => sameId(a.id, action.id))?.status
      )
      return state.map(apt => {
        if (!sameId(apt.id, action.id)) return apt
        return {
          ...apt,
          status: action.status,
          ...(!wasCompleted && isNowCompleted && !apt.deliveredAt && {
            deliveredAt: new Date().toISOString()
          })
        }
      })
    }

    default:
      return state
  }
}
