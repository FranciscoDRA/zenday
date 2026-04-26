import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNotifications } from '../../contexts/NotificationContext'
import { formatDateTime } from '../../utils/helpers'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  success: { icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  warning: { icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  error:   { icon: '🚨', color: '#ef4444', bg: 'rgba(239,68,68,0.10)'  },
  info:    { icon: '📋', color: '#6366f1', bg: 'rgba(99,102,241,0.10)' },
}

function getConfig(type) {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG.info
}

// CORREGIDO: getTimeAgo ahora recibe el timestamp actual explícitamente
function getTimeAgo(date, nowTimestamp) {
  if (!date) return '—'
  const diff = nowTimestamp - new Date(date).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours   = Math.floor(diff / 3_600_000)
  const days    = Math.floor(diff / 86_400_000)
  if (minutes < 1)  return 'Ahora mismo'
  if (minutes < 60) return `Hace ${minutes} min`
  if (hours   < 24) return `Hace ${hours} h`
  if (days    < 7)  return `Hace ${days} d`
  return formatDateTime(date)
}

// CORREGIDO: Filtros por categoría (más robusto que strings hardcodeados)
// Para compatibilidad con notificaciones existentes, también busca en título
const isRelevantForProfessional = (n) => {
  // Nuevo sistema: categorías
  if (n.category) {
    return ['financial', 'appointment', 'patient', 'agenda', 'pending'].includes(n.category)
  }
  // Fallback para notificaciones viejas
  const title = n.title?.toLowerCase() || ''
  return title.includes('pago') ||
    title.includes('cita') ||
    title.includes('cliente') ||
    title.includes('agenda') ||
    title.includes('pedido') ||
    title.includes('reprogramada') ||
    title.includes('creada') ||
    ['agenda', 'financial', 'patients', 'pending'].includes(n.link?.screen)
}

const isRelevantForEntrepreneur = (n) => {
  // Nuevo sistema: categorías
  if (n.category) {
    return ['stock', 'order', 'financial', 'products', 'pending'].includes(n.category)
  }
  // Fallback para notificaciones viejas
  const title = n.title?.toLowerCase() || ''
  return title.includes('stock') ||
    title.includes('pedido') ||
    title.includes('pago') ||
    title.includes('completado') ||
    title.includes('eliminado') ||
    title.includes('agotado') ||
    ['products', 'pending', 'financial'].includes(n.link?.screen)
}

// Modo personal: notificaciones de recordatorios y eventos
const isRelevantForPersonal = (n) => {
  if (n.category) {
    return ['reminder', 'event', 'task', 'appointment'].includes(n.category)
  }
  const title = n.title?.toLowerCase() || ''
  return title.includes('recordatorio') ||
    title.includes('cita') ||
    title.includes('evento') ||
    title.includes('tarea')
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export function NotificationCenter({ nav, userMode = 'professional' }) {
  const [isOpen,    setIsOpen]    = useState(false)
  const [panelPos,  setPanelPos]  = useState({ top: 0, right: 0 })
  const [showAll,   setShowAll]   = useState(false)  // ← NUEVO: control de "ver más"
  const [now,       setNow]       = useState(Date.now())  // ← para refrescar timestamps

  const { notifications, markAsRead, markAllAsRead, deleteNotification, clearAll } = useNotifications()

  const bellRef  = useRef(null)
  const panelRef = useRef(null)

  // ── Filtrar por modo ──────────────────────────────────────────────────────
  const modeNotifications = useMemo(() => {
    let filter
    if (userMode === 'entrepreneur') filter = isRelevantForEntrepreneur
    else if (userMode === 'personal') filter = isRelevantForPersonal
    else filter = isRelevantForProfessional
    
    return notifications.filter(filter)
  }, [notifications, userMode])

  const modeUnreadCount = useMemo(
    () => modeNotifications.filter(n => !n.read).length,
    [modeNotifications]
  )

  const modeLabel = userMode === 'entrepreneur'
    ? { title: 'Alertas del negocio', empty: 'Sin alertas de stock o pedidos' }
    : userMode === 'personal'
    ? { title: 'Recordatorios', empty: 'Sin recordatorios próximos' }
    : { title: 'Notificaciones', empty: 'Sin notificaciones de citas o pagos' }

  // ── Abrir / cerrar ────────────────────────────────────────────────────────
  const handleOpen = () => {
    if (bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect()
      const rightPos = window.innerWidth - rect.right
      // CORREGIDO: Evitar que el panel quede fuera de pantalla
      const maxRight = Math.min(rightPos, window.innerWidth - 360)
      setPanelPos({ top: rect.bottom + 8, right: Math.max(8, maxRight) })
    }
    setShowAll(false)  // Resetear "ver más" al abrir
    setIsOpen(o => !o)
  }

  // CORREGIDO: Recalcular posición al redimensionar ventana
  useEffect(() => {
    if (!isOpen || !bellRef.current) return
    
    const recalcPos = () => {
      if (bellRef.current) {
        const rect = bellRef.current.getBoundingClientRect()
        const rightPos = window.innerWidth - rect.right
        const maxRight = Math.min(rightPos, window.innerWidth - 360)
        setPanelPos({ top: rect.bottom + 8, right: Math.max(8, maxRight) })
      }
    }
    
    window.addEventListener('resize', recalcPos)
    return () => window.removeEventListener('resize', recalcPos)
  }, [isOpen])

  const handleNotificationClick = useCallback((n) => {
    markAsRead(n.id)
    // CORREGIDO: Verificar que nav existe y que la ruta es válida
    if (n.link && n.link.screen && nav?.navigate) {
      try {
        nav.navigate(n.link.screen, n.link.params)
        setIsOpen(false)
      } catch (err) {
        console.error(`[NotificationCenter] Failed to navigate to ${n.link.screen}:`, err)
      }
    }
  }, [markAsRead, nav])

  // CORREGIDO: handleClearAll elimina solo notificaciones del modo actual
  const handleClearAll = useCallback(() => {
    if (!window.confirm(`¿Eliminar todas las notificaciones de ${modeLabel.title.toLowerCase()}?`)) return
    modeNotifications.forEach(n => deleteNotification(n.id))
    setIsOpen(false)
    setShowAll(false)
  }, [modeNotifications, deleteNotification, modeLabel.title])

  // CORREGIDO: markAllAsRead solo marca las del modo actual
  const handleMarkAllAsRead = useCallback(() => {
    modeNotifications.forEach(n => {
      if (!n.read) markAsRead(n.id)
    })
  }, [modeNotifications, markAsRead])

  // ── Click-outside ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (panelRef.current?.contains(e.target) || bellRef.current?.contains(e.target)) return
      setIsOpen(false)
      setShowAll(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  // ── Refrescar timestamps (ahora con now explícito) ─────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [isOpen])

  const VISIBLE = 8
  const visibleNotifications = showAll 
    ? modeNotifications 
    : modeNotifications.slice(0, VISIBLE)
  const hasMore = modeNotifications.length > VISIBLE && !showAll

  // ── Navegación segura para link de WhatsApp en notificaciones ──────────────
  const handleWhatsAppClick = useCallback((phone, e) => {
    e.stopPropagation()
    if (!phone) return
    const url = `https://wa.me/${phone.replace(/[\s\-\(\)]/g, '')}`
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }, [])

  // ─── PANEL ────────────────────────────────────────────────────────────────
  const panel = isOpen ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Centro de notificaciones"
      style={{
        position:      'fixed',
        top:           panelPos.top,
        right:         panelPos.right,
        width:         360,
        maxHeight:     520,
        background:    'var(--bg-secondary)',
        borderRadius:  18,
        border:        '1px solid var(--border)',
        boxShadow:     '0 20px 48px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.06)',
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        zIndex:        9999,
        animation:     'popIn 0.15s cubic-bezier(0.34,1.4,0.64,1)',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '14px 16px',
        borderBottom:   '1px solid var(--border)',
        background:     'var(--bg-tertiary)',
        flexShrink:     0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {modeLabel.title}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {modeUnreadCount > 0 && (
            <button onClick={handleMarkAllAsRead} style={btnStyle}>✓ Todo leído</button>
          )}
          {modeNotifications.length > 0 && (
            <button onClick={handleClearAll} style={iconBtnStyle} title="Limpiar todo">🗑</button>
          )}
        </div>
      </div>

      {/* ── Lista ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {modeNotifications.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'48px 24px', textAlign:'center' }}>
            <span style={{ fontSize: 40, opacity: .25, marginBottom: 12 }}>🔔</span>
            <p style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 600, margin: 0 }}>
              {modeLabel.empty}
            </p>
          </div>
        ) : (
          visibleNotifications.map(n => {
            const cfg = getConfig(n.type)
            return (
              <NotificationItem
                key={n.id}
                n={n}
                cfg={cfg}
                nowTimestamp={now}
                onClick={() => handleNotificationClick(n)}
                onDelete={() => deleteNotification(n.id)}
                onWhatsAppClick={userMode === 'entrepreneur' && n.category === 'order' ? 
                  (phone) => handleWhatsAppClick(phone, new Event('click')) : null}
              />
            )
          })
        )}
      </div>

      {/* ── Footer CORREGIDO: "Ver más" en lugar de cerrar ── */}
      {hasMore && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-tertiary)', flexShrink: 0 }}>
          <button
            onClick={() => setShowAll(true)}
            style={{ width:'100%', padding: '8px', background:'transparent', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 600, color:'var(--accent-blue)', cursor:'pointer', fontFamily:'inherit' }}
          >
            📋 Ver {modeNotifications.length - VISIBLE} notificaciones más
          </button>
        </div>
      )}
      
      {/* Footer para "Mostrar menos" cuando está expandido */}
      {showAll && modeNotifications.length > VISIBLE && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-tertiary)', flexShrink: 0 }}>
          <button
            onClick={() => setShowAll(false)}
            style={{ width:'100%', padding: '8px', background:'transparent', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 600, color:'var(--text-tertiary)', cursor:'pointer', fontFamily:'inherit' }}
          >
            Mostrar menos
          </button>
        </div>
      )}
    </div>
  ) : null

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="notification-center">
        <button
          ref={bellRef}
          className="notification-bell"
          onClick={handleOpen}
          title="Notificaciones"
          aria-label={`Notificaciones${modeUnreadCount > 0 ? `, ${modeUnreadCount} sin leer` : ''}`}
          aria-expanded={isOpen}
        >
          🔔
          {modeUnreadCount > 0 && (
            <span className="notification-badge" aria-hidden="true">
              {modeUnreadCount > 9 ? '9+' : modeUnreadCount}
            </span>
          )}
        </button>
      </div>
      {createPortal(panel, document.body)}
    </>
  )
}

