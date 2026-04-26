import React, { useState, useEffect } from 'react'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    // Estado inicial
    const init = async () => {
      try {
        const fn = api.isMaximized ?? api.getIsMaximized
        if (fn) setIsMaximized(await fn())
      } catch (err) {
        console.error('[WindowControls] isMaximized:', err)
      }
    }
    init()

    // Suscribir al cambio de estado
    // onWindowMaximized debe devolver una función de cleanup (patrón estándar en Electron)
    let unsubscribe
    try {
      if (api.onWindowMaximized) {
        unsubscribe = api.onWindowMaximized(setIsMaximized)
      }
    } catch (err) {
      console.error('[WindowControls] onWindowMaximized:', err)
    }

    return () => {
      // Si el preload devuelve un cleanup, lo usamos
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      } else if (api.offWindowMaximized) {
        // Alternativa: API explícita de desuscripción
        try { api.offWindowMaximized(setIsMaximized) } catch {}
      }
    }
  }, [])

  const call = (name, fallback) => {
    try {
      const api = window.electronAPI
      const fn  = api?.[name] ?? api?.[fallback]
      fn?.()
    } catch (err) {
      console.error(`[WindowControls] ${name}:`, err)
    }
  }

  return (
    <div className="window-controls">
      <div className="window-title">
        <span>ZenDay</span>
      </div>

      <div className="window-controls__group">

        {/* Minimizar */}
        <button
          className="win-control win-control--minimize"
          onClick={() => call('minimize', 'minimizeWindow')}
          title="Minimizar"
          aria-label="Minimizar ventana"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="7.5" width="12" height="1" fill="currentColor" />
          </svg>
        </button>

        {/* Maximizar / Restaurar */}
        <button
          className={`win-control win-control--maximize${isMaximized ? ' restore' : ''}`}
          onClick={() => call('maximize', 'maximizeWindow')}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
          aria-label={isMaximized ? 'Restaurar ventana' : 'Maximizar ventana'}
        >
          {isMaximized ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M5 2L5 3M11 2L11 3M2 5L3 5M2 11L3 11M14 5L13 5M14 11L13 11" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          )}
        </button>

        {/* Cerrar */}
        <button
          className="win-control win-control--close"
          onClick={() => call('close', 'closeWindow')}
          title="Cerrar"
          aria-label="Cerrar aplicación"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

      </div>
    </div>
  )
}