import React, { useState, useRef, useEffect } from 'react'
import { USER_MODES } from '../../utils/constants'
import { puedeVerPantalla } from '../../utils/businessRoles'

export function Sidebar({ activeTab, onSwitchTab, canGoBack, userMode, user, onLogout, alertas = 0, myRole }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  const getTabs = () => {
    if (userMode === 'personal') {
      return [
        { id: 'personal',  label: 'Mi Agenda',      icon: '🙋', key: '1' },
        { id: 'settings',  label: 'Configuración',  icon: '⚙️', key: '2' }
      ]
    }
    if (userMode === 'entrepreneur') {
      return [
        { id: 'dashboard',   label: 'Panel',          icon: '📊', key: '1' },
        { id: 'patients',    label: 'Clientes',       icon: '👥', key: '2' },
        { id: 'emprendedor', label: 'Mis Pedidos',    icon: '📦', key: '3' },
        { id: 'products',    label: 'Artículos',      icon: '📋', key: '4' },
        { id: 'expenses',    label: 'Gastos',         icon: '💰', key: '5' },
        { id: 'pending',     label: 'Pagos Pend.',    icon: '💳', key: '6' },
        { id: 'alertas',     label: 'Alertas',        icon: '🔔', key: '7', badge: alertas },
        { id: 'reports',     label: 'Reportes',       icon: '📊', key: '8' },
        { id: 'settings',    label: 'Configuración',  icon: '⚙️', key: '9' }
      ]
    }
    return [
      { id: 'dashboard',  label: 'Panel',          icon: '📊', key: '1' },
      { id: 'agenda',     label: 'Agenda',         icon: '📅', key: '2' },
      { id: 'patients',   label: 'Clientes',       icon: '👥', key: '3' },
      { id: 'kanban',     label: 'Kanban',         icon: '📋', key: '4' },
      { id: 'financial',  label: 'Finanzas',       icon: '💰', key: '5' },
      { id: 'pending',    label: 'Pagos Pend.',    icon: '💳', key: '6' },
      { id: 'alertas',    label: 'Alertas',        icon: '🔔', key: '7', badge: alertas },
      { id: 'reports',    label: 'Reportes',       icon: '📊', key: '8' },
      { id: 'settings',   label: 'Configuración',  icon: '⚙️', key: '9' },
    ]
  }

  // Esconde del menú lo que el rol actual no puede abrir (ver
  // businessRoles.js) — la barrera real es firestore.rules, esto es sólo
  // para no ofrecer un botón que el servidor va a rechazar.
  const tabs = getTabs().filter(tab => puedeVerPantalla(myRole, tab.id))
  const userInitial = user?.email?.charAt(0).toUpperCase() || '?'
  const userEmail = user?.email || ''

  // ── Alt+N, que hasta ahora era un cartel y nada más ────────────────────────
  //
  // Cada botón mostraba "Alt+1", "Alt+2"… y NADIE escuchaba esa combinación:
  // buscando `altKey` en todo el proyecto aparecía una sola vez, en BackButton,
  // y era para Alt+←. O sea que los nueve atajos anunciados no existían.
  //
  // Un atajo que se anuncia y no funciona es peor que no anunciarlo: el usuario
  // lo prueba, no pasa nada, y a partir de ahí desconfía de los otros carteles
  // de la app.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    const alPresionar = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      // Si está escribiendo, el atajo no interrumpe.
      const el = document.activeElement
      const escribiendo = el && (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      )
      if (escribiendo) return

      const destino = tabsRef.current.find(t => t.key === e.key)
      if (!destino) return
      e.preventDefault()
      onSwitchTab(destino.id)
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [onSwitchTab])

  return (
    <aside className={`windows-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!isCollapsed ? (
          <>
            <h1>ZenDay</h1>
            <p className="sidebar-subtitle">{USER_MODES[userMode]?.label || 'Consultorio'}</p>
          </>
        ) : (
          <h1>ZD</h1>
        )}
        <button className="sidebar-toggle" onClick={() => setIsCollapsed(!isCollapsed)}>
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`sidebar-item ${activeTab === tab.id && !canGoBack ? 'active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            title={isCollapsed ? tab.label : undefined}
          >
            <span className="sidebar-icon">{tab.icon}</span>
            {/* Plegada, el contador va sobre el ícono: si no, la única señal de
                que hay algo para mirar desaparece justo cuando hay menos lugar
                para buscarla. */}
            {isCollapsed && tab.badge > 0 && (
              <span className="sidebar-badge es-punto" aria-hidden="true" />
            )}
            {!isCollapsed && (
              <>
                <span className="sidebar-label">{tab.label}</span>
                {tab.badge > 0 && (
                  <span className="sidebar-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
                )}
                <span className="sidebar-key">Alt+{tab.key}</span>
              </>
            )}
            {activeTab === tab.id && !canGoBack && <div className="active-indicator" />}
          </button>
        ))}
      </nav>

      {/* Avatar con menú */}
      {user && (
        <div style={{ padding: '12px', borderTop: '0.5px solid var(--border)', position: 'relative' }}>
          <button
            onClick={() => setShowUserMenu(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '12px', border: 'none',
              background: showUserMenu ? 'var(--bg-tertiary)' : 'transparent',
              cursor: 'pointer', transition: 'background 0.2s',
            }}
            title={isCollapsed ? userEmail : undefined}
          >
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: '15px',
            }}>
              {userInitial}
            </div>
            {!isCollapsed && (
              <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', 
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {userEmail}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  {USER_MODES[userMode]?.label || 'Usuario'}
                </div>
              </div>
            )}
          </button>

          {/* Menú desplegable */}
          {showUserMenu && (
            <>
              {/* Click outside */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                onClick={() => setShowUserMenu(false)}
              />
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: '12px',
                right: '12px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 100,
                overflow: 'hidden',
                marginBottom: '8px',
              }}>
                {/* Info usuario */}
                <div style={{
                  padding: '14px 16px',
                  borderBottom: '0.5px solid var(--border)',
                  background: 'var(--bg-secondary)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'white', fontWeight: 700, fontSize: '16px',
                    }}>
                      {userInitial}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {userEmail}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {USER_MODES[userMode]?.label || 'Usuario'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Opciones */}
                <div style={{ padding: '6px' }}>
                  <button
                    onClick={() => { onSwitchTab('settings'); setShowUserMenu(false) }}
                    style={{
                      width: '100%', padding: '10px 12px', display: 'flex',
                      alignItems: 'center', gap: '10px', borderRadius: '10px',
                      border: 'none', background: 'transparent',
                      cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    ⚙️ <span>Configuración</span>
                  </button>

                  <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />

                  <button
                    onClick={() => { onLogout(); setShowUserMenu(false) }}
                    style={{
                      width: '100%', padding: '10px 12px', display: 'flex',
                      alignItems: 'center', gap: '10px', borderRadius: '10px',
                      border: 'none', background: 'transparent',
                      cursor: 'pointer', fontSize: '13px', color: 'var(--accent-red)',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    🚪 <span>Cerrar sesión</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        .windows-sidebar.collapsed { width: 60px; }

        .sidebar-badge {
          min-width: 18px; height: 18px; padding: 0 5px;
          border-radius: 9px;
          background: var(--accent-red, #ef4444); color: #fff;
          font-size: 10px; font-weight: 800; line-height: 18px;
          text-align: center; flex-shrink: 0;
        }
        /* Plegada no entra el número: alcanza con que se vea que hay algo. */
        .sidebar-badge.es-punto {
          position: absolute; top: 6px; right: 8px;
          min-width: 8px; width: 8px; height: 8px; padding: 0; border-radius: 50%;
        }
        .windows-sidebar .sidebar-item { position: relative; }
      `}</style>
    </aside>
  )
}