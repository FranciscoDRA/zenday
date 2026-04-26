import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useReminders } from '../../contexts/ReminderContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime as formatDateTimeHelper } from '../../utils/helpers'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const ADVANCE_OPTIONS = [
  { value: 0,  label: 'En el momento' },
  { value: 1,  label: '1 hora antes'  },
  { value: 2,  label: '2 horas antes' },
  { value: 24, label: '1 día antes'   },
  { value: 48, label: '2 días antes'  },
]

const EMPTY_FORM = {
  title:           '',
  message:         '',
  type:            'meeting',
  sessionTime:     '',
  reminderAdvance: 0,
  priority:        'normal',
  repeat:          'none',
  sendWhatsApp:    false,
  clientPhone:     '',
  clientName:      '',
  clientId:        null,
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const PRIORITY_ICONS = { high: '🔴', normal: '🟡', low: '🟢' }
const TYPE_ICONS     = { payment: '💰', meeting: '📅', task: '📝' }

const getPriorityIcon = (p) => PRIORITY_ICONS[p] ?? '🟢'
const getTypeIcon     = (t) => TYPE_ICONS[t]     ?? '📝'
const getAdvanceText  = (advance) => ADVANCE_OPTIONS.find(o => o.value === advance)?.label ?? `${advance} horas antes`

function toLocalInputValue(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToISO(localValue) {
  if (!localValue || !localValue.includes('T')) return ''
  const [datePart, timePart] = localValue.split('T')
  if (!datePart) return ''
  const dateParts = datePart.split('-').map(Number)
  const timeParts = (timePart || '00:00').split(':').map(Number)
  if (dateParts.some(isNaN) || dateParts.length < 3) return ''
  const [year, month, day] = dateParts
  const [hours = 0, minutes = 0] = timeParts
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

function normalizeUruguayPhone(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('598')) return digits
  if (digits.startsWith('0'))   return '598' + digits.slice(1)
  if (digits.startsWith('9'))   return '598' + digits
  return digits
}

const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied')  return false
  return (await Notification.requestPermission()) === 'granted'
}

const fireNotification = (reminder, onNotificationClick) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const notif = new Notification(`🔔 ${reminder.title}`, {
      body:               reminder.message || (reminder.clientName ? `Cliente: ${reminder.clientName}` : 'Tenés un recordatorio'),
      tag:                `reminder-${reminder.id}`,
      requireInteraction: reminder.priority === 'high',
      silent:             false,
    })
    notif.onclick = () => {
      window.focus?.()
      window.electronAPI?.focusWindow?.()
      onNotificationClick?.()
      notif.close()
    }
  } catch (err) {
    console.error('[ReminderPanel] Failed to show notification:', err)
  }
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function ReminderPanel({ nav, patients = [] }) {
  const toast = useToast()

  const [isOpen,       setIsOpen]       = useState(false)
  const [showForm,     setShowForm]     = useState(false)
  const [searchTerm,   setSearchTerm]   = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [formData,     setFormData]     = useState(EMPTY_FORM)

  const notifiedIds = useRef(new Set())
  const remindersRef = useRef([])

  const { reminders, pendingReminders, addReminder, markAsCompleted, deleteReminder } = useReminders()

  // Sincronizar ref con reminders actuales
  useEffect(() => {
    remindersRef.current = reminders
  }, [reminders])

  const pendingCount = pendingReminders.length

  useEffect(() => { requestNotificationPermission() }, [])

  // Escape para cerrar
  useEffect(() => {
    if (!isOpen && !showForm) return
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (showForm) { closeForm(); return }
      setIsOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, showForm])

  // Motor de notificaciones
  const checkReminders = useCallback(() => {
    const now    = Date.now()
    const WINDOW = 30_000
    remindersRef.current.forEach(reminder => {
      if (reminder.completed) return
      if (notifiedIds.current.has(reminder.id)) return
      const reminderTime = new Date(reminder.reminderTime).getTime()
      const diff         = reminderTime - now
      if (diff <= WINDOW && diff > -60_000) {
        notifiedIds.current.add(reminder.id)
        fireNotification(reminder, () => setIsOpen(true))
      }
    })
  }, [])

  useEffect(() => {
    checkReminders()
    const interval = setInterval(checkReminders, 30_000)
    return () => clearInterval(interval)
  }, [checkReminders])

  // Pacientes filtrados
  const filteredPatients = useMemo(() => {
    if (searchTerm.length < 2) return []
    const q = searchTerm.toLowerCase()
    return patients.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 5)
  }, [searchTerm, patients])

  // Recordatorios filtrados
  const displayedReminders = useMemo(() => {
    const now    = Date.now()
    const future = now + 7 * 86_400_000
    return reminders
      .filter(r => {
        if (r.completed || !r.reminderTime) return false
        const t = new Date(r.reminderTime).getTime()
        if (activeFilter === 'pending')  return t <= now
        if (activeFilter === 'upcoming') return t > now && t <= future
        return true
      })
      .sort((a, b) => new Date(a.reminderTime) - new Date(b.reminderTime))
  }, [reminders, activeFilter])

  const selectClient = useCallback((client) => {
    setFormData(prev => ({ ...prev, clientName: client.name, clientPhone: client.phone || '', clientId: client.id }))
    setSearchTerm('')
  }, [])

  const closeForm = useCallback(() => {
    setShowForm(false)
    setFormData(EMPTY_FORM)
    setSearchTerm('')
  }, [])

  const calculateReminderTime = useCallback(() => {
    if (!formData.sessionTime) return ''
    const sessionMs = new Date(formData.sessionTime).getTime()
    if (isNaN(sessionMs)) return ''
    const reminderMs = sessionMs - (formData.reminderAdvance * 60 * 60 * 1000)
    return new Date(reminderMs).toISOString()
  }, [formData.sessionTime, formData.reminderAdvance])

  const sendWhatsAppReminder = useCallback((reminder) => {
    if (!reminder.clientPhone) { toast.addToast('❌ El cliente no tiene número de teléfono', 'error'); return }
    const phone   = normalizeUruguayPhone(reminder.clientPhone)
    const message = encodeURIComponent(reminder.whatsappMessage || reminder.message || '')
    const url = `https://wa.me/${phone}?text=${message}`
    
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    toast.addToast(`📱 Abriendo WhatsApp para ${reminder.clientName}`, 'info')
  }, [toast])

  const handleAddReminder = useCallback(() => {
    if (!formData.title.trim()) { toast.addToast('❌ El título es obligatorio', 'error'); return }
    if (!formData.sessionTime)  { toast.addToast('❌ Seleccioná la fecha y hora de la sesión', 'error'); return }
    if (formData.sendWhatsApp && !formData.clientPhone) { toast.addToast('❌ Para WhatsApp necesitás el número del cliente', 'error'); return }

    const reminderTime  = calculateReminderTime()
    const advanceText   = getAdvanceText(formData.reminderAdvance).toLowerCase()
    const sessionDate   = new Date(formData.sessionTime)
    const formattedDate = sessionDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const formattedTime = sessionDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

    const whatsappMessage =
      `📅 *RECORDATORIO DE CITA* 📅\n\n` +
      `Hola *${formData.clientName || 'cliente'}*,\n\n` +
      `Te confirmo tu cita para:\n\n` +
      `📆 *Fecha:* ${formattedDate}\n` +
      `⏰ *Hora:* ${formattedTime}\n\n` +
      (formData.message ? `📝 *Detalles:* ${formData.message}\n\n` : '') +
      `---\n🔔 Te enviaré este recordatorio ${advanceText} de la cita.\n\n` +
      `*ZenDay* - Tu gestión inteligente`

    const finalMessage = formData.message
      ? `${formData.message}\n\n⏰ Te avisaré ${advanceText} de la sesión.`
      : `⏰ Te avisaré ${advanceText} de la sesión.`

    addReminder({ ...formData, reminderTime, message: finalMessage, whatsappMessage })
    toast.addToast(`✅ Recordatorio creado${formData.sendWhatsApp ? ' con envío de WhatsApp' : ''}`, 'success')
    closeForm()
  }, [formData, calculateReminderTime, addReminder, toast, closeForm])

  // ✅ CORREGIDO: al completar, generar el siguiente si es recurrente
  const processRecurringReminder = useCallback((reminder) => {
    if (reminder.repeat === 'none') return null
    if (reminder.completed) return null
    
    const currentTime = new Date(reminder.reminderTime)
    let nextTime = null
    
    switch (reminder.repeat) {
      case 'daily':
        nextTime = new Date(currentTime.setDate(currentTime.getDate() + 1))
        break
      case 'weekly':
        nextTime = new Date(currentTime.setDate(currentTime.getDate() + 7))
        break
      case 'monthly':
        nextTime = new Date(currentTime.setMonth(currentTime.getMonth() + 1))
        break
      default:
        return null
    }
    
    if (nextTime && !isNaN(nextTime.getTime())) {
      return {
        ...reminder,
        id: undefined,  // el contexto generará un nuevo ID
        reminderTime: nextTime.toISOString(),
        completed: false,
        createdAt: new Date().toISOString(),
      }
    }
    return null
  }, [])

  const handleDelete = useCallback((id) => {
    notifiedIds.current.delete(id)
    deleteReminder(id)
    toast.addToast('🗑️ Recordatorio eliminado', 'info')
  }, [deleteReminder, toast])

  // ✅ CORREGIDO: al completar, generar el siguiente si es recurrente
  const handleComplete = useCallback((id) => {
    notifiedIds.current.delete(id)
    
    // Buscar el recordatorio actual en el ref (siempre actualizado)
    const reminder = remindersRef.current.find(r => r.id === id)
    if (reminder && reminder.repeat !== 'none') {
      const nextReminder = processRecurringReminder(reminder)
      if (nextReminder) {
        addReminder(nextReminder)
      }
    }
    
    markAsCompleted(id)
    toast.addToast('✅ Recordatorio completado', 'success')
  }, [markAsCompleted, toast, processRecurringReminder, addReminder])

  // ─── PANEL PRINCIPAL ──────────────────────────────────────────────────────
  const mainPanel = isOpen ? (
    <div className="reminder-modal-apple" onClick={() => setIsOpen(false)}>
      <div className="reminder-sheet" onClick={e => e.stopPropagation()}>

        <div className="sheet-header">
          <div className="sheet-header-left">
            <button className="sheet-close" onClick={() => setIsOpen(false)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2>Recordatorios</h2>
          </div>
          <button className="new-reminder-btn" onClick={() => { setIsOpen(false); setShowForm(true) }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nuevo
          </button>
        </div>

        <div className="sheet-filters">
          {[
            { key: 'all',      label: 'Todos' },
            { key: 'pending',  label: 'Pendientes', count: pendingCount },
            { key: 'upcoming', label: 'Próximos' },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              className={`filter-chip ${activeFilter === key ? 'active' : ''}`}
              onClick={() => setActiveFilter(key)}
            >
              {label}
              {count > 0 && <span className="chip-badge">{count}</span>}
            </button>
          ))}
        </div>

        <div className="reminder-list">
          {displayedReminders.length === 0 ? (
            <div className="empty-reminder">
              <div className="empty-icon">🔔</div>
              <h4>Sin recordatorios</h4>
              <p>Todos tus recordatorios están al día</p>
              <button type="button" className="btn-primary" onClick={() => { setIsOpen(false); setShowForm(true) }}>
                + Crear recordatorio
              </button>
            </div>
          ) : (
            displayedReminders.map(reminder => (
              <div key={reminder.id} className={`reminder-card ${!reminder.completed ? 'active' : ''}`}>
                <div className="card-icon">{getTypeIcon(reminder.type)}</div>
                <div className="card-content">
                  <div className="card-header">
                    <span className="card-title">{reminder.title}</span>
                    <span className={`priority-badge ${reminder.priority}`}>
                      {getPriorityIcon(reminder.priority)} {reminder.priority}
                    </span>
                  </div>
                  {reminder.message && <p className="card-message">{reminder.message}</p>}
                  <div className="card-meta">
                    <span className="meta-time">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                      {formatDateTimeHelper(reminder.reminderTime)}
                    </span>
                    {reminder.sendWhatsApp && reminder.clientName && (
                      <span className="meta-whatsapp">📱 {reminder.clientName}</span>
                    )}
                    {reminder.repeat !== 'none' && (
                      <span className="meta-repeat">🔄 {reminder.repeat}</span>
                    )}
                  </div>
                </div>
                <div className="card-actions">
                  {!reminder.completed && reminder.sendWhatsApp && !reminder.whatsAppSent && (
                    <button type="button" className="action-whatsapp" onClick={() => sendWhatsAppReminder(reminder)} title="Enviar WhatsApp">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                      </svg>
                    </button>
                  )}
                  {!reminder.completed && (
                    <button type="button" className="action-complete" onClick={() => handleComplete(reminder.id)} title="Marcar completado">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  )}
                  <button type="button" className="action-delete" onClick={() => handleDelete(reminder.id)} title="Eliminar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  ) : null

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  const formPanel = showForm ? (
    <div className="reminder-modal-apple" onClick={closeForm}>
      <div className="reminder-sheet form-sheet" onClick={e => e.stopPropagation()}>

        <div className="sheet-header">
          <div className="sheet-header-left">
            <button className="sheet-close" onClick={closeForm}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2>Nuevo recordatorio</h2>
          </div>
        </div>

        <div className="form-container">
          <div className="form-group">
            <label>Título *</label>
            <input
              type="text"
              placeholder="Ej: Reunión con cliente"
              value={formData.title}
              onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Mensaje</label>
            <textarea
              placeholder="Detalles adicionales..."
              value={formData.message}
              onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Tipo</label>
              <select value={formData.type} onChange={e => setFormData(prev => ({ ...prev, type: e.target.value }))}>
                <option value="meeting">📅 Reunión</option>
                <option value="payment">💰 Pago</option>
                <option value="task">📝 Tarea</option>
              </select>
            </div>
            <div className="form-group">
              <label>Prioridad</label>
              <select value={formData.priority} onChange={e => setFormData(prev => ({ ...prev, priority: e.target.value }))}>
                <option value="low">🟢 Baja</option>
                <option value="normal">🟡 Normal</option>
                <option value="high">🔴 Alta</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>📅 Fecha y hora de la sesión *</label>
            <input
              type="datetime-local"
              className="datetime-input-native"
              value={toLocalInputValue(formData.sessionTime)}
              onChange={e => setFormData(prev => ({ ...prev, sessionTime: localInputToISO(e.target.value) }))}
            />
            <small>Cuándo será la reunión o evento</small>
          </div>

          <div className="form-group">
            <label>⏰ ¿Cuándo querés que te avise?</label>
            <div className="reminder-advance-buttons">
              {ADVANCE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`advance-option ${formData.reminderAdvance === opt.value ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, reminderAdvance: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {formData.sessionTime && (
            <div className="reminder-summary">
              <div className="summary-icon">🔔</div>
              <div className="summary-text">
                Te avisaré <strong>{getAdvanceText(formData.reminderAdvance).toLowerCase()}</strong><br />
                de la sesión del {new Date(formData.sessionTime).toLocaleString('es-ES')}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Repetir</label>
            <select value={formData.repeat} onChange={e => setFormData(prev => ({ ...prev, repeat: e.target.value }))}>
              <option value="none">No repetir</option>
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
          </div>

          <div className="whatsapp-section">
            <label className="whatsapp-toggle">
              <input
                type="checkbox"
                checked={formData.sendWhatsApp}
                onChange={e => setFormData(prev => ({ ...prev, sendWhatsApp: e.target.checked }))}
              />
              <span className="toggle-slider" />
              <span className="toggle-label">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                Enviar por WhatsApp
              </span>
            </label>
          </div>

          {formData.sendWhatsApp && (
            <div className="client-section">
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Buscar cliente</label>
                <input
                  type="text"
                  placeholder="Escribe el nombre..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                {filteredPatients.length > 0 && (
                  <div className="client-results">
                    {filteredPatients.map(client => (
                      <div key={client.id} className="client-result" onClick={() => selectClient(client)}>
                        <span>{client.name}</span>
                        <span className="client-phone">{client.phone || 'Sin teléfono'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Nombre del cliente</label>
                <input
                  type="text"
                  placeholder="Ej: Juan Pérez"
                  value={formData.clientName}
                  onChange={e => setFormData(prev => ({ ...prev, clientName: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Número de WhatsApp</label>
                <input
                  type="tel"
                  placeholder="099 123 456"
                  value={formData.clientPhone}
                  onChange={e => setFormData(prev => ({ ...prev, clientPhone: e.target.value }))}
                />
                <small>Se abrirá WhatsApp automáticamente</small>
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={closeForm}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={handleAddReminder}>Crear recordatorio</button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        className="reminder-button-apple"
        onClick={() => setIsOpen(true)}
        aria-label={`Recordatorios${pendingCount > 0 ? `, ${pendingCount} pendientes` : ''}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2" />
          <path d="M5 3L2 6M22 6l-3-3" />
        </svg>
        {pendingCount > 0 && (
          <span className="reminder-badge-apple">{pendingCount}</span>
        )}
      </button>

      {createPortal(mainPanel, document.body)}
      {createPortal(formPanel, document.body)}
    </>
  )
}