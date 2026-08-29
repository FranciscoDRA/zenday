import React, { useState, useEffect } from 'react'
import { esMobil } from '../../utils/platform'

export function WindowControls({ actions }) {
  const [isMaximized, setIsMaximized] = useState(false)
  // El celular no tiene ventana que minimizar/maximizar/cerrar — esos tres
  // botones no significan nada ahí — pero SÍ necesita la barra de acciones
  // (avisos de error, notificaciones, recordatorios, backups), así que la
  // franja de arriba se sigue mostrando, sólo sin los controles de ventana.
  const mostrarControlesDeVentana = !esMobil()

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    const init = async () => {
      try {
        const fn = api.isMaximized ?? api.getIsMaximized
        if (fn) setIsMaximized(await fn())
      } catch (err) {
        console.error('[WindowControls] isMaximized:', err)
      }
    }
    init()

    let unsubscribe
    try {
      if (api.onWindowMaximized) {
        unsubscribe = api.onWindowMaximized(setIsMaximized)
      }
    } catch (err) {
      console.error('[WindowControls] onWindowMaximized:', err)
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      } else if (api.offWindowMaximized) {
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

      {/* Acciones: NotificationCenter, ReminderPanel, BackupManager */}
      {actions && (
        <div
          className="window-controls__group"
          style={{ WebkitAppRegion: 'no-drag', marginLeft: 'auto', marginRight: '8px' }}
        >
          {actions}
        </div>
      )}

      {mostrarControlesDeVentana && (
      <div className="window-controls__group" style={{ WebkitAppRegion: 'no-drag' }}>

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
      )}
    </div>
  )
}