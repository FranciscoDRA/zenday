import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useConfirm } from '../../contexts/ConfirmContext'

/**
 * Componente de botón de navegación hacia atrás para aplicación Electron
 * Soporta múltiples modos (personal/profesional/emprendedor), atajos de teclado,
 * estado de carga, accesibilidad y prevención de pérdida de datos.
 * 
 * @param {Function} onClick - Función a ejecutar al hacer clic o activar atajo
 * @param {string} label - Texto alternativo para accesibilidad (default: "Volver")
 * @param {boolean} disabled - Deshabilita el botón (default: false)
 * @param {boolean} keyboardShortcut - Habilita atajos de teclado (default: true)
 * @param {boolean} confirmIfUnsaved - Pide confirmación si hay cambios sin guardar (default: false)
 * @param {Function} hasUnsavedChanges - Función que detecta si hay cambios sin guardar
 * @param {string} contextText - Texto contextual para mostrar junto al botón
 * @param {string} mode - Modo de la app: 'personal', 'professional', 'entrepreneur'
 * @param {Object} analytics - Sistema de analíticas opcional (con método .track)
 * @param {string} returnDestination - Destino de navegación para tracking
 */

// Mapa de labels por modo
const MODE_LABELS = {
  personal: 'Volver al calendario',
  professional: 'Volver al panel profesional',
  entrepreneur: 'Volver al listado',
}

// Constantes de atajos de teclado
const KEYBOARD_SHORTCUTS = {
  ESC: 'Escape',
  BACKSPACE: 'Backspace',
  ARROW_LEFT: 'ArrowLeft',
}

