import React, { useMemo, useState, useCallback } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatDateTime, formatCurrency } from '../../utils/helpers'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PAID_STATUSES = new Set(['completed', 'delivered', 'picked'])

const DEFAULT_TEMPLATE = {
  prefix: 'Hola ',
  middle: ', recordatorio de pago pendiente de ',
  suffix: ' por el pedido entregado el ',
  ending: '. ¡Gracias por tu compra!',
}

const DEFAULT_PAYMENT_CONFIG = {
  bankInfo:        '',
  bankAlias:       '',
  bankCBU:         '',
  mercadoPagoLink: '',
  paymentMessage:  'Podés pagar por transferencia bancaria o Mercado Pago:',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function loadFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key)
    return val !== null ? val : fallback
  } catch {
    return fallback
  }
}

function loadJSONFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key)
    return val ? JSON.parse(val) : fallback
  } catch {
    return fallback
  }
}

/** Normaliza un número de teléfono uruguayo a 598XXXXXXXXX */
function normalizeUruguayPhone(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('598')) return digits
  if (digits.startsWith('0'))   return '598' + digits.slice(1)  // 09X → 598 9X
  if (digits.startsWith('9'))   return '598' + digits            // 9X  → 598 9X
  return digits
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function PendingPaymentsScreen({
  appointments,
  markAsPaid,
  deleteAppointment,
  setProducts,
  setAppointments,
  nav,
  patients,
}) {
  const focusRef = useScreenFocus()
  const toast    = useToast()
  const confirm  = useConfirm()  // ✅ Dialogos consistentes

  // ── Template de mensaje ───────────────────────────────────────────────────
  const [prefix,  setPrefix]  = useState(() => loadFromStorage('reminder-prefix', DEFAULT_TEMPLATE.prefix))
  const [middle,  setMiddle]  = useState(() => loadFromStorage('reminder-middle', DEFAULT_TEMPLATE.middle))
  const [suffix,  setSuffix]  = useState(() => loadFromStorage('reminder-suffix', DEFAULT_TEMPLATE.suffix))
  const [ending,  setEnding]  = useState(() => loadFromStorage('reminder-ending', DEFAULT_TEMPLATE.ending))

  // ── Config de pago ─────────────────────────────────────────────────────────
  const [paymentConfig, setPaymentConfig] = useState(
    () => loadJSONFromStorage('zenday-payment-config', DEFAULT_PAYMENT_CONFIG)
  )

  const [showTemplate,      setShowTemplate]      = useState(false)
  const [showPaymentConfig, setShowPaymentConfig] = useState(false)
  const [isDeleting,        setIsDeleting]        = useState(false)
  const [deletingId,        setDeletingId]        = useState(null)

  // ── Pedidos pendientes ─────────────────────────────────────────────────────
  const pendingAppointments = useMemo(() =>
    (appointments || [])
      .filter(apt => PAID_STATUSES.has(apt.status) && !apt.paid)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime)),
  [appointments])

  // ── Agrupados por cliente ──────────────────────────────────────────────────
  const groupedByClient = useMemo(() => {
    const groups = {}
    pendingAppointments.forEach(apt => {
      const key = apt.patientName || 'Sin nombre'
      let phone = apt.patientPhone
      let email = apt.patientEmail
      if (!phone && patients) {
        const found = patients.find(p => p.id === apt.patientId || p.name === apt.patientName)
        if (found) { phone = found.phone; email = found.email }
      }

      if (!groups[key]) {
        groups[key] = { name: key, phone, email, appointments: [], total: 0 }
      }
      groups[key].appointments.push(apt)
      groups[key].total += apt.price || 0
    })
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [pendingAppointments, patients])

  const totalPending = useMemo(
    () => groupedByClient.reduce((s, g) => s + g.total, 0),
    [groupedByClient]
  )

  // ── Construir mensaje ──────────────────────────────────────────────────────
  const buildMessage = useCallback((apt) => {
    let msg = `${prefix}${apt.patientName}${middle}${formatCurrency(apt.price, 'UYU')}${suffix}${formatDateTime(apt.startTime)}${ending}`

    if (paymentConfig.bankInfo || paymentConfig.mercadoPagoLink) {
      msg += '\n\n' + paymentConfig.paymentMessage + '\n'
      if (paymentConfig.bankInfo) {
        msg += `\n🏦 Banco: ${paymentConfig.bankInfo}`
        if (paymentConfig.bankAlias) msg += `\n📝 Alias: ${paymentConfig.bankAlias}`
        if (paymentConfig.bankCBU)   msg += `\n🔢 CBU: ${paymentConfig.bankCBU}`
      }
      if (paymentConfig.mercadoPagoLink) {
        msg += `\n💳 Mercado Pago: ${paymentConfig.mercadoPagoLink}`
      }
    }
    return msg
  }, [prefix, middle, suffix, ending, paymentConfig])

  // ── Enviar WhatsApp (corregido: usa openExternal en Electron) ──────────────
  const sendWhatsApp = useCallback((phone, message) => {
    const normalized = normalizeUruguayPhone(phone)
    const url = `https://api.whatsapp.com/send?phone=${normalized}&text=${encodeURIComponent(message)}`
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const handleSendReminder = useCallback((apt, groupPhone) => {
    const phone = apt.patientPhone || groupPhone
    if (!phone) {
      toast.addToast('📱 Agregá un teléfono al cliente', 'error')
      return
    }
    sendWhatsApp(phone, buildMessage(apt))
    toast.addToast('📱 Recordatorio enviado', 'success')
  }, [buildMessage, sendWhatsApp, toast])

  // ── Marcar como pagado (con confirmación unificada) ────────────────────────
  const handleMarkAsPaid = useCallback(async (apt) => {
    const ok = await confirm(
      `¿Confirmar pago de ${formatCurrency(apt.price, 'UYU')}?\nCliente: ${apt.patientName}`,
      'Confirmar pago'
    )
    if (!ok) return
    markAsPaid(apt.id)
    toast.addToast('✅ Pago registrado', 'success')
  }, [markAsPaid, toast, confirm])

  // ── Eliminar pedido (con confirmación unificada) ───────────────────────────
  const handleDeleteAppointment = useCallback(async (apt) => {
    if (isDeleting) return

    const ok = await confirm(
      `⚠️ ¿ELIMINAR PEDIDO PENDIENTE?\n\nCliente: ${apt.patientName}\nProducto: ${apt.productName || 'N/A'}\nMonto: ${formatCurrency(apt.price, 'UYU')}\n\nEsta acción NO se puede deshacer.`,
      'Confirmar eliminación'
    )
    if (!ok) return

    setIsDeleting(true)
    setDeletingId(apt.id)

    try {
      // 1. Devolver stock si corresponde
      if (apt.productId && setProducts) {
        setProducts(prev => {
          const idx = prev.findIndex(p => String(p.id) === String(apt.productId))
          if (idx === -1) return prev
          const updated = [...prev]
          const newStock = (updated[idx].stock || 0) + 1
          updated[idx] = { ...updated[idx], stock: newStock, updatedAt: new Date().toISOString() }
          toast.addToast(`📦 Stock de "${updated[idx].name}" restaurado a ${newStock}`, 'info')
          return updated
        })
      }

      // 2. Eliminar la cita
      if (typeof setAppointments === 'function') {
        setAppointments(prev => prev.filter(a => String(a.id) !== String(apt.id)))
        toast.addToast('🗑️ Pedido eliminado', 'success')
      } else if (typeof deleteAppointment === 'function') {
        deleteAppointment(apt.id)
        toast.addToast('🗑️ Pedido eliminado', 'success')
      } else {
        toast.addToast('❌ Error: función de eliminación no disponible', 'error')
      }
    } catch (err) {
      console.error('[PendingPayments] Error al eliminar:', err)
      toast.addToast('❌ Error al eliminar el pedido', 'error')
    } finally {
      setTimeout(() => { setIsDeleting(false); setDeletingId(null) }, 300)
    }
  }, [isDeleting, setProducts, setAppointments, deleteAppointment, toast, confirm])

  // ── Guardar template ───────────────────────────────────────────────────────
  const saveTemplate = useCallback(() => {
    localStorage.setItem('reminder-prefix', prefix)
    localStorage.setItem('reminder-middle', middle)
    localStorage.setItem('reminder-suffix', suffix)
    localStorage.setItem('reminder-ending', ending)
    toast.addToast('💾 Plantilla guardada', 'success')
  }, [prefix, middle, suffix, ending, toast])

  const resetTemplate = useCallback(() => {
    setPrefix(DEFAULT_TEMPLATE.prefix)
    setMiddle(DEFAULT_TEMPLATE.middle)
    setSuffix(DEFAULT_TEMPLATE.suffix)
    setEnding(DEFAULT_TEMPLATE.ending)
  }, [])

  // ── Guardar config de pago ─────────────────────────────────────────────────
  const savePaymentConfig = useCallback(() => {
    try {
      localStorage.setItem('zenday-payment-config', JSON.stringify(paymentConfig))
      setShowPaymentConfig(false)
      toast.addToast('💳 Configuración guardada', 'success')
    } catch {
      toast.addToast('❌ Error al guardar la configuración', 'error')
    }
  }, [paymentConfig, toast])

  // ── Copiar al portapapeles ─────────────────────────────────────────────────
  const copyToClipboard = useCallback((text) => {
    navigator.clipboard?.writeText(text)
    toast.addToast('📋 Copiado', 'success')
  }, [toast])

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div ref={focusRef} tabIndex={-1} className="pending-payments">

      {/* Header */}
      <div className="pending-payments__header">
        <BackButton onClick={() => nav.goBack()} />
        <div className="pending-payments__title">
          <h1>Cobros pendientes</h1>
          <p>Gestioná los pagos de tus pedidos entregados</p>
        </div>
        <div className="header-actions">
          <button
            className={`pending-payments__settings ${showPaymentConfig ? 'active' : ''}`}
            onClick={() => setShowPaymentConfig(v => !v)}
            title="Configurar métodos de pago"
          >
            💳
          </button>
          <button
            className={`pending-payments__settings ${showTemplate ? 'active' : ''}`}
            onClick={() => setShowTemplate(v => !v)}
            title="Personalizar mensaje"
          >
            ✏️
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="pending-payments__stats">
        <div className="stat-card stat-card--primary">
          <div className="stat-card__icon">💰</div>
          <div className="stat-card__content">
            <span className="stat-card__value">{formatCurrency(totalPending, 'UYU')}</span>
            <span className="stat-card__label">Total pendiente</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon">👥</div>
          <div className="stat-card__content">
            <span className="stat-card__value">{groupedByClient.length}</span>
            <span className="stat-card__label">Clientes</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon">📦</div>
          <div className="stat-card__content">
            <span className="stat-card__value">{pendingAppointments.length}</span>
            <span className="stat-card__label">Pedidos</span>
          </div>
        </div>
      </div>

      {/* Config de pago */}
      {showPaymentConfig && (
        <div className="payment-config-panel">
          <h3>💳 Configurar métodos de pago</h3>
          <p>Esta información se agregará a los mensajes de WhatsApp</p>

          <div className="form-group">
            <label>Mensaje introductorio</label>
            <input
              type="text"
              value={paymentConfig.paymentMessage}
              onChange={e => setPaymentConfig(p => ({ ...p, paymentMessage: e.target.value }))}
              placeholder="Ej: Podés pagar por transferencia o Mercado Pago:"
            />
          </div>

          <div className="form-group">
            <label>🏦 Banco / Entidad</label>
            <input
              type="text"
              value={paymentConfig.bankInfo}
              onChange={e => setPaymentConfig(p => ({ ...p, bankInfo: e.target.value }))}
              placeholder="Ej: Banco Itaú"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>📝 Alias</label>
              <input
                type="text"
                value={paymentConfig.bankAlias}
                onChange={e => setPaymentConfig(p => ({ ...p, bankAlias: e.target.value }))}
                placeholder="Ej: mi.negocio.itaú"
              />
            </div>
            <div className="form-group">
              <label>🔢 CBU / CVU</label>
              <input
                type="text"
                value={paymentConfig.bankCBU}
                onChange={e => setPaymentConfig(p => ({ ...p, bankCBU: e.target.value }))}
                placeholder="Ej: 0000000000000000000000"
              />
            </div>
          </div>

          <div className="form-group">
            <label>💳 Link de Mercado Pago</label>
            <input
              type="text"
              value={paymentConfig.mercadoPagoLink}
              onChange={e => setPaymentConfig(p => ({ ...p, mercadoPagoLink: e.target.value }))}
              placeholder="Ej: https://mpago.la/..."
            />
          </div>

          <div className="modal-footer">
            <button className="btn--secondary" onClick={() => setShowPaymentConfig(false)}>Cancelar</button>
            <button className="btn--primary"   onClick={savePaymentConfig}>Guardar</button>
          </div>
        </div>
      )}

      {/* Editor de template */}
      {showTemplate && (
        <div className="template-editor">
          <div className="template-editor__header">
            <div className="template-editor__icon">✏️</div>
            <div>
              <h3>Personalizar mensaje</h3>
              <p>El mensaje se enviará por WhatsApp a tus clientes</p>
            </div>
          </div>

          <div className="template-editor__body">
            <div className="message-builder">
              <div className="message-builder__line">
                <input value={prefix}  onChange={e => setPrefix(e.target.value)}  placeholder="Prefijo" />
                <span className="variable-badge">👤 Nombre</span>
                <input value={middle}  onChange={e => setMiddle(e.target.value)}  placeholder="Medio" />
                <span className="variable-badge">💰 Monto</span>
                <input value={suffix}  onChange={e => setSuffix(e.target.value)}  placeholder="Sufijo" />
                <span className="variable-badge">📅 Fecha</span>
                <input value={ending}  onChange={e => setEnding(e.target.value)}  placeholder="Final" />
              </div>
            </div>

            <div className="message-preview">
              <div className="message-preview__label">Vista previa</div>
              <div className="message-preview__text">
                {prefix}<strong>Juan Pérez</strong>{middle}
                <strong>$5.000</strong>{suffix}
                <strong>10/04/2026</strong>{ending}
              </div>
            </div>

            <div className="template-actions">
              <button className="btn btn--secondary" onClick={resetTemplate}>Restablecer</button>
              <button className="btn btn--primary"   onClick={saveTemplate}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Lista o empty state */}
      {groupedByClient.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🎉</div>
          <h3>¡Todo al día!</h3>
          <p>No hay pagos pendientes por cobrar</p>
        </div>
      ) : (
        <div className="clients-list">
          {groupedByClient.map(group => (
            <div key={group.name} className="client-card">
              <div className="client-card__header">
                <div className="client-avatar">
                  {(group.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="client-info">
                  <h4>{group.name}</h4>
                  <div className="client-contact">
                    {group.phone ? (
                      <span>📞 {group.phone}</span>
                    ) : (
                      <span className="client-contact--warning">⚠️ Sin teléfono</span>
                    )}
                  </div>
                </div>
                <div className="client-total">
                  <span className="client-total__label">Adeuda</span>
                  <span className="client-total__value">{formatCurrency(group.total, 'UYU')}</span>
                </div>
              </div>

              <div className="client-card__orders">
                {group.appointments.map(apt => (
                  <div key={apt.id} className="order-row">
                    <div className="order-row__info">
                      <div className="order-date">
                        <span className="order-date__day">
                          {new Date(apt.startTime).getDate()}
                        </span>
                        <span className="order-date__month">
                          {new Date(apt.startTime).toLocaleString('es', { month: 'short' })}
                        </span>
                      </div>
                      <div className="order-details">
                        <span className="order-details__name">{apt.productName || 'Producto'}</span>
                        <span className="order-details__price">{formatCurrency(apt.price, 'UYU')}</span>
                      </div>
                    </div>
                    <div className="order-row__actions">
                      <button
                        className="btn-action btn-action--paid"
                        onClick={() => handleMarkAsPaid(apt)}
                      >
                        ✓ Pagado
                      </button>
                      <button
                        className={`btn-action btn-action--whatsapp ${!group.phone ? 'disabled' : ''}`}
                        onClick={() => handleSendReminder(apt, group.phone)}
                        disabled={!group.phone}
                      >
                        📱 Recordar
                      </button>
                      {paymentConfig.mercadoPagoLink && (
                        <button
                          className="btn-action btn-action--link"
                          onClick={() => copyToClipboard(paymentConfig.mercadoPagoLink)}
                          title="Copiar link de pago"
                        >
                          🔗
                        </button>
                      )}
                      <button
                        className="btn-action btn-action--delete"
                        onClick={() => handleDeleteAppointment(apt)}
                        disabled={isDeleting}
                        title="Eliminar pedido"
                      >
                        {deletingId === apt.id ? '⌛' : '✕'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}

export default PendingPaymentsScreen