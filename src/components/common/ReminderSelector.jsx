// src/components/common/ReminderPanel.jsx

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useReminders } from '../../contexts/ReminderContext'
import { formatDateTime } from '../../utils/helpers'

// ─── Solicitar permiso de notificaciones al cargar ───────────────────────────
const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

// ─── Disparar notificación nativa (Electron o browser) ──────────────────────
const fireNotification = (reminder, onNotificationClick) => {
  const canNotify = 'Notification' in window && Notification.permission === 'granted'
  if (!canNotify) return

  const title = `🔔 ${reminder.title}`
  const body = reminder.message || 
    (reminder.clientName ? `Cliente: ${reminder.clientName}` : 'Tienes un recordatorio pendiente')

  const notif = new Notification(title, {
    body,
    icon: '/icon.png',       // ajustá a tu ícono real
    badge: '/badge.png',
    tag: `reminder-${reminder.id}`,  // evita duplicados si el SO lo soporta
    requireInteraction: reminder.priority === 'high', // alta prioridad no desaparece sola
    silent: false
  })

  notif.onclick = () => {
    window.focus?.()
    // Si usás Electron podés enfocar la ventana
    if (window.electronAPI?.focusWindow) {
      window.electronAPI.focusWindow()
    }
    onNotificationClick?.()
    notif.close()
  }
}

