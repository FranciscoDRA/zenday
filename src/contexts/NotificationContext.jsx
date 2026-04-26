import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('zenday-notifications')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // ── Persistencia ───────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem('zenday-notifications', JSON.stringify(notifications))
    } catch (err) {
      console.error('[Notifications] Error saving:', err)
    }
  }, [notifications])

  // ── Contador de no leídas (valor derivado, no estado) ──────────────────────
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications]
  )

  // ── Agregar ────────────────────────────────────────────────────────────────
  const addNotification = useCallback((type, title, message, link = null) => {
    const newNotification = {
      id:        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type,      // 'success' | 'warning' | 'error' | 'info'
      title,
      message,
      link,      // { screen: 'products', params: {} } | null
      read:      false,
      createdAt: new Date().toISOString(),
    }

    setNotifications(prev => [newNotification, ...prev].slice(0, 100))

    // Notificación del sistema — verificar que el API existe y está permitida
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body: message })
      } catch {
        // Silencioso — algunos contextos de Electron no lo soportan
      }
    }
  }, [])

  // ── Leer ───────────────────────────────────────────────────────────────────
  const markAsRead = useCallback((id) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    )
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  // ── Eliminar ───────────────────────────────────────────────────────────────
  const deleteNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
    }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used within NotificationProvider')
  return context
}