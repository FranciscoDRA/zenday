import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'

const ReminderContext = createContext(null)

export const useReminders = () => {
  const context = useContext(ReminderContext)
  if (!context) throw new Error('useReminders must be used within a ReminderProvider')
  return context
}

export const ReminderProvider = ({ children }) => {
  const [reminders, setReminders] = useState(() => {
    try {
      const saved = localStorage.getItem('zenday_reminders')
      return saved ? JSON.parse(saved) : []
    } catch (e) {
      return []
    }
  })

  const notifiedIdsRef = useRef(new Set())

  // ─── Persistencia ──────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('zenday_reminders', JSON.stringify(reminders))
  }, [reminders])

  // ─── Recordatorios pendientes (derivado, sin estado extra) ─────────────────
  const pendingReminders = reminders.filter(r => {
    if (r.completed || !r.reminderTime) return false
    return new Date(r.reminderTime) <= new Date()
  })

  // ─── Agregar ───────────────────────────────────────────────────────────────
  const addReminder = useCallback((reminderData) => {
    const newReminder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      completed: false,
      notified: false,
      whatsAppSent: false,
      ...reminderData
    }
    setReminders(prev => [...prev, newReminder])
    return newReminder
  }, [])

  // ─── Completar ─────────────────────────────────────────────────────────────
  const markAsCompleted = useCallback((id) => {
    setReminders(prev =>
      prev.map(r => String(r.id) === String(id)
        ? { ...r, completed: true, completedAt: new Date().toISOString() }
        : r
      )
    )
  }, [])

  // ─── Eliminar ──────────────────────────────────────────────────────────────
  const deleteReminder = useCallback((id) => {
    notifiedIdsRef.current.delete(String(id))
    setReminders(prev => {
      const next = prev.filter(r => String(r.id) !== String(id))
      // Escribir directo para evitar que el useEffect de persistencia compita
      localStorage.setItem('zenday_reminders', JSON.stringify(next))
      return next
    })
  }, [])

  // ─── Actualizar ────────────────────────────────────────────────────────────
  const updateReminder = useCallback((id, updates) => {
    setReminders(prev =>
      prev.map(r => String(r.id) === String(id) ? { ...r, ...updates } : r)
    )
  }, [])

  // ─── Próximos (usado por el panel para filtrar) ────────────────────────────
  const getUpcomingReminders = useCallback((days = 7) => {
    const now = new Date()
    const future = new Date()
    future.setDate(future.getDate() + days)
    return reminders
      .filter(r => {
        if (r.completed || !r.reminderTime) return false
        const t = new Date(r.reminderTime)
        return t > now && t <= future
      })
      .sort((a, b) => new Date(a.reminderTime) - new Date(b.reminderTime))
  }, [reminders])

  // ─── WhatsApp ──────────────────────────────────────────────────────────────
  const sendWhatsAppReminder = useCallback((reminder) => {
    if (!reminder.clientPhone) return false

    const phone = reminder.clientPhone.replace(/\D/g, '')
    const message = encodeURIComponent(
      `🔔 *${reminder.title}*\n\n${reminder.message || 'Tienes un recordatorio pendiente.'}\n\n---\n📱 Enviado desde *ZenDay*`
    )
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank')

    setReminders(prev =>
      prev.map(r => String(r.id) === String(reminder.id)
        ? { ...r, whatsAppSent: true, whatsAppSentAt: new Date().toISOString() }
        : r
      )
    )
    return true
  }, [])

  // Escrito suelto, este objeto era NUEVO en cada render del provider, aunque
  // las funciones de adentro fueran siempre las mismas. React compara el value
  // del contexto por identidad: un objeto nuevo = "cambio" = se re-renderiza
  // TODO lo que consume el contexto. En ToastContext eso llegaba a resuscribir
  // los cuatro listeners de Firestore con cada aviso que aparecia en pantalla.
  const value = useMemo(() => ({
    reminders,
    pendingReminders,
    addReminder,
    markAsCompleted,
    deleteReminder,
    updateReminder,
    getUpcomingReminders,
    sendWhatsAppReminder,
  }), [reminders, pendingReminders, addReminder, markAsCompleted, deleteReminder, updateReminder, getUpcomingReminders, sendWhatsAppReminder])

  return (
    <ReminderContext.Provider value={value}>
      {children}
    </ReminderContext.Provider>
  )
}

export default ReminderContext