export function ReminderPanel({ nav, patients = [] }) {
  const [isOpen, setIsOpen]           = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [searchTerm, setSearchTerm]   = useState('')
  const [filteredPatients, setFilteredPatients] = useState([])
  const [activeFilter, setActiveFilter] = useState('all')
  
  // Rastrea qué IDs ya notificamos para no repetir
  const notifiedIds = useRef(new Set())

  const { 
    reminders, 
    pendingReminders, 
    addReminder, 
    markAsCompleted, 
    deleteReminder, 
    getUpcomingReminders,
    sendWhatsAppReminder
  } = useReminders()
  
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    type: 'meeting',
    reminderTime: '',
    priority: 'normal',
    repeat: 'none',
    sendWhatsApp: false,
    clientPhone: '',
    clientName: '',
    clientId: null
  })

  const upcomingReminders = getUpcomingReminders(7)
  const pendingCount = pendingReminders.length

  // ─── PEDIR PERMISO AL MONTAR ────────────────────────────────────────────────
  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // ─── MOTOR DE NOTIFICACIONES: revisa cada 30s ────────────────────────────────
  const checkReminders = useCallback(() => {
    const now = Date.now()
    const WINDOW_MS = 30_000 // dispara si el recordatorio está dentro de los próximos 30s

    reminders.forEach(reminder => {
      if (reminder.completed) return
      if (notifiedIds.current.has(reminder.id)) return

      const reminderTime = new Date(reminder.reminderTime).getTime()
      const diff = reminderTime - now

      // Dispara si ya pasó o está a punto de pasar (ventana de 30s)
      if (diff <= WINDOW_MS && diff > -60_000) {
        notifiedIds.current.add(reminder.id)
        fireNotification(reminder, () => setIsOpen(true))
      }
    })
  }, [reminders])

  useEffect(() => {
    checkReminders() // revisión inmediata al cambiar recordatorios
    const interval = setInterval(checkReminders, 30_000)
    return () => clearInterval(interval)
  }, [checkReminders])

  // ─── BÚSQUEDA DE PACIENTES ───────────────────────────────────────────────────
  useEffect(() => {
    if (searchTerm.length > 1) {
      setFilteredPatients(
        patients
          .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
          .slice(0, 5)
      )
    } else {
      setFilteredPatients([])
    }
  }, [searchTerm, patients])

  const selectClient = (client) => {
    setFormData(prev => ({
      ...prev,
      clientName: client.name,
      clientPhone: client.phone || '',
      clientId: client.id
    }))
    setSearchTerm('')
    setFilteredPatients([])
  }

  // ─── FECHA LOCAL ↔ ISO ───────────────────────────────────────────────────────
  const handleDateTimeChange = (e) => {
    const val = e.target.value
    setFormData(prev => ({
      ...prev,
      reminderTime: val ? new Date(val).toISOString() : ''
    }))
  }

  const getLocalDateTime = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    if (isNaN(d)) return ''
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-') + 'T' + [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0')
    ].join(':')
  }

  // ─── CREAR RECORDATORIO ──────────────────────────────────────────────────────
  const handleAddReminder = () => {
    if (!formData.title.trim()) {
      alert('El título es obligatorio')
      return
    }
    if (!formData.reminderTime) {
      alert('Seleccioná una fecha y hora')
      return
    }
    if (formData.sendWhatsApp && !formData.clientPhone) {
      alert('Para enviar WhatsApp necesitás el número del cliente')
      return
    }

    addReminder({ ...formData, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    setShowForm(false)
    setFormData({
      title: '', message: '', type: 'meeting', reminderTime: '',
      priority: 'normal', repeat: 'none', sendWhatsApp: false,
      clientPhone: '', clientName: '', clientId: null
    })
  }

  // ─── DELETE CON LIMPIEZA DEL SET ─────────────────────────────────────────────
  const handleDelete = (id) => {
    notifiedIds.current.delete(id) // permite re-notificar si se recrea
    deleteReminder(id)
  }

  // ─── LISTA DEDUPLICADA ── AQUÍ ESTABA EL BUG PRINCIPAL ───────────────────────
  const getFilteredReminders = () => {
    if (activeFilter === 'pending')  return pendingReminders
    if (activeFilter === 'upcoming') return upcomingReminders

    // 'all': unión sin duplicados, ordenados por tiempo
    const seen = new Set()
    return [...pendingReminders, ...upcomingReminders]
      .filter(r => {
        if (seen.has(r.id)) return false
        seen.add(r.id)
        return true
      })
      .sort((a, b) => new Date(a.reminderTime) - new Date(b.reminderTime))
      .slice(0, 20)
  }

  const displayedReminders = getFilteredReminders()

  // ─── HELPERS VISUALES ────────────────────────────────────────────────────────
  const getPriorityIcon = (p) => ({ high: '🔴', normal: '🟡', low: '🟢' }[p] ?? '🟢')
  const getTypeIcon     = (t) => ({ payment: '💰', meeting: '📅', task: '📝' }[t] ?? '📝')

  return (
    <>
      {/* ── Botón flotante ── */}
      <button className="reminder-button-apple" onClick={() => setIsOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2" />
          <path d="M5 3L2 6M22 6l-3-3" />
        </svg>
        {pendingCount > 0 && (
          <span className="reminder-badge-apple">{pendingCount}</span>
        )}
      </button>

      {/* ── Panel principal ── */}
      {isOpen && (
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
              <button className="new-reminder-btn" onClick={() => setShowForm(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Nuevo
              </button>
            </div>

            {/* Filtros */}
            <div className="sheet-filters">
              {[
                { key: 'all',      label: 'Todos' },
                { key: 'pending',  label: 'Pendientes', count: pendingCount },
                { key: 'upcoming', label: 'Próximos' }
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  className={`filter-chip ${activeFilter === key ? 'active' : ''}`}
                  onClick={() => setActiveFilter(key)}
                >
                  {label}
                  {count > 0 && <span className="chip-badge">{count}</span>}
                </button>
              ))}
            </div>

            {/* Lista */}
            <div className="reminder-list">
              {displayedReminders.length === 0 ? (
                <div className="empty-reminder">
                  <div className="empty-icon">🔔</div>
                  <h4>Sin recordatorios</h4>
                  <p>Todos tus recordatorios están al día</p>
                  <button className="btn-primary" onClick={() => setShowForm(true)}>
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
                      {reminder.message && (
                        <p className="card-message">{reminder.message}</p>
                      )}
                      <div className="card-meta">
                        <span className="meta-time">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          {formatDateTime(reminder.reminderTime)}
                        </span>
                        {reminder.sendWhatsApp && reminder.clientName && (
                          <span className="meta-whatsapp">📱 {reminder.clientName}</span>
                        )}
                      </div>
                    </div>
                    <div className="card-actions">
                      {!reminder.completed && reminder.sendWhatsApp && !reminder.whatsAppSent && (
                        <button
                          className="action-whatsapp"
                          onClick={() => sendWhatsAppReminder(reminder)}
                          title="Enviar WhatsApp"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                        </button>
                      )}
                      {!reminder.completed && (
                        <button
                          className="action-complete"
                          onClick={() => markAsCompleted(reminder.id)}
                          title="Marcar completado"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      )}
                      {/* ✅ handleDelete en lugar de deleteReminder directo */}
                      <button
                        className="action-delete"
                        onClick={() => handleDelete(reminder.id)}
                        title="Eliminar"
                      >
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
      )}

      {/* ── Modal nuevo recordatorio ── */}
      {showForm && (
        <div className="reminder-modal-apple" onClick={() => setShowForm(false)}>
          <div className="reminder-sheet form-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-header">
              <div className="sheet-header-left">
                <button className="sheet-close" onClick={() => setShowForm(false)}>
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
                  placeholder="Ej: Cobrar a cliente"
                  value={formData.title}
                  onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
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
                  <select
                    value={formData.type}
                    onChange={e => setFormData(prev => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="meeting">📅 Reunión</option>
                    <option value="payment">💰 Pago</option>
                    <option value="task">📝 Tarea</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Prioridad</label>
                  <select
                    value={formData.priority}
                    onChange={e => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                  >
                    <option value="low">🟢 Baja</option>
                    <option value="normal">🟡 Normal</option>
                    <option value="high">🔴 Alta</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Fecha y hora *</label>
                <input
                  type="datetime-local"
                  className="datetime-input-native"
                  value={getLocalDateTime(formData.reminderTime)}
                  onChange={handleDateTimeChange}
                />
              </div>

              <div className="form-group">
                <label>Repetir</label>
                <select
                  value={formData.repeat}
                  onChange={e => setFormData(prev => ({ ...prev, repeat: e.target.value }))}
                >
                  <option value="none">No repetir</option>
                  <option value="daily">Diario</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                </select>
              </div>

              {/* WhatsApp toggle */}
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
                  <div className="form-group">
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
                          <div
                            key={client.id}
                            className="client-result"
                            onClick={() => selectClient(client)}
                          >
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
                <button className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancelar
                </button>
                <button className="btn-primary" onClick={handleAddReminder}>
                  Crear recordatorio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
