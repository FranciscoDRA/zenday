import React from 'react'
import { STATUSES, ORDER_STATUSES } from '../../utils/constants'

export function StatusBadge({ status, type = 'appointment' }) {
  const statuses = type === 'order' ? ORDER_STATUSES : STATUSES
  const info = statuses[status] 
    ?? Object.values(statuses)[0] 
    ?? { color: 'var(--text-quaternary)', icon: '?', label: status || '—' }

  return (
    <span 
      className={`status-badge ${status ?? 'unknown'}`} 
      style={{ backgroundColor: info.color }} 
      title={info.label}
    >
      <span className="status-icon">{info.icon}</span>
      <span className="status-label">{info.label}</span>
    </span>
  )
}