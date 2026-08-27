import React, { useMemo, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { BackButton } from '../common/BackButton'
import { PaymentDateModal } from '../common/PaymentDateModal'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useScreenFocus } from '../../hooks/useScreenFocus'
import { formatDateTime, formatCurrency, todayKey } from '../../utils/helpers'
import { generatePendingPaymentsReport } from '../../utils/pdfReportGenerator'

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
  if (digits.startsWith('0'))   return '598' + digits.slice(1)
  if (digits.startsWith('9'))   return '598' + digits
  return digits
}

/**
 * Generar PDF de cobros pendientes.
 *
 * Antes esto bajaba html2pdf desde un CDN de cloudflare en el momento de
 * apretar el boton, armaba un HTML completo a mano y le sacaba una foto.
 * Sin internet no funcionaba, y el PDF salia como imagen: pesado y con el
 * texto no seleccionable.
 *
 * Ahora lo arma jsPDF, que ya viene adentro del programa igual que los demas
 * reportes. Anda sin internet y el texto se puede buscar y copiar.
 */
async function generatePDF(groupedByClient, totalPending) {
  return generatePendingPaymentsReport({ groupedByClient, totalPending })
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
  const { confirm } = useConfirm()

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
  const [isExportingPDF,    setIsExportingPDF]    = useState(false)
  
  // ── Modal de fecha de pago ─────────────────────────────────────────────────
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [pendingPaymentApt, setPendingPaymentApt] = useState(null)
  
  // ── Modal para editar precio ───────────────────────────────────────────────
  const [showEditPriceModal, setShowEditPriceModal] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState(null)
  const [newPrice, setNewPrice] = useState('')
  const [priceError, setPriceError] = useState('')

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

  // ── Exportar a Excel ───────────────────────────────────────────────────────
  const handleExportDeudores = useCallback(() => {
    if (groupedByClient.length === 0) {
      toast.addToast('No hay cobros pendientes', 'info')
      return
    }

    const data = [
      ['Cliente', 'Teléfono', 'Email', 'Producto', 'Fecha pedido', 'Monto pendiente'],
      ...groupedByClient.flatMap(group =>
        group.appointments.map(apt => [
          group.name,
          group.phone || 'Sin teléfono',
          group.email || 'Sin email',
          apt.productName || 'Sin producto',
          new Date(apt.startTime).toLocaleDateString('es-UY'),
          apt.price || 0
        ])
      )
    ]

    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cobros pendientes')
    XLSX.writeFile(wb, `cobros-pendientes-${todayKey()}.xlsx`)
    toast.addToast('📊 Excel exportado', 'success')
  }, [groupedByClient, toast])

  // ── Exportar a PDF ─────────────────────────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (groupedByClient.length === 0) {
      toast.addToast('No hay cobros pendientes para exportar', 'info')
      return
    }

    setIsExportingPDF(true)
    try {
      await generatePDF(groupedByClient, totalPending)
      toast.addToast('📄 PDF generado correctamente', 'success')
    } catch (error) {
      console.error('[PendingPayments] Error exportando PDF:', error)
      toast.addToast('❌ Error al generar el PDF', 'error')
    } finally {
      setIsExportingPDF(false)
    }
  }, [groupedByClient, totalPending, toast])

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

  // ── Enviar WhatsApp ────────────────────────────────────────────────────────
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

  // ── ABRIR MODAL PARA EDITAR PRECIO ─────────────────────────────────────────
  const handleEditPrice = useCallback((apt) => {
    setEditingAppointment(apt)
    setNewPrice(String(apt.price || 0))
    setPriceError('')
    setShowEditPriceModal(true)
  }, [])

  // ── VALIDAR Y GUARDAR NUEVO PRECIO ─────────────────────────────────────────
  const handleSavePrice = useCallback(async () => {
    if (!editingAppointment) return
    
    // Validar que sea un número válido
    const parsedPrice = parseFloat(newPrice)
    if (isNaN(parsedPrice)) {
      setPriceError('Ingrese un número válido')
      return
    }
    
    if (parsedPrice < 0) {
      setPriceError('El precio no puede ser negativo')
      return
    }
    
    if (parsedPrice > 99999999) {
      setPriceError('El precio es demasiado alto')
      return
    }
    
    // Confirmar cambio de precio
    const oldPrice = editingAppointment.price || 0
    const difference = parsedPrice - oldPrice
    
    let confirmMessage = `⚠️ CAMBIAR PRECIO DEL PEDIDO\n\n`
    confirmMessage += `Cliente: ${editingAppointment.patientName}\n`
    confirmMessage += `Producto: ${editingAppointment.productName || 'N/A'}\n`
    confirmMessage += `Precio actual: ${formatCurrency(oldPrice, 'UYU')}\n`
    confirmMessage += `Nuevo precio: ${formatCurrency(parsedPrice, 'UYU')}\n`
    
    if (difference !== 0) {
      confirmMessage += `\n💸 Diferencia: ${difference > 0 ? '+' : ''}${formatCurrency(difference, 'UYU')}\n`
    }
    
    confirmMessage += `\n¿Estás seguro de cambiar el precio?`
    
    const confirmed = await confirm(confirmMessage, 'Confirmar cambio de precio')
    if (!confirmed) return
    
    // Actualizar el appointment en el estado
    if (typeof setAppointments === 'function') {
      setAppointments(prev => prev.map(a => 
        String(a.id) === String(editingAppointment.id) 
          ? { ...a, price: parsedPrice, originalPrice: oldPrice, priceUpdatedAt: new Date().toISOString() }
          : a
      ))
    }
    
    toast.addToast(`💰 Precio actualizado: ${formatCurrency(oldPrice, 'UYU')} → ${formatCurrency(parsedPrice, 'UYU')}`, 'success')
    setShowEditPriceModal(false)
    setEditingAppointment(null)
    setNewPrice('')
  }, [editingAppointment, newPrice, setAppointments, confirm, toast])

  // ── Marcar como pagado (ABRE MODAL) ────────────────────────────────────────
  const handleMarkAsPaid = useCallback((apt) => {
    setPendingPaymentApt(apt)
    setShowPaymentModal(true)
  }, [])

  // ── Eliminar pedido ────────────────────────────────────────────────────────
  const handleDeleteAppointment = useCallback(async (apt) => {
    if (isDeleting) return

    // Si el pedido tiene precio, preguntar antes de eliminar
    if (apt.price > 0) {
      const confirmDelete = await confirm(
        `⚠️ ¿ELIMINAR PEDIDO PENDIENTE?\n\n` +
        `Cliente: ${apt.patientName}\n` +
        `Producto: ${apt.productName || 'N/A'}\n` +
        `Monto: ${formatCurrency(apt.price, 'UYU')}\n\n` +
        `⚠️ ADVERTENCIA: Este pedido tiene un monto pendiente de cobro.\n` +
        `Si lo eliminas, perderás el registro de esta deuda.\n\n` +
        `¿Estás seguro de eliminar este pedido?`,
        'Confirmar eliminación'
      )
      if (!confirmDelete) return
    } else {
      const ok = await confirm(
        `⚠️ ¿ELIMINAR PEDIDO PENDIENTE?\n\nCliente: ${apt.patientName}\nProducto: ${apt.productName || 'N/A'}\nEsta acción NO se puede deshacer.`,
        'Confirmar eliminación'
      )
      if (!ok) return
    }

    setIsDeleting(true)
    setDeletingId(apt.id)

    try {
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

      if (typeof setAppointments === 'function') {
        setAppointments(prev => prev.filter(a => String(a.id) !== String(apt.id)))
        toast.addToast('🗑️ Pedido eliminado', 'success')
      } else if (typeof deleteAppointment === 'function') {
        // FIX: si el borrado se rechaza, no seguir como si hubiera pasado.
        if (await deleteAppointment(apt.id) === false) return
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
          <button
            onClick={handleExportDeudores}
            style={{
              padding: '8px 16px', borderRadius: '20px',
              border: '1px solid var(--border)', background: 'transparent',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500
            }}
          >
            📊 Exportar Excel
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExportingPDF}
            style={{
              padding: '8px 16px', borderRadius: '20px',
              border: '1px solid var(--border)', background: 'transparent',
              cursor: isExportingPDF ? 'wait' : 'pointer',
              fontSize: '13px', fontWeight: 500,
              opacity: isExportingPDF ? 0.6 : 1
            }}
          >
            {isExportingPDF ? '⏳ Generando...' : '📄 Exportar PDF'}
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
                        className="btn-action btn-action--edit"
                        onClick={() => handleEditPrice(apt)}
                        title="Editar precio"
                        style={{
                          padding: '7px 10px',
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: '20px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        ✏️ Precio
                      </button>
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

      {/* Modal de selección de fecha de pago */}
      {showPaymentModal && pendingPaymentApt && (
        <PaymentDateModal
          onConfirm={(date, metodo) => {
            // FIX: registro de pago sin verificar. Si fallaba, el modal se
            // cerraba y el cobro no quedaba registrado en ningún lado.
            if (markAsPaid(pendingPaymentApt.id, date, metodo) === false) return
            toast.addToast('✅ Pago registrado', 'success')
            setShowPaymentModal(false)
            setPendingPaymentApt(null)
          }}
          onCancel={() => {
            setShowPaymentModal(false)
            setPendingPaymentApt(null)
          }}
        />
      )}

      {/* Modal para editar precio del pedido */}
      {showEditPriceModal && editingAppointment && (
        <div className="modal-overlay" onClick={() => setShowEditPriceModal(false)}>
          <div className="modal-content" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✏️ Editar monto del pedido</h3>
              <button className="modal-close" onClick={() => setShowEditPriceModal(false)}>✕</button>
            </div>
            
            <div className="modal-body" style={{ padding: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
                  <strong>Cliente:</strong> {editingAppointment.patientName}
                </p>
                <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
                  <strong>Producto:</strong> {editingAppointment.productName || 'N/A'}
                </p>
                <p style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
                  <strong>Precio actual:</strong> {formatCurrency(editingAppointment.price, 'UYU')}
                </p>
              </div>
              
              <div className="form-group">
                <label>💰 Nuevo monto a cobrar</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ 
                    position: 'absolute', 
                    left: '12px', 
                    top: '50%', 
                    transform: 'translateY(-50%)',
                    color: 'var(--text-tertiary)'
                  }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={newPrice}
                    onChange={(e) => {
                      const valor = e.target.value.replace(/\./g, '').replace(/\s/g, '')
                      setNewPrice(valor)
                      setPriceError('')
                    }}
                    placeholder="Ingrese el monto final"
                    style={{
                      width: '100%',
                      padding: '12px 12px 12px 28px',
                      borderRadius: '10px',
                      border: priceError ? '1.5px solid #ef4444' : '1.5px solid var(--border)',
                      background: 'var(--bg-tertiary)',
                      fontSize: '14px',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
                {priceError && (
                  <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--accent-red)' }}>
                    ❌ {priceError}
                  </div>
                )}
                <small style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', display: 'block' }}>
                  💡 Podés quitar el costo de envío o ajustar el precio final según lo que pagó el cliente.
                </small>
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn--secondary" onClick={() => setShowEditPriceModal(false)}>Cancelar</button>
              <button className="btn--primary" onClick={handleSavePrice}>Guardar cambio</button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}

export default PendingPaymentsScreen