// ─── ITEM SEPARADO (evita re-renders del panel entero en hover) ───────────────

function NotificationItem({ n, cfg, nowTimestamp, onClick, onDelete, onWhatsAppClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          12,
        padding:      '12px 16px',
        borderBottom: '1px solid var(--border)',
        cursor:       n.link ? 'pointer' : 'default',
        background:   hovered ? 'var(--bg-tertiary)' : (!n.read ? 'rgba(99,102,241,0.04)' : 'transparent'),
        borderLeft:   !n.read ? '3px solid var(--accent-blue)' : '3px solid transparent',
        transition:   'background 0.12s',
        position:     'relative',
      }}
    >
      {/* Ícono con fondo */}
      <div style={{
        width:          38,
        height:         38,
        background:     cfg.bg,
        borderRadius:   10,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       18,
        flexShrink:     0,
      }}>
        {cfg.icon}
      </div>

      {/* Texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, letterSpacing: '-0.01em' }}>
          {n.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.4 }}>
          {n.message}
        </div>
        
        {/* Botón WhatsApp inline para pedidos (modo emprendedor) */}
        {onWhatsAppClick && n.data?.phone && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onWhatsAppClick(n.data.phone)
            }}
            style={{
              background: 'rgba(37, 211, 102, 0.15)',
              border: 'none',
              borderRadius: 16,
              padding: '2px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#25d366',
              cursor: 'pointer',
              marginTop: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            💬 Contactar por WhatsApp
          </button>
        )}
        
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginTop: onWhatsAppClick ? 6 : 0 }}>
          {getTimeAgo(n.createdAt, nowTimestamp)}
        </div>
      </div>

      {/* Botón eliminar — visible al hover */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{
            width:          26,
            height:         26,
            background:     'rgba(239,68,68,0.10)',
            border:         'none',
            borderRadius:   '50%',
            fontSize:       12,
            cursor:         'pointer',
            color:          '#ef4444',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
          }}
          title="Eliminar"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ─── ESTILOS REUTILIZABLES ────────────────────────────────────────────────────

const btnStyle = {
  padding:      '5px 12px',
  background:   'transparent',
  border:       '1px solid var(--border)',
  borderRadius: 20,
  fontSize:     12,
  fontWeight:   700,
  color:        'var(--text-secondary)',
  cursor:       'pointer',
  fontFamily:   'inherit',
}

const iconBtnStyle = {
  width:          30,
  height:         30,
  background:     'transparent',
  border:         '1px solid var(--border)',
  borderRadius:   '50%',
  fontSize:       14,
  cursor:         'pointer',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  color:          'var(--text-tertiary)',
}