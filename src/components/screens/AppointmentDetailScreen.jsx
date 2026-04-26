import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { BackButton } from '../common/BackButton'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { formatCurrency } from '../../utils/helpers'

// ============================================
// CONSTANTES FUERA DEL COMPONENTE
// ============================================

const INVALID_TRANSITIONS = {
  'completed': ['scheduled', 'confirmed', 'in-progress', 'pending'],
  'delivered': ['scheduled', 'confirmed', 'in-progress', 'pending'],
  'picked': ['scheduled', 'confirmed', 'in-progress', 'pending'],
  'cancelled': ['scheduled', 'confirmed', 'in-progress', 'completed', 'delivered'],
  'no-show': ['completed', 'delivered']
}

const STATUS_LABELS = {
  scheduled: '📅 Agendada',
  confirmed: '✅ Confirmada',
  'in-progress': '⏳ En curso',
  completed: '✔️ Completada',
  cancelled: '❌ Cancelada',
  'no-show': '🚫 No asistió',
  pending: '⏳ Pendiente',
  delivered: '📦 Entregado',
  picked: '🛒 Retirado'
}

const STATUS_COLORS = {
  scheduled: '#3498db',
  confirmed: '#2ecc71',
  'in-progress': '#f39c12',
  completed: '#27ae60',
  cancelled: '#e74c3c',
  'no-show': '#95a5a6',
  pending: '#f39c12',
  delivered: '#27ae60',
  picked: '#3498db'
}

// ============================================
// UTILIDADES
// ============================================

const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-ES', { 
    weekday: 'long',
    day: '2-digit', 
    month: 'long',
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

// CORREGIDO: parseLocalDate para evitar problemas UTC
const parseLocalDate = (str) => {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null
  return new Date(y, m - 1, d, 12, 0, 0)  // Mediodía UTC-3
}

const formatDateForInput = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  return date.toISOString().split('T')[0]
}

const formatPhoneForWhatsApp = (phone) => {
  if (!phone) return null
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 8 && !cleaned.startsWith('598')) {
    cleaned = '598' + cleaned
  }
  if (cleaned.length === 9 && cleaned.startsWith('0')) {
    cleaned = '598' + cleaned.substring(1)
  }
  if (cleaned.length < 10) return null
  return cleaned
}

