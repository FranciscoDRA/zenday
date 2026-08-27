// src/contexts/ConfirmContext.jsx
// ✅ VERSIÓN COMPLETA Y CORREGIDA - PRODUCTION-READY

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'

const ConfirmContext = createContext(null)

// Tipos de diálogo
export const DIALOG_TYPES = {
  INFO: 'info',
  WARNING: 'warning',
  DANGER: 'danger',
  SUCCESS: 'success'
}

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [isVisible, setIsVisible] = useState(false)
  const dialogRef = useRef(null)

  // Manejar tecla Escape y Enter
  useEffect(() => {
    if (!dialog) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose(false)
      } else if (e.key === 'Enter' && dialog) {
        // Enter confirma (si no hay input enfocado)
        const activeElement = document.activeElement
        if (!activeElement || activeElement.tagName !== 'INPUT') {
          handleClose(true)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    
    // Animar entrada
    requestAnimationFrame(() => {
      setIsVisible(true)
    })

    // Enfocar el diálogo
    if (dialogRef.current) {
      dialogRef.current.focus()
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      setIsVisible(false)
    }
  }, [dialog])

  // Bloquear scroll del body cuando el diálogo está abierto
  useEffect(() => {
    if (dialog) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    
    return () => {
      document.body.style.overflow = ''
    }
  }, [dialog])

  const confirm = useCallback((message, title = null, options = {}) => {
    return new Promise((resolve) => {
      setDialog({
        message,
        title: title || 'Confirmar',
        type: options.type || DIALOG_TYPES.INFO,
        confirmText: options.confirmText || 'Aceptar',
        cancelText: options.cancelText || 'Cancelar',
        showCancel: options.showCancel !== false,
        resolve
      })
    })
  }, [])

  const alert = useCallback((message, title = null, options = {}) => {
    return new Promise((resolve) => {
      setDialog({
        message,
        title: title || 'Atención',
        type: options.type || DIALOG_TYPES.INFO,
        confirmText: options.confirmText || 'Entendido',
        showCancel: false,
        resolve
      })
    })
  }, [])

  const handleClose = useCallback((result) => {
    if (dialog) {
      setIsVisible(false)
      setTimeout(() => {
        dialog.resolve(result)
        setDialog(null)
      }, 200)
    }
  }, [dialog])

  const getIcon = (type) => {
    switch (type) {
      case DIALOG_TYPES.WARNING:
        return '⚠️'
      case DIALOG_TYPES.DANGER:
        return '🔴'
      case DIALOG_TYPES.SUCCESS:
        return '✅'
      default:
        return 'ℹ️'
    }
  }

  const getColors = (type) => {
    switch (type) {
      case DIALOG_TYPES.WARNING:
        return {
          border: '#f59e0b',
          button: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.05)',
          hover: '#d97706'
        }
      case DIALOG_TYPES.DANGER:
        return {
          border: '#ef4444',
          button: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.05)',
          hover: '#dc2626'
        }
      case DIALOG_TYPES.SUCCESS:
        return {
          border: '#10b981',
          button: '#10b981',
          bg: 'rgba(16, 185, 129, 0.05)',
          hover: '#059669'
        }
      default:
        return {
          border: '#6366f1',
          button: '#6366f1',
          bg: 'rgba(99, 102, 241, 0.05)',
          hover: '#4f46e5'
        }
    }
  }

  // Escrito suelto, este objeto era NUEVO en cada render del provider, aunque
  // las funciones de adentro fueran siempre las mismas. React compara el value
  // del contexto por identidad: un objeto nuevo = "cambio" = se re-renderiza
  // TODO lo que consume el contexto. En ToastContext eso llegaba a resuscribir
  // los cuatro listeners de Firestore con cada aviso que aparecia en pantalla.
  const value = useMemo(() => ({
    confirm,
    alert,
    DIALOG_TYPES,
  }), [confirm, alert])

  const colors = dialog ? getColors(dialog.type) : null

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      
      {dialog && (
        <div 
          className={`confirm-overlay ${isVisible ? 'visible' : ''}`} 
          onClick={() => handleClose(false)}
          aria-hidden={!isVisible}
        >
          <div 
            ref={dialogRef}
            className={`confirm-dialog ${isVisible ? 'visible' : ''}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              borderTop: `4px solid ${colors?.border}`
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-describedby="dialog-message"
            tabIndex={-1}
          >
            <div className="dialog-header">
              <span className="dialog-icon" aria-hidden="true">
                {getIcon(dialog.type)}
              </span>
              <h3 id="dialog-title">{dialog.title}</h3>
              <button 
                className="dialog-close"
                onClick={() => handleClose(false)}
                aria-label="Cerrar diálogo"
                title="Cerrar (Esc)"
              >
                ✕
              </button>
            </div>
            
            <div className="dialog-body">
              <p id="dialog-message">{dialog.message}</p>
            </div>
            
            <div className="dialog-footer">
              {dialog.showCancel && (
                <button 
                  className="btn-cancel"
                  onClick={() => handleClose(false)}
                >
                  {dialog.cancelText}
                </button>
              )}
              <button 
                className="btn-confirm"
                style={{
                  background: colors?.button,
                  borderColor: colors?.button,
                  '--hover-color': colors?.hover
                }}
                onClick={() => handleClose(true)}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}


    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider')
  }
  return context
}

export default ConfirmProvider