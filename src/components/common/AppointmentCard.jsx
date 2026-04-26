import React, { useState, useCallback, useRef, useEffect } from 'react'
import { formatTime, formatDateTime, formatCurrency } from '../../utils/helpers'
import { RECURRENCE_TYPES, STATUSES, ORDER_STATUSES } from '../../utils/constants'
import { StatusBadge } from './StatusBadge'
import { PaymentBadge } from './PaymentBadge'

// Constantes fuera del componente para evitar hardcodeo
const VALID_NAVIGATION_ROUTES = ['detail', 'reschedule', 'edit']

// Estados en los que se puede registrar un pago
const PAYABLE_STATUSES = new Set(['completed', 'delivered', 'picked'])

// Función auxiliar para formateo seguro de fechas
const safeFormatTime = (date) => {
  if (!date) return '—'
  const d = new Date(date)
  return isNaN(d.getTime()) ? '—' : formatTime(d)
}

const safeFormatDateTime = (date) => {
  if (!date) return '—'
  const d = new Date(date)
  return isNaN(d.getTime()) ? '—' : formatDateTime(d)
}

// Función mejorada para validar y normalizar teléfono para WhatsApp
const normalizePhoneForWhatsApp = (phone) => {
  if (!phone) return null
  let cleaned = String(phone).replace(/[\s\-\(\)]/g, '')
  
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1)
  
  if (cleaned.startsWith('598') && cleaned.length === 11) return cleaned
  if (cleaned.length === 8 || cleaned.length === 9) return '598' + cleaned
  if (cleaned.length >= 10) return cleaned
  
  return null
}

