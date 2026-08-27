import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // El objeto del contexto se memoriza a propósito.
  //
  // Escrito como `value={{ addToast, removeToast }}` era un objeto NUEVO en
  // cada render del provider — y el provider re-renderiza cada vez que aparece
  // un toast y otra vez cuando se va solo a los 3 segundos.
  //
  // Eso hacía que `toast` cambiara de identidad todo el tiempo, y App.jsx tiene
  // `toast` en las dependencias del efecto que suscribe a Firestore: cada toast
  // desarmaba y rearmaba las cuatro suscripciones, y el snapshot fresco pisaba
  // el estado local. El caso feo era guardar algo: salía el toast de "guardado",
  // eso mismo re-suscribía, y llegaba la versión del servidor sin lo recién
  // guardado. Ambas funciones ya son estables (useCallback con deps vacías).
  const value = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}