const openWhatsApp = (phoneNumber, message, e) => {
  e?.stopPropagation()
  if (!phoneNumber) return
  const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const openMaps = (location, e) => {
  e?.stopPropagation()
  if (!location) return
  const url = `https://maps.google.com/?q=${encodeURIComponent(location)}`
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function AppointmentDetailScreen({ 
  nav, 
  appointments, 
  updateAppointment, 
  deleteAppointment, 
  markAsPaid,
  updateStatus,
  params 
}) {
  const toast = useToast()
  const { confirm } = useConfirm()

  const appointment = useMemo(
    () => appointments?.find(a => a.id === params?.appointmentId),
    [appointments, params?.appointmentId]
  )

  const [isEditing, setIsEditing] = useState(false)
  const [editedNotes, setEditedNotes] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [isEditingDate, setIsEditingDate] = useState(false)  // ← NUEVO: para edición inline de fecha
  const [tempDate, setTempDate] = useState('')  // ← NUEVO: fecha temporal para edición

  useEffect(() => {
    setIsEditing(false)
    setIsProcessing(false)
    setShowHistory(false)
    setCancelReason('')
    setIsEditingDate(false)
    setTempDate('')
  }, [appointment?.id])

  const isPaid = appointment?.paid === true || appointment?.paymentStatus === 'paid'
  const price = appointment?.price || 0
  const remainingAmount = appointment?.remainingAmount || price
  const whatsAppNumber = formatPhoneForWhatsApp(appointment?.patientPhone)

  const canEdit = appointment && !['completed', 'cancelled', 'delivered'].includes(appointment.status)
const canEditDate = !!appointment 
  const canDelete = appointment && (!appointment.paid || appointment.status === 'scheduled')
  const canMarkAsPaid = appointment && !isPaid && price > 0 && ['completed', 'delivered', 'picked'].includes(appointment.status)

  const getAvailableStatuses = useCallback((currentStatus) => {
    const allStatuses = [
      { value: 'scheduled', label: '📅 Agendada', color: '#3498db' },
      { value: 'confirmed', label: '✅ Confirmada', color: '#2ecc71' },
      { value: 'in-progress', label: '⏳ En curso', color: '#f39c12' },
      { value: 'completed', label: '✔️ Completada', color: '#27ae60' },
      { value: 'delivered', label: '📦 Entregado', color: '#27ae60' },
      { value: 'picked', label: '🛒 Retirado', color: '#3498db' },
      { value: 'cancelled', label: '❌ Cancelada', color: '#e74c3c' },
      { value: 'no-show', label: '🚫 No asistió', color: '#95a5a6' }
    ]
    
    const invalidForCurrent = INVALID_TRANSITIONS[currentStatus] || []
    
    return allStatuses.filter(s => 
      s.value !== currentStatus && !invalidForCurrent.includes(s.value)
    )
  }, [])

  // ============================================
  // HANDLERS
  // ============================================

  // CORREGIDO: Función para editar fecha
  const handleDateEditStart = () => {
    const currentDate = appointment.orderDate || appointment.startTime
    setTempDate(formatDateForInput(currentDate))
    setIsEditingDate(true)
  }

  const handleDateEditCancel = () => {
    setIsEditingDate(false)
    setTempDate('')
  }

  const handleDateEditSave = async () => {
    if (!appointment || !tempDate) {
      setIsEditingDate(false)
      return
    }
    
    const newDate = parseLocalDate(tempDate)
    if (!newDate) {
      toast.addToast('❌ Fecha inválida', 'error')
      return
    }
    
    // Mantener la misma hora
    const currentStartTime = new Date(appointment.startTime)
    newDate.setHours(currentStartTime.getHours(), currentStartTime.getMinutes(), 0, 0)
    
    const newEndTime = new Date(newDate.getTime() + (appointment.duration || 60) * 60000)
    
    try {
      await updateAppointment(appointment.id, {
        startTime: newDate.toISOString(),
        endTime: newEndTime.toISOString(),
        ...(appointment.orderDate && { orderDate: newDate.toISOString() })
      })
      toast.addToast('✅ Fecha actualizada', 'success')
      setIsEditingDate(false)
    } catch (err) {
      console.error('Error updating date:', err)
      toast.addToast('❌ Error al actualizar fecha', 'error')
    }
  }

  const handleStatusChange = async (newStatus) => {
    if (!appointment) return
    
    setIsProcessing(true)
    
    try {
      const currentStatus = appointment.status
      
      if (INVALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
        toast.addToast('❌ No se puede cambiar a ese estado', 'error')
        return
      }
      
      const completingStatuses = ['completed', 'delivered', 'picked']
      if (completingStatuses.includes(newStatus) && !isPaid && price > 0) {
        const shouldComplete = await confirm(
          '⚠️ Este pedido NO ESTÁ PAGADO\n\n' +
          `Monto pendiente: ${formatCurrency(price, 'UYU')}\n\n` +
          '¿Deseas marcarlo como completado de todas formas?',
          'Confirmar sin pago'
        )
        if (!shouldComplete) {
          setIsProcessing(false)
          return
        }
      }
      
      let reason = null
      if (newStatus === 'cancelled') {
        const reasonResult = await confirm(
          '¿Por qué motivo se cancela esta cita?\n\n' +
          'Este motivo quedará registrado en la auditoría.',
          'Motivo de cancelación',
          true
        )
        if (reasonResult === null) {
          setIsProcessing(false)
          return
        }
        reason = reasonResult || 'No especificado'
      }
      
      if (updateStatus) {
        updateStatus(appointment.id, newStatus)
      } else {
        updateAppointment(appointment.id, { 
          status: newStatus,
          ...(reason && { cancelReason: reason, cancelledAt: new Date().toISOString() })
        })
      }
      
      console.info('[AUDIT] Status changed:', {
        appointmentId: appointment.id,
        from: currentStatus,
        to: newStatus,
        reason,
        user: localStorage.getItem('zenday-user-name') || 'Usuario',
        timestamp: new Date().toISOString()
      })
      
      toast.addToast(`✅ Estado cambiado a ${STATUS_LABELS[newStatus]}`, 'success')
    } catch (error) {
      console.error('Status change error:', error)
      toast.addToast('❌ Error al cambiar estado', 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMarkAsPaid = async () => {
    if (!appointment) return
    
    const confirmPayment = await confirm(
      '💰 REGISTRAR PAGO\n\n' +
      `Cliente: ${appointment.patientName}\n` +
      `Monto: ${formatCurrency(price, 'UYU')}\n\n` +
      '¿Confirmar pago recibido?',
      'Confirmar pago'
    )
    
    if (!confirmPayment) return
    
    setIsProcessing(true)
    
    try {
      if (markAsPaid) {
        markAsPaid(appointment.id)
      } else {
        updateAppointment(appointment.id, { 
          paid: true, 
          paymentStatus: 'paid',
          paymentDate: new Date().toISOString()
        })
      }
      
      console.info('[AUDIT] Payment registered:', {
        appointmentId: appointment.id,
        amount: price,
        user: localStorage.getItem('zenday-user-name') || 'Usuario',
        timestamp: new Date().toISOString()
      })
      
      toast.addToast('💰 Pago registrado exitosamente', 'success')
    } catch (error) {
      console.error('Payment error:', error)
      toast.addToast('❌ Error al registrar pago', 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDelete = async () => {
    if (!appointment) return
    
    if (appointment.paid) {
      const confirmPaid = await confirm(
        '⚠️ ¡PRECAUCIÓN! CITA PAGADA\n\n' +
        `Cliente: ${appointment.patientName}\n` +
        `Monto pagado: ${formatCurrency(price, 'UYU')}\n\n` +
        'Eliminar esta cita afectará tus reportes financieros.\n\n' +
        '¿Estás ABSOLUTAMENTE seguro?',
        '¡ALERTA! Cita pagada'
      )
      if (!confirmPaid) return
    } else {
      const confirmDelete = await confirm(
        '⚠️ ¿ELIMINAR CITA?\n\n' +
        `Cliente: ${appointment.patientName}\n` +
        `Fecha: ${formatDate(appointment.startTime)}\n\n` +
        'Esta acción NO se puede deshacer.',
        'Eliminar cita'
      )
      if (!confirmDelete) return
    }
    
    let shouldNotify = false
    if (whatsAppNumber) {
      shouldNotify = await confirm(
        '¿Deseas notificar al cliente por WhatsApp?',
        'Notificar cliente'
      )
    }
    
    const reason = await confirm(
      'Motivo de cancelación (opcional):\n\nEste motivo quedará registrado en la papelera.',
      'Motivo de cancelación',
      true
    )
    
    try {
      const trashBin = JSON.parse(localStorage.getItem('zenday-trash-bin') || '[]')
      trashBin.push({
        ...appointment,
        deletedAt: new Date().toISOString(),
        deletedBy: localStorage.getItem('zenday-user-name') || 'Usuario',
        deleteReason: reason || 'No especificado',
        wasNotified: shouldNotify
      })
      localStorage.setItem('zenday-trash-bin', JSON.stringify(trashBin.slice(-50)))
    } catch (error) {
      console.error('Error saving to trash:', error)
    }
    
    if (shouldNotify && whatsAppNumber) {
      const message = `Hola ${appointment.patientName}, tu cita del ${formatDate(appointment.startTime)} ha sido cancelada. Disculpa las molestias.`
      openWhatsApp(whatsAppNumber, message)
    }
    
    console.warn('[AUDIT] Appointment deleted:', {
      id: appointment.id,
      patient: appointment.patientName,
      wasPaid: appointment.paid,
      reason: reason || 'No especificado',
      user: localStorage.getItem('zenday-user-name') || 'Usuario',
      timestamp: new Date().toISOString()
    })
    
    deleteAppointment(appointment.id)
    toast.addToast('🗑️ Cita eliminada', 'info')
    nav.goBack()
  }

  const handleSaveNotes = () => {
    if (!appointment) return
    
    const noteEntry = {
      text: editedNotes,
      timestamp: new Date().toISOString(),
      author: localStorage.getItem('zenday-user-name') || 'Usuario'
    }
    
    const notesHistory = appointment.notesHistory || []
    const updatedHistory = [...notesHistory, noteEntry].slice(-50)
    
    updateAppointment(appointment.id, { 
      notes: editedNotes,
      notesHistory: updatedHistory,
      lastNoteUpdate: new Date().toISOString()
    })
    
    setIsEditing(false)
    toast.addToast('📝 Notas guardadas', 'success')
  }

  const handleCopyDetails = async () => {
    if (!appointment) return
    
    const text = `
Cliente: ${appointment.patientName}
Teléfono: ${appointment.patientPhone || 'No especificado'}
Email: ${appointment.patientEmail || 'No especificado'}
Fecha: ${formatDate(appointment.startTime)}
Servicio: ${appointment.productName || 'No especificado'}
Precio: ${price > 0 ? formatCurrency(price, 'UYU') : 'No especificado'}
Estado: ${STATUS_LABELS[appointment.status] || appointment.status}
    `.trim()
    
    try {
      await navigator.clipboard.writeText(text)
      toast.addToast('📋 Datos copiados al portapapeles', 'success')
    } catch (err) {
      console.error('Clipboard error:', err)
      toast.addToast('❌ No se pudo copiar al portapapeles', 'error')
    }
  }

  const handleShare = () => {
    if (!appointment) return
    
    const text = `📅 Cita: ${appointment.patientName} - ${formatDate(appointment.startTime)}`
    
    if (navigator.share) {
      navigator.share({
        title: 'Detalle de cita',
        text: text
      }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(text)
      toast.addToast('📤 Información copiada', 'success')
    }
  }

  const handlePrintLabel = () => {
    if (!appointment) return
    
    const labelData = {
      patientName: appointment.patientName,
      phone: appointment.patientPhone,
      direccion: appointment.address || appointment.location,
      productName: appointment.productName,
      externalRef: appointment.externalRef || appointment.id,
      orderId: appointment.id,
    }
    
    if (window.electronAPI?.printLabel) {
      window.electronAPI.printLabel(labelData).catch(err => {
        console.error('Print label failed:', err)
        toast.addToast('❌ Error al imprimir etiqueta', 'error')
      })
    } else {
      toast.addToast('⚠️ Impresión no disponible en este entorno', 'warning')
    }
  }

  if (!appointment) {
    return (
      <div className="appointment-detail-screen">
        <div className="top-bar">
          <BackButton onClick={() => nav.goBack()} />
          <h2 className="top-bar-title">Detalle</h2>
        </div>
        <div className="empty-state">
          <span className="empty-emoji">❌</span>
          <h3>Cita no encontrada</h3>
          <p>La cita que buscas no existe</p>
          <button className="btn-primary" onClick={() => nav.goBack()}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  // Obtener la fecha para mostrar en el input
  const displayDate = appointment.orderDate || appointment.startTime
  const orderDateObj = new Date(displayDate)
  const orderDateString = !isNaN(orderDateObj.getTime()) 
    ? orderDateObj.toISOString().split('T')[0] 
    : ''

  return (
    <div className="appointment-detail-screen">
      {/* Header */}
      <div className="top-bar">
        <BackButton onClick={() => nav.goBack()} />
        <h2 className="top-bar-title">Detalle de cita</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {appointment.requiresShipping && (
            <button 
              className="print-label-btn" 
              onClick={handlePrintLabel}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                border: '0.5px solid var(--border)',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              🏷️ Etiqueta
            </button>
          )}
          {canEdit && (
  <button 
    onClick={() => nav.navigate('new', { editingAppointment: appointment })}
    style={{
      padding: '8px 16px',
      background: 'var(--accent-blue)',
      border: 'none',
      borderRadius: '20px',
      color: 'white',
      cursor: 'pointer',
      fontSize: '13px'
    }}
  >
    ✏️ Editar
  </button>
)}

{appointment && (
  <button 
    onClick={handleDateEditStart}
    style={{
      padding: '8px 16px',
      background: 'transparent',
      border: '0.5px solid var(--border)',
      borderRadius: '20px',
      cursor: 'pointer',
      fontSize: '13px',
      color: 'var(--text-secondary)'
    }}
  >
    📅 Cambiar fecha
  </button>
)}
              ✏️ Editar
         
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions" style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        padding: '12px',
        background: 'var(--bg-secondary)',
        borderRadius: '16px'
      }}>
        <button 
          className="quick-action-btn"
          onClick={handleCopyDetails}
          style={{
            flex: 1,
            padding: '8px',
            background: 'transparent',
            border: '0.5px solid var(--border)',
            borderRadius: '20px',
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          📋 Copiar
        </button>
        
        <button 
          className="quick-action-btn"
          onClick={handleShare}
          style={{
            flex: 1,
            padding: '8px',
            background: 'transparent',
            border: '0.5px solid var(--border)',
            borderRadius: '20px',
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          📤 Compartir
        </button>
        
        {appointment.location && (
          <button 
            className="quick-action-btn"
            onClick={() => openMaps(appointment.location)}
            style={{
              flex: 1,
              padding: '8px',
              background: 'transparent',
              border: '0.5px solid var(--border)',
              borderRadius: '20px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            🗺️ Maps
          </button>
        )}
      </div>

      {/* Información del cliente */}
      <div className="detail-section">
        <h3>👤 CLIENTE</h3>
        <div className="detail-row">
          <span className="detail-label">Nombre</span>
          <span className="detail-value">{appointment.patientName || '—'}</span>
        </div>
        {appointment.patientPhone && (
          <div className="detail-row">
            <span className="detail-label">📞 Teléfono</span>
            <span className="detail-value">
              {appointment.patientPhone}
              {whatsAppNumber && (
                <button 
                  onClick={() => openWhatsApp(whatsAppNumber, `Hola ${appointment.patientName}, te escribo de ${appointment.productName || 'ZenDay'}`)}
                  style={{ 
                    marginLeft: '12px', 
                    color: '#25D366', 
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500 
                  }}
                >
                  💬 WhatsApp
                </button>
              )}
            </span>
          </div>
        )}
        {appointment.patientEmail && (
          <div className="detail-row">
            <span className="detail-label">✉️ Email</span>
            <span className="detail-value">
              <a href={`mailto:${appointment.patientEmail}`} style={{ color: 'var(--text-primary)' }}>
                {appointment.patientEmail}
              </a>
            </span>
          </div>
        )}
      </div>

      {/* Información de la cita */}
      <div className="detail-section">
        <h3>📋 INFORMACIÓN</h3>
        
        {/* CORREGIDO: Fecha editable */}
        <div className="detail-row">
          <span className="detail-label">📅 Fecha y hora</span>
          <span className="detail-value">
            {isEditingDate ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input 
                  type="date"
                  value={tempDate}
                  onChange={(e) => setTempDate(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    fontSize: '13px'
                  }}
                  autoFocus
                />
                <button 
                  onClick={handleDateEditSave}
                  style={{
                    padding: '6px 12px',
                    background: '#10b981',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  ✓ Guardar
                </button>
                <button 
                  onClick={handleDateEditCancel}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {formatDate(appointment.startTime)}
                {canEdit && (
                  <button 
                    onClick={handleDateEditStart}
                    style={{
                      padding: '2px 8px',
                      background: 'transparent',
                      border: '0.5px solid var(--border)',
                      borderRadius: '12px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      color: 'var(--text-tertiary)'
                    }}
                  >
                    ✏️ Cambiar fecha
                  </button>
                )}
              </div>
            )}
          </span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">⏱️ Duración</span>
          <span className="detail-value">{appointment.duration || 60} min</span>
        </div>
        
        {appointment.location && (
          <div className="detail-row">
            <span className="detail-label">📍 Ubicación</span>
            <span className="detail-value">
              {appointment.location}
              <button 
                onClick={() => openMaps(appointment.location)}
                style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '0.5px solid var(--border)',
                  borderRadius: '12px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                🗺️ Ver mapa
              </button>
            </span>
          </div>
        )}
        
        {appointment.meetingLink && (
          <div className="detail-row">
            <span className="detail-label">🔗 Link</span>
            <span className="detail-value">
              <a 
                href={appointment.meetingLink} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-blue)' }}
              >
                {appointment.meetingLink.length > 40 
                  ? appointment.meetingLink.substring(0, 40) + '...' 
                  : appointment.meetingLink}
              </a>
            </span>
          </div>
        )}
        
        {/* Fecha del pedido (si es un pedido) */}
        {appointment.orderDate && (
          <div className="detail-row">
            <span className="detail-label">📦 Fecha del pedido</span>
            <span className="detail-value">
              {new Date(appointment.orderDate).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              })}
            </span>
          </div>
        )}
      </div>

      {/* Servicio y Pago */}
      <div className="detail-section">
        <h3>💰 SERVICIO Y PAGO</h3>
        <div className="detail-row">
          <span className="detail-label">📦 Artículo/Servicio</span>
          <span className="detail-value">{appointment.productName || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">💲 Precio</span>
          <span className="detail-value">
            {price > 0 ? formatCurrency(price, 'UYU') : '—'}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">💰 Estado de pago</span>
          <span className="detail-value">
            {isPaid ? (
              <span style={{ color: '#10b981', fontWeight: 600 }}>✅ Pagado</span>
            ) : (
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>⏳ Pendiente</span>
            )}
          </span>
        </div>
        {!isPaid && price > 0 && (
          <div className="detail-row">
            <span className="detail-label">💳 Monto pendiente</span>
            <span className="detail-value" style={{ color: '#ef4444', fontWeight: 600 }}>
              {formatCurrency(remainingAmount, 'UYU')}
            </span>
          </div>
        )}
        {appointment.paymentDate && (
          <div className="detail-row">
            <span className="detail-label">📅 Fecha de pago</span>
            <span className="detail-value">
              {new Date(appointment.paymentDate).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Botón de pago */}
      {canMarkAsPaid && (
        <div className="detail-section" style={{ background: 'rgba(16, 185, 129, 0.05)' }}>
          <button 
            className="pay-btn"
            onClick={handleMarkAsPaid}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '14px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none',
              borderRadius: '40px',
              color: 'white',
              fontWeight: 600,
              fontSize: '16px',
              cursor: isProcessing ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              opacity: isProcessing ? 0.7 : 1
            }}
          >
            {isProcessing ? '⏳ Procesando...' : '💰 Marcar como pagado'}
          </button>
        </div>
      )}

      {/* Notas y resto del contenido igual que antes... */}
      {/* Notas */}
      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>📝 NOTAS</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {appointment.notesHistory?.length > 0 && (
              <button 
                onClick={() => setShowHistory(!showHistory)}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '0.5px solid var(--border)',
                  borderRadius: '20px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                📋 Historial
              </button>
            )}
            {!isEditing && canEdit && (
              <button 
                className="edit-notes-btn"
                onClick={() => {
                  setEditedNotes(appointment.notes || '')
                  setIsEditing(true)
                }}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '0.5px solid var(--border)',
                  borderRadius: '20px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                ✏️ Editar
              </button>
            )}
          </div>
        </div>
        
        {isEditing ? (
          <div>
            <textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                marginBottom: '12px'
              }}
              placeholder="Agregar notas..."
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setIsEditing(false)} 
                className="btn-secondary small"
                disabled={isProcessing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveNotes} 
                className="btn-primary small"
                disabled={isProcessing}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <div className="detail-notes">
            {appointment.notes ? (
              <p>{appointment.notes}</p>
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Sin notas</p>
            )}
          </div>
        )}
        
        {/* Historial de notas */}
        {showHistory && appointment.notesHistory?.length > 0 && (
          <div className="notes-history" style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--bg-tertiary)',
            borderRadius: '12px',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>📋 Historial de cambios</h4>
            {appointment.notesHistory.slice().reverse().map((note, i) => (
              <div key={i} style={{
                padding: '8px',
                borderBottom: i < appointment.notesHistory.length - 1 ? '0.5px solid var(--border)' : 'none',
                fontSize: '12px'
              }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {new Date(note.timestamp).toLocaleString()} - {note.author}
                </div>
                <div style={{ color: 'var(--text-primary)' }}>{note.text || '(vacío)'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cambiar estado */}
      <div className="detail-section">
        <h3>🔄 CAMBIAR ESTADO</h3>
        <div className="status-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            className="status-btn active"
            style={{
              backgroundColor: STATUS_COLORS[appointment.status],
              borderColor: STATUS_COLORS[appointment.status],
              color: 'white',
              cursor: 'default',
              padding: '8px 16px',
              borderRadius: '20px',
              border: 'none'
            }}
            disabled
          >
            {STATUS_LABELS[appointment.status] || appointment.status}
          </button>
          
          {getAvailableStatuses(appointment.status).map(status => (
            <button
              key={status.value}
              className="status-btn"
              style={{
                backgroundColor: 'transparent',
                border: `1px solid ${status.color}`,
                color: status.color,
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: isProcessing ? 'wait' : 'pointer',
                opacity: isProcessing ? 0.5 : 1
              }}
              onClick={() => handleStatusChange(status.value)}
              disabled={isProcessing}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {/* Acciones peligrosas */}
      {canDelete && (
        <div className="detail-section" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <button 
            className="danger-btn"
            onClick={handleDelete}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              border: '1px solid #ef4444',
              borderRadius: '40px',
              color: '#ef4444',
              fontWeight: 500,
              cursor: isProcessing ? 'wait' : 'pointer',
              opacity: isProcessing ? 0.5 : 1
            }}
          >
            {isProcessing ? '⏳ Procesando...' : '🗑️ Eliminar cita'}
          </button>
        </div>
      )}

      <div className="bottom-padding" />
    </div>
  )
}