export function BackButton({ 
  onClick, 
  label = "Volver", 
  disabled = false,
  keyboardShortcut = true,
  confirmIfUnsaved = false,
  hasUnsavedChanges = () => false,
  contextText = null,
  mode = null,
  analytics = null,
  returnDestination = null
}) {
  const { confirm } = useConfirm()

  const [isNavigating, setIsNavigating] = useState(false)
  const buttonRef = useRef(null)
  
  // Refs para evitar stale closures en los handlers
  const onClickRef = useRef(onClick)
  const confirmIfUnsavedRef = useRef(confirmIfUnsaved)
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges)
  const isNavigatingRef = useRef(false)
  
  // Actualizar refs cuando cambian las props
  useEffect(() => {
    onClickRef.current = onClick
  }, [onClick])
  
  useEffect(() => {
    confirmIfUnsavedRef.current = confirmIfUnsaved
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [confirmIfUnsaved, hasUnsavedChanges])
  
  useEffect(() => {
    isNavigatingRef.current = isNavigating
  }, [isNavigating])

  // Trackear analytics cuando se renderiza el botón (sin dependencies inestables)
  useEffect(() => {
    if (analytics && analytics.track && mode) {
      analytics.track('BackButtonRendered', { 
        mode, 
        returnDestination,
        hasContextText: !!contextText 
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, returnDestination, contextText]) // analytics NO está en deps para evitar re-renders

  // Detectar si el elemento enfocado es editable
  const isElementEditable = useCallback((element) => {
    if (!element) return false
    
    const tagName = element.tagName
    const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)
    const isContentEditable = element.isContentEditable === true
    const hasTextboxRole = element.getAttribute('role') === 'textbox'
    const isEditableDiv = tagName === 'DIV' && element.getAttribute('contenteditable') === 'true'
    
    return isInputField || isContentEditable || hasTextboxRole || isEditableDiv
  }, [])

  // Navegación con prevención de pérdida de datos y manejo de errores
  const handleNavigation = useCallback(async (event) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    
    // Usar refs para valores actuales
    const currentDisabled = disabled
    const currentIsNavigating = isNavigatingRef.current
    const currentConfirmIfUnsaved = confirmIfUnsavedRef.current
    const currentHasUnsavedChanges = hasUnsavedChangesRef.current
    const currentOnClick = onClickRef.current
    
    if (currentDisabled || currentIsNavigating) return

    // Verificar cambios sin guardar con manejo de errores
    if (currentConfirmIfUnsaved) {
      try {
        const hasChanges = await currentHasUnsavedChanges?.()
        if (hasChanges) {
          // Era window.confirm: en Electron eso abre el cartel gris del sistema,
          // con la ruta del archivo arriba. Al lado del resto de la app parece
          // que algo se rompio. useConfirm usa el modal propio, que ademas se
          // cierra con Escape y confirma con Enter.
          const userConfirmed = await confirm(
            'Tenés cambios sin guardar.\n\nSi salís ahora se pierden.',
            'Salir sin guardar'
          )
          if (!userConfirmed) return
        }
      } catch (error) {
        console.error('Error checking unsaved changes:', error)
        // En caso de error, asumir que no hay cambios para no bloquear navegación
      }
    }

    setIsNavigating(true)

    try {
      await currentOnClick?.()
      
      // Tracking de navegación exitosa
      if (analytics && analytics.track) {
        analytics.track('BackButtonNavigation', {
          success: true,
          mode,
          returnDestination,
          navigationTime: Date.now()
        })
      }
    } catch (error) {
      console.error('Error during back navigation:', error)
      
      // Tracking de error
      if (analytics && analytics.track) {
        analytics.track('BackButtonNavigation', {
          success: false,
          error: error.message,
          mode,
          returnDestination
        })
      }
    } finally {
      setIsNavigating(false)
    }
  }, [disabled, mode, returnDestination, analytics])

  // Atajos de teclado con handleNavigation estable
  useEffect(() => {
    if (!keyboardShortcut || disabled) return

    const handleKeyDown = (e) => {
      const activeElement = document.activeElement
      const isEditable = isElementEditable(activeElement)
      
      // Escape: siempre funciona excepto en elementos editables
      if (e.key === KEYBOARD_SHORTCUTS.ESC && !isEditable) {
        e.preventDefault()
        handleNavigation(e)
      }
      
      // Backspace: SOLO cuando no hay nada enfocado (body es el foco)
      if (e.key === KEYBOARD_SHORTCUTS.BACKSPACE && activeElement === document.body) {
        e.preventDefault()
        handleNavigation(e)
      }
      
      // Flecha izquierda + Ctrl/Cmd: funciona excepto en elementos editables
      if (e.key === KEYBOARD_SHORTCUTS.ARROW_LEFT && (e.ctrlKey || e.metaKey) && !isEditable) {
        e.preventDefault()
        handleNavigation(e)
      }
      
      // Alt + Flecha izquierda: funciona excepto en elementos editables
      if (e.key === KEYBOARD_SHORTCUTS.ARROW_LEFT && e.altKey && !isEditable) {
        e.preventDefault()
        handleNavigation(e)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keyboardShortcut, disabled, handleNavigation, isElementEditable])

  // Obtener texto contextual según el modo
  const getContextualLabel = () => {
    if (contextText) return contextText
    if (mode && MODE_LABELS[mode]) return MODE_LABELS[mode]
    return label
  }

  // Detectar sistema operativo para mostrar atajos correctos
  const getKeyboardShortcutText = () => {
    // Método moderno para detectar macOS
    const isMac = navigator.userAgent?.includes('Mac') || 
                  navigator.platform?.toUpperCase().includes('MAC') ||
                  (typeof process !== 'undefined' && process?.platform === 'darwin')
    
    const ctrlKey = isMac ? '⌘' : 'Ctrl'
    
    if (mode === 'entrepreneur') {
      return ` (${ctrlKey}+← / Esc)`
    }
    return ` (Esc)`
  }

  // Badge visual con atajo de teclado (mejor UX que tooltip nativo)
  const getShortcutBadge = () => {
    if (!keyboardShortcut) return null
    
    const isMac = navigator.userAgent?.includes('Mac') || 
                  navigator.platform?.toUpperCase().includes('MAC') ||
                  (typeof process !== 'undefined' && process?.platform === 'darwin')
    
    const ctrlKey = isMac ? '⌘' : 'Ctrl'
    
    if (mode === 'entrepreneur') {
      return (
        <span className="back-button-shortcut" aria-label="Atajo de teclado">
          {ctrlKey}+←
        </span>
      )
    }
    
    return (
      <span className="back-button-shortcut" aria-label="Atajo de teclado">
        Esc
      </span>
    )
  }

  return (
    <div className="back-button-container">
      <div className="back-button-wrapper">
        <button 
          ref={buttonRef}
          type="button"
          className={`back-btn ${disabled || isNavigating ? 'back-btn-disabled' : ''}`}
          onClick={handleNavigation}
          aria-label={`${getContextualLabel()}${keyboardShortcut ? getKeyboardShortcutText() : ''}`}
          disabled={disabled || isNavigating}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          
          {isNavigating && (
            <span className="back-btn-spinner" aria-label="Cargando...">
              ⏳
            </span>
          )}
        </button>
        
        {getShortcutBadge()}
      </div>
      
      {contextText && (
        <span className="back-button-context">
          {contextText}
        </span>
      )}
    </div>
  )
}