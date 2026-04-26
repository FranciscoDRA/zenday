import { hasConflict, hasAnyConflict } from '../utils/helpers'

export function appointmentsReducer(state, action) {
  switch (action.type) {
    case 'SET_APPOINTMENTS': return action.payload
    case 'ADD_APPOINTMENT': if (hasConflict(state, action.payload)) return state; return [...state, action.payload]
    case 'ADD_MULTIPLE_APPOINTMENTS': if (hasAnyConflict(state, action.payload)) return state; return [...state, ...action.payload]
    case 'UPDATE_APPOINTMENT': {
      const updated = state.map(apt => (apt.id === action.id ? { ...apt, ...action.payload } : apt))
      const updatedApt = updated.find(apt => apt.id === action.id)
      if (hasConflict(updated, updatedApt, action.id)) return state
      return updated
    }
    case 'MARK_PAID': return state.map(apt =>
      apt.id === action.id
        ? { ...apt, paid: true, paymentDate: apt.paymentDate || new Date().toISOString() }
        : apt
    )
    case 'DELETE_APPOINTMENT': return state.filter(apt => apt.id !== action.id)
    case 'DELETE_RECURRING_APPOINTMENTS': return state.filter(apt => apt.recurrenceGroupId !== action.groupId)
    case 'UPDATE_STATUS': {
      const completingStatuses = ['completed', 'delivered', 'picked']
      const isNowCompleted = completingStatuses.includes(action.status)
      const wasCompleted = completingStatuses.includes(
        state.find(a => a.id === action.id)?.status
      )
      return state.map(apt => {
        if (apt.id !== action.id) return apt
        return {
          ...apt,
          status: action.status,
          ...(!wasCompleted && isNowCompleted && !apt.deliveredAt && {
            deliveredAt: new Date().toISOString()
          })
        }
      })
    }
    default: return state
  }
}