export function AppointmentCard({
  appointment,
  nav,
  onStatusChange,
  onMarkAsPaid,
  onWhatsAppClick,
  compact = false,
  userMode,
  onError,
}) {
  // ============================================
  // TODOS LOS HOOKS ANTES DE CUALQUIER RETURN
  // ============================================
  
  const [pendingStatus, setPendingStatus] = useState(null)
  const previousStatusRef = useRef(null)
  const timeoutRef = useRef(null)
  const selectRef = useRef(null)
  const isMountedRef = useRef(true)

  // Limpiar timeouts al desmontar
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // RESET de pendingStatus si el appointment cambia desde fuera (polling, sync)
  useEffect(() => {
    if (pendingStatus && appointment.status !== pendingStatus) {
      // El estado ya cambió externamente, limpiar UI de undo
      setPendingStatus(null)
      previousStatusRef.current = null
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [appointment.status, pendingStatus])

  // Determinar modos y statuses
  const isOrderMode = userMode === 'merchant' || userMode === 'entrepreneur'
  const isProfessionalMode = userMode === 'professional'
  const isPersonalMode = userMode === 'personal'
  const isEntrepreneurMode = userMode === 'entrepreneur'
  
  const statuses = isOrderMode ? ORDER_STATUSES : STATUSES
  const statusType = isOrderMode ? 'order' : 'appointment'

  const getStatusLabel = useCallback((statusKey) => {
    return statuses[statusKey]?.label || statusKey
  }, [statuses])

  // --- Manejo de cambio de estado ---
  const handleStatusChange = useCallback(async (newStatus, event) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    
    const previousStatus = appointment.status
    const isCritical = newStatus === 'delivered' || newStatus === 'completed'
    const statusLabel = getStatusLabel(newStatus)
    
    if (isCritical) {
      const confirmMessage = `¿Cambiar estado a "${statusLabel}"? Esto modificará el stock y no podrá deshacerse fácilmente.`
      if (!window.confirm(confirmMessage)) {
        if (selectRef.current) {
          selectRef.current.value = previousStatus
        }
        return
      }
    }

    previousStatusRef.current = previousStatus
    
    if (isCritical) {
      setPendingStatus(newStatus)
      
      try {
        await onStatusChange?.(newStatus)
        
        timeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setPendingStatus(null)
            previousStatusRef.current = null
          }
          timeoutRef.current = null
        }, 5000)
      } catch (error) {
        console.error('Status change failed:', error)
        onError?.(error.message || 'Error al cambiar estado')
        
        if (isMountedRef.current) {
          setPendingStatus(null)
          previousStatusRef.current = null
        }
        
        if (selectRef.current) {
          selectRef.current.value = previousStatus
        }
      }
    } else {
      try {
        await onStatusChange?.(newStatus)
      } catch (error) {
        console.error('Status change failed:', error)
        onError?.(error.message || 'Error al cambiar estado')
        
        if (selectRef.current) {
          selectRef.current.value = previousStatus
        }
      }
    }
  }, [appointment.status, onStatusChange, getStatusLabel, onError])

  // --- Undo de cambio crítico ---
  const undoStatusChange = useCallback(async () => {
    if (!isMountedRef.current) return
    
    if (pendingStatus && timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      
      const prevStatus = previousStatusRef.current
      if (prevStatus) {
        try {
          await onStatusChange?.(prevStatus)
        } catch (error) {
          console.error('Undo failed:', error)
          onError?.(error.message || 'Error al deshacer cambio')
        }
      }
      
      if (isMountedRef.current) {
        setPendingStatus(null)
        previousStatusRef.current = null
      }
    }
  }, [pendingStatus, onStatusChange, onError])

  // --- Navegación segura ---
  const handleNavigate = useCallback((e, view) => {
    e?.stopPropagation()
    
    if (!appointment?.id) {
      console.error('Cannot navigate: appointment.id is missing')
      onError?.('No se puede navegar: ID de cita/pedido no válido')
      return
    }
    
    if (!VALID_NAVIGATION_ROUTES.includes(view)) {
      console.error(`Invalid navigation route: ${view}`)
      onError?.(`Ruta de navegación no válida: ${view}`)
      return
    }
    
    if (nav?.navigate) {
      nav.navigate(view, { appointmentId: appointment.id })
    } else {
      console.warn('Nav not available for navigation to', view)
      onError?.('Navegación no disponible')
    }
  }, [nav, appointment?.id, onError])

  // --- WhatsApp con fallback ---
  const handleWhatsAppClick = useCallback((phone) => {
    const normalizedPhone = normalizePhoneForWhatsApp(phone)
    if (!normalizedPhone) {
      onError?.('Número de teléfono no válido')
      return
    }
    
    if (onWhatsAppClick) {
      onWhatsAppClick(normalizedPhone)
    } else {
      const url = `https://wa.me/${normalizedPhone}`
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url)
      } else {
        window.open(url, '_blank')
      }
    }
  }, [onWhatsAppClick, onError])

  // --- Impresión de etiqueta ---
  const handlePrintLabel = useCallback((e) => {
    e?.stopPropagation()
    
    if (!appointment?.id) {
      onError?.('No se puede imprimir: ID de pedido no válido')
      return
    }
    
    const labelData = {
      patientName: appointment.patientName,
      phone: appointment.phone,
      direccion: appointment.direccion || appointment.address,
      productName: appointment.productName,
      externalRef: appointment.externalRef || appointment.id,
      orderId: appointment.id,
    }
    
    if (window.electronAPI?.printLabel) {
      window.electronAPI.printLabel(labelData).catch(err => {
        console.error('Print label failed:', err)
        onError?.('Error al imprimir etiqueta')
      })
    } else {
      console.warn('Electron printLabel API not available')
      onError?.('Impresión no disponible en este entorno')
    }
  }, [appointment, onError])

  // ============================================
  // GUARDS CONDICIONALES
  // ============================================
  
  if (!appointment) return null
  if (!appointment.id) {
    console.error('AppointmentCard: appointment.id is missing', appointment)
    return null
  }

  // Datos formateados
  const startTimeStr = safeFormatTime(appointment.startTime)
  const endTimeStr = appointment.endTime ? ` - ${safeFormatTime(appointment.endTime)}` : ''
  const fullDateTimeStr = safeFormatDateTime(appointment.startTime)

  // Recurrencia
  const isRecurring = appointment.recurrenceType && appointment.recurrenceType !== 'none'
  const recurrenceInfo = isRecurring ? RECURRENCE_TYPES?.[appointment.recurrenceType] : null
  const recurrenceLabel = isRecurring && appointment.recurrenceInstance > 0
    ? `${recurrenceInfo?.label ?? ''} #${appointment.recurrenceInstance}`
    : recurrenceInfo?.label ?? ''

  // Botón de pago
  const canMarkAsPaid = !appointment.paid && 
    (PAYABLE_STATUSES.has(appointment.status) || appointment.fromMercadoPago) &&
    !(isOrderMode && appointment.stockIssue === true)

  // Precio
  const numericPrice = Number(appointment.price)
  const showPrice = !isNaN(numericPrice) && numericPrice > 0
  const currency = appointment.currency || 'UYU'

  // CORREGIDO: WhatsApp solo para pedidos (fromMercadoPago o modo order)
  const showWhatsAppButton = appointment.phone && 
    (appointment.fromMercadoPago || isOrderMode)
  
  // CORREGIDO: Tiempo relativo - solo para citas futuras
  const getRelativeTime = () => {
    if (!appointment.startTime) return null
    const diffMinutes = Math.floor((new Date(appointment.startTime) - new Date()) / 60000)
    if (diffMinutes < 0) return null  // No mostrar para citas pasadas
    if (diffMinutes === 0) return 'Ahora mismo'
    if (diffMinutes < 60) return `En ${diffMinutes} min`
    const hours = Math.floor(diffMinutes / 60)
    if (hours < 24) return `En ${hours}h`
    return null  // Más de un día → solo mostrar la fecha normal
  }
  
  const relativeTime = isPersonalMode ? getRelativeTime() : null

  // ============================================
  // RENDER - MODO COMPACTO
  // ============================================
  if (compact) {
    return (
      <div className={`appointment-card compact status-${appointment.status}`}>
        <div className="appointment-time">
          {startTimeStr}
          {relativeTime && <span className="relative-time">{relativeTime}</span>}
        </div>

        <div
          className="appointment-info"
          onClick={(e) => handleNavigate(e, 'detail')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleNavigate(e, 'detail')}
        >
          <strong>{appointment.patientName}</strong>
          <span className="service">{appointment.productName || 'Pedido'}</span>
          {isRecurring && (
            <span className="recurring-badge" title={`Recurrente: ${recurrenceLabel}`}>
              {recurrenceInfo?.icon}
            </span>
          )}
          {showWhatsAppButton && (
            <button 
              className="whatsapp-mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleWhatsAppClick(appointment.phone)
              }}
              title="Contactar por WhatsApp"
            >
              📱
            </button>
          )}
        </div>

        <div className="appointment-right">
          <StatusBadge status={appointment.status} type={statusType} />
          {appointment.paid ? (
            <span className="payment-icon paid" title="Pagado">💰</span>
          ) : (
            <span className="payment-icon pending" title="Pendiente de pago">⏳</span>
          )}
        </div>

        <div className="appointment-actions">
          {canMarkAsPaid && (
            <button
              className="pay-btn"
              onClick={e => { e.stopPropagation(); onMarkAsPaid?.() }}
            >
              💰 Cobrar
            </button>
          )}
          <select
            ref={selectRef}
            value={appointment.status}
            onChange={(e) => {
              e.stopPropagation()
              handleStatusChange(e.target.value, e).catch(err => {
                console.error('Status change error:', err)
                onError?.(err.message || 'Error al cambiar estado')
              })
            }}
            onClick={e => e.stopPropagation()}
          >
            {Object.entries(statuses).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>
          {pendingStatus && (
            <button 
              className="undo-btn"
              onClick={(e) => {
                e.stopPropagation()
                undoStatusChange()
              }}
            >
              ↩️ Deshacer
            </button>
          )}
        </div>
      </div>
    )
  }

  // ============================================
  // RENDER - MODO COMPLETO
  // ============================================
  return (
    <div className={`appointment-card status-${appointment.status}`}>
      <div className="appointment-header">
        <div className="appointment-time">
          {fullDateTimeStr}{endTimeStr}
          {relativeTime && <span className="relative-time">({relativeTime})</span>}
          {isRecurring && (
            <span className="recurring-badge">
              {recurrenceInfo?.icon} {recurrenceLabel}
            </span>
          )}
        </div>
        <div className="header-right">
          <StatusBadge status={appointment.status} type={statusType} />
          <PaymentBadge
            paid={appointment.paid}
            onMarkAsPaid={canMarkAsPaid ? onMarkAsPaid : undefined}
          />
        </div>
      </div>

      <div
        className="appointment-body"
        onClick={(e) => handleNavigate(e, 'detail')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleNavigate(e, 'detail')}
      >
        <div className="patient-info">
          <h4>{appointment.patientName}</h4>
          {showWhatsAppButton && (
           <div className="patient-phone">
  📞 {appointment.phone}
       {showWhatsAppButton && (
    <button className="whatsapp-btn"
      onClick={(e) => { e.stopPropagation(); handleWhatsAppClick(appointment.phone) }}>
      💬 WhatsApp
     </button>
        )}
        </div>
          )}
        </div>
        
        <div className="appointment-details">
          <span className="service-icon">📦</span>
          <span>{appointment.productName || 'Pedido'}</span>
          {showPrice && (
            <span className="price">{formatCurrency(numericPrice, currency)}</span>
          )}
        </div>
        
        {appointment.notes && (
          <p className="appointment-notes">{appointment.notes}</p>
        )}
        
        {appointment.projectId && (
          <div className="appointment-project">
            📌 {appointment.projectName || 'Proyecto'}
          </div>
        )}
        
        {isPersonalMode && appointment.address && (
          <div className="appointment-address">
            📍 {appointment.address}
          </div>
        )}
        
        {isProfessionalMode && appointment.visitCount > 0 && (
          <div className="visit-history-badge" title="Visitas previas">
            🏥 {appointment.visitCount} visita{appointment.visitCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="appointment-footer">
        <button onClick={(e) => handleNavigate(e, 'detail')}>
          Ver detalles
        </button>
        
        {isProfessionalMode && (
          <button onClick={(e) => handleNavigate(e, 'reschedule')}>
            📅 Reagendar
          </button>
        )}
        
        {isEntrepreneurMode && appointment.requiresShipping && (
          <button onClick={handlePrintLabel}>
            🏷️ Imprimir etiqueta
          </button>
        )}
        
        <select
          ref={selectRef}
          value={appointment.status}
          onChange={(e) => {
            e.stopPropagation()
            handleStatusChange(e.target.value, e).catch(err => {
              console.error('Status change error:', err)
              onError?.(err.message || 'Error al cambiar estado')
            })
          }}
        >
          {Object.entries(statuses).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        
        {pendingStatus && (
          <button onClick={undoStatusChange}>
            ↩️ Deshacer
          </button>
        )}
      </div>
    </div>
  )
}