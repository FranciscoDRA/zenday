export const DEFAULT_CONSULTATION_CONFIG = {
  defaultDuration: 30,
  defaultPrice: 5000,
}

export const STATUSES = {
  scheduled: { label: 'Agendada', color: '#3498db', icon: '📅' },
  confirmed: { label: 'Confirmada', color: '#2ecc71', icon: '✅' },
  'in-progress': { label: 'En curso', color: '#f39c12', icon: '⏳' },
  completed: { label: 'Completada', color: '#27ae60', icon: '✔️' },
  cancelled: { label: 'Cancelada', color: '#e74c3c', icon: '❌' },
  'no-show': { label: 'No asistió', color: '#95a5a6', icon: '🚫' },
}

export const ORDER_STATUSES = {
  pending: { label: 'Pendiente', color: '#f39c12', icon: '⏳' },
  delivered: { label: 'Entregado', color: '#27ae60', icon: '✅' },
  picked: { label: 'Retirado', color: '#3498db', icon: '🛍️' },
  cancelled: { label: 'Cancelado', color: '#e74c3c', icon: '❌' },
}

export const USER_MODES = {
  personal: { label: 'Personal', icon: '👤', description: 'Agenda personal' },
  professional: { label: 'Profesional', icon: '🏥', description: 'Consultorio médico' },
  entrepreneur: { label: 'Emprendedor', icon: '🛒', description: 'Gestión de productos y pedidos' },
  merchant: { label: 'Comerciante', icon: '🏪', description: 'Pedidos con estados de entrega' },
}

export const RECURRENCE_TYPES = {
  none: { label: 'No recurrente', icon: '📅', interval: 0 },
  daily: { label: 'Diario', icon: '🔄', interval: 1, unit: 'days' },
  weekly: { label: 'Semanal', icon: '📆', interval: 7, unit: 'days' },
  biweekly: { label: 'Quincenal', icon: '📅📅', interval: 14, unit: 'days' },
  monthly: { label: 'Mensual', icon: '🗓️', interval: 30, unit: 'days' },
  yearly: { label: 'Anual', icon: '📅🎂', interval: 365, unit: 'days' },
}

export const DEFAULT_KANBAN_COLUMNS = [
  { id: 'prospect', label: 'Prospecto', color: '#94a3b8' },
  { id: 'negotiation', label: 'En Negociación', color: '#f59e0b' },
  { id: 'active', label: 'Activo', color: '#10b981' },
  { id: 'completed', label: 'Finalizado', color: '#6366f1' },
]
