import React, { useState } from 'react'
import { USER_MODES } from '../../utils/constants'

export function Sidebar({ activeTab, onSwitchTab, canGoBack, userMode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  
  const getTabs = () => {
    // Modo personal — solo agenda personal y configuración
    if (userMode === 'personal') {
      return [
        { id: 'personal',  label: 'Mi Agenda',      icon: '🙋', key: '1' },
        { id: 'settings',  label: 'Configuración',  icon: '⚙️', key: '2' }
      ]
    }
    
    // Modo emprendedor / merchant
    if (userMode === 'entrepreneur' || userMode === 'merchant') {
      return [
        { id: 'dashboard',   label: 'Panel',          icon: '📊', key: '1' },
        { id: 'patients',    label: 'Clientes',       icon: '👥', key: '2' },
        { id: 'emprendedor', label: 'Mis Pedidos',    icon: '📦', key: '3' },
        { id: 'products',    label: 'Artículos',      icon: '📋', key: '4' },
        { id: 'expenses',    label: 'Gastos',         icon: '💰', key: '5' },
        { id: 'pending',     label: 'Pagos Pend.',    icon: '💳', key: '6' },
        { id: 'reports',     label: 'Reportes',       icon: '📊', key: '7' },
        { id: 'settings',    label: 'Configuración',  icon: '⚙️', key: '8' }
      ]
    }
    
    // Modo profesional — agenda clientes + agenda personal
    return [
      { id: 'dashboard',  label: 'Panel',          icon: '📊', key: '1' },
      { id: 'agenda', label: 'Agenda', icon: '📅', key: '2' },
     
      { id: 'patients',   label: 'Clientes',       icon: '👥', key: '4' },
      { id: 'kanban',     label: 'Kanban',         icon: '📋', key: '5' },
      
      { id: 'financial',  label: 'Finanzas',       icon: '💰', key: '7' },
      { id: 'pending',    label: 'Pagos Pend.',    icon: '💳', key: '8' },
      { id: 'reports',    label: 'Reportes',       icon: '📊', key: '9' },
      { id: 'settings',   label: 'Configuración',  icon: '⚙️', key: '0' }
    ]
  }
  
  const tabs = getTabs()
  
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
            {!isCollapsed && (
              <>
                <span className="sidebar-label">{tab.label}</span>
                <span className="sidebar-key">Alt+{tab.key}</span>
              </>
            )}
            {activeTab === tab.id && !canGoBack && <div className="active-indicator" />}
          </button>
        ))}
      </nav>
      
      <style>{`
        .windows-sidebar.collapsed {
          width: 60px;
        }
      `}</style>
    </aside>
  )
}