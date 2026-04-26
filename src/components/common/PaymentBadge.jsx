import React from 'react'

export function PaymentBadge({ paid, onMarkAsPaid }) {
  if (paid) {
    return (
      <span className="payment-badge paid" title="Pagado">
        💰 Pagado
      </span>
    )
  }

  if (!onMarkAsPaid) {
    return (
      <span className="payment-badge pending" title="Pago pendiente">
        ⏳ Pendiente
      </span>
    )
  }

  return (
    <button
      type="button"
      className="payment-badge pending"
      onClick={(e) => { e.stopPropagation(); onMarkAsPaid() }}
      title="Marcar como pagado"
    >
      ⏳ Pendiente
    </button>